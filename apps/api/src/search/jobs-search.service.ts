import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';

const INDEX = 'jobs';
/** Mirror of JobsService relevance scan cap so id-filtering never shrinks results. */
const SEARCH_ID_LIMIT = 1000;
const BACKFILL_BATCH = 500;
const REQUEST_TIMEOUT_MS = 3_000;

type LocalizedName = { name: string; nameUz?: string | null; nameRu?: string | null };

type JobDocument = {
  id: string;
  title: string;
  companyName: string;
  cityName: string | null;
  categoryName: string | null;
  skills: string[];
  description: string;
  /** Titles and bodies of every stored translation, so a Russian query finds a
   * posting written in Uzbek and vice versa. */
  titleAlt: string[];
  descriptionAlt: string[];
  publishedAt: number | null;
};

/**
 * Typo-tolerant job search via Meilisearch (plain REST - the official JS SDK
 * is ESM-only and this API compiles to CommonJS). Postgres stays the source
 * of truth: only PUBLISHED jobs are indexed, and queries return ids that
 * JobsService feeds back into Prisma so every existing filter keeps working.
 * When MEILI_HOST is unset or Meilisearch is unreachable, callers fall back
 * to Prisma `contains` search.
 */
@Injectable()
export class JobsSearchService implements OnModuleInit {
  private readonly logger = new Logger(JobsSearchService.name);
  private readonly host: string | null;
  private readonly apiKey: string | undefined;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.host = (config.get<string>('MEILI_HOST') || '').replace(/\/$/, '') || null;
    this.apiKey = config.get<string>('MEILI_MASTER_KEY') || undefined;
    if (!this.host) {
      this.logger.log('MEILI_HOST not set; job search uses Prisma only');
    }
  }

  get enabled(): boolean {
    return Boolean(this.host);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Meilisearch ${method} ${path} responded ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async onModuleInit() {
    if (!this.host) return;
    try {
      await this.initIndex();
      this.logger.log('Meilisearch jobs index ready');
    } catch (err) {
      // Keep the API booting; searches will retry Meili and fall back to Prisma.
      this.logger.warn(`Meilisearch init incomplete: ${(err as Error).message}`);
    }
  }

  /** Ensure index + settings exist, then backfill when the index is empty. */
  private async initIndex(): Promise<void> {
    // Both calls are async tasks in Meili; re-running them is idempotent.
    await this.request('POST', '/indexes', { uid: INDEX, primaryKey: 'id' }).catch(
      () => undefined,
    );
    await this.request('PATCH', `/indexes/${INDEX}/settings`, JOBS_INDEX_SETTINGS);
    const stats = await this.request<{ numberOfDocuments: number }>(
      'GET',
      `/indexes/${INDEX}/stats`,
    );
    if (stats.numberOfDocuments === 0) {
      await this.backfill();
    }
  }

  private backfillInFlight = false;
  private lastBackfillKick = 0;

  /**
   * Meilisearch may restart empty (staging runs it stateless: Railway volumes
   * put this image in a silent crash loop). Rebuild the index in the
   * background so search self-heals without an API redeploy.
   */
  private kickBackfill(): void {
    const now = Date.now();
    if (this.backfillInFlight || now - this.lastBackfillKick < 30_000) return;
    this.backfillInFlight = true;
    this.lastBackfillKick = now;
    this.logger.warn('Meilisearch index empty or missing; reindexing in background');
    void this.initIndex()
      .catch((err) => this.logger.warn(`Meilisearch reindex failed: ${(err as Error).message}`))
      .finally(() => {
        this.backfillInFlight = false;
      });
  }

  /** Ranked job ids for a text query, or null when Meili is unavailable. */
  async searchJobIds(q: string): Promise<string[] | null> {
    if (!this.host) return null;
    try {
      const res = await this.request<{ hits: Array<{ id: string }> }>(
        'POST',
        `/indexes/${INDEX}/search`,
        {
          q,
          limit: SEARCH_ID_LIMIT,
          attributesToRetrieve: ['id'],
          // Default 'last' matches any query word, so multi-word queries return
          // nearly the whole corpus. 'all' keeps typo tolerance but requires
          // every word to match, like users expect from a job search box.
          matchingStrategy: 'all',
        },
      );
      if (res.hits.length === 0) {
        // 0 hits from a wiped index is indistinguishable from a genuine miss;
        // check stats and reindex + fall back to Prisma when the index is empty.
        const stats = await this.request<{ numberOfDocuments: number }>(
          'GET',
          `/indexes/${INDEX}/stats`,
        ).catch(() => null);
        if (!stats || stats.numberOfDocuments === 0) {
          this.kickBackfill();
          return null;
        }
      }
      return res.hits.map((h) => h.id);
    } catch (err) {
      const message = (err as Error).message;
      if (/responded 404/.test(message)) {
        // Index itself is gone (fresh Meilisearch instance).
        this.kickBackfill();
      }
      this.logger.warn(`Meilisearch query failed, using Prisma fallback: ${message}`);
      return null;
    }
  }

  /** Upsert (PUBLISHED) or remove (anything else) one job. Fire-and-forget safe. */
  async syncJob(jobId: string): Promise<void> {
    if (!this.host) return;
    try {
      const job = await this.fetchJob(jobId);
      if (job && job.status === 'PUBLISHED') {
        await this.request('PUT', `/indexes/${INDEX}/documents`, [this.toDocument(job)]);
      } else {
        await this.request('DELETE', `/indexes/${INDEX}/documents/${jobId}`).catch(
          () => undefined,
        );
      }
    } catch (err) {
      this.logger.warn(`Meilisearch sync failed for job ${jobId}: ${(err as Error).message}`);
    }
  }

  /** Re-sync all jobs of a company (e.g. after a ban pauses its postings). */
  async syncCompanyJobs(companyId: string): Promise<void> {
    if (!this.host) return;
    try {
      const jobs = await this.prisma.jobPost.findMany({
        where: { companyId },
        select: { id: true },
      });
      for (const { id } of jobs) {
        await this.syncJob(id);
      }
    } catch (err) {
      this.logger.warn(
        `Meilisearch company sync failed for ${companyId}: ${(err as Error).message}`,
      );
    }
  }

  private async backfill(): Promise<void> {
    let skip = 0;
    let indexed = 0;
    for (;;) {
      const batch = await this.prisma.jobPost.findMany({
        where: { status: 'PUBLISHED' },
        skip,
        take: BACKFILL_BATCH,
        orderBy: { createdAt: 'asc' },
        include: this.syncInclude,
      });
      if (!batch.length) break;
      await this.request(
        'PUT',
        `/indexes/${INDEX}/documents`,
        batch.map((job) => this.toDocument(job)),
      );
      indexed += batch.length;
      skip += BACKFILL_BATCH;
    }
    this.logger.log(`Meilisearch backfill indexed ${indexed} published job(s)`);
  }

  private syncInclude = {
    company: { select: { name: true } },
    city: { select: { name: true, nameUz: true, nameRu: true } },
    category: { select: { name: true, nameUz: true, nameRu: true } },
    jobSkills: { select: { skill: { select: { name: true, nameUz: true, nameRu: true } } } },
    translations: { select: { title: true, description: true } },
  } as const;

  private fetchJob(jobId: string) {
    return this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: this.syncInclude,
    });
  }

  private toDocument(job: {
    id: string;
    title: string;
    description: string;
    publishedAt: Date | null;
    company: { name: string };
    city: LocalizedName | null;
    category: LocalizedName | null;
    jobSkills: Array<{ skill: LocalizedName }>;
    translations: Array<{ title: string; description: string }>;
  }): JobDocument {
    // Catalog names are indexed in every language so a Russian query for a city
    // still matches a posting whose row was written in Uzbek.
    const names = (row: LocalizedName | null | undefined): string[] =>
      row ? [row.name, row.nameUz, row.nameRu].filter((v): v is string => Boolean(v)) : [];

    return {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      cityName: names(job.city).join(' ') || null,
      categoryName: names(job.category).join(' ') || null,
      skills: job.jobSkills.flatMap((s) => names(s.skill)),
      description: job.description.slice(0, 600),
      titleAlt: job.translations.map((t) => t.title),
      descriptionAlt: job.translations.map((t) => t.description.slice(0, 600)),
      publishedAt: job.publishedAt ? job.publishedAt.getTime() : null,
    };
  }
}
