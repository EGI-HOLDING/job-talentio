import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { GeoBackfillService } from './geo-backfill.service';
import { IndustryBackfillService } from './industry-backfill.service';
import { VipCompanyBackfillService } from './vip-company-backfill.service';
import { CompanyLogoBackfillService } from './company-logo-backfill.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MetaController],
  providers: [
    MetaService,
    GeoBackfillService,
    IndustryBackfillService,
    VipCompanyBackfillService,
    CompanyLogoBackfillService,
  ],
  exports: [MetaService],
})
export class MetaModule {}
