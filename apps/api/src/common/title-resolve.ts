import { BadRequestException } from '@nestjs/common';
import { ExperienceLevel, JobTitle, PrismaClient } from '@prisma/client';
import { initialCatalogStatus } from './i18n/catalog-tech-identity';
import { assertCatalogLabel } from './lookup-normalize';
import { slugify } from './utils';

type Db = Pick<PrismaClient, 'jobTitle' | 'jobTitleAlias'>;

/** Map variant normalized keys → canonical key (role tokens). */
const TITLE_SYNONYMS: Record<string, string> = {
  frontdeveloper: 'frontenddeveloper',
  frontenddev: 'frontenddeveloper',
  frontdev: 'frontenddeveloper',
  backendeveloper: 'backenddeveloper',
  backenddev: 'backenddeveloper',
  cppdeveloper: 'cplusplusdeveloper',
  cppsystemsengineer: 'cplusplussystemsengineer',
  nodedev: 'nodejsdeveloper',
  reactjsdeveloper: 'reactdeveloper',
};

const SENIORITY_LEVEL: Record<string, ExperienceLevel> = {
  intern: 'INTERN',
  internship: 'INTERN',
  junior: 'JUNIOR',
  jr: 'JUNIOR',
  entry: 'JUNIOR',
  entrylevel: 'JUNIOR',
  mid: 'MIDDLE',
  middle: 'MIDDLE',
  midlevel: 'MIDDLE',
  senior: 'SENIOR',
  sr: 'SENIOR',
  principal: 'SENIOR',
  staff: 'SENIOR',
  executive: 'EXECUTIVE',
};

/**
 * Whole-word seniority tokens (not Lead/Manager — those are role names).
 * Use trailing lookahead so "Sr." / "Jr." consume the period (plain `\b` would stop at `Sr`).
 */
const SENIORITY_TOKEN_RE =
  /\b(?:junior|senior|mid(?:dle)?(?:[-\s]?level)?|entry(?:[-\s]?level)?|principal|staff|intern(?:ship)?|jr\.?|sr\.?)(?=\s|[|/(),-]|$)/gi;

export type StripSeniorityResult = {
  roleTitle: string;
  inferredLevel: ExperienceLevel | null;
};

export function titleHasSeniorityToken(input: string): boolean {
  SENIORITY_TOKEN_RE.lastIndex = 0;
  return SENIORITY_TOKEN_RE.test(input);
}

