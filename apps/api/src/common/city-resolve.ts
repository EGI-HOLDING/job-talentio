import { BadRequestException } from '@nestjs/common';
import { City, PrismaClient } from '@prisma/client';
import {
  assertLookupName,
  catalogSlugify,
  normalizeLookupKey,
  titleCaseWords,
} from './lookup-normalize';

type Db = Pick<PrismaClient, 'city' | 'province'>;

const CITY_SYNONYMS: Record<string, string> = {
  tashkentcity: 'tashkent',
  toshkent: 'tashkent',
  samarkandcity: 'samarkand',
  samarqand: 'samarkand',
  bukhoro: 'bukhara',
  buxoro: 'bukhara',
  qarshi: 'karshi',
};

const cityInclude = {
  province: { select: { id: true, name: true, slug: true, type: true, countryId: true } },
} as const;

function cityKey(input: string): string {
  const key = normalizeLookupKey(input);
  return CITY_SYNONYMS[key] ?? key;
}

export type ResolveCityResult = {
  city: City & {
    province?: { id: string; name: string; slug: string; type: string; countryId: string };
  };
  created: boolean;
  matchedVia: 'slug' | 'normalized' | 'name' | 'created';
};

export async function resolveCity(
  db: Db,
  opts: {
    name?: string;
    slug?: string;
    provinceSlug?: string;
    provinceId?: string;
    allowCreate?: boolean;
  },
): Promise<ResolveCityResult> {
  const allowCreate = opts.allowCreate === true;
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('slug or name required');

  const slug = opts.slug ? catalogSlugify(opts.slug) : catalogSlugify(raw);
  const key = cityKey(raw);

  const bySlug = await db.city.findUnique({ where: { slug }, include: cityInclude });
  if (bySlug) return { city: bySlug, created: false, matchedVia: 'slug' };

  const byName = await db.city.findFirst({
    where: { name: { equals: raw, mode: 'insensitive' } },
    include: cityInclude,
  });
  if (byName) return { city: byName, created: false, matchedVia: 'name' };

  const all = await db.city.findMany({
    select: { id: true, name: true, slug: true },
  });
  const fuzzy = all.find((c) => cityKey(c.name) === key || cityKey(c.slug) === key);
  if (fuzzy) {
    const city = await db.city.findUniqueOrThrow({
      where: { id: fuzzy.id },
      include: cityInclude,
    });
    return { city, created: false, matchedVia: 'normalized' };
  }

  if (!allowCreate) throw new BadRequestException('City not found');

  let provinceId = opts.provinceId?.trim() || '';
  if (!provinceId && opts.provinceSlug) {
    const prov = await db.province.findFirst({
      where: { slug: catalogSlugify(opts.provinceSlug) },
    });
    if (!prov) throw new BadRequestException('Province not found');
    provinceId = prov.id;
  }
  if (!provinceId) {
    throw new BadRequestException('provinceSlug or provinceId is required to create a city');
  }

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
        provinceId,
      },
      include: cityInclude,
    });
    return { city, created: true, matchedVia: 'created' };
  } catch {
    const again = await db.city.findUnique({
      where: { slug: finalSlug },
      include: cityInclude,
    });
    if (again) return { city: again, created: false, matchedVia: 'slug' };
    throw new BadRequestException('Could not create city');
  }
}
