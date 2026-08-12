import type { PrismaClient } from '@prisma/client';
import { detectLocale } from './detect-locale';

type Db = Pick<PrismaClient, 'jobPost'>;
type CompanyDb = Pick<PrismaClient, 'company'>;

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

/**
 * `Company.locale` has the same problem as `JobPost.locale`: it defaults to
 * `uz`, so a profile written in English claims to be Uzbek. That drives the
 * "written in" badge and the source language sent to the translation provider.
 */
export async function backfillCompanyLocale(db: CompanyDb): Promise<JobLocaleBackfillResult> {
  const companies = await db.company.findMany({
    select: { id: true, description: true, locale: true },
  });

  let corrected = 0;
  let unclear = 0;

  for (const company of companies) {
    const detected = company.description ? detectLocale(company.description) : null;
    if (!detected) {
      unclear += 1;
      continue;
    }
    if (detected === company.locale) continue;

    await db.company.update({ where: { id: company.id }, data: { locale: detected } });
    corrected += 1;
  }

  return { scanned: companies.length, corrected, unclear };
}
