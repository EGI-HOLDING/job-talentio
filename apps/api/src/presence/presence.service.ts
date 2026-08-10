import { Inject, Injectable, Logger } from '@nestjs/common';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';

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
      where: { id: { in: ids } },
      select: { id: true, lastSeenAt: true },
    });
    const lastSeen = new Map(users.map((u) => [u.id, u.lastSeenAt]));

    ids.forEach((id, i) => {
      result[id] = {
        isOnline: online[i],
        lastSeenAt: online[i] ? null : (lastSeen.get(id)?.toISOString() ?? null),
      };
    });
    return result;
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
