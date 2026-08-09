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

/** Upsert UZ country, provinces, and catalog cities by slug. Relinks legacy cities by slug. */
export async function upsertUzbekistanGeo(db: Db): Promise<UpsertUzbekistanGeoResult> {
  const country = await db.country.upsert({
    where: { slug: UZBEKISTAN_COUNTRY.slug },
    update: {
      name: UZBEKISTAN_COUNTRY.name,
      iso2: UZBEKISTAN_COUNTRY.iso2,
      iso3: UZBEKISTAN_COUNTRY.iso3,
      phoneCode: UZBEKISTAN_COUNTRY.phoneCode,
      currencyCode: UZBEKISTAN_COUNTRY.currencyCode,
      isActive: true,
    },
    create: {
      name: UZBEKISTAN_COUNTRY.name,
      slug: UZBEKISTAN_COUNTRY.slug,
      iso2: UZBEKISTAN_COUNTRY.iso2,
      iso3: UZBEKISTAN_COUNTRY.iso3,
      phoneCode: UZBEKISTAN_COUNTRY.phoneCode,
      currencyCode: UZBEKISTAN_COUNTRY.currencyCode,
      isActive: true,
    },
  });

  let provincesUpserted = 0;
  let citiesUpserted = 0;
  const provinceBySlug = new Map<string, string>();

  for (const prov of UZBEKISTAN_PROVINCES) {
    const existing = await db.province.findUnique({
      where: { countryId_slug: { countryId: country.id, slug: prov.slug } },
    });
    const row = existing
      ? await db.province.update({
          where: { id: existing.id },
          data: { name: prov.name, type: prov.type as ProvinceType },
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
      const found = await db.city.findUnique({ where: { slug: city.slug } });
      if (found) {
        await db.city.update({
          where: { id: found.id },
          data: { name: city.name, provinceId: row.id },
        });
      } else {
        await db.city.create({
          data: { name: city.name, slug: city.slug, provinceId: row.id },
        });
      }
      citiesUpserted += 1;
    }
  }

  let citiesLinked = 0;
  const allCities = await db.city.findMany({ select: { id: true, slug: true, provinceId: true } });
  for (const c of allCities) {
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
