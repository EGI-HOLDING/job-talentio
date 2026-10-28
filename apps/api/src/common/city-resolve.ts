import { BadRequestException } from '@nestjs/common';
import { City, PrismaClient } from '@prisma/client';
import { countryFilter, geoAliasKey, SELECTABLE_CITY } from './geo-selection';
import {
  assertCatalogLabel,
  catalogSlugify,
  normalizeLookupKey,
  titleCaseWords,
} from './lookup-normalize';

type Db = Pick<PrismaClient, 'city' | 'province'>;

const cityInclude = {
  province: { select: { id: true, name: true, slug: true, type: true, countryId: true } },
} as const;

function cityKey(input: string): string {
  return geoAliasKey(input);
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
    country?: string;
    allowCreate?: boolean;
  },
): Promise<ResolveCityResult> {
  const allowCreate = opts.allowCreate === true;
  const raw = (opts.name || opts.slug || '').trim();
  if (!raw) throw new BadRequestException('slug or name required');

  const slug = opts.slug ? catalogSlugify(opts.slug) : catalogSlugify(raw);
  const key = cityKey(raw);

  const scope = {
    ...SELECTABLE_CITY,
    AND: [
      ...(opts.country ? [{ province: { country: countryFilter(opts.country) } }] : []),
      ...(opts.provinceId ? [{ provinceId: opts.provinceId }] : []),
      ...(opts.provinceSlug ? [{ province: { slug: opts.provinceSlug } }] : []),
    ],
  };
  const bySlug = await db.city.findFirst({ where: { ...scope, slug }, include: cityInclude });
  if (bySlug) return { city: bySlug, created: false, matchedVia: 'slug' };

  const matches = await db.city.findMany({
    where: { ...scope, OR: [
      ...(['name', 'nameUz', 'nameRu', 'nameId'] as const).map(field => ({ [field]: { equals: raw, mode: 'insensitive' as const } })),
      { aliases: { some: { aliasKey: key } } },
    ] },
    include: cityInclude,
    take: 2,
  });
  if (matches.length > 1) throw new BadRequestException('City name is ambiguous; select a country and province');
  const byName = matches[0];
  if (byName) return { city: byName, created: false, matchedVia: 'name' };

  const all = await db.city.findMany({
    where: scope,
    select: { id: true, name: true, slug: true },
  });
  const fuzzyMatches = all.filter((c) => cityKey(c.name) === key || cityKey(c.slug) === key);
  if (fuzzyMatches.length > 1) throw new BadRequestException('City name is ambiguous; select a country and province');
  const fuzzy = fuzzyMatches[0];
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
    assertCatalogLabel(opts.name || raw);
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
