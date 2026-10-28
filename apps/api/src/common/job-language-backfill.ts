import type { PrismaClient } from '@prisma/client';
export type JobLanguageBackfillResult = { scanned:number; skippedExisting:number; skippedEmptySlice:number; filled:number };
/** Compatibility for old maintenance commands. Requirements must be authored by employers. */
export async function needsJobLanguageBackfill(_db: Pick<PrismaClient,'jobPost'>):Promise<boolean> { return false; }
export async function backfillJobLanguages(_db: Pick<PrismaClient,'language'|'jobPost'|'jobPostLanguage'>, options:{log?:(message:string)=>void}={}):Promise<JobLanguageBackfillResult> {
  options.log?.('Language inference is disabled. Existing requirements are preserved; employers must confirm them.');
  return {scanned:0,skippedExisting:0,skippedEmptySlice:0,filled:0};
}
