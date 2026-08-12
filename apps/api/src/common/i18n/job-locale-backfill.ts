import type { PrismaClient } from '@prisma/client';
import { detectLocale } from './detect-locale';

type Db = Pick<PrismaClient, 'jobPost'>;

export type JobLocaleBackfillResult = {
  scanned: number;
  corrected: number;
  unclear: number;
};

/**
 * `JobPost.locale` defaults to `uz`, so postings created before the field was
 * filled in claim to be Uzbek whatever language they are actually written in.
 * That mislabel is now visible ("This text is written in Uzbek" on an English
 * posting) and it also drives hreflang and machine translation, so repair the
 * rows we can read confidently and leave the rest untouched.
 */
export async function backfillJobLocale(db: Db): Promise<JobLocaleBackfillResult> {
  const jobs = await db.jobPost.findMany({
    select: { id: true, title: true, description: true, locale: true },
  });

  let corrected = 0;
  let unclear = 0;

  for (const job of jobs) {
    const detected = detectLocale(`${job.title}\n${job.description}`);
    if (!detected) {
      unclear += 1;
      continue;
    }
    if (detected === job.locale) continue;

    await db.jobPost.update({ where: { id: job.id }, data: { locale: detected } });
    corrected += 1;
  }

  return { scanned: jobs.length, corrected, unclear };
}
