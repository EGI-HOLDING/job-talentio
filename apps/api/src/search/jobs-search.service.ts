import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { loadExposurePolicy } from '../benefits/benefit-policy';
import { JOBS_INDEX_SETTINGS } from './jobs-search.settings';
import {
  indexPublishedJobs,
  jobIndexInclude,
  rebuildJobsIndex,
  toJobSearchDocument,
} from './jobs-index.sync';

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
  private readonly index: string;
  private readonly host: string | null;
  private readonly apiKey: string | undefined;
  private syncFailures = 0;
  private lastEnqueuedAt: Date | null = null;
  private failedSyncs = new Set<string>();
  private syncInFlight = new Map<string, Promise<void>>();
  private projectionUncertain = false;
  projectionHealth() {
    return {
      enabled: this.enabled,
      syncFailures: this.syncFailures,
      pendingJobs: this.failedSyncs.size,
      rebuilding: this.backfillInFlight,
      projectionUncertain: this.projectionUncertain,
      lastEnqueuedAt: this.lastEnqueuedAt,
    };
  }

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.index = config.get<string>('MEILI_JOBS_INDEX') || 'jobs';
    if (!/^[a-zA-Z0-9_-]+$/.test(this.index)) throw new Error('Invalid jobs index name');
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
    await this.request('POST', '/indexes', { uid: this.index, primaryKey: 'id' }).catch(
      () => undefined,
    );
    await this.request('PATCH', `/indexes/${this.index}/settings`, JOBS_INDEX_SETTINGS);
    const stats = await this.request<{ numberOfDocuments: number }>(
      'GET',
      `/indexes/${this.index}/stats`,
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
      index: this.index,
      host: this.host,
      apiKey: this.apiKey,
      log: (message) => this.logger.log(message),
    })
      .then(() => {
        this.projectionUncertain = false;
      })
      .catch((err) => {
        this.projectionUncertain = true;
        this.syncFailures++;
        this.logger.warn(`Meilisearch reindex failed: ${(err as Error).message}`);
      })
      .finally(() => {
        this.backfillInFlight = false;
      });
  }

  /** PostgreSQL has already applied authorization and all structured filters. */
  async rankedIds(q: string, eligibleIds: string[]): Promise<string[] | null> {
    if (!this.host || !eligibleIds.length) return null;
    if (this.backfillInFlight) return null;
    if (this.projectionUncertain) {
      this.reindexInBackground();
      return null;
    }
    if (eligibleIds.some((id) => this.failedSyncs.has(id))) return null;
    try {
      const ids: string[] = [];
      const promoted =
        (await this.prisma.featureFlag.findUnique({ where: { key: 'hr_promotions' } }))?.enabled ===
          true &&
        (await this.prisma.featureFlag.findUnique({ where: { key: 'hr_packages' } }))?.enabled ===
          true;
      const policy = await loadExposurePolicy(this.prisma);
      const filter =
        'id IN [' +
        eligibleIds.map((id) => JSON.stringify(id)).join(',') +
        '] AND exposureVersion = ' +
        policy.version +
        ' AND promotionEnabled = ' +
        promoted +
        ' AND (boostProjectedActive = false OR (boostEndsAt > ' +
        Date.now() +
        ' AND exposureUpdatedAt >= ' +
        (Date.now() - 60000) +
        '))';
      const coverage = await this.request<{ totalHits: number }>(
        'POST',
        '/indexes/' + this.index + '/search',
        { q: '', filter, page: 1, hitsPerPage: 1, attributesToRetrieve: ['id'] },
      );
      if (coverage.totalHits < eligibleIds.length) {
        this.logger.warn(`Meilisearch projection coverage ${coverage.totalHits}/${eligibleIds.length}; using database ranking`);
        this.reindexInBackground();
        return null;
      }
      for (let page = 1; ; page++) {
        const response = await this.request<{ hits: Array<{ id: string }>; totalPages: number }>(
          'POST',
          '/indexes/' + this.index + '/search',
          {
            q,
            filter,
            page,
            hitsPerPage: 500,
            matchingStrategy: 'all',
            attributesToRetrieve: ['id'],
          },
        );
        ids.push(...response.hits.map((hit) => hit.id));
        if (page >= response.totalPages || !response.hits.length) break;
      }
      return ids;
    } catch (error) {
      if (/responded 404/.test((error as Error).message)) this.reindexInBackground();
      this.logger.warn(
        'Ranked search unavailable; PostgreSQL fallback: ' + (error as Error).message,
      );
      return null;
    }
  }

  /** Upsert (PUBLISHED) or remove (anything else) one job. Fire-and-forget safe. */
  async syncJob(jobId: string): Promise<void> {
    if (!this.host) return;
    const previous = this.syncInFlight.get(jobId) ?? Promise.resolve();
    const current = previous.then(() => this.syncOneJob(jobId));
    this.syncInFlight.set(jobId, current);
    try {
      await current;
    } finally {
      if (this.syncInFlight.get(jobId) === current) this.syncInFlight.delete(jobId);
    }
  }

  /** Reconstructible projections: failed jobs retry; process restart rebuilds the index. */
  async retryFailedSyncs() {
    await Promise.all(
      [...this.failedSyncs]
        .filter((id) => !this.syncInFlight.has(id))
        .slice(0, 10)
        .map((id) => this.syncJob(id)),
    );
  }

  private async syncOneJob(jobId: string): Promise<void> {
    if (!this.host) return;
    this.failedSyncs.add(jobId);
    try {
      const job = await this.fetchJob(jobId);
      let task: { taskUid: number } | undefined;
      if (
        job &&
        job.status === 'PUBLISHED' &&
        (!job.benefit?.expiresAt || job.benefit.expiresAt > new Date())
      ) {
        task = await this.request<{ taskUid: number }>('PUT', `/indexes/${this.index}/documents`, [
          toJobSearchDocument(
            job,
            (await this.prisma.featureFlag.findUnique({ where: { key: 'hr_promotions' } }))
              ?.enabled === true &&
              (await this.prisma.featureFlag.findUnique({ where: { key: 'hr_packages' } }))
                ?.enabled === true,
            await loadExposurePolicy(this.prisma),
          ),
        ]);
        this.lastEnqueuedAt = new Date();
      } else {
        task = await this.request<{ taskUid: number }>(
          'DELETE',
          `/indexes/${this.index}/documents/${jobId}`,
        );
      }
      const deadline = Date.now() + 15000;
      while (task) {
        const state = await this.request<{ status: string; error?: { message?: string } }>(
          'GET',
          '/tasks/' + task.taskUid,
        );
        if (state.status === 'succeeded') break;
        if (['failed', 'canceled'].includes(state.status))
          throw new Error(state.error?.message ?? 'Index task failed');
        if (Date.now() > deadline) throw new Error('Index task timed out');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      this.failedSyncs.delete(jobId);
    } catch (err) {
      this.syncFailures++;
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
    const indexed = await indexPublishedJobs(this.prisma, this.host, this.apiKey, this.index);
    this.logger.log(`Meilisearch backfill indexed ${indexed} published job(s)`);
  }

  private fetchJob(jobId: string) {
    return this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: jobIndexInclude,
    });
  }
}
