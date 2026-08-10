import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { RATE_LIMIT_REDIS, SearchRateLimitGuard } from './search-rate-limit.guard';

/**
 * Shared Redis client for rate limiting. Commands fail fast when Redis is
 * unreachable (no offline queue) so guards can fail open instead of hanging.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMIT_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IORedis | null => {
        const logger = new Logger('RateLimitRedis');
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        try {
          const client = new IORedis(url, {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
          });
          let warned = false;
          client.on('error', (err: Error) => {
            if (!warned) {
              warned = true;
              logger.warn(`Redis unavailable, rate limiting fails open: ${err.message}`);
            }
          });
          client.on('ready', () => {
            warned = false;
          });
          client.connect().catch(() => undefined);
          return client;
        } catch (err) {
          logger.warn(`Redis init failed, rate limiting disabled: ${(err as Error).message}`);
          return null;
        }
      },
    },
    SearchRateLimitGuard,
  ],
  exports: [RATE_LIMIT_REDIS, SearchRateLimitGuard],
})
export class RateLimitModule {}
