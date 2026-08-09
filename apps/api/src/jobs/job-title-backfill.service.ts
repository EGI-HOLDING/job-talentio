import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { backfillJobTitles } from '../common/job-title-backfill';

@Injectable()
export class JobTitleBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobTitleBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const missing = await this.prisma.jobPost.count({
        where: { jobTitleId: null },
      });
      if (missing === 0) return;

      this.logger.log(
        `Found ${missing} job posts without jobTitleId — running JobTitle backfill`,
      );
      const result = await backfillJobTitles(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `JobTitle backfill done: scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`,
      );
    } catch (err) {
      // Do not crash API boot; Dockerfile CMD also runs the script
      this.logger.error(
        `JobTitle backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
