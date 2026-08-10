/**
 * Deployable entrypoint: `node dist/scripts/backfill-job-locale.js`
 * Idempotent: re-detects the language of every posting and company profile, and
 * only writes when the stored value is confidently wrong.
 */
import { PrismaClient } from '@prisma/client';
import { backfillCompanyLocale, backfillJobLocale } from '../common/i18n/job-locale-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const jobs = await backfillJobLocale(prisma);
    console.log(
      `Job locale backfill: scanned=${jobs.scanned} corrected=${jobs.corrected} unclear=${jobs.unclear}`,
    );
    const companies = await backfillCompanyLocale(prisma);
    console.log(
      `Company locale backfill: scanned=${companies.scanned} corrected=${companies.corrected} unclear=${companies.unclear}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
