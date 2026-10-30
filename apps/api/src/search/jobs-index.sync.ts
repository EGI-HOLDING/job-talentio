import { Prisma, PrismaClient } from '@prisma/client';
import {
  exposureLog,
  liveJobWhere,
  ExposurePolicy,
  INITIAL_EXPOSURE,
  loadExposurePolicy,
} from '../benefits/benefit-policy';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';
import { resolveJobPromotion } from '../benefits/job-promotion';

const INDEX = 'jobs';
const BATCH = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const TASK_TIMEOUT_MS = 60_000;

type LocalizedName = {
  name: string;
  nameUz?: string | null;
  nameRu?: string | null;
  nameId?: string | null;
};

export type JobSearchDocument = {
  id: string;
  title: string;
  companyName: string;
  cityName: string | null;
  countryName: string | null;
  categoryName: string | null;
  /** Catalog title in every stored language, separate from the posting title. */
  jobTitle: string | null;
  skills: string[];
  description: string;
  titleAlt: string[];
  descriptionAlt: string[];
  publishedAt: number | null;
  exposureLog: number;
  exposureVersion: number;
  promotionEnabled: boolean;
  boostProjectedActive: boolean;
  boostEndsAt: number;
  exposureUpdatedAt: number;
};

export const jobIndexInclude = {
  benefit: { include: { boosts: { orderBy: { startsAt: 'desc' as const }, take: 1 } } },
  company: { select: { name: true } },
  city: {
    select: {
      name: true,
      nameUz: true,
      nameRu: true,
      nameId: true,
      aliases: { select: { alias: true } },
    },
  },
  country: { select: { name: true, nameUz: true, nameRu: true, nameId: true } },
  category: { select: { name: true, nameUz: true, nameRu: true, nameId: true } },
  jobTitle: {
    select: {
      name: true,
      nameUz: true,
      nameRu: true,
      nameId: true,
      aliases: { select: { alias: true } },
    },
  },
  jobSkills: {
    select: { skill: { select: { name: true, nameUz: true, nameRu: true, nameId: true } } },
  },
  translations: {
    where: { isMachine: false },
    select: { title: true, description: true },
  },
} satisfies Prisma.JobPostInclude;

type IndexedJob = {
  status?: string;
  id: string;
  isAnonymous: boolean;
  title: string;
  description: string;
  publishedAt: Date | null;
  benefit?: {
    code?: string;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    policySnapshot: Prisma.JsonValue | null;
    boosts: Array<{ startsAt: Date; endsAt: Date }>;
  } | null;
  company: { name: string };
  city: (LocalizedName & { aliases?: Array<{ alias: string }> }) | null;
  country?: LocalizedName | null;
  category: LocalizedName | null;
  jobTitle: (LocalizedName & { aliases?: Array<{ alias: string }> }) | null;
  jobSkills: Array<{ skill: LocalizedName }>;
  translations: Array<{ title: string; description: string }>;
};

function names(row: LocalizedName | null | undefined): string[] {
  return row
    ? [row.name, row.nameUz, row.nameRu, row.nameId].filter((v): v is string => Boolean(v))
    : [];
}

export function toJobSearchDocument(
  job: IndexedJob,
  promoted = false,
  exposure: ExposurePolicy = INITIAL_EXPOSURE,
): JobSearchDocument {
  const titleNames = [
    ...names(job.jobTitle),
    ...(job.jobTitle?.aliases || []).map((row) => row.alias),
  ];
  const now = new Date();
  const effective = resolveJobPromotion(job.status ?? 'PUBLISHED', job.benefit, promoted, now);
  const boost = effective.boost;
  return {
    boostProjectedActive: !!boost && boost.startsAt <= now && boost.endsAt > now,
    boostEndsAt: boost?.endsAt.getTime() ?? 0,
    exposureUpdatedAt: now.getTime(),
    exposureVersion: exposure.version,
    promotionEnabled: promoted,
    exposureLog: exposureLog(
      {
        publishedAt: job.publishedAt,
        visibility: effective.visibility,
        boost,
      },
      now,
      exposure,
    ),
    id: job.id,
    title: job.title,
    companyName: job.isAnonymous ? '' : job.company.name,
    cityName:
      [...names(job.city), ...(job.city?.aliases || []).map((row) => row.alias)].join(' ') || null,
    countryName: names(job.country).join(' ') || null,
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

async function waitForTask(
  host: string,
  apiKey: string | undefined,
  taskUid: number,
): Promise<void> {
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
  index = INDEX,
): Promise<number> {
  const promotions =
    (await prisma.featureFlag.findUnique({ where: { key: 'hr_promotions' } }))?.enabled === true &&
    (await prisma.featureFlag.findUnique({ where: { key: 'hr_packages' } }))?.enabled === true;
  const exposure = await loadExposurePolicy(prisma);
  let cursor: string | undefined;
  let indexed = 0;
  for (;;) {
    const batch = await prisma.jobPost.findMany({
      where: { ...liveJobWhere(), ...(cursor ? { id: { gt: cursor } } : {}) },
      take: BATCH,
      // Keyset pagination over an immutable unique key. Timestamp-only offset
      // pages can repeat/omit rows when many jobs share the same creation time.
      orderBy: { id: 'asc' },
      include: jobIndexInclude,
    });
    if (!batch.length) break;
    const enqueued = await meili<{ taskUid: number }>(
      host,
      apiKey,
      'PUT',
      `/indexes/${index}/documents`,
      batch.map((job) => toJobSearchDocument(job, promotions, exposure)),
    );
    await waitForTask(host, apiKey, enqueued.taskUid);
    indexed += batch.length;
    cursor = batch[batch.length - 1].id;
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
  index?: string;
  log?: (message: string) => void;
}): Promise<number> {
  const index = opts.index ?? INDEX;
  const host = (opts.host || '').replace(/\/$/, '');
  const log = opts.log ?? (() => undefined);
  if (!host) {
    log('Meilisearch: MEILI_HOST unset; keyword search uses the database');
    return 0;
  }
  await meili(host, opts.apiKey, 'POST', '/indexes', { uid: index, primaryKey: 'id' }).catch(
    () => undefined,
  );
  await meili(host, opts.apiKey, 'PATCH', `/indexes/${index}/settings`, JOBS_INDEX_SETTINGS);
  const deleted = await meili<{ taskUid: number }>(
    host,
    opts.apiKey,
    'DELETE',
    `/indexes/${index}/documents`,
  );
  await waitForTask(host, opts.apiKey, deleted.taskUid);
  const indexed = await indexPublishedJobs(opts.prisma, host, opts.apiKey, index);
  log(`Meilisearch: indexed ${indexed} published job(s)`);
  return indexed;
}