export function stripSeniorityFromTitle(input: string): StripSeniorityResult {
  let s = input
    .trim()
    .replace(/[\u2013\u2014/]/g, '-')
    .replace(/\s+/g, ' ');
  let inferred: ExperienceLevel | null = null;

  const takeLevel = (token: string) => {
    const key = token
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[-\s]/g, '');
    const level = SENIORITY_LEVEL[key];
    if (level && !inferred) inferred = level;
  };

  // Drop parentheses that only contain seniority: "(Senior)", "(Jr.)"
  s = s.replace(/\(\s*([^)]+?)\s*\)/g, (_m, inner: string) => {
    const innerText = String(inner).trim();
    SENIORITY_TOKEN_RE.lastIndex = 0;
    const without = innerText.replace(SENIORITY_TOKEN_RE, (token) => {
      takeLevel(token);
      return ' ';
    }).replace(/\s+/g, ' ').trim();
    return without ? ` (${without}) ` : ' ';
  });

  // Remove every whole-word seniority token anywhere in the title
  SENIORITY_TOKEN_RE.lastIndex = 0;
  s = s.replace(SENIORITY_TOKEN_RE, (token) => {
    takeLevel(token);
    return ' ';
  });

  s = s
    .replace(/\(\s*\)/g, '')
    .replace(/^\.+\s*|\s*\.+(?=\s|$)/g, ' ')
    .replace(/\s*([|/])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-,|/]+|[\s\-,|/]+$/g, '')
    .trim();

  if (!s) {
    SENIORITY_TOKEN_RE.lastIndex = 0;
    s = input
      .replace(SENIORITY_TOKEN_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { roleTitle: s, inferredLevel: inferred };
}

export function normalizeJobTitleKey(input: string): string {
  const { roleTitle } = stripSeniorityFromTitle(input);
  let s = roleTitle
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  s = s
    .replace(/c\+\+/g, 'cplusplus')
    .replace(/\bcpp\b/g, 'cplusplus')
    .replace(/c\s*plus\s*plus/g, 'cplusplus')
    .replace(/c#/g, 'csharp')
    .replace(/node\.?js/g, 'nodejs')
    .replace(/react\.?js/g, 'react')
    .replace(/front[\s-]*end/g, 'frontend')
    .replace(/back[\s-]*end/g, 'backend')
    .replace(/full[\s-]*stack/g, 'fullstack')
    .replace(/ui\s*\/\s*ux/g, 'uiux')
    .replace(/ui\/ux/g, 'uiux');

  s = s.replace(/[^a-z0-9]+/g, '');
  if (!s) return '';
  return TITLE_SYNONYMS[s] ?? s;
}

export function jobTitleSlugify(input: string): string {
  const { roleTitle } = stripSeniorityFromTitle(input);
  let s = roleTitle.trim().toLowerCase();
  s = s
    .replace(/c\+\+/gi, 'cplusplus')
    .replace(/\bcpp\b/gi, 'cplusplus')
    .replace(/front[\s-]*end/gi, 'frontend')
    .replace(/back[\s-]*end/gi, 'backend')
    .replace(/full[\s-]*stack/gi, 'fullstack');
  return slugify(s) || normalizeJobTitleKey(roleTitle).slice(0, 60);
}

export function canonicalDisplayName(roleTitle: string): string {
  let s = stripSeniorityFromTitle(roleTitle).roleTitle.trim().replace(/\s+/g, ' ');
  s = s
    .replace(/\bcpp\b/gi, 'C++')
    .replace(/\bc\+\+\b/gi, 'C++')
    .replace(/\bfrontend\b/gi, 'Frontend')
    .replace(/\bbackend\b/gi, 'Backend')
    .replace(/\bfull[\s-]*stack\b/gi, 'Full-stack')
    .replace(/\bui\s*\/\s*ux\b/gi, 'UI/UX');
  return s
    .split(' ')
    .map((w) => {
      if (/^c\+\+$/i.test(w)) return 'C++';
      if (w.includes('/') || w.includes('.')) return w;
      if (w === w.toUpperCase() && w.length <= 4) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}+.#/&\s()-]{0,118}$/u;

export type ResolveJobTitleResult = {
  jobTitle: JobTitle;
  created: boolean;
  matchedVia: 'slug' | 'normalizedKey' | 'alias' | 'name' | 'created';
  inferredLevel: ExperienceLevel | null;
  roleTitle: string;
};

/** If catalog display name still has Senior/Junior/…, rewrite it in place (or point at clean twin). */
async function ensureCleanCatalogName(
  db: Db,
  jobTitle: JobTitle,
  roleTitle: string,
): Promise<JobTitle> {
  const clean = canonicalDisplayName(roleTitle);
  const key = normalizeJobTitleKey(roleTitle);

  if (!titleHasSeniorityToken(jobTitle.name) && jobTitle.name === clean) {
    return jobTitle;
  }

  // An admin-edited title keeps its wording even if it does not match what the
  // canonicalizer would produce.
  if (jobTitle.curatedAt) return jobTitle;

  // Prefer an already-clean twin with the same key
  if (key) {
    const twin = await db.jobTitle.findUnique({ where: { normalizedKey: key } });
    if (twin && twin.id !== jobTitle.id && !titleHasSeniorityToken(twin.name)) {
      return twin;
    }
  }

  if (!titleHasSeniorityToken(jobTitle.name) && !titleHasSeniorityToken(clean)) {
    if (normalizeJobTitleKey(jobTitle.name) === key && jobTitle.name !== clean) {
      return db.jobTitle
        .update({ where: { id: jobTitle.id }, data: { name: clean } })
        .catch(() => jobTitle);
    }
    return jobTitle;
  }

  const slug = jobTitleSlugify(roleTitle) || key.slice(0, 60);
  return db.jobTitle
    .update({
      where: { id: jobTitle.id },
      data: { name: clean, ...(key ? { normalizedKey: key } : {}), ...(slug ? { slug } : {}) },
    })
    .catch(async () => {
      const existing = key
        ? await db.jobTitle.findUnique({ where: { normalizedKey: key } })
        : null;
      return existing ?? { ...jobTitle, name: clean };
    });
}

/**
 * Strict find-or-create for role titles. Seniority is stripped; synonyms/aliases collapse variants.
 * Auto-create when no match (allowCreate default true).
 */
export async function resolveJobTitle(
  db: Db,
  opts: { name?: string; slug?: string; allowCreate?: boolean },
): Promise<ResolveJobTitleResult> {
  const allowCreate = opts.allowCreate !== false;
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('Job title is required');

  const { roleTitle, inferredLevel } = stripSeniorityFromTitle(raw);
  if (roleTitle.length < 2) {
    throw new BadRequestException('Job title is too short after removing seniority words');
  }

  const slug = opts.slug ? jobTitleSlugify(opts.slug) : jobTitleSlugify(roleTitle);
  const key = normalizeJobTitleKey(roleTitle);
  if (!key || key.length < 2) {
    throw new BadRequestException('Job title is too short or invalid');
  }

  const finish = async (
    jobTitle: JobTitle,
    matchedVia: ResolveJobTitleResult['matchedVia'],
    created: boolean,
  ): Promise<ResolveJobTitleResult> => {
    const cleaned = await ensureCleanCatalogName(db, jobTitle, roleTitle);
    await ensureAlias(db, cleaned.id, raw, key);
    return { jobTitle: cleaned, created, matchedVia, inferredLevel, roleTitle };
  };

  const bySlug = slug ? await db.jobTitle.findUnique({ where: { slug } }) : null;
  if (bySlug) return finish(bySlug, 'slug', false);

  const byKey = await db.jobTitle.findUnique({ where: { normalizedKey: key } });
  if (byKey) return finish(byKey, 'normalizedKey', false);

  const byAlias = await db.jobTitleAlias.findUnique({
    where: { aliasKey: key },
    include: { jobTitle: true },
  });
  if (byAlias?.jobTitle) return finish(byAlias.jobTitle, 'alias', false);

  // Also match dirty catalog names that still contain seniority
  const byDirtyName = await db.jobTitle.findFirst({
    where: {
      OR: [
        { name: { equals: roleTitle, mode: 'insensitive' } },
        { name: { equals: raw, mode: 'insensitive' } },
        { name: { contains: roleTitle, mode: 'insensitive' } },
      ],
    },
  });
  if (byDirtyName && normalizeJobTitleKey(byDirtyName.name) === key) {
    return finish(byDirtyName, 'name', false);
  }

  if (!allowCreate) {
    throw new BadRequestException('Job title not found');
  }

  if (!NAME_RE.test(roleTitle)) {
    throw new BadRequestException(
      'Job title contains invalid characters. Use letters, numbers, and + . # / & - ( )',
    );
  }
  try {
    assertCatalogLabel(roleTitle, { skipCharset: true });
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }

  const displayName = canonicalDisplayName(roleTitle);
  const finalSlug = slug || jobTitleSlugify(displayName) || key.slice(0, 60);

  try {
    const jobTitle = await db.jobTitle.create({
      data: {
        name: displayName,
        slug: finalSlug,
        normalizedKey: key,
        i18nStatus: initialCatalogStatus(displayName),
      },
    });
    const altKey = normalizeJobTitleKey(raw);
    if (altKey && altKey !== key) {
      await ensureAlias(db, jobTitle.id, raw, altKey);
    }
    return finish(jobTitle, 'created', true);
  } catch {
    const again =
      (await db.jobTitle.findUnique({ where: { slug: finalSlug } })) ||
      (await db.jobTitle.findUnique({ where: { normalizedKey: key } }));
    if (again) return finish(again, 'slug', false);
    throw new BadRequestException('Could not create job title');
  }
}

async function ensureAlias(db: Db, jobTitleId: string, alias: string, aliasKey: string) {
  if (!aliasKey) return;
  const title = await db.jobTitle.findUnique({ where: { id: jobTitleId } });
  if (!title) return;
  if (
    normalizeJobTitleKey(title.name) === aliasKey ||
    title.slug === jobTitleSlugify(alias)
  ) {
    return;
  }
  const existing = await db.jobTitleAlias.findUnique({ where: { aliasKey } });
  if (existing) return;
  await db.jobTitleAlias
    .create({
      data: {
        jobTitleId,
        alias: alias.trim().slice(0, 120),
        aliasKey,
      },
    })
    .catch(() => undefined);
}
