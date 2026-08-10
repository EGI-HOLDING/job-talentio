/**
 * Deployable entrypoint: `node dist/scripts/backfill-news.js`
 * (or `pnpm --filter @job-talentio/api exec tsx src/scripts/backfill-news.ts`)
 */
import { PrismaClient } from '@prisma/client';
import { backfillNews } from '../common/news-backfill';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillNews(prisma);
    console.log(`News backfill: upserted=${result.upserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
