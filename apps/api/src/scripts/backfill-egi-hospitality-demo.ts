/**
 * Deployable entrypoint: `node dist/scripts/backfill-egi-hospitality-demo.js`
 * (or `pnpm --filter @job-talentio/api exec tsx src/scripts/backfill-egi-hospitality-demo.ts`)
 */
import { PrismaClient } from '@prisma/client';
import { backfillEgiHospitalityDemo } from '../common/egi-hospitality-demo';
import { createDemoLogoUploaderFromEnv } from '../common/demo-logo-storage';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillEgiHospitalityDemo(prisma, {
      logoUploader: createDemoLogoUploaderFromEnv(),
    });
    console.log(
      `EGI hospitality demo: companies=${result.companies} jobsCreated=${result.jobs} logosUploaded=${result.logosUploaded} logosUpdated=${result.logosUpdated}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
