/**
 * Deployable entrypoint: `node dist/scripts/backfill-geo.js`
 */
import { PrismaClient } from '@prisma/client';
import { backfillGeo } from '../common/geo-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillGeo(prisma, {
      log: (msg) => console.warn(msg),
    });
    console.log(
      `Geo backfill: countries=${result.countries} provinces=${result.provinces} cities=${result.cities} catalogCities=${result.catalogCities} linked=${result.citiesLinked}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
