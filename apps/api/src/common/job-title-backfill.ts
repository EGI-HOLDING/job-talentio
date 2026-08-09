import { PrismaClient } from '@prisma/client';
import { resolveJobTitle } from './title-resolve';
import { jobFingerprint } from './dedupe';

type Db = Pick<PrismaClient, 'jobPost' | 'jobTitle' | 'jobTitleAlias'>;

export type JobTitleBackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
};

/**
 * Idempotent: resolve every JobPost title into JobTitle, rewrite display title
 * (strip seniority), fill missing experienceLevel, refresh fingerprint.
 */
export async function backfillJobTitles(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<JobTitleBackfillResult> {
  const log = opts?.log ?? (() => undefined);
  const posts = await db.jobPost.findMany({
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
  let skipped = 0;
  let errors = 0;

  for (const post of posts) {
    try {
      const resolved = await resolveJobTitle(db, { name: post.title });
      const nextTitle = resolved.jobTitle.name;
      const nextLevel = post.experienceLevel ?? resolved.inferredLevel ?? null;
      const nextFingerprint = jobFingerprint({
        title: nextTitle,
        workMode: post.workMode,
        cityId: post.cityId,
      });

      const needsUpdate =
        post.jobTitleId !== resolved.jobTitle.id ||
        post.title !== nextTitle ||
        (!post.experienceLevel && !!resolved.inferredLevel);

      if (!needsUpdate) {
        skipped += 1;
        continue;
      }

      await db.jobPost.update({
        where: { id: post.id },
        data: {
          jobTitleId: resolved.jobTitle.id,
          title: nextTitle,
          ...(post.experienceLevel
            ? {}
            : nextLevel
              ? { experienceLevel: nextLevel }
              : {}),
          fingerprint: nextFingerprint,
        },
      });
      updated += 1;
    } catch (err) {
      errors += 1;
      log(
        `Skip job ${post.id} ("${post.title}"): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { scanned: posts.length, updated, skipped, errors };
}
