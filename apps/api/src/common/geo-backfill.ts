import { PrismaClient } from '@prisma/client';
type Db = Pick<PrismaClient, 'country' | 'province' | 'city'>;
export type GeoBackfillResult = { countries: number; provinces: number; cities: number; citiesLinked: number; catalogCities: number };
export async function needsGeoBackfill(_db: Db): Promise<boolean> { return false; }
/** Legacy command is read-only. Use the explicit reviewed dataset importer. */
export async function backfillGeo(db: Db, opts?: { log?: (message: string) => void }): Promise<GeoBackfillResult> {
 opts?.log?.('Geographic catalogs are database-managed; no static backfill is performed.');
 const [countries, provinces, cities] = await Promise.all([db.country.count(), db.province.count(), db.city.count()]);
 return { countries, provinces, cities, citiesLinked: 0, catalogCities: 0 };
}
