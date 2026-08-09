/**
 * Backfill JobPost.jobTitleId + rewrite titles (strip seniority) + optional level infer.
 * Run after migrate: `pnpm exec tsx prisma/backfill-job-titles.ts` (from apps/api)
 */
import { PrismaClient } from '@prisma/client';
import { resolveJobTitle } from '../src/common/title-resolve';
import { jobFingerprint } from '../src/common/dedupe';

const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.jobPost.findMany({
    select: {
      id: true,
      title: true,
      experienceLevel: true,
      workMode: true,
      cityId: true,
      jobTitleId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let updated = 0;
  for (const post of posts) {
    try {
      const resolved = await resolveJobTitle(prisma, { name: post.title });
      const nextLevel =
        post.experienceLevel ?? resolved.inferredLevel ?? undefined;
      const nextTitle = resolved.jobTitle.name;
      const fingerprint = jobFingerprint({
        title: nextTitle,
        workMode: post.workMode,
        cityId: post.cityId,
      });

      await prisma.jobPost.update({
        where: { id: post.id },
        data: {
          jobTitleId: resolved.jobTitle.id,
          title: nextTitle,
          ...(post.experienceLevel ? {} : nextLevel ? { experienceLevel: nextLevel } : {}),
          fingerprint,
        },
      });
      updated += 1;
    } catch (err) {
      console.warn(`Skip job ${post.id} ("${post.title}"):`, err);
    }
  }
  console.log(`Backfilled ${updated}/${posts.length} job posts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
