import { Prisma, PrismaClient } from '@prisma/client';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';

const INDEX = 'jobs';
const BATCH = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const TASK_TIMEOUT_MS = 60_000;

type LocalizedName = { name: string; nameUz?: string | null; nameRu?: string | null };

export type JobSearchDocument = {
  id: string;
  title: string;
  companyName: string;
  cityName: string | null;
  categoryName: string | null;
  /** Catalog title in every stored language, separate from the posting title. */
  jobTitle: string | null;
  skills: string[];
  description: string;
  titleAlt: string[];
  descriptionAlt: string[];
  publishedAt: number | null;
};

export const jobIndexInclude = {
  company: { select: { name: true } },
  city: { select: { name: true, nameUz: true, nameRu: true } },
  category: { select: { name: true, nameUz: true, nameRu: true } },
  jobTitle: { select: { name: true, nameUz: true, nameRu: true } },
  jobSkills: { select: { skill: { select: { name: true, nameUz: true, nameRu: true } } } },
  translations: { select: { title: true, description: true } },
} satisfies Prisma.JobPostInclude;

type IndexedJob = {
  id: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  company: { name: string };
  city: LocalizedName | null;
  category: LocalizedName | null;
  jobTitle: LocalizedName | null;
  jobSkills: Array<{ skill: LocalizedName }>;
  translations: Array<{ title: string; description: string }>;
};

function names(row: LocalizedName | null | undefined): string[] {
  return row ? [row.name, row.nameUz, row.nameRu].filter((v): v is string => Boolean(v)) : [];
}

export function toJobSearchDocument(job: IndexedJob): JobSearchDocument {
  const titleNames = names(job.jobTitle);
  return {
    id: job.id,
    title: job.title,
    companyName: job.company.name,
    cityName: names(job.city).join(' ') || null,
    categoryName: names(job.category).join(' ') || null,
    jobTitle: titleNames.join(' ') || null,
    skills: job.jobSkills.flatMap((s) => names(s.skill)),
    description: job.description.slice(0, 600),
    titleAlt: job.translations.map((t) => t.title),
    descriptionAlt: job.translations.map((t) => t.description.slice(0, 600)),
    publishedAt: job.publishedAt ? job.publishedAt.getTime() : null,
  };
}

async function meili<T>(
  host: string,
  apiKey: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Meilisearch ${method} ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

async function waitForTask(host: string, apiKey: string | undefined, taskUid: number): Promise<void> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    const task = await meili<{ status: string; error?: { message?: string } }>(
      host,
      apiKey,
      'GET',
      `/tasks/${taskUid}`,
    );
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') {
      throw new Error(
        `Meilisearch task ${taskUid} ${task.status}${task.error?.message ? `: ${task.error.message}` : ''}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`Meilisearch task ${taskUid} timed out`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Upsert every published posting. Does not remove stale ids. */
export async function indexPublishedJobs(
  prisma: PrismaClient,
  host: string,
  apiKey?: string,
): Promise<number> {
  let skip = 0;
  let indexed = 0;
  for (;;) {
    const batch = await prisma.jobPost.findMany({
      where: { status: 'PUBLISHED' },
      skip,
      take: BATCH,
      orderBy: { createdAt: 'asc' },
      include: jobIndexInclude,
    });
    if (!batch.length) break;
    const enqueued = await meili<{ taskUid: number }>(
      host,
      apiKey,
      'PUT',
      `/indexes/${INDEX}/documents`,
      batch.map((job) => toJobSearchDocument(job)),
    );
    await waitForTask(host, apiKey, enqueued.taskUid);
    indexed += batch.length;
    skip += BATCH;
  }
  return indexed;
}

/**
 * Replace the jobs index with the current published postings.
 * Waits until the delete task finishes so a following search cannot read dead ids.
 */
export async function rebuildJobsIndex(opts: {
  prisma: PrismaClient;
  host: string | null | undefined;
  apiKey?: string;
  log?: (message: string) => void;
}): Promise<number> {
  const host = (opts.host || '').replace(/\/$/, '');
  const log = opts.log ?? (() => undefined);
  if (!host) {
    log('Meilisearch: MEILI_HOST unset; keyword search uses the database');
    return 0;
  }
  await meili(host, opts.apiKey, 'POST', '/indexes', { uid: INDEX, primaryKey: 'id' }).catch(
    () => undefined,
  );
  await meili(host, opts.apiKey, 'PATCH', `/indexes/${INDEX}/settings`, JOBS_INDEX_SETTINGS);
  const deleted = await meili<{ taskUid: number }>(
    host,
    opts.apiKey,
    'DELETE',
    `/indexes/${INDEX}/documents`,
  );
  await waitForTask(host, opts.apiKey, deleted.taskUid);
  const indexed = await indexPublishedJobs(opts.prisma, host, opts.apiKey);
  log(`Meilisearch: indexed ${indexed} published job(s)`);
  return indexed;
}
