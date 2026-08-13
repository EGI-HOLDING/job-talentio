/**
 * Deployable entrypoint: `node dist/scripts/backfill-egi-hospitality-demo.js`
 * (or `pnpm --filter @job-talentio/api exec tsx src/scripts/backfill-egi-hospitality-demo.ts`)
 */
import { PrismaClient } from '@prisma/client';
import { backfillEgiHospitalityDemo } from '../common/egi-hospitality-demo';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillEgiHospitalityDemo(prisma);
    console.log(
      `EGI hospitality demo: companies=${result.companies} jobsCreated=${result.jobs}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
