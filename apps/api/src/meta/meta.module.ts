import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { GeoBackfillService } from './geo-backfill.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MetaController],
  providers: [MetaService, GeoBackfillService],
  exports: [MetaService],
})
export class MetaModule {}
