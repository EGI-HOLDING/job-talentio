/**
 * Deployable entrypoint: `node dist/scripts/backfill-catalog-i18n.js`
 * Idempotent: writes uz/ru display names onto existing catalog rows.
 */
import { PrismaClient } from '@prisma/client';
import { backfillCatalogI18n } from '../common/i18n/catalog-i18n-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillCatalogI18n(prisma);
    for (const [table, counts] of Object.entries(result)) {
      console.log(`${table}: updated=${counts.updated} missingRows=${counts.missing}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
