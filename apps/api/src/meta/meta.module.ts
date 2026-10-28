import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { EgiHospitalityDemoBackfillService } from './egi-hospitality-demo-backfill.service';
import { CompanyLogoBackfillService } from './company-logo-backfill.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [MetaController],
  providers: [
    MetaService,
    EgiHospitalityDemoBackfillService,
    CompanyLogoBackfillService,
  ],
  exports: [MetaService],
})
export class MetaModule {}
