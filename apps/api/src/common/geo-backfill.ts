import { PrismaClient } from '@prisma/client';
import { upsertUzbekistanGeo } from './geo-catalog';

type Db = Pick<PrismaClient, 'country' | 'province' | 'city'>;

export type GeoBackfillResult = {
  countries: number;
  provinces: number;
  cities: number;
  citiesLinked: number;
  catalogCities: number;
};

export async function needsGeoBackfill(db: Db): Promise<boolean> {
  const [countryCount, provinceCount, cityCount, catalogFloor] = await Promise.all([
    db.country.count(),
    db.province.count(),
    db.city.count(),
    Promise.resolve(80),
  ]);
  if (countryCount < 1 || provinceCount < 14) return true;
  if (cityCount < catalogFloor) return true;
  return false;
}

/** Idempotent: upsert UZ hierarchy and expand city catalog on deploy. */
export async function backfillGeo(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<GeoBackfillResult> {
  const log = opts?.log ?? (() => undefined);
  const result = await upsertUzbekistanGeo(db);
  log(
    `Geo catalog: provinces=${result.provincesUpserted} citiesUpserted=${result.citiesUpserted} linked=${result.citiesLinked}`,
  );
  const [countries, provinces, cities] = await Promise.all([
    db.country.count(),
    db.province.count(),
    db.city.count(),
  ]);
  return {
    countries,
    provinces,
    cities,
    citiesLinked: result.citiesLinked,
    catalogCities: result.citiesUpserted,
  };
}
