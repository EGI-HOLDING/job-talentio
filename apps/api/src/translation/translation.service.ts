import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { catalogDelegate } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { contentHash } from '../common/i18n/content-locale';
import { detectLocale } from '../common/i18n/detect-locale';
import { DEFAULT_LOCALE, isLocale } from '../common/i18n/locale';
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

    const chars = title.length + description.length;
    const allowed = await this.consumeBudget(chars);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const [translatedTitle, translatedDescription] = await this.provider.translate({
        texts: [title, description],
        targetLocale: target,
        sourceLocale: job.locale,
      });
      if (!translatedTitle || !translatedDescription) {
        await this.refundBudget(chars);
        return { status: 'unsupported' };
      }

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
      await this.refundBudget(chars);
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
      const qChars = text.length;
      if (!(await this.consumeBudget(qChars))) return;

      try {
        const [translated] = await this.provider.translate({
          texts: [text],
          targetLocale: target,
          sourceLocale: source,
        });
        if (!translated) {
          await this.refundBudget(qChars);
          continue;
        }
        const value = { question: translated, isMachine: true, sourceHash: hash };
        await this.prisma.jobQuestionTranslation.upsert({
          where: { questionId_locale: { questionId: question.id, locale: target } },
          update: value,
          create: { questionId: question.id, locale: target, ...value },
        });
      } catch (err) {
        await this.refundBudget(qChars);
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
    const chars = description.length;
    const allowed = await this.consumeBudget(chars);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const [translated] = await this.provider.translate({
        texts: [description],
        targetLocale: target,
        sourceLocale: company.locale,
      });
      if (!translated) {
        await this.refundBudget(chars);
        return { status: 'unsupported' };
      }

      const value = { description: translated, isMachine: true, sourceHash: hash };
      await this.prisma.companyTranslation.upsert({
        where: { companyId_locale: { companyId, locale: target } },
        update: value,
        create: { companyId, locale: target, ...value },
      });
      return { status: 'ready', locale: target };
    } catch (err) {
      await this.refundBudget(chars);
      this.logger.warn(
        `Machine translation failed for company ${companyId}: ${(err as Error).message}`,
      );
      return { status: 'failed', reason: 'Translation service unavailable' };
    }
  }

  /** Same contract as `translateJob`, for an article title, excerpt, and body. */
  async translateNews(slug: string, target: Locale): Promise<MachineTranslationResult> {
    if (!this.provider.enabled) return { status: 'disabled' };

    const article = await this.prisma.newsArticle.findUnique({
      where: { slug },
      include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
    });
    if (!article || !article.isPublished) return { status: 'failed', reason: 'Article not found' };
    if (!isLocale(article.locale)) return { status: 'unsupported' };
    if (target === article.locale) return { status: 'exists', locale: target };

    const hash = contentHash(article.title, article.excerpt, article.body);
    const existing = article.translations.find((t) => t.locale === target);
    if (existing && (!existing.isMachine || existing.sourceHash === hash)) {
      return { status: 'exists', locale: target };
    }

    const title = article.title.slice(0, MAX_CHARS_PER_FIELD);
    const excerpt = article.excerpt.slice(0, MAX_CHARS_PER_FIELD);
    const body = article.body.slice(0, MAX_CHARS_PER_FIELD);
    const chars = title.length + excerpt.length + body.length;
    const allowed = await this.consumeBudget(chars);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const [translatedTitle, translatedExcerpt, translatedBody] = await this.provider.translate({
        texts: [title, excerpt, body],
        targetLocale: target,
        sourceLocale: article.locale,
      });
      if (!translatedTitle || !translatedExcerpt || !translatedBody) {
        await this.refundBudget(chars);
        return { status: 'unsupported' };
      }

      const value = {
        title: translatedTitle,
        excerpt: translatedExcerpt,
        body: translatedBody,
        isMachine: true,
        sourceHash: hash,
      };
      await this.prisma.newsArticleTranslation.upsert({
        where: { articleId_locale: { articleId: article.id, locale: target } },
        update: value,
        create: { articleId: article.id, locale: target, ...value },
      });
      return { status: 'ready', locale: target };
    } catch (err) {
      await this.refundBudget(chars);
      this.logger.warn(
        `Machine translation failed for news ${slug}: ${(err as Error).message}`,
      );
      return { status: 'failed', reason: 'Translation service unavailable' };
    }
  }

  /**
   * Recruiter-triggered batch for a candidate's narrative fields. Proper names
   * (person, company, school, issuer) stay in the source language.
   */
  async translateProfile(profileId: string, target: Locale): Promise<MachineTranslationResult> {
    if (!this.provider.enabled) return { status: 'disabled' };

    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      include: {
        translations: { select: { locale: true, isMachine: true, sourceHash: true } },
        experiences: {
          include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
        },
        educations: {
          include: { translations: { select: { locale: true, isMachine: true, sourceHash: true } } },
        },
      },
    });
    if (!profile) return { status: 'failed', reason: 'Profile not found' };

    const detected =
      detectLocale([profile.headline, profile.summary].filter(Boolean).join('\n')) ?? DEFAULT_LOCALE;
    const source: Locale = isLocale(profile.contentLocale) ? profile.contentLocale : detected;
    if (target === source) return { status: 'exists', locale: target };

    type Pending = { texts: string[]; apply: (out: string[]) => Promise<void> };
    const pending: Pending[] = [];

    const profileParts: Array<{ key: 'headline' | 'summary'; text: string }> = [];
    if (profile.headline?.trim()) {
      profileParts.push({ key: 'headline', text: profile.headline.slice(0, MAX_CHARS_PER_FIELD) });
    }
    if (profile.summary?.trim()) {
      profileParts.push({ key: 'summary', text: profile.summary.slice(0, MAX_CHARS_PER_FIELD) });
    }
    const profileHash = contentHash(profile.headline, profile.summary);
    const profileExisting = profile.translations.find((t) => t.locale === target);
    if (
      profileParts.length &&
      !(profileExisting && (!profileExisting.isMachine || profileExisting.sourceHash === profileHash))
    ) {
      pending.push({
        texts: profileParts.map((p) => p.text),
        apply: async (out) => {
          const value: {
            headline?: string;
            summary?: string;
            isMachine: boolean;
            sourceHash: string;
          } = { isMachine: true, sourceHash: profileHash };
          profileParts.forEach((part, i) => {
            value[part.key] = out[i];
          });
          await this.prisma.employeeProfileTranslation.upsert({
            where: { profileId_locale: { profileId, locale: target } },
            update: value,
            create: { profileId, locale: target, ...value },
          });
        },
      });
    }

    for (const exp of profile.experiences) {
      const parts: Array<{ key: 'title' | 'description'; text: string }> = [];
      if (exp.title.trim()) {
        parts.push({ key: 'title', text: exp.title.slice(0, MAX_CHARS_PER_FIELD) });
      }
      if (exp.description?.trim()) {
        parts.push({ key: 'description', text: exp.description.slice(0, MAX_CHARS_PER_FIELD) });
      }
      if (!parts.length) continue;
      const hash = contentHash(exp.title, exp.description);
      const existing = exp.translations.find((t) => t.locale === target);
      if (existing && (!existing.isMachine || existing.sourceHash === hash)) continue;
      pending.push({
        texts: parts.map((p) => p.text),
        apply: async (out) => {
          const value: {
            title?: string;
            description?: string;
            isMachine: boolean;
            sourceHash: string;
          } = { isMachine: true, sourceHash: hash };
          parts.forEach((part, i) => {
            value[part.key] = out[i];
          });
          const title = value.title ?? exp.title;
          await this.prisma.workExperienceTranslation.upsert({
            where: { experienceId_locale: { experienceId: exp.id, locale: target } },
            update: {
              title,
              description: value.description,
              isMachine: true,
              sourceHash: hash,
            },
            create: {
              experienceId: exp.id,
              locale: target,
              title,
              description: value.description,
              isMachine: true,
              sourceHash: hash,
            },
          });
        },
      });
    }

    for (const edu of profile.educations) {
      if (!edu.field?.trim()) continue;
      const text = edu.field.slice(0, MAX_CHARS_PER_FIELD);
      const hash = contentHash(edu.field);
      const existing = edu.translations.find((t) => t.locale === target);
      if (existing && (!existing.isMachine || existing.sourceHash === hash)) continue;
      pending.push({
        texts: [text],
        apply: async (out) => {
          const value = { field: out[0], isMachine: true, sourceHash: hash };
          await this.prisma.educationTranslation.upsert({
            where: { educationId_locale: { educationId: edu.id, locale: target } },
            update: value,
            create: { educationId: edu.id, locale: target, ...value },
          });
        },
      });
    }

    if (!pending.length) {
      const hadNarrative =
        profileParts.length > 0 ||
        profile.experiences.some((e) => e.title.trim() || e.description?.trim()) ||
        profile.educations.some((e) => e.field?.trim());
      return hadNarrative ? { status: 'exists', locale: target } : { status: 'unsupported' };
    }

    const texts = pending.flatMap((item) => item.texts);
    const chars = texts.reduce((n, t) => n + t.length, 0);
    const allowed = await this.consumeBudget(chars);
    if (!allowed) return { status: 'budget-exceeded' };

    try {
      const translated = await this.provider.translate({
        texts,
        targetLocale: target,
        sourceLocale: source,
      });
      if (translated.length < texts.length || translated.some((t) => !t)) {
        await this.refundBudget(chars);
        return { status: 'unsupported' };
      }
      let offset = 0;
      for (const item of pending) {
        const slice = translated.slice(offset, offset + item.texts.length);
        offset += item.texts.length;
        await item.apply(slice as string[]);
      }
      return { status: 'ready', locale: target };
    } catch (err) {
      await this.refundBudget(chars);
      this.logger.warn(
        `Machine translation failed for profile ${profileId}: ${(err as Error).message}`,
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
    const reserved = text.length * targets.length;
    const allowed = await this.consumeBudget(reserved);
    if (!allowed) return { status: 'budget-exceeded' };

    const data: Record<string, unknown> = {};
    const filled: Locale[] = [];
    let spent = 0;
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
        spent += text.length;
      } catch (err) {
        await this.refundBudget(reserved - spent);
        this.logger.warn(
          `Machine translation failed for ${kind} ${id}: ${(err as Error).message}`,
        );
        return { status: 'failed', reason: 'Translation service unavailable' };
      }
    }

    if (spent < reserved) await this.refundBudget(reserved - spent);
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

  private budgetKey(): string {
    const month = new Date().toISOString().slice(0, 7);
    return `mt:chars:${month}`;
  }

  /**
   * Reserve characters against the monthly Redis counter. Callers must
   * `refundBudget` when the provider fails or returns unsupported output so
   * failed attempts do not burn the monthly cap.
   */
  private async consumeBudget(chars: number): Promise<boolean> {
    if (this.monthlyCharBudget <= 0) return true;
    if (!this.redis || this.redis.status !== 'ready') {
      this.logger.warn('Redis unavailable, skipping machine translation to protect the budget');
      return false;
    }

    const key = this.budgetKey();
    try {
      const used = await this.redis.incrby(key, chars);
      if (used === chars) await this.redis.expire(key, 60 * 60 * 24 * 40);
      if (used > this.monthlyCharBudget) {
        await this.redis.decrby(key, chars);
        this.logger.warn(`Machine translation budget exhausted (${used - chars} chars this month)`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async refundBudget(chars: number): Promise<void> {
    if (chars <= 0 || this.monthlyCharBudget <= 0) return;
    if (!this.redis || this.redis.status !== 'ready') return;
    try {
      await this.redis.decrby(this.budgetKey(), chars);
    } catch {
      // Best-effort; over-count is safer than under-count on refund failure.
    }
  }
}
