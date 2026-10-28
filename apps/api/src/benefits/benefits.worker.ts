import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsSearchService } from '../search/jobs-search.service';
import { loadExposurePolicy } from './benefit-policy';
import { BenefitsService } from './benefits.service';
@Injectable()
export class BenefitsWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private projectionVersion = '';
  private logger = new Logger(BenefitsWorker.name);
  constructor(
    private db: PrismaService,
    private benefits: BenefitsService,
    private search: JobsSearchService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 30000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async sync(ids: string[]) {
    // Keep the one-minute projection budget practical for many simultaneous
    // boosts while bounding requests when the search dependency is slow.
    for (let i = 0; i < ids.length; i += 8)
      await Promise.all(ids.slice(i, i + 8).map((id) => this.search.syncJob(id)));
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.search.retryFailedSyncs();
      await this.db.jobPurchaseOrder.updateMany({where: {status: 'PENDING', expiresAt: {lte: new Date()}}, data: {status: 'EXPIRED'}});
      const packages = await this.benefits.enabled(),
        promoted = packages && (await this.benefits.enabled('hr_promotions'));
      const policy = await loadExposurePolicy(this.db);
      const version = String(promoted) + ':' + policy.version;
      if (this.projectionVersion !== version) {
        this.search.reindexInBackground();
        this.projectionVersion = version;
      }
      if (!packages) return;
      const now = new Date();
      const expired = await this.db.jobBenefit.findMany({
        where: { expiresAt: { lte: now }, job: { status: { in: ['PUBLISHED', 'PAUSED'] } } },
        select: { jobId: true },
      });
      if (expired.length) {
        await this.db.jobPost.updateMany({
          where: {
            id: { in: expired.map((row) => row.jobId) },
            status: { in: ['PUBLISHED', 'PAUSED'] },
            benefit: { expiresAt: { lte: now } },
          },
          data: { status: 'EXPIRED' },
        });
        await this.sync(expired.map((row) => row.jobId));
      }
      if (await this.benefits.enabled('hr_promotions')) {
        const jobs = await this.db.jobBenefit.findMany({
          where: {
            job: { status: 'PUBLISHED' },
            boosts: { some: { endsAt: { gte: new Date(now.getTime() - 90000) } } },
          },
          select: { jobId: true },
        });
        await this.sync(jobs.map((row) => row.jobId));
      }
    } catch (error) {
      this.logger.error('Benefits projection failed: ' + (error as Error).message);
    } finally {
      this.running = false;
    }
  }
}
