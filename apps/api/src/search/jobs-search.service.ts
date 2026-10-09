import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';
import {
  indexPublishedJobs,
  jobIndexInclude,
  rebuildJobsIndex,
  toJobSearchDocument,
} from './jobs-index.sync';

const INDEX = 'jobs';
/** Mirror of JobsService relevance scan cap so id-filtering never shrinks results. */
const SEARCH_ID_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 3_000;

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
   * Full replace of the jobs index. Throttled so a burst of searches that miss
   * a stale index does not rebuild on every request. Also used when Meili
   * restarts empty (staging has no volume) so search self-heals.
   */
  reindexInBackground(): void {
    this.scheduleRebuild('index out of date with published jobs');
  }

  private scheduleRebuild(reason: string): void {
    const now = Date.now();
    if (!this.host || this.backfillInFlight || now - this.lastBackfillKick < 30_000) return;
    this.backfillInFlight = true;
    this.lastBackfillKick = now;
    this.logger.warn(`Meilisearch ${reason}; reindexing in background`);
    void rebuildJobsIndex({
      prisma: this.prisma,
      host: this.host,
      apiKey: this.apiKey,
      log: (message) => this.logger.log(message),
    })
      .catch((err) => this.logger.warn(`Meilisearch reindex failed: ${(err as Error).message}`))
      .finally(() => {
        this.backfillInFlight = false;
      });
  }

  private kickBackfill(): void {
    this.scheduleRebuild('index empty or missing');
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
        // 0 hits is not a trustworthy filter: an empty array is truthy and
        // `id IN ()` hides every posting, including ones the index never saw.
        // An empty index still needs a rebuild; a non-empty miss falls through
        // to Postgres, which rebuilds only when it actually finds rows.
        const stats = await this.request<{ numberOfDocuments: number }>(
          'GET',
          `/indexes/${INDEX}/stats`,
        ).catch(() => null);
        if (!stats || stats.numberOfDocuments === 0) {
          this.kickBackfill();
        }
        return null;
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
        await this.request('PUT', `/indexes/${INDEX}/documents`, [toJobSearchDocument(job)]);
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
    if (!this.host) return;
    const indexed = await indexPublishedJobs(this.prisma, this.host, this.apiKey);
    this.logger.log(`Meilisearch backfill indexed ${indexed} published job(s)`);
  }

  private fetchJob(jobId: string) {
    return this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: jobIndexInclude,
    });
  }
}
