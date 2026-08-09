import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { backfillVipDemoCompanies, needsVipDemoBackfill } from '../common/vip-company-backfill';

@Injectable()
export class VipCompanyBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VipCompanyBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsVipDemoBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('VIP demo companies incomplete - running backfill');
      const result = await backfillVipDemoCompanies(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(`VIP demo backfill done: promoted=${result.promoted}`);
    } catch (err) {
      this.logger.error(
        `VIP demo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
