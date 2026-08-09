import { PrismaClient } from '@prisma/client';
import {
  resolveJobTitle,
  stripSeniorityFromTitle,
  titleHasSeniorityToken,
  canonicalDisplayName,
  normalizeJobTitleKey,
  jobTitleSlugify,
} from './title-resolve';
import { jobFingerprint } from './dedupe';

type Db = Pick<PrismaClient, 'jobPost' | 'jobTitle' | 'jobTitleAlias'>;

export type JobTitleBackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
  catalogCleaned: number;
  catalogMerged: number;
};

/** True when posts/catalog still need seniority purge or missing jobTitleId. */
export async function needsJobTitleBackfill(db: Db): Promise<boolean> {
  const nullLinks = await db.jobPost.count({ where: { jobTitleId: null } });
  if (nullLinks > 0) return true;

  // Substring contains('Intern') false-positives "International" — filter with whole-word helper.
  const [postSamples, titleSamples] = await Promise.all([
    db.jobPost.findMany({
      where: {
        OR: [
          { title: { contains: 'Senior', mode: 'insensitive' } },
          { title: { contains: 'Junior', mode: 'insensitive' } },
          { title: { contains: 'Principal', mode: 'insensitive' } },
          { title: { contains: 'Staff', mode: 'insensitive' } },
          { title: { contains: 'Intern', mode: 'insensitive' } },
          { title: { contains: 'Middle', mode: 'insensitive' } },
          { title: { contains: 'Mid-level', mode: 'insensitive' } },
          { title: { contains: 'Entry', mode: 'insensitive' } },
          { title: { contains: 'Sr.', mode: 'insensitive' } },
          { title: { contains: 'Jr.', mode: 'insensitive' } },
        ],
      },
      select: { title: true },
      take: 200,
    }),
    db.jobTitle.findMany({
      where: {
        OR: [
          { name: { contains: 'Senior', mode: 'insensitive' } },
          { name: { contains: 'Junior', mode: 'insensitive' } },
          { name: { contains: 'Principal', mode: 'insensitive' } },
          { name: { contains: 'Staff', mode: 'insensitive' } },
          { name: { contains: 'Intern', mode: 'insensitive' } },
          { name: { contains: 'Middle', mode: 'insensitive' } },
          { name: { contains: 'Mid-level', mode: 'insensitive' } },
          { name: { contains: 'Entry', mode: 'insensitive' } },
          { name: { contains: 'Sr.', mode: 'insensitive' } },
          { name: { contains: 'Jr.', mode: 'insensitive' } },
        ],
      },
      select: { name: true },
      take: 200,
    }),
  ]);

  return (
    postSamples.some((p) => titleHasSeniorityToken(p.title)) ||
    titleSamples.some((t) => titleHasSeniorityToken(t.name))
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scrub seniority only when it prefixes the known role title (not prose "our staff"). */
function scrubDescriptionSeniority(
  description: string,
  oldTitle: string,
  nextTitle: string,
): string {
  let next = description;
  if (oldTitle && oldTitle !== nextTitle && next.includes(oldTitle)) {
    next = next.split(oldTitle).join(nextTitle);
  }
  if (!nextTitle || !titleHasSeniorityToken(next)) return next;

  const role = escapeRegExp(nextTitle);
  const seniority =
    '(?:Junior|Senior|Principal|Staff|Intern(?:ship)?|Mid(?:dle)?(?:[\\s-]?level)?|Entry(?:[\\s-]?level)?|Jr\\.?|Sr\\.?)';
  return next.replace(new RegExp(`\\b${seniority}\\s+${role}\\b`, 'gi'), nextTitle);
}

/**
 * Rename dirty catalog rows; if the clean key/slug already exists, merge posts
 * onto the clean row and delete the dirty duplicate.
 */
async function cleanJobTitleCatalog(
  db: Db,
  log: (msg: string) => void,
): Promise<{ cleaned: number; merged: number }> {
  const titles = await db.jobTitle.findMany({
    select: { id: true, name: true, slug: true, normalizedKey: true },
  });
  let cleaned = 0;
  let merged = 0;

  for (const row of titles) {
    if (!titleHasSeniorityToken(row.name)) continue;
    try {
      const { roleTitle } = stripSeniorityFromTitle(row.name);
      if (roleTitle.length < 2) {
        log(`Skip JobTitle ${row.id} ("${row.name}"): empty after strip`);
        continue;
      }
      const cleanName = canonicalDisplayName(roleTitle);
      const key = normalizeJobTitleKey(roleTitle);
      const slug = jobTitleSlugify(roleTitle) || key.slice(0, 60);

      const conflict =
        (await db.jobTitle.findFirst({
          where: {
            id: { not: row.id },
            OR: [{ normalizedKey: key }, { slug }, { name: { equals: cleanName, mode: 'insensitive' } }],
          },
        })) ?? null;

      if (conflict) {
        await db.jobPost.updateMany({
          where: { jobTitleId: row.id },
          data: { jobTitleId: conflict.id },
        });
        const aliases = await db.jobTitleAlias.findMany({ where: { jobTitleId: row.id } });
        for (const alias of aliases) {
          await db.jobTitleAlias
            .update({
              where: { id: alias.id },
              data: { jobTitleId: conflict.id },
            })
            .catch(() =>
              db.jobTitleAlias.delete({ where: { id: alias.id } }).catch(() => undefined),
            );
        }
        await db.jobTitle.delete({ where: { id: row.id } });
        merged += 1;
        log(`Merged dirty JobTitle "${row.name}" → "${conflict.name}"`);
        continue;
      }

      await db.jobTitle.update({
        where: { id: row.id },
        data: {
          name: cleanName,
          slug,
          normalizedKey: key,
        },
      });
      cleaned += 1;
    } catch (err) {
      log(
        `Skip JobTitle ${row.id} ("${row.name}"): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return { cleaned, merged };
}

/**
 * Idempotent: clean/merge dirty JobTitle catalog names, then resolve every JobPost
 * title (strip seniority), set jobTitleId, rewrite title + role-prefixed description
 * mentions, fill missing experienceLevel, refresh fingerprint.
 */
export async function backfillJobTitles(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<JobTitleBackfillResult> {
  const log = opts?.log ?? (() => undefined);

  const { cleaned: catalogCleaned, merged: catalogMerged } = await cleanJobTitleCatalog(
    db,
    log,
  );

  const posts = await db.jobPost.findMany({
    select: {
      id: true,
      title: true,
      description: true,
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

      const nextDescription = scrubDescriptionSeniority(
        post.description,
        post.title,
        nextTitle,
      );

      const needsUpdate =
        post.jobTitleId !== resolved.jobTitle.id ||
        post.title !== nextTitle ||
        post.description !== nextDescription ||
        titleHasSeniorityToken(post.title) ||
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
          description: nextDescription,
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

  return {
    scanned: posts.length,
    updated,
    skipped,
    errors,
    catalogCleaned,
    catalogMerged,
  };
}
