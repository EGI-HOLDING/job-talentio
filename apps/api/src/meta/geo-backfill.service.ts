import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { backfillGeo, needsGeoBackfill } from '../common/geo-backfill';

@Injectable()
export class GeoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeoBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const needs = await needsGeoBackfill(this.prisma);
      if (!needs) return;
      this.logger.log('Geo catalog incomplete — running backfill');
      const result = await backfillGeo(this.prisma, {
        log: (msg) => this.logger.warn(msg),
      });
      this.logger.log(
        `Geo backfill done: countries=${result.countries} provinces=${result.provinces} cities=${result.cities}`,
      );
    } catch (err) {
      this.logger.error(
        `Geo backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
