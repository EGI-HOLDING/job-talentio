import { BadRequestException } from '@nestjs/common';
import { Benefit, PrismaClient } from '@prisma/client';
import { resolveBenefitIcon } from '@job-talentio/shared';
import {
  assertLookupName,
  catalogSlugify,
  normalizeLookupKey,
  titleCaseWords,
} from './lookup-normalize';

type Db = Pick<PrismaClient, 'benefit' | 'benefitAlias'>;

const BENEFIT_SYNONYMS: Record<string, string> = {
  healthcare: 'healthinsurance',
  medicalinsurance: 'healthinsurance',
  health: 'healthinsurance',
  wfh: 'remotework',
  remote: 'remotework',
  workfromhome: 'remotework',
  flexhours: 'flexiblehours',
  flextime: 'flexiblehours',
  gymmembership: 'gym',
  fitness: 'gym',
  vacation: 'paidvacation',
  annualleave: 'paidvacation',
  stock: 'stockoptions',
  equity: 'stockoptions',
  bonus: 'bonus',
  performancebonus: 'bonus',
};

function benefitKey(input: string): string {
  const key = normalizeLookupKey(input);
  return BENEFIT_SYNONYMS[key] ?? key;
}

export type ResolveBenefitResult = {
  benefit: Benefit;
  created: boolean;
  matchedVia: 'slug' | 'normalizedKey' | 'alias' | 'name' | 'created';
};

export async function resolveBenefit(
  db: Db,
  opts: { name?: string; slug?: string; icon?: string; allowCreate?: boolean },
): Promise<ResolveBenefitResult> {
  const allowCreate = opts.allowCreate !== false;
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('slug or name required');

  const slug = opts.slug ? catalogSlugify(opts.slug) : opts.name ? catalogSlugify(opts.name) : '';
  const key = benefitKey(raw);
  if (!key) throw new BadRequestException('Benefit name is too short or invalid');

  const bySlug = slug ? await db.benefit.findUnique({ where: { slug } }) : null;
  if (bySlug) {
    await ensureAlias(db, bySlug.id, raw, key);
    return { benefit: bySlug, created: false, matchedVia: 'slug' };
  }

  const byKey = await db.benefit.findUnique({ where: { normalizedKey: key } });
  if (byKey) {
    await ensureAlias(db, byKey.id, raw, key);
    return { benefit: byKey, created: false, matchedVia: 'normalizedKey' };
  }

  const byAlias = await db.benefitAlias.findUnique({
    where: { aliasKey: key },
    include: { benefit: true },
  });
  if (byAlias?.benefit) {
    return { benefit: byAlias.benefit, created: false, matchedVia: 'alias' };
  }

  const byName = await db.benefit.findFirst({
    where: { name: { equals: raw, mode: 'insensitive' } },
  });
  if (byName) {
    await ensureAlias(db, byName.id, raw, key);
    if (!byName.normalizedKey) {
      await db.benefit
        .update({ where: { id: byName.id }, data: { normalizedKey: key } })
        .catch(() => undefined);
    }
    return { benefit: byName, created: false, matchedVia: 'name' };
  }

  if (!allowCreate) throw new BadRequestException('Benefit not found');

  try {
    assertLookupName(opts.name || raw);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }

  const displayName = opts.name?.trim() || titleCaseWords(slug.replace(/-/g, ' '));
  const finalSlug = slug || catalogSlugify(displayName) || key.slice(0, 60);

  try {
    const benefit = await db.benefit.create({
      data: {
        name: displayName,
        slug: finalSlug,
        normalizedKey: key,
        icon: resolveBenefitIcon(finalSlug, opts.icon) || null,
      },
    });
    return { benefit, created: true, matchedVia: 'created' };
  } catch {
    const again =
      (await db.benefit.findUnique({ where: { slug: finalSlug } })) ||
      (await db.benefit.findUnique({ where: { normalizedKey: key } }));
    if (again) {
      await ensureAlias(db, again.id, raw, key);
      return { benefit: again, created: false, matchedVia: 'slug' };
    }
    throw new BadRequestException('Could not create benefit');
  }
}

async function ensureAlias(db: Db, benefitId: string, alias: string, aliasKey: string) {
  const benefit = await db.benefit.findUnique({ where: { id: benefitId } });
  if (!benefit) return;
  if (benefitKey(benefit.name) === aliasKey || benefit.slug === catalogSlugify(alias)) return;
  const existing = await db.benefitAlias.findUnique({ where: { aliasKey } });
  if (existing) return;
  await db.benefitAlias
    .create({ data: { benefitId, alias: alias.trim().slice(0, 80), aliasKey } })
    .catch(() => undefined);
}
