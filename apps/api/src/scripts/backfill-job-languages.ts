/**
 * Deployable entrypoint: `node dist/scripts/backfill-job-languages.js`
 */
import { PrismaClient } from '@prisma/client';
import { backfillJobLanguages } from '../common/job-language-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillJobLanguages(prisma, {
      log: (msg) => console.warn(msg),
    });
    console.log(
      `Job language backfill: scanned=${result.scanned} filled=${result.filled} emptySlice=${result.skippedEmptySlice}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
