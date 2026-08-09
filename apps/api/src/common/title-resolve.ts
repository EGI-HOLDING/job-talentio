import { BadRequestException } from '@nestjs/common';
import { ExperienceLevel, JobTitle, PrismaClient } from '@prisma/client';
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
  lead: 'LEAD',
  executive: 'EXECUTIVE',
};

/** Tokens stripped only at start/end — never Manager/Director/Partner or "Team Lead" role names. */
const PREFIX_SENIORITY =
  /^(junior|jr\.?|senior|sr\.?|mid(?:dle)?(?:[-\s]?level)?|entry(?:[-\s]?level)?|principal|staff|intern(?:ship)?)\s+/i;
const SUFFIX_SENIORITY =
  /\s+(junior|jr\.?|senior|sr\.?|mid(?:dle)?(?:[-\s]?level)?|entry(?:[-\s]?level)?|intern(?:ship)?)$/i;
/** "X Intern" / "Intern X" already covered; also "Motion Design Intern" */
const TRAILING_INTERN = /\s+intern(?:ship)?$/i;

export type StripSeniorityResult = {
  roleTitle: string;
  inferredLevel: ExperienceLevel | null;
};

export function stripSeniorityFromTitle(input: string): StripSeniorityResult {
  let s = input.trim().replace(/\s+/g, ' ');
  let inferred: ExperienceLevel | null = null;

  const takeLevel = (token: string) => {
    const key = token
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[-\s]/g, '');
    const level = SENIORITY_LEVEL[key];
    if (level && !inferred) inferred = level;
  };

  for (let i = 0; i < 3; i++) {
    const pre = s.match(PREFIX_SENIORITY);
    if (pre) {
      takeLevel(pre[1]);
      s = s.slice(pre[0].length).trim();
      continue;
    }
    const suf = s.match(SUFFIX_SENIORITY) || s.match(TRAILING_INTERN);
    if (suf) {
      takeLevel(suf[1] || 'intern');
      s = s.slice(0, suf.index).trim();
      continue;
    }
    break;
  }

  // Parenthetical leftovers like "(Remote-first)" stay; strip empty parens
  s = s.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
  return { roleTitle: s || input.trim(), inferredLevel: inferred };
}

export function normalizeJobTitleKey(input: string): string {
  let s = input
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
  let s = input.trim().toLowerCase();
  s = s
    .replace(/c\+\+/gi, 'cplusplus')
    .replace(/\bcpp\b/gi, 'cplusplus')
    .replace(/front[\s-]*end/gi, 'frontend')
    .replace(/back[\s-]*end/gi, 'backend')
    .replace(/full[\s-]*stack/gi, 'fullstack');
  return slugify(s) || normalizeJobTitleKey(input).slice(0, 60);
}

function canonicalDisplayName(roleTitle: string): string {
  let s = roleTitle.trim().replace(/\s+/g, ' ');
  // Prefer readable tech tokens
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
  /** Original input after seniority strip (before catalog name overwrite). */
  roleTitle: string;
};

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

  const slug = opts.slug
    ? jobTitleSlugify(opts.slug)
    : jobTitleSlugify(roleTitle);
  const key = normalizeJobTitleKey(roleTitle);
  if (!key || key.length < 2) {
    throw new BadRequestException('Job title is too short or invalid');
  }

  const bySlug = slug ? await db.jobTitle.findUnique({ where: { slug } }) : null;
  if (bySlug) {
    await ensureAlias(db, bySlug.id, raw, key);
    return {
      jobTitle: bySlug,
      created: false,
      matchedVia: 'slug',
      inferredLevel,
      roleTitle,
    };
  }

  const byKey = await db.jobTitle.findUnique({ where: { normalizedKey: key } });
  if (byKey) {
    await ensureAlias(db, byKey.id, raw, key);
    return {
      jobTitle: byKey,
      created: false,
      matchedVia: 'normalizedKey',
      inferredLevel,
      roleTitle,
    };
  }

  const byAlias = await db.jobTitleAlias.findUnique({
    where: { aliasKey: key },
    include: { jobTitle: true },
  });
  if (byAlias?.jobTitle) {
    return {
      jobTitle: byAlias.jobTitle,
      created: false,
      matchedVia: 'alias',
      inferredLevel,
      roleTitle,
    };
  }

  const byName = await db.jobTitle.findFirst({
    where: { name: { equals: roleTitle, mode: 'insensitive' } },
  });
  if (byName) {
    await ensureAlias(db, byName.id, raw, key);
    return {
      jobTitle: byName,
      created: false,
      matchedVia: 'name',
      inferredLevel,
      roleTitle,
    };
  }

  if (!allowCreate) {
    throw new BadRequestException('Job title not found');
  }

  if (!NAME_RE.test(roleTitle)) {
    throw new BadRequestException(
      'Job title contains invalid characters. Use letters, numbers, and + . # / & - ( )',
    );
  }

  const displayName = canonicalDisplayName(roleTitle);
  const finalSlug = slug || jobTitleSlugify(displayName) || key.slice(0, 60);

  try {
    const jobTitle = await db.jobTitle.create({
      data: {
        name: displayName,
        slug: finalSlug,
        normalizedKey: key,
      },
    });
    if (normalizeJobTitleKey(displayName) !== key || raw !== displayName) {
      await ensureAlias(db, jobTitle.id, raw, key);
    }
    // Also alias common orthographic variant of the same key
    const altKey = normalizeJobTitleKey(raw);
    if (altKey && altKey !== key) {
      await ensureAlias(db, jobTitle.id, raw, altKey);
    }
    return {
      jobTitle,
      created: true,
      matchedVia: 'created',
      inferredLevel,
      roleTitle,
    };
  } catch {
    const again =
      (await db.jobTitle.findUnique({ where: { slug: finalSlug } })) ||
      (await db.jobTitle.findUnique({ where: { normalizedKey: key } }));
    if (again) {
      await ensureAlias(db, again.id, raw, key);
      return {
        jobTitle: again,
        created: false,
        matchedVia: 'slug',
        inferredLevel,
        roleTitle,
      };
    }
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
