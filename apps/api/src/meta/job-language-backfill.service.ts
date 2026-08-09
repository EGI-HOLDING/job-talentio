import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  backfillJobLanguages,
  needsJobLanguageBackfill,
} from '../common/job-language-backfill';

@Injectable()
export class JobLanguageBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobLanguageBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsJobLanguageBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('Many jobs missing language requirements — running backfill');
      const result = await backfillJobLanguages(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `Job language backfill done: scanned=${result.scanned} filled=${result.filled} emptySlice=${result.skippedEmptySlice}`,
      );
    } catch (err) {
      this.logger.error(
        `Job language backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
