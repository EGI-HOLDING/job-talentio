/**
 * Deployable entrypoint: `node dist/scripts/backfill-job-locale.js`
 * Idempotent: re-detects the language of every posting and only writes when the
 * stored value is confidently wrong.
 */
import { PrismaClient } from '@prisma/client';
import { backfillJobLocale } from '../common/i18n/job-locale-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillJobLocale(prisma);
    console.log(
      `Job locale backfill: scanned=${result.scanned} corrected=${result.corrected} unclear=${result.unclear}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
