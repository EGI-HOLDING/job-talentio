import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { LiveUpdates } from '../common/live-updates';
import { OperationsService } from '../benefits/operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { formatTelegramChatText } from '../telegram/telegram.chat';
import { emailLocale } from '../common/i18n/email-locale';
import { AuthUser } from '../common/auth.decorators';
import { Prisma } from '@prisma/client';
import { revealsAnonymousEmployer, anonymousRevealHistory } from '../common/anonymous-job';
import { applicationChatAllowed } from './application-chat-access';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private presence: PresenceService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    @Optional() private live?: LiveUpdates,
    @Optional() private operations?: OperationsService,
  ) {}

  private pairIds(a: string, b: string) {
    return a < b ? [a, b] : [b, a];
  }

  private async assertApplicationChatNotWithdrawn(
    tx: Prisma.TransactionClient,
    conversation: { jobPostId: string | null; userAId: string; userBId: string },
  ) {
    if (!conversation.jobPostId) return;
    const applications = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
      SELECT a."status"::text AS "status"
      FROM "Application" a
      JOIN "EmployeeProfile" p ON p."id" = a."profileId"
      WHERE a."jobPostId" = ${conversation.jobPostId}
        AND p."userId" IN (${Prisma.join([conversation.userAId, conversation.userBId])})
      FOR UPDATE OF a
    `);
    if (applications.some((application) => !applicationChatAllowed(application.status))) {
      throw new NotFoundException('Conversation not found');
    }
  }

  private assertParticipant(
    conversation: { userAId: string; userBId: string },
    user: AuthUser,
  ) {
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    }
  }

  /** Keep confidential employer context behind the same stage gate as job details. */
  private async canAccessConversationContext(
    conversation: { jobPostId: string | null; companyId: string | null },
    participantIds: string[],
    viewer: AuthUser,
  ) {
    if (viewer.role === 'SUPER_ADMIN') return true;
    let companyId = conversation.companyId;
    if (conversation.jobPostId) {
      const job = await this.prisma.jobPost.findUnique({
        where: { id: conversation.jobPostId },
        select: {
          isAnonymous: true,
          companyId: true,
          company: { select: { isBanned: true, anonymizedAt: true } },
        },
      });
      if (!job || job.company.isBanned || job.company.anonymizedAt) return false;
      companyId = job.companyId;
      if (viewer.role === 'RECRUITER') {
        const membership = await this.prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId, userId: viewer.id } },
          select: { userId: true },
        });
        if (!membership) return false;
      }
      const application = await this.prisma.application.findFirst({
        where: {
          jobPostId: conversation.jobPostId,
          profile: { userId: { in: participantIds } },
        },
        select: { status: true, events: anonymousRevealHistory },
      });
      if (!applicationChatAllowed(application?.status)) return false;
      if (!job.isAnonymous) return true;
      return Boolean(application && revealsAnonymousEmployer(application.status, application.events));
    }

    if (!companyId) return true;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { isBanned: true, anonymizedAt: true },
    });
    if (!company || company.isBanned || company.anonymizedAt) return false;
    if (viewer.role === 'RECRUITER') {
      const membership = await this.prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: viewer.id } },
        select: { userId: true },
      });
      if (!membership) return false;
    }
    const applications = await this.prisma.application.findMany({
      where: {
        profile: { userId: { in: participantIds } },
        jobPost: { companyId },
      },
      select: { status: true, events: anonymousRevealHistory, jobPost: { select: { isAnonymous: true } } },
    });
    if (!applications.length) return true;
    return applications.some(
      (application) =>
        !application.jobPost.isAnonymous || revealsAnonymousEmployer(application.status, application.events),
    );
  }

  async startConversation(
    user: AuthUser,
    peerUserId: string,
    opts?: { jobPostId?: string; companyId?: string },
  ) {
    if (peerUserId === user.id) throw new BadRequestException('Cannot chat with yourself');
    const peer = await this.prisma.user.findUnique({ where: { id: peerUserId } });
    if (!peer || peer.isBanned) throw new NotFoundException('User not found');

    const contextJob = opts?.jobPostId
      ? await this.prisma.jobPost.findUnique({
          where: { id: opts.jobPostId },
          select: { id: true, companyId: true, isAnonymous: true },
        })
      : null;
    if (opts?.jobPostId && !contextJob) throw new NotFoundException('Job not found');
    if (opts?.companyId && contextJob && opts.companyId !== contextJob.companyId) {
      throw new BadRequestException('The job does not belong to this company');
    }

    let isColdOutreach = false;
    let companyId: string | undefined;

    if (user.role === 'RECRUITER') {
      const membershipIds = new Set((user.memberships ?? []).map((m) => m.companyId));
      const requestedCompanyId = contextJob?.companyId ?? opts?.companyId;
      if (requestedCompanyId && !membershipIds.has(requestedCompanyId)) {
        throw new ForbiddenException('Not a member of this company');
      }
      companyId = requestedCompanyId ?? user.memberships?.[0]?.companyId;
      if (!companyId) throw new ForbiddenException('No company');

      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { isBanned: true, anonymizedAt: true },
      });
      if (!company || company.isBanned || company.anonymizedAt) {
        throw new NotFoundException('Company not available');
      }

      const applications = contextJob
        ? await this.prisma.application.findMany({
            where: {
              jobPostId: contextJob.id,
              profile: { userId: peerUserId },
              jobPost: { companyId },
            },
            select: { status: true, events: anonymousRevealHistory, jobPost: { select: { isAnonymous: true } } },
          })
        : await this.prisma.application.findMany({
            where: {
              profile: { userId: peerUserId },
              jobPost: { companyId },
            },
            select: { status: true, events: anonymousRevealHistory, jobPost: { select: { isAnonymous: true } } },
          });
      if (contextJob && applications.some((application) => !applicationChatAllowed(application.status))) {
        throw new NotFoundException('Conversation not found');
      }
      const hasApplication = applications.some(
        (application) =>
          !application.jobPost.isAnonymous || revealsAnonymousEmployer(application.status, application.events),
      );
      const hiddenAnonymousApplication = applications.some(
        (application) =>
          application.jobPost.isAnonymous && !revealsAnonymousEmployer(application.status, application.events),
      );

      if (!hasApplication && hiddenAnonymousApplication) {
        throw new ForbiddenException('The employer is hidden until the interview stage');
      }
      if (contextJob?.isAnonymous && applications.length && !hasApplication) {
        throw new ForbiddenException('The employer is hidden until the interview stage');
      }

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
        if (peer.role !== 'EMPLOYEE') throw new NotFoundException('User not found');
        const candidateProfile = await this.prisma.employeeProfile.findUnique({
          where: { userId: peerUserId },
          select: { visibility: true },
        });
        if (!candidateProfile || candidateProfile.visibility === 'PRIVATE') {
          throw new NotFoundException('User not found');
        }
        isColdOutreach = true;
      }
    } else if (user.role === 'EMPLOYEE' && (contextJob || opts?.companyId)) {
      const requestedCompanyId = contextJob?.companyId ?? opts?.companyId;
      if (!requestedCompanyId || peer.role !== 'RECRUITER') {
        throw new NotFoundException('Recruiter not found for this company');
      }
      const [company, membership] = await Promise.all([
        this.prisma.company.findUnique({
          where: { id: requestedCompanyId },
          select: { isBanned: true, anonymizedAt: true },
        }),
        this.prisma.companyMember.findUnique({
          where: { companyId_userId: { companyId: requestedCompanyId, userId: peerUserId } },
          select: { userId: true },
        }),
      ]);
      if (!company || company.isBanned || company.anonymizedAt || !membership) {
        throw new NotFoundException('Recruiter not found for this company');
      }
      companyId = requestedCompanyId;

      if (contextJob) {
        const application = await this.prisma.application.findFirst({
          where: {
            jobPostId: contextJob.id,
            profile: { userId: user.id },
          },
          select: { status: true, events: anonymousRevealHistory },
        });
        if (!applicationChatAllowed(application?.status)) {
          throw new NotFoundException('Conversation not found');
        }
        if (contextJob.isAnonymous && (!application || !revealsAnonymousEmployer(application.status, application.events))) {
          throw new NotFoundException('Employer not available');
        }
      }
    }

    const [userAId, userBId] = this.pairIds(user.id, peerUserId);
    const jobPostId = contextJob?.id ?? null;
    const existing = await this.prisma.conversation.findFirst({
      where: {
        userAId,
        userBId,
        jobPostId,
      },
    });
    if (existing) return existing;

    try {
      return await this.prisma.conversation.create({
        data: {
          userAId,
          userBId,
          companyId: companyId ?? contextJob?.companyId ?? null,
          jobPostId,
          initiatedBy: user.id,
          isColdOutreach,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.conversation.findFirst({
          where: { userAId, userBId, jobPostId },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }

  async listConversations(user: AuthUser) {
    const userId = user.id;
    const loadedConversations = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        userA: { select: { id: true, fullName: true, role: true } },
        userB: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const visibility = await Promise.all(
      loadedConversations.map(async (conversation) =>
        (await this.canAccessConversationContext(
          conversation,
          [conversation.userAId, conversation.userBId],
          user,
        ))
          ? conversation
          : null,
      ),
    );
    const conversations = visibility.filter(
      (conversation): conversation is (typeof loadedConversations)[number] => conversation !== null,
    );

    // Inbox fetch = Delivered for peer messages (not Read until the thread is opened)
    if (conversations.length > 0) {
      const delivered = await this.prisma.chatMessage.updateMany({
        where: {
          conversationId: { in: conversations.map((c) => c.id) },
          senderId: { not: userId },
          deliveredAt: null,
        },
        data: { deliveredAt: new Date() },
      });
      if (delivered.count) this.live?.publish(conversations.flatMap(item => [item.userAId,item.userBId]), 'chat');
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
    const result = await this.prisma.chatMessage.updateMany({
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
    return result.count;
  }

  async getMessages(user: AuthUser, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException();
    this.assertParticipant(conversation, user);
    if (
      !(await this.canAccessConversationContext(
        conversation,
        [conversation.userAId, conversation.userBId],
        user,
      ))
    ) {
      throw new NotFoundException('Conversation not found');
    }

    if (user.role !== 'SUPER_ADMIN') {
      const changed = await this.markPeerRead(conversationId, user.id);
      if (changed) this.live?.publish([conversation.userAId,conversation.userBId], 'chat');
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
    opts?: { telegram?: 'offline' | 'always' | 'never'; idempotencyKey?: string },
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException();
    if (conversation.userAId !== user.id && conversation.userBId !== user.id) {
      throw new ForbiddenException();
    }
    if (
      !(await this.canAccessConversationContext(
        conversation,
        [conversation.userAId, conversation.userBId],
        user,
      ))
    ) {
      throw new NotFoundException('Conversation not found');
    }
    const write = async (tx: Prisma.TransactionClient) => {
      await this.assertApplicationChatNotWithdrawn(tx, conversation);
      const value = await tx.chatMessage.create({
        data: { conversationId, senderId: user.id, body },
        include: { sender: { select: { id: true, fullName: true } } },
      });
      await tx.conversation.update({where:{id:conversationId},data:{updatedAt:new Date()}});
      return value;
    };
    const committed = opts?.idempotencyKey && this.operations
      ? await this.operations.transaction('chat-message:'+conversationId, opts.idempotencyKey, {senderId:user.id,body}, write)
      : {value:await this.prisma.$transaction(write),replayed:false};
    const message = committed.value;
    if (committed.replayed) return message;
    this.live?.publish([conversation.userAId, conversation.userBId], 'chat');
    const peerId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId;
    await this.notifyPeer({
      peerId,
      jobPostId: conversation.jobPostId,
      senderId: user.id,
      senderName: message.sender.fullName,
      body,
      telegram: opts?.telegram ?? 'offline',
    });
    return message;
  }

  async notifyPeer(opts: {
    peerId: string;
    jobPostId?: string | null;
    senderId: string;
    senderName: string;
    body: string;
    telegram: 'offline' | 'always' | 'never';
  }) {
    const messageHref = (role: string) => '/messages?' + new URLSearchParams({
      peer: opts.senderId,
      role: role === 'RECRUITER' || role === 'SUPER_ADMIN' ? 'RECRUITER' : 'EMPLOYEE',
      ...(opts.jobPostId ? { job: opts.jobPostId } : {}),
    });
    try {
      const recipient = await this.prisma.user.findUnique({ where: { id: opts.peerId }, select: { role: true } });
      await this.notifications.create({
        userId: opts.peerId,
        type: 'CHAT_MESSAGE',
        title: `New message from ${opts.senderName}`,
        body: 'Open the conversation to read it',
        titleKey: 'notify.chatMessage.title',
        bodyKey: 'notify.chatMessage.body',
        params: { name: opts.senderName },
        linkUrl: messageHref(recipient?.role || 'EMPLOYEE'),
      });
    } catch (err) {
      this.logger.warn(`Chat notification failed: ${(err as Error).message}`);
    }

    if (opts.telegram === 'never') return;
    try {
      const peer = await this.prisma.user.findUnique({
        where: { id: opts.peerId },
        select: { telegramId: true, locale: true, role: true },
      });
      if (!peer?.telegramId) return;
      if (opts.telegram === 'offline') {
        const presence = await this.presence.getOne(opts.peerId);
        if (presence.isOnline) return;
      }
      const locale = emailLocale(peer.locale);
      const webUrl = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const url = `${webUrl}/${locale}${messageHref(peer.role)}`;
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
