import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  backfillJobTitles,
  needsJobTitleBackfill,
} from '../common/job-title-backfill';

@Injectable()
export class JobTitleBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobTitleBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsJobTitleBackfill(this.prisma);
      if (!needs) {
        // Still scrub mojibake / link stragglers cheaply when catalog looks clean
        this.logger.log('JobTitle backfill: light pass (idempotent)');
      } else {
        this.logger.log(
          'Job posts/catalog still need JobTitle normalize - running backfill',
        );
      }
      const result = await backfillJobTitles(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `JobTitle backfill done: scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} catalogCleaned=${result.catalogCleaned} catalogMerged=${result.catalogMerged} errors=${result.errors} dedupeClosed=${result.dedupeClosed} dedupeRemainingAbc=${result.dedupeRemainingAbc}`,
      );
    } catch (err) {
      this.logger.error(
        `JobTitle backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
