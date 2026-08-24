import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PLAN_LIMITS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { formatTelegramChatText } from '../telegram/telegram.chat';
import { emailLocale } from '../common/i18n/email-locale';
import { AuthUser } from '../common/auth.decorators';
import { effectivePlan } from '../common/effective-plan';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private presence: PresenceService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  private pairIds(a: string, b: string) {
    return a < b ? [a, b] : [b, a];
  }

  private assertParticipant(
    conversation: { userAId: string; userBId: string },
    user: AuthUser,
  ) {
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    }
  }

  async canColdOutreach(recruiterUserId: string, companyId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    const plan = effectivePlan(sub);
    if (!PLAN_LIMITS[plan].coldChat) return false;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const used = await this.prisma.conversation.count({
      where: {
        companyId,
        isColdOutreach: true,
        initiatedBy: recruiterUserId,
        createdAt: { gte: start },
      },
    });
    const limits = PLAN_LIMITS[plan];
    const quota =
      ('coldChatDailyQuota' in limits ? limits.coldChatDailyQuota : undefined) ?? 20;
    return used < quota;
  }

  async startConversation(
    user: AuthUser,
    peerUserId: string,
    opts?: { jobPostId?: string; companyId?: string },
  ) {
    if (peerUserId === user.id) throw new BadRequestException('Cannot chat with yourself');
    const peer = await this.prisma.user.findUnique({ where: { id: peerUserId } });
    if (!peer || peer.isBanned) throw new NotFoundException('User not found');

    let isColdOutreach = false;
    let companyId: string | undefined;

    if (user.role === 'RECRUITER') {
      const membershipIds = new Set((user.memberships ?? []).map((m) => m.companyId));
      if (opts?.companyId) {
        if (!membershipIds.has(opts.companyId)) {
          throw new ForbiddenException('Not a member of this company');
        }
        companyId = opts.companyId;
      } else {
        companyId = user.memberships?.[0]?.companyId;
      }
      if (!companyId) throw new ForbiddenException('No company');

      const hasApplication = opts?.jobPostId
        ? await this.prisma.application.findFirst({
            where: {
              jobPostId: opts.jobPostId,
              profile: { userId: peerUserId },
              jobPost: { companyId },
            },
          })
        : await this.prisma.application.findFirst({
            where: {
              profile: { userId: peerUserId },
              jobPost: { companyId },
            },
          });

      const peerInitiated = await this.prisma.conversation.findFirst({
        where: {
          OR: [
            { userAId: peerUserId, userBId: user.id },
            { userAId: user.id, userBId: peerUserId },
          ],
          initiatedBy: peerUserId,
        },
      });

      if (!hasApplication && !peerInitiated) {
        const allowed = await this.canColdOutreach(user.id, companyId);
        if (!allowed) {
          throw new ForbiddenException(
            'Cold outreach requires Premium plan (or active application / candidate-initiated chat)',
          );
        }
        isColdOutreach = true;
      }
    }

    const [userAId, userBId] = this.pairIds(user.id, peerUserId);
    const existing = await this.prisma.conversation.findFirst({
      where: {
        userAId,
        userBId,
        jobPostId: opts?.jobPostId ?? null,
      },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        userAId,
        userBId,
        companyId: companyId ?? null,
        jobPostId: opts?.jobPostId ?? null,
        initiatedBy: user.id,
        isColdOutreach,
      },
    });
  }

  async listConversations(user: AuthUser) {
    const userId = user.id;
    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        userA: { select: { id: true, fullName: true, email: true, role: true } },
        userB: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Inbox fetch = Delivered for peer messages (not Read until the thread is opened)
    if (conversations.length > 0) {
      await this.prisma.chatMessage.updateMany({
        where: {
          conversationId: { in: conversations.map((c) => c.id) },
          senderId: { not: userId },
          deliveredAt: null,
        },
        data: { deliveredAt: new Date() },
      });
    }

    const peerIds = conversations.map((c) => (c.userAId === userId ? c.userBId : c.userAId));
    const presence = await this.presence.getPresence(peerIds);
    const context = await this.inboxContextFor(user, conversations);

    return conversations.map((c) => {
      const peerId = c.userAId === userId ? c.userBId : c.userAId;
      const job = c.jobPostId ? context.jobById.get(c.jobPostId) ?? null : null;
      const companyId = c.companyId ?? job?.companyId ?? null;
      return {
        ...c,
        peerPresence: presence[peerId] ?? null,
        peerCandidateId: context.peerCandidateByUserId.get(peerId) ?? null,
        company: companyId ? context.companyById.get(companyId) ?? null : null,
        job,
      };
    });
  }

  /**
   * Batch company / job / candidate-profile context for the inbox header.
   * Candidate ids follow the same PRIVATE gate as GET /profiles/candidates/:id.
   */
  private async inboxContextFor(
    user: AuthUser,
    conversations: Array<{
      userAId: string;
      userBId: string;
      companyId: string | null;
      jobPostId: string | null;
      userA: { id: string; role: string };
      userB: { id: string; role: string };
    }>,
  ) {
    const canViewCandidates = user.role === 'RECRUITER' || user.role === 'SUPER_ADMIN';
    const employeePeerIds = canViewCandidates
      ? [
          ...new Set(
            conversations
              .map((c) => (c.userAId === user.id ? c.userB : c.userA))
              .filter((peer) => peer.role === 'EMPLOYEE')
              .map((peer) => peer.id),
          ),
        ]
      : [];

    const profiles =
      employeePeerIds.length > 0
        ? await this.prisma.employeeProfile.findMany({
            where: { userId: { in: employeePeerIds } },
            select: { id: true, userId: true, visibility: true },
          })
        : [];

    const privateProfileIds = profiles
      .filter((p) => p.visibility === 'PRIVATE')
      .map((p) => p.id);
    const viewerCompanyIds = (user.memberships ?? []).map((m) => m.companyId).filter(Boolean);
    const appliedProfileIds = new Set<string>();
    if (user.role === 'SUPER_ADMIN') {
      for (const id of privateProfileIds) appliedProfileIds.add(id);
    } else if (privateProfileIds.length > 0 && viewerCompanyIds.length > 0) {
      const applied = await this.prisma.application.findMany({
        where: {
          profileId: { in: privateProfileIds },
          jobPost: { companyId: { in: viewerCompanyIds } },
        },
        select: { profileId: true },
      });
      for (const row of applied) appliedProfileIds.add(row.profileId);
    }

    const peerCandidateByUserId = new Map<string, string>();
    for (const profile of profiles) {
      if (profile.visibility === 'PRIVATE' && !appliedProfileIds.has(profile.id)) continue;
      peerCandidateByUserId.set(profile.userId, profile.id);
    }

    const jobIds = [
      ...new Set(conversations.map((c) => c.jobPostId).filter((id): id is string => Boolean(id))),
    ];
    const jobs =
      jobIds.length > 0
        ? await this.prisma.jobPost.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, title: true, status: true, companyId: true },
          })
        : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    const companyIds = new Set<string>();
    for (const c of conversations) {
      if (c.companyId) companyIds.add(c.companyId);
    }
    for (const job of jobs) companyIds.add(job.companyId);

    const companies =
      companyIds.size > 0
        ? await this.prisma.company.findMany({
            where: { id: { in: [...companyIds] } },
            select: { id: true, name: true, slug: true },
          })
        : [];
    const companyById = new Map(companies.map((company) => [company.id, company]));

    return { peerCandidateByUserId, jobById, companyById };
  }

  /** Thread open/poll = Read (+ Delivered if somehow still missing). */
  private async markPeerRead(conversationId: string, viewerId: string) {
    const now = new Date();
    await this.prisma.chatMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: viewerId },
        OR: [{ deliveredAt: null }, { readAt: null }],
      },
      data: {
        deliveredAt: now,
        readAt: now,
      },
    });
  }

  async getMessages(user: AuthUser, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException();
    this.assertParticipant(conversation, user);

    if (user.role !== 'SUPER_ADMIN') {
      await this.markPeerRead(conversationId, user.id);
    }

    return this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, fullName: true } } },
    });
  }

  async sendMessage(
    user: AuthUser,
    conversationId: string,
    body: string,
    opts?: { telegram?: 'offline' | 'always' | 'never' },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException();
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ForbiddenException();
    }
    const message = await this.prisma.chatMessage.create({
      data: { conversationId, senderId: user.id, body },
      include: { sender: { select: { id: true, fullName: true } } },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    const peerId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId;
    await this.notifyPeer({
      peerId,
      senderId: user.id,
      senderName: message.sender.fullName,
      body,
      telegram: opts?.telegram ?? 'offline',
    });
    return message;
  }

  async notifyPeer(opts: {
    peerId: string;
    senderId: string;
    senderName: string;
    body: string;
    telegram: 'offline' | 'always' | 'never';
  }) {
    try {
      await this.notifications.create({
        userId: opts.peerId,
        type: 'CHAT_MESSAGE',
        title: `New message from ${opts.senderName}`,
        body: 'Open the conversation to read it',
        titleKey: 'notify.chatMessage.title',
        bodyKey: 'notify.chatMessage.body',
        params: { name: opts.senderName },
        linkUrl: `/messages?peer=${opts.senderId}`,
      });
    } catch (err) {
      this.logger.warn(`Chat notification failed: ${(err as Error).message}`);
    }

    if (opts.telegram === 'never') return;
    try {
      const peer = await this.prisma.user.findUnique({
        where: { id: opts.peerId },
        select: { telegramId: true, locale: true },
      });
      if (!peer?.telegramId) return;
      if (opts.telegram === 'offline') {
        const presence = await this.presence.getOne(opts.peerId);
        if (presence.isOnline) return;
      }
      const locale = emailLocale(peer.locale);
      const webUrl = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const url = `${webUrl}/${locale}/messages?peer=${opts.senderId}`;
      const text = formatTelegramChatText({
        locale,
        sender: opts.senderName,
        message: opts.body,
        url,
      });
      await this.telegram.sendMessage(peer.telegramId, text);
    } catch (err) {
      this.logger.warn(`Chat Telegram fan-out failed: ${(err as Error).message}`);
    }
  }
}
