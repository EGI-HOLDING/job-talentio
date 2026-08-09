import { LanguageLevel, PrismaClient, WorkMode } from '@prisma/client';

type Db = Pick<PrismaClient, 'language' | 'jobPost' | 'jobPostLanguage'>;

export type JobLanguageBackfillResult = {
  scanned: number;
  skippedExisting: number;
  skippedEmptySlice: number;
  filled: number;
};

type LangSpec = { code: string; minLevel: LanguageLevel; isRequired: boolean };

function hashBucket(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function isItRole(title: string, categorySlug: string | null, industrySlug: string | null) {
  const hay = `${title} ${categorySlug ?? ''} ${industrySlug ?? ''}`.toLowerCase();
  return /(?:developer|engineer|software|frontend|backend|fullstack|devops|data|product|design|qa|mobile|ios|android|typescript|react|python|it-|information-technology|technology)/.test(
    hay,
  );
}

function isCustomerFacing(title: string, categorySlug: string | null) {
  const hay = `${title} ${categorySlug ?? ''}`.toLowerCase();
  return /(?:sales|marketing|support|customer|smm|content|hr|recruiter|account)/.test(hay);
}

function pickTemplate(opts: {
  id: string;
  title: string;
  locale: string;
  workMode: WorkMode;
  categorySlug: string | null;
  industrySlug: string | null;
  plan: string | null;
}): LangSpec[] | null {
  const bucket = hashBucket(opts.id);
  // ~12.5% stay empty for empty-state / heuristic match testing
  if (bucket % 8 === 0) return null;

  const it = isItRole(opts.title, opts.categorySlug, opts.industrySlug);
  const customer = isCustomerFacing(opts.title, opts.categorySlug);
  const remote = opts.workMode === 'REMOTE';
  const vipish = opts.plan === 'VIP' || opts.plan === 'PREMIUM';
  const locale = (opts.locale || 'uz').toLowerCase();
  const variant = bucket % 3;

  const specs: LangSpec[] = [];

  if (it) {
    specs.push({ code: 'uz', minLevel: variant === 0 ? 'NATIVE' : 'B2', isRequired: true });
    specs.push({
      code: 'ru',
      minLevel: variant === 2 ? 'B2' : 'B1',
      isRequired: true,
    });
    if (remote || vipish || variant !== 1) {
      specs.push({
        code: 'en',
        minLevel: remote || vipish ? (variant === 0 ? 'C1' : 'B2') : 'B1',
        isRequired: remote || vipish || variant === 0,
      });
    }
  } else if (customer) {
    specs.push({ code: 'uz', minLevel: 'NATIVE', isRequired: true });
    specs.push({ code: 'ru', minLevel: variant === 0 ? 'B2' : 'B1', isRequired: true });
    if (variant === 2 || remote) {
      specs.push({ code: 'en', minLevel: 'B1', isRequired: false });
    }
  } else {
    // Local office / ops / finance / retail
    specs.push({ code: 'uz', minLevel: 'NATIVE', isRequired: true });
    if (variant !== 1 || locale === 'ru') {
      specs.push({ code: 'ru', minLevel: locale === 'ru' ? 'B2' : 'B1', isRequired: true });
    }
    if (remote || (vipish && variant === 0)) {
      specs.push({ code: 'en', minLevel: 'B2', isRequired: false });
    }
  }

  if (locale === 'en' && !specs.some((s) => s.code === 'en')) {
    specs.push({ code: 'en', minLevel: 'B2', isRequired: true });
  }
  if (locale === 'ru') {
    const ru = specs.find((s) => s.code === 'ru');
    if (ru) ru.minLevel = languageLevelMax(ru.minLevel, 'B2');
    else specs.push({ code: 'ru', minLevel: 'B2', isRequired: true });
  }

  // Ensure uz usually present for local market demos
  if (!specs.some((s) => s.code === 'uz') && locale !== 'en') {
    specs.unshift({ code: 'uz', minLevel: 'B2', isRequired: true });
  }

  return specs.slice(0, 3);
}

function languageLevelMax(a: LanguageLevel, b: LanguageLevel): LanguageLevel {
  const order: LanguageLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export async function needsJobLanguageBackfill(db: Db): Promise<boolean> {
  const empty = await db.jobPost.count({
    where: { jobLanguages: { none: {} } },
  });
  if (empty === 0) return false;
  // Only auto-run when a meaningful share of jobs still lack languages
  const total = await db.jobPost.count();
  if (total === 0) return false;
  return empty / total > 0.2;
}

/**
 * Idempotent: only fills jobs that currently have zero JobPostLanguage rows.
 * Uses uz/ru/en only with market-plausible CEFR levels for staging/demo.
 */
export async function backfillJobLanguages(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<JobLanguageBackfillResult> {
  const log = opts?.log ?? (() => undefined);

  const languages = await db.language.findMany({
    where: { code: { in: ['uz', 'ru', 'en'] } },
    select: { id: true, code: true },
  });
  const langIdByCode = new Map(languages.map((l) => [l.code, l.id]));
  if (langIdByCode.size < 3) {
    log('job-language-backfill: missing uz/ru/en catalog rows; abort');
    return { scanned: 0, skippedExisting: 0, skippedEmptySlice: 0, filled: 0 };
  }

  const jobs = await db.jobPost.findMany({
    where: { jobLanguages: { none: {} } },
    select: {
      id: true,
      title: true,
      locale: true,
      workMode: true,
      category: { select: { slug: true } },
      company: {
        select: {
          industry: { select: { slug: true } },
          subscription: { select: { plan: true } },
        },
      },
    },
  });

  let skippedEmptySlice = 0;
  let filled = 0;

  for (const job of jobs) {
    const template = pickTemplate({
      id: job.id,
      title: job.title,
      locale: job.locale,
      workMode: job.workMode,
      categorySlug: job.category?.slug ?? null,
      industrySlug: job.company.industry?.slug ?? null,
      plan: job.company.subscription?.plan ?? null,
    });
    if (!template) {
      skippedEmptySlice += 1;
      continue;
    }

    for (const spec of template) {
      const languageId = langIdByCode.get(spec.code);
      if (!languageId) continue;
      await db.jobPostLanguage.create({
        data: {
          jobPostId: job.id,
          languageId,
          minLevel: spec.minLevel,
          isRequired: spec.isRequired,
        },
      });
    }
    filled += 1;
  }

  const result = {
    scanned: jobs.length,
    skippedExisting: 0,
    skippedEmptySlice,
    filled,
  };
  log(
    `job-language-backfill: scanned=${result.scanned} filled=${result.filled} emptySlice=${result.skippedEmptySlice}`,
  );
  return result;
}
