import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { backfillIndustries, needsIndustryBackfill } from '../common/industry-backfill';

@Injectable()
export class IndustryBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndustryBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsIndustryBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('Industry catalog incomplete - running backfill');
      const result = await backfillIndustries(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `Industry backfill done: groups=${result.groupsUpserted} industries=${result.industriesUpserted} remapped=${result.companiesRemapped} retired=${result.industriesRetired}`,
      );
    } catch (err) {
      this.logger.error(
        `Industry backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
