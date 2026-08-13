import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  backfillEgiHospitalityDemo,
  needsEgiHospitalityDemoBackfill,
} from '../common/egi-hospitality-demo';

@Injectable()
export class EgiHospitalityDemoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EgiHospitalityDemoBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsEgiHospitalityDemoBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('EGI hospitality demo companies incomplete - running backfill');
      const result = await backfillEgiHospitalityDemo(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `EGI hospitality demo backfill done: companies=${result.companies} jobs=${result.jobs}`,
      );
    } catch (err) {
      this.logger.error(
        `EGI hospitality demo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
