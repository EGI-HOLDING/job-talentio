/**
 * Deployable entrypoint: `node dist/scripts/backfill-job-titles.js`
 * Also: `pnpm prisma:backfill-job-titles` (via prisma wrapper).
 */
import { PrismaClient } from '@prisma/client';
import { backfillJobTitles } from '../common/job-title-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillJobTitles(prisma, {
      log: (msg) => console.warn(msg),
    });
    console.log(
      `JobTitle backfill: scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} catalogCleaned=${result.catalogCleaned} catalogMerged=${result.catalogMerged} errors=${result.errors} dedupeClosed=${result.dedupeClosed} dedupeRemainingAbc=${result.dedupeRemainingAbc}`,
    );
    // Per-row errors are non-fatal; only throw if nothing could be scanned due to DB failure
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
