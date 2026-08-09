import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobTitleBackfillService } from './job-title-backfill.service';
import { CompaniesModule } from '../companies/companies.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [CompaniesModule, MatchingModule, NotificationsModule, PrismaModule],
  controllers: [JobsController],
  providers: [JobsService, JobTitleBackfillService],
  exports: [JobsService],
})
export class JobsModule {}
