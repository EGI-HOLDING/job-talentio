import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobTitleBackfillService } from './job-title-backfill.service';
import { CompaniesModule } from '../companies/companies.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { LinkedInModule } from '../linkedin/linkedin.module';

@Module({
  imports: [CompaniesModule, MatchingModule, NotificationsModule, PrismaModule, TelegramModule, LinkedInModule],
  controllers: [JobsController],
  providers: [JobsService, JobTitleBackfillService],
  exports: [JobsService],
})
export class JobsModule {}
