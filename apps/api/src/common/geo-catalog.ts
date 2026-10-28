import { PrismaClient } from '@prisma/client';
type Db = Pick<PrismaClient, 'country' | 'province' | 'city'>;
/** Compatibility adapter: reports existing data; never recreates a static catalog. */
export async function upsertUzbekistanGeo(db: Db) {
 const country = await db.country.findUnique({ where: { iso2: 'UZ' } });
 return { countryId: country?.id || '', provincesUpserted: 0, citiesUpserted: 0, citiesLinked: 0 };
}
