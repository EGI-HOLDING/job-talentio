import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  backfillEgiHospitalityDemo,
  needsEgiHospitalityDemoBackfill,
} from '../common/egi-hospitality-demo';

@Injectable()
export class EgiHospitalityDemoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EgiHospitalityDemoBackfillService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsEgiHospitalityDemoBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('EGI hospitality demo companies incomplete - running backfill');
      const result = await backfillEgiHospitalityDemo(this.prisma, {
        log: (msg) => this.logger.warn(msg),
        logoUploader: {
          putObject: (key, buffer, contentType) => this.storage.putObject(key, buffer, contentType),
          publicUrlForKey: (key) => this.storage.publicUrlForKey(key),
        },
      });
      this.logger.log(
        `EGI hospitality demo backfill done: companies=${result.companies} jobs=${result.jobs} logosUploaded=${result.logosUploaded} logosUpdated=${result.logosUpdated}`,
      );
    } catch (err) {
      this.logger.error(
        `EGI hospitality demo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
