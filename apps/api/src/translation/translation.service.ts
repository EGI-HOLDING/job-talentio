import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { catalogDelegate } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { contentHash } from '../common/i18n/content-locale';
import { detectLocale } from '../common/i18n/detect-locale';
import { isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { TRANSLATION_PROVIDER } from './translation.provider';
import type { TranslationProvider } from './translation.provider';

/** Machine output is truncated so a single request cannot burn the budget. */
const MAX_CHARS_PER_FIELD = 5_000;
/** Catalog labels are a few words; anything longer is not a label. */
const MAX_LABEL_CHARS = 120;
const DEFAULT_MONTHLY_CHAR_BUDGET = 200_000;

export type MachineTranslationResult =
  | { status: 'ready'; locale: Locale }
  | { status: 'exists'; locale: Locale }
  | { status: 'disabled' }
  | { status: 'budget-exceeded' }
  | { status: 'unsupported' }
  | { status: 'failed'; reason: string };

export type CatalogTranslationResult =
  | { status: 'ready'; filled: Locale[] }
  | { status: 'exists' }
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
      // Applicants answer in the language they read the posting in.
      await this.translateJobQuestions(jobId, job.locale, target);
      return { status: 'ready', locale: target };
    } catch (err) {
      this.logger.warn(`Machine translation failed for job ${jobId}: ${(err as Error).message}`);
      return { status: 'failed', reason: 'Translation service unavailable' };
    }
  }

  /**
   * Screening questions ride along with the posting they belong to. Failures are
   * swallowed: a translated posting with original questions still works.
   */
  private async translateJobQuestions(jobId: string, source: Locale, target: Locale) {
    const questions = await this.prisma.jobQuestion.findMany({
      where: { jobPostId: jobId },
      include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
    });

    for (const question of questions) {
      const hash = contentHash(question.question);
      const existing = question.translations.find((t) => t.locale === target);
      if (existing && (!existing.isMachine || existing.sourceHash === hash)) continue;

      const text = question.question.slice(0, MAX_LABEL_CHARS * 4);
      if (!(await this.consumeBudget(text.length))) return;

      try {
        const [translated] = await this.provider.translate({
          texts: [text],
          targetLocale: target,
          sourceLocale: source,
        });
        if (!translated) continue;
        const value = { question: translated, isMachine: true, sourceHash: hash };
        await this.prisma.jobQuestionTranslation.upsert({
          where: { questionId_locale: { questionId: question.id, locale: target } },
          update: value,
          create: { questionId: question.id, locale: target, ...value },
        });
      } catch (err) {
        this.logger.warn(
          `Question translation failed for job ${jobId}: ${(err as Error).message}`,
        );
        return;
      }
    }
  }

  /** Same contract as `translateJob`, for the company blurb (never the name). */
  async translateCompany(companyId: string, target: Locale): Promise<MachineTranslationResult> {
    if (!this.provider.enabled) return { status: 'disabled' };

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
    });
    if (!company) return { status: 'failed', reason: 'Company not found' };
    if (!company.description?.trim()) return { status: 'unsupported' };
    if (!isLocale(company.locale)) return { status: 'unsupported' };
    if (target === company.locale) return { status: 'exists', locale: target };

    const hash = contentHash(company.description);
    const existing = company.translations.find((t) => t.locale === target);
    if (existing && (!existing.isMachine || existing.sourceHash === hash)) {
      return { status: 'exists', locale: target };
    }

    const description = company.description.slice(0, MAX_CHARS_PER_FIELD);
    const allowed = await this.consumeBudget(description.length);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const [translated] = await this.provider.translate({
        texts: [description],
        targetLocale: target,
        sourceLocale: company.locale,
      });
      if (!translated) return { status: 'unsupported' };

      const value = { description: translated, isMachine: true, sourceHash: hash };
      await this.prisma.companyTranslation.upsert({
        where: { companyId_locale: { companyId, locale: target } },
        update: value,
        create: { companyId, locale: target, ...value },
      });
      return { status: 'ready', locale: target };
    } catch (err) {
      this.logger.warn(
        `Machine translation failed for company ${companyId}: ${(err as Error).message}`,
      );
      return { status: 'failed', reason: 'Translation service unavailable' };
    }
  }

  /**
   * Fills the missing uz/ru labels of one catalog row. Only empty columns and
   * earlier machine output are touched, so an admin's wording always survives.
   * The row is marked reviewed once nothing is left to translate.
   */
  async translateCatalogLabel(
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogTranslationResult> {
    if (!this.provider.enabled) return { status: 'disabled' };

    const delegate = catalogDelegate(this.prisma, kind);
    const row = await delegate.findUnique({ where: { id } });
    if (!row) return { status: 'failed', reason: 'Catalog entry not found' };

    const source = detectLocale(row.name) ?? 'en';
    const targets = (['uz', 'ru'] as const).filter((locale) => {
      if (locale === source) return false;
      const value = locale === 'uz' ? row.nameUz : row.nameRu;
      const isMachine = locale === 'uz' ? row.nameUzIsMachine : row.nameRuIsMachine;
      // A human value is final; machine output may be refreshed.
      return !value || isMachine;
    });
    if (!targets.length) {
      await this.markCatalogReviewed(kind, id);
      return { status: 'exists' };
    }

    const text = row.name.slice(0, MAX_LABEL_CHARS);
    const allowed = await this.consumeBudget(text.length * targets.length);
    if (!allowed) return { status: 'budget-exceeded' };

    const data: Record<string, unknown> = {};
    const filled: Locale[] = [];
    for (const target of targets) {
      try {
        const [translated] = await this.provider.translate({
          texts: [text],
          targetLocale: target,
          sourceLocale: source,
        });
        // Providers return nothing for a language they do not support.
        if (!translated || translated === text) continue;
        data[target === 'uz' ? 'nameUz' : 'nameRu'] = translated;
        data[target === 'uz' ? 'nameUzIsMachine' : 'nameRuIsMachine'] = true;
        filled.push(target);
      } catch (err) {
        this.logger.warn(
          `Machine translation failed for ${kind} ${id}: ${(err as Error).message}`,
        );
        return { status: 'failed', reason: 'Translation service unavailable' };
      }
    }

    if (!filled.length) return { status: 'unsupported' };

    const covered = (locale: Locale) =>
      locale === source ||
      filled.includes(locale) ||
      Boolean(locale === 'uz' ? row.nameUz : row.nameRu);
    if (covered('uz') && covered('ru')) data.i18nStatus = 'COMPLETE';

    await delegate.update({ where: { id }, data });
    return { status: 'ready', filled };
  }

  private async markCatalogReviewed(kind: CatalogKind, id: string) {
    const delegate = catalogDelegate(this.prisma, kind);
    await delegate.update({ where: { id }, data: { i18nStatus: 'COMPLETE' } });
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
