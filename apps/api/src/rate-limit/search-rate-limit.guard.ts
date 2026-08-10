import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type IORedis from 'ioredis';

export const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT_PER_WINDOW = 60;
/** Consecutive violated windows before a hard temporary block. */
const BLOCK_AFTER_VIOLATED_WINDOWS = 5;
const BLOCK_TTL_SECONDS = 15 * 60;

/**
 * Fixed-window Redis rate limit for public search endpoints (60 req/min/IP by
 * default). Repeat offenders get a 15-minute IP block. Fails open when Redis
 * is down so search never hard-depends on Redis.
 */
@Injectable()
export class SearchRateLimitGuard implements CanActivate {
  private readonly limit: number;

  constructor(
    @Optional() @Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis | null,
    config: ConfigService,
  ) {
    const fromEnv = Number(config.get('SEARCH_RATE_LIMIT_PER_MIN'));
    this.limit =
      Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DEFAULT_LIMIT_PER_WINDOW;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.redis || this.redis.status !== 'ready') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    try {
      if (await this.redis.exists(`rl:block:${ip}`)) {
        throw new HttpException('Too many requests. Temporarily blocked.', 429);
      }

      const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
      const route = `${req.method}:${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
      const key = `rl:search:${ip}:${route}:${window}`;
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, WINDOW_SECONDS + 30);
      }
      if (count > this.limit) {
        // Only the first request over the limit marks this window as violated.
        if (count === this.limit + 1) {
          const violationsKey = `rl:violwins:${ip}`;
          const violations = await this.redis.incr(violationsKey);
          await this.redis.expire(violationsKey, BLOCK_TTL_SECONDS);
          if (violations >= BLOCK_AFTER_VIOLATED_WINDOWS) {
            await this.redis.set(`rl:block:${ip}`, '1', 'EX', BLOCK_TTL_SECONDS);
          }
        }
        throw new HttpException('Too many requests', 429);
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      return true; // Redis hiccup: fail open
    }
  }
}
