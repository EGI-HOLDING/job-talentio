import { BadRequestException } from '@nestjs/common';
import { PrismaClient, Skill } from '@prisma/client';
import { initialCatalogStatus } from './i18n/catalog-tech-identity';
import { assertCatalogLabel } from './lookup-normalize';
import { slugify } from './utils';

type Db = Pick<PrismaClient, 'skill' | 'skillAlias'>;

export function normalizeSkillKey(input: string): string {
  let s = input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  s = s
    .replace(/c\+\+/g, 'cplusplus')
    .replace(/c#/g, 'csharp')
    .replace(/f#/g, 'fsharp')
    .replace(/\.net\b/g, 'dotnet');

  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  return s;
}

/** Slug that preserves C++/C# tokens before generic slugify. */
export function skillSlugify(input: string): string {
  let s = input.trim().toLowerCase();
  s = s
    .replace(/c\+\+/gi, 'cplusplus')
    .replace(/c#/gi, 'csharp')
    .replace(/f#/gi, 'fsharp');
  return slugify(s) || normalizeSkillKey(input).slice(0, 60);
}

function titleCaseFromSlug(slug: string): string {
  if (slug === 'cplusplus') return 'C++';
  if (slug === 'csharp') return 'C#';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}+.#/\s-]{0,78}$/u;

export type ResolveSkillResult = {
  skill: Skill;
  created: boolean;
  matchedVia: 'slug' | 'normalizedKey' | 'alias' | 'name' | 'created';
};

/**
 * Strict find-or-create: prefer existing Skill / SkillAlias; only create when no match.
 * Novel spellings of an existing skill become aliases instead of new rows.
 */
export async function resolveSkill(
  db: Db,
  opts: { name?: string; slug?: string; category?: string; allowCreate?: boolean },
): Promise<ResolveSkillResult> {
  const allowCreate = opts.allowCreate !== false;
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('slug or name required');

  const slug = opts.slug ? skillSlugify(opts.slug) : opts.name ? skillSlugify(opts.name) : '';
  const key = normalizeSkillKey(raw);
  if (!key || key.length < 1) {
    throw new BadRequestException('Skill name is too short or invalid');
  }

  const bySlug = slug
    ? await db.skill.findUnique({ where: { slug } })
    : null;
  if (bySlug) {
    if (bySlug.archivedAt) throw new BadRequestException('Skill is not available');
    await ensureAlias(db, bySlug.id, raw, key);
    return { skill: bySlug, created: false, matchedVia: 'slug' };
  }

  const byKey = await db.skill.findUnique({ where: { normalizedKey: key } });
  if (byKey) {
    if (byKey.archivedAt) throw new BadRequestException('Skill is not available');
    await ensureAlias(db, byKey.id, raw, key);
    return { skill: byKey, created: false, matchedVia: 'normalizedKey' };
  }

  const byAlias = await db.skillAlias.findUnique({
    where: { aliasKey: key },
    include: { skill: true },
  });
  if (byAlias?.skill) {
    if (byAlias.skill.archivedAt) throw new BadRequestException('Skill is not available');
    return { skill: byAlias.skill, created: false, matchedVia: 'alias' };
  }

  const byName = await db.skill.findFirst({
    where: { OR: (['name', 'nameId', 'nameRu', 'nameUz'] as const).map(field => ({ [field]: { equals: raw, mode: 'insensitive' as const } })) },
  });
  if (byName) {
    if (byName.archivedAt) throw new BadRequestException('Skill is not available');
    await ensureAlias(db, byName.id, raw, key);
    return { skill: byName, created: false, matchedVia: 'name' };
  }

  if (!allowCreate) {
    throw new BadRequestException('Skill not found');
  }

  const displayName = opts.name?.trim() || titleCaseFromSlug(slug || key);
  try {
    assertCatalogLabel(displayName);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
  if (opts.name && !NAME_RE.test(opts.name.trim())) {
    throw new BadRequestException(
      'Skill name contains invalid characters. Use letters, numbers, and + . # / -',
    );
  }
  const finalSlug = slug || skillSlugify(displayName) || key.slice(0, 60);

  // ON CONFLICT keeps an enclosing CV import transaction usable when another
  // profile creates the same catalog label concurrently.
  const inserted = await db.skill.createMany({
      data: [{
        name: displayName,
        slug: finalSlug,
        normalizedKey: key,
        category: opts.category,
        i18nStatus: initialCatalogStatus(displayName),
      }],
      skipDuplicates: true,
    });
    const skill = (await db.skill.findUnique({ where: { normalizedKey: key } })) || (await db.skill.findUnique({ where: { slug: finalSlug } }));
    if (!skill || skill.archivedAt) throw new BadRequestException('Skill is not available');
    if (normalizeSkillKey(displayName) !== key || displayName !== skill.name) {
      await ensureAlias(db, skill.id, raw, key);
    }
    return { skill, created: inserted.count > 0, matchedVia: inserted.count ? 'created' : 'normalizedKey' };
}

async function ensureAlias(db: Db, skillId: string, alias: string, aliasKey: string) {
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill) return;
  if (normalizeSkillKey(skill.name) === aliasKey || skill.slug === skillSlugify(alias)) {
    return;
  }
  const existing = await db.skillAlias.findUnique({ where: { aliasKey } });
  if (existing) return;
  await db.skillAlias.createMany({
    data: [{ skillId, alias: alias.trim().slice(0, 80), aliasKey }],
    skipDuplicates: true,
  });
}
