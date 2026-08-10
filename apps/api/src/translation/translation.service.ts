import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { contentHash } from '../common/i18n/content-locale';
import { isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { TRANSLATION_PROVIDER } from './translation.provider';
import type { TranslationProvider } from './translation.provider';

/** Machine output is truncated so a single request cannot burn the budget. */
const MAX_CHARS_PER_FIELD = 5_000;
const DEFAULT_MONTHLY_CHAR_BUDGET = 200_000;

export type MachineTranslationResult =
  | { status: 'ready'; locale: Locale }
  | { status: 'exists'; locale: Locale }
  | { status: 'disabled' }
  | { status: 'budget-exceeded' }
  | { status: 'unsupported' }
  | { status: 'failed'; reason: string };

/**
 * On-demand machine translation with a durable cache: results are stored as
 * `isMachine` rows in the same translation tables a human would write to, so a
 * text is paid for once and every later reader gets it for free. A human
 * translation always wins and is never overwritten.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly monthlyCharBudget: number;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
    @Inject(TRANSLATION_PROVIDER) private provider: TranslationProvider,
    @Optional() @Inject(RATE_LIMIT_REDIS) private readonly redis: IORedis | null,
  ) {
    this.monthlyCharBudget = Number(
      config.get<string>('TRANSLATION_MONTHLY_CHAR_BUDGET') ?? DEFAULT_MONTHLY_CHAR_BUDGET,
    );
  }

  get enabled(): boolean {
    return this.provider.enabled;
  }

  get providerName(): string {
    return this.provider.name;
  }

  async translateJob(jobId: string, target: Locale): Promise<MachineTranslationResult> {
    if (!this.provider.enabled) return { status: 'disabled' };

    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
    });
    if (!job) return { status: 'failed', reason: 'Job not found' };
    if (!isLocale(job.locale)) return { status: 'unsupported' };
    if (target === job.locale) return { status: 'exists', locale: target };

    const hash = contentHash(job.title, job.description);
    const existing = job.translations.find((t) => t.locale === target);
    // A human version, or machine output still matching the source, is enough.
    if (existing && (!existing.isMachine || existing.sourceHash === hash)) {
      return { status: 'exists', locale: target };
    }

    const title = job.title.slice(0, MAX_CHARS_PER_FIELD);
    const description = job.description.slice(0, MAX_CHARS_PER_FIELD);

    const allowed = await this.consumeBudget(title.length + description.length);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const [translatedTitle, translatedDescription] = await this.provider.translate({
        texts: [title, description],
        targetLocale: target,
        sourceLocale: job.locale,
      });
      if (!translatedTitle || !translatedDescription) return { status: 'unsupported' };

      const value = {
        title: translatedTitle,
        description: translatedDescription,
        isMachine: true,
        sourceHash: hash,
      };
      await this.prisma.jobPostTranslation.upsert({
        where: { jobPostId_locale: { jobPostId: jobId, locale: target } },
        update: value,
        create: { jobPostId: jobId, locale: target, ...value },
      });
      return { status: 'ready', locale: target };
    } catch (err) {
      this.logger.warn(`Machine translation failed for job ${jobId}: ${(err as Error).message}`);
      return { status: 'failed', reason: 'Translation service unavailable' };
    }
  }

  /**
   * Monthly character counter in Redis. Without Redis the budget cannot be
   * enforced, so translation stays off rather than risking an open-ended bill.
   */
  private async consumeBudget(chars: number): Promise<boolean> {
    if (this.monthlyCharBudget <= 0) return true;
    if (!this.redis || this.redis.status !== 'ready') {
      this.logger.warn('Redis unavailable, skipping machine translation to protect the budget');
      return false;
    }

    const month = new Date().toISOString().slice(0, 7);
    const key = `mt:chars:${month}`;
    try {
      const used = await this.redis.incrby(key, chars);
      if (used === chars) await this.redis.expire(key, 60 * 60 * 24 * 40);
      if (used > this.monthlyCharBudget) {
        this.logger.warn(`Machine translation budget exhausted (${used} chars this month)`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
