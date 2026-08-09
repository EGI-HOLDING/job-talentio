/**
 * Deployable entrypoint: `node dist/scripts/backfill-industries.js`
 */
import { PrismaClient } from '@prisma/client';
import { backfillIndustries } from '../common/industry-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillIndustries(prisma, {
      log: (msg) => console.warn(msg),
    });
    console.log(
      `Industry backfill: groups=${result.groupsUpserted} industries=${result.industriesUpserted} remapped=${result.companiesRemapped} retired=${result.industriesRetired}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
