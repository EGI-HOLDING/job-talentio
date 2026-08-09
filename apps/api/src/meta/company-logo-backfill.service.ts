import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { backfillCompanyLogos, needsCompanyLogoBackfill } from '../common/company-logo-backfill';

@Injectable()
export class CompanyLogoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CompanyLogoBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsCompanyLogoBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('Company logos outdated - running backfill');
      const result = await backfillCompanyLogos(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(`Company logo backfill done: updated=${result.updated}`);
    } catch (err) {
      this.logger.error(
        `Company logo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
