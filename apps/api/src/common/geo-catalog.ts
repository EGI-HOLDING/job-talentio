import { PrismaClient, ProvinceType } from '@prisma/client';
import {
  LEGACY_CITY_PROVINCE,
  UZBEKISTAN_COUNTRY,
  UZBEKISTAN_PROVINCES,
} from './uzbekistan-geo';

type Db = Pick<PrismaClient, 'country' | 'province' | 'city'>;

export type UpsertUzbekistanGeoResult = {
  countryId: string;
  provincesUpserted: number;
  citiesUpserted: number;
  citiesLinked: number;
};

/**
 * Upsert UZ country, provinces, and catalog cities by slug. Relinks legacy
 * cities by slug.
 *
 * This runs on every container start, so it must not undo admin work: a row an
 * admin edited (`curatedAt`) keeps its name, and an archived slug is neither
 * revived nor recreated.
 */
export async function upsertUzbekistanGeo(db: Db): Promise<UpsertUzbekistanGeoResult> {
  const existingCountry = await db.country.findUnique({
    where: { slug: UZBEKISTAN_COUNTRY.slug },
    select: { id: true, curatedAt: true },
  });

  const countryFacts = {
    iso2: UZBEKISTAN_COUNTRY.iso2,
    iso3: UZBEKISTAN_COUNTRY.iso3,
    phoneCode: UZBEKISTAN_COUNTRY.phoneCode,
    currencyCode: UZBEKISTAN_COUNTRY.currencyCode,
    isActive: true,
  };

  const country = await db.country.upsert({
    where: { slug: UZBEKISTAN_COUNTRY.slug },
    update: {
      ...countryFacts,
      ...(existingCountry?.curatedAt ? {} : { name: UZBEKISTAN_COUNTRY.name }),
    },
    create: {
      name: UZBEKISTAN_COUNTRY.name,
      slug: UZBEKISTAN_COUNTRY.slug,
      ...countryFacts,
    },
  });

  let provincesUpserted = 0;
  let citiesUpserted = 0;
  const provinceBySlug = new Map<string, string>();

  for (const prov of UZBEKISTAN_PROVINCES) {
    const existing = await db.province.findUnique({
      where: { countryId_slug: { countryId: country.id, slug: prov.slug } },
      select: { id: true, curatedAt: true },
    });
    const row = existing
      ? await db.province.update({
          where: { id: existing.id },
          data: existing.curatedAt
            ? {}
            : { name: prov.name, type: prov.type as ProvinceType },
        })
      : await db.province.create({
          data: {
            countryId: country.id,
            name: prov.name,
            slug: prov.slug,
            type: prov.type as ProvinceType,
          },
        });
    provinceBySlug.set(prov.slug, row.id);
    provincesUpserted += 1;

    for (const city of prov.cities) {
      const found = await db.city.findUnique({
        where: { slug: city.slug },
        select: { id: true, curatedAt: true, archivedAt: true },
      });
      if (found) {
        // An archived city stays archived; reviving it here would undo a
        // deliberate admin decision on every deploy.
        if (!found.curatedAt) {
          await db.city.update({
            where: { id: found.id },
            data: { name: city.name, provinceId: row.id },
          });
        }
      } else {
        await db.city.create({
          data: { name: city.name, slug: city.slug, provinceId: row.id },
        });
      }
      citiesUpserted += 1;
    }
  }

  let citiesLinked = 0;
  const allCities = await db.city.findMany({
    select: { id: true, slug: true, provinceId: true, curatedAt: true },
  });
  for (const c of allCities) {
    if (c.curatedAt) continue;
    const targetSlug = LEGACY_CITY_PROVINCE[c.slug];
    if (!targetSlug) continue;
    const pid = provinceBySlug.get(targetSlug);
    if (!pid || c.provinceId === pid) continue;
    await db.city.update({ where: { id: c.id }, data: { provinceId: pid } });
    citiesLinked += 1;
  }

  return {
    countryId: country.id,
    provincesUpserted,
    citiesUpserted,
    citiesLinked,
  };
}
