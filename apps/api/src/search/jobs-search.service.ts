import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const INDEX = 'jobs';
/** Mirror of JobsService relevance scan cap so id-filtering never shrinks results. */
const SEARCH_ID_LIMIT = 1000;
const BACKFILL_BATCH = 500;
const REQUEST_TIMEOUT_MS = 3_000;

type JobDocument = {
  id: string;
  title: string;
  companyName: string;
  cityName: string | null;
  categoryName: string | null;
  skills: string[];
  description: string;
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
      // Both calls are async tasks in Meili; re-running them is idempotent.
      await this.request('POST', '/indexes', { uid: INDEX, primaryKey: 'id' }).catch(
        () => undefined,
      );
      await this.request('PATCH', `/indexes/${INDEX}/settings`, {
        searchableAttributes: [
          'title',
          'companyName',
          'skills',
          'categoryName',
          'cityName',
          'description',
        ],
        displayedAttributes: ['id'],
      });
      const stats = await this.request<{ numberOfDocuments: number }>(
        'GET',
        `/indexes/${INDEX}/stats`,
      );
      if (stats.numberOfDocuments === 0) {
        await this.backfill();
      }
      this.logger.log('Meilisearch jobs index ready');
    } catch (err) {
      // Keep the API booting; searches will retry Meili and fall back to Prisma.
      this.logger.warn(`Meilisearch init incomplete: ${(err as Error).message}`);
    }
  }

  /** Ranked job ids for a text query, or null when Meili is unavailable. */
  async searchJobIds(q: string): Promise<string[] | null> {
    if (!this.host) return null;
    try {
      const res = await this.request<{ hits: Array<{ id: string }> }>(
        'POST',
        `/indexes/${INDEX}/search`,
        { q, limit: SEARCH_ID_LIMIT, attributesToRetrieve: ['id'] },
      );
      return res.hits.map((h) => h.id);
    } catch (err) {
      this.logger.warn(
        `Meilisearch query failed, using Prisma fallback: ${(err as Error).message}`,
      );
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
    city: { select: { name: true } },
    category: { select: { name: true } },
    jobSkills: { select: { skill: { select: { name: true } } } },
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
    city: { name: string } | null;
    category: { name: string } | null;
    jobSkills: Array<{ skill: { name: string } }>;
  }): JobDocument {
    return {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      cityName: job.city?.name ?? null,
      categoryName: job.category?.name ?? null,
      skills: job.jobSkills.map((s) => s.skill.name),
      description: job.description.slice(0, 600),
      publishedAt: job.publishedAt ? job.publishedAt.getTime() : null,
    };
  }
}
