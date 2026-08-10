/**
 * Deployable entrypoint: `node dist/scripts/backfill-catalog-status.js`
 * Idempotent: sorts catalog rows into PENDING / COMPLETE / IGNORED.
 */
import { PrismaClient } from '@prisma/client';
import { backfillCatalogStatus } from '../common/i18n/catalog-status-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillCatalogStatus(prisma);
    for (const [table, counts] of Object.entries(result)) {
      console.log(
        `${table}: complete=${counts.complete} ignored=${counts.ignored} pending=${counts.pending}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
