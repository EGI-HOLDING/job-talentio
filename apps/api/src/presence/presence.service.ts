import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { AuthUser } from '../common/auth.decorators';
import { revealsAnonymousEmployer, anonymousRevealHistory } from '../common/anonymous-job';

export type PresenceStatus = { isOnline: boolean; lastSeenAt: string | null };

/** Heartbeat arrives every ~25s; two missed beats flip the user offline. */
const ONLINE_TTL_SECONDS = 60;
const LAST_SEEN_WRITE_INTERVAL_SECONDS = 60;
const BATCH_CAP = 200;

/**
 * Redis-backed online presence. A user is online while the set
 * `presence:sockets:{userId}` holds at least one live socket id; the key TTL
 * is refreshed by heartbeats so crashed connections expire on their own.
 * `User.lastSeenAt` is written at most once per minute as a cold fallback.
 * Every path fails open: with Redis down users just read as offline.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(RATE_LIMIT_REDIS) private redis: IORedis | null,
  ) {}

  private socketsKey(userId: string) {
    return `presence:sockets:${userId}`;
  }

  private get redisReady(): boolean {
    return Boolean(this.redis && this.redis.status === 'ready');
  }

  /** Socket connected. Returns true when this made the user come online. */
  async markOnline(userId: string, socketId: string): Promise<boolean> {
    if (!this.redisReady) return false;
    try {
      const key = this.socketsKey(userId);
      const added = await this.redis!.sadd(key, socketId);
      await this.redis!.expire(key, ONLINE_TTL_SECONDS);
      const count = await this.redis!.scard(key);
      void this.touchLastSeen(userId);
      return added === 1 && count === 1;
    } catch {
      return false;
    }
  }

  /** Heartbeat: refresh TTL (re-adds the socket in case the key expired). */
  async heartbeat(userId: string, socketId: string): Promise<void> {
    if (!this.redisReady) return;
    try {
      const key = this.socketsKey(userId);
      await this.redis!.sadd(key, socketId);
      await this.redis!.expire(key, ONLINE_TTL_SECONDS);
      void this.touchLastSeen(userId);
    } catch {
      /* fail open */
    }
  }

  /** Socket disconnected. Returns true when the user went fully offline. */
  async markOffline(userId: string, socketId: string): Promise<boolean> {
    if (!this.redisReady) return false;
    try {
      const key = this.socketsKey(userId);
      await this.redis!.srem(key, socketId);
      const remaining = await this.redis!.scard(key);
      if (remaining <= 0) {
        await this.redis!.del(key);
        await this.writeLastSeen(userId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Batch lookup: Redis liveness plus DB lastSeen for offline users. */
  async getPresence(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const ids = [...new Set(userIds)].filter(Boolean).slice(0, BATCH_CAP);
    const result: Record<string, PresenceStatus> = {};
    if (!ids.length) return result;

    let online = ids.map(() => false);
    if (this.redisReady) {
      try {
        const pipeline = this.redis!.pipeline();
        for (const id of ids) pipeline.exists(this.socketsKey(id));
        const rows = await pipeline.exec();
        online = ids.map((_, i) => Number(rows?.[i]?.[1] ?? 0) === 1);
      } catch {
        /* fail open: everyone offline */
      }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, isBanned: false, anonymizedAt: null },
      select: { id: true, lastSeenAt: true },
    });
    const lastSeen = new Map(users.map((u) => [u.id, u.lastSeenAt]));

    ids.forEach((id, i) => {
      if (!lastSeen.has(id)) {
        result[id] = { isOnline: false, lastSeenAt: null };
        return;
      }
      result[id] = {
        isOnline: online[i],
        lastSeenAt: online[i] ? null : (lastSeen.get(id)?.toISOString() ?? null),
      };
    });
    return result;
  }

  /**
   * Presence is private profile data: only return it for visible candidates,
   * conversation peers, or the signed-in user. Never trust caller-supplied IDs.
   */
  async getVisiblePresence(viewer: AuthUser, requestedIds: string[]) {
    const ids = [...new Set(requestedIds)].filter(Boolean).slice(0, 50);
    if (!ids.length) return {};

    const visibleIds = new Set<string>([viewer.id]);
    if (viewer.role === 'SUPER_ADMIN') {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids }, isBanned: false, anonymizedAt: null },
        select: { id: true },
      });
      for (const user of users) visibleIds.add(user.id);
    } else {
      const peerConversations = await this.prisma.conversation.findMany({
        where: {
          OR: [
            { userAId: viewer.id, userBId: { in: ids } },
            { userBId: viewer.id, userAId: { in: ids } },
          ],
        },
        select: { userAId: true, userBId: true, jobPostId: true, companyId: true },
      });
      for (const conversation of peerConversations) {
        if (!(await this.canSeeConversationPresence(viewer, conversation))) continue;
        visibleIds.add(
          conversation.userAId === viewer.id ? conversation.userBId : conversation.userAId,
        );
      }

      if (viewer.role === 'RECRUITER') {
        const requestedCompanyIds = [
          ...new Set((viewer.memberships ?? []).map((membership) => membership.companyId)),
        ];
        const activeCompanies = requestedCompanyIds.length
          ? await this.prisma.company.findMany({
              where: {
                id: { in: requestedCompanyIds },
                isBanned: false,
                anonymizedAt: null,
              },
              select: { id: true },
            })
          : [];
        const companyIds = activeCompanies.map((company) => company.id);
        const visibleCandidates = await this.prisma.employeeProfile.findMany({
          where: {
            userId: { in: ids },
            user: { isBanned: false, anonymizedAt: null },
            OR: [
              { visibility: { in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] } },
              ...(companyIds.length
                ? [
                    {
                      applications: {
                        some: { jobPost: { companyId: { in: companyIds } } },
                      },
                    },
                  ]
                : []),
            ],
          },
          select: { userId: true },
        });
        for (const profile of visibleCandidates) visibleIds.add(profile.userId);
      }
    }

    return this.getPresence(ids.filter((id) => visibleIds.has(id)));
  }

  private async canSeeConversationPresence(
    viewer: AuthUser,
    conversation: {
      userAId: string;
      userBId: string;
      jobPostId: string | null;
      companyId: string | null;
    },
  ) {
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
      if (!job.isAnonymous) return true;
      const application = await this.prisma.application.findFirst({
        where: {
          jobPostId: conversation.jobPostId,
          profile: { userId: { in: [conversation.userAId, conversation.userBId] } },
        },
        select: { status: true, events: anonymousRevealHistory },
      });
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
        profile: { userId: { in: [conversation.userAId, conversation.userBId] } },
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

  async getOne(userId: string): Promise<PresenceStatus> {
    const map = await this.getPresence([userId]);
    return map[userId] ?? { isOnline: false, lastSeenAt: null };
  }

  /** Throttled `User.lastSeenAt` write (about once/min, multi-instance safe). */
  private async touchLastSeen(userId: string) {
    if (!this.redisReady) return;
    try {
      const ok = await this.redis!.set(
        `presence:seenwrite:${userId}`,
        '1',
        'EX',
        LAST_SEEN_WRITE_INTERVAL_SECONDS,
        'NX',
      );
      if (ok === 'OK') await this.writeLastSeen(userId);
    } catch {
      /* ignore */
    }
  }

  private async writeLastSeen(userId: string) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
      });
    } catch (err) {
      this.logger.debug(`lastSeenAt write failed for ${userId}: ${(err as Error).message}`);
    }
  }
}
