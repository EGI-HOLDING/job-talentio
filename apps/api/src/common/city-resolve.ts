import { BadRequestException } from '@nestjs/common';
import { City, PrismaClient } from '@prisma/client';
import {
  assertLookupName,
  catalogSlugify,
  normalizeLookupKey,
  titleCaseWords,
} from './lookup-normalize';

type Db = Pick<PrismaClient, 'city'>;

const CITY_SYNONYMS: Record<string, string> = {
  tashkentcity: 'tashkent',
  toshkent: 'tashkent',
  samarkandcity: 'samarkand',
  samarqand: 'samarkand',
  bukhoro: 'bukhara',
  buxoro: 'bukhara',
};

function cityKey(input: string): string {
  const key = normalizeLookupKey(input);
  return CITY_SYNONYMS[key] ?? key;
}

export type ResolveCityResult = {
  city: City;
  created: boolean;
  matchedVia: 'slug' | 'normalized' | 'name' | 'created';
};

export async function resolveCity(
  db: Db,
  opts: { name?: string; slug?: string; region?: string; allowCreate?: boolean },
): Promise<ResolveCityResult> {
  const allowCreate = opts.allowCreate === true; // cities: create only when explicitly allowed
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('slug or name required');

  const slug = opts.slug ? catalogSlugify(opts.slug) : catalogSlugify(raw);
  const key = cityKey(raw);

  const bySlug = await db.city.findUnique({ where: { slug } });
  if (bySlug) return { city: bySlug, created: false, matchedVia: 'slug' };

  const byName = await db.city.findFirst({
    where: { name: { equals: raw, mode: 'insensitive' } },
  });
  if (byName) return { city: byName, created: false, matchedVia: 'name' };

  // Fuzzy: match synonym key against existing city slugs/names
  const all = await db.city.findMany({ select: { id: true, name: true, slug: true, region: true } });
  const fuzzy = all.find((c) => cityKey(c.name) === key || cityKey(c.slug) === key);
  if (fuzzy) {
    const city = await db.city.findUniqueOrThrow({ where: { id: fuzzy.id } });
    return { city, created: false, matchedVia: 'normalized' };
  }

  if (!allowCreate) throw new BadRequestException('City not found');

  try {
    assertLookupName(opts.name || raw);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }

  const displayName = opts.name?.trim() || titleCaseWords(raw);
  const finalSlug = slug || catalogSlugify(displayName);

  try {
    const city = await db.city.create({
      data: {
        name: displayName,
        slug: finalSlug,
        region: opts.region?.trim() || undefined,
      },
    });
    return { city, created: true, matchedVia: 'created' };
  } catch {
    const again = await db.city.findUnique({ where: { slug: finalSlug } });
    if (again) return { city: again, created: false, matchedVia: 'slug' };
    throw new BadRequestException('Could not create city');
  }
}
