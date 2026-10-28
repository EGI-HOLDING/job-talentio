import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { BenefitsService } from './benefits.service';
import { BenefitsController, AdminBenefitsController } from './benefits.controller';
import { SearchModule } from '../search/search.module';
import { BenefitsWorker } from './benefits.worker';
import { HrEventsService } from './hr-events.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { HrSupportService } from './hr-support.service';
import {
  HrEventsController,
  HrReportsController,
  HrSupportController,
  FeaturedController,
} from './hr.controller';
import { OperationsService } from './operations.service';
import { JobCommerceService } from './job-commerce.service';
import { JobPaymentProvider } from './job-payment.provider';
import { JobCommerceController, JobCommerceCatalogController, JobPaymentWebhookController } from './job-commerce.controller';
import { RecruiterOnboardingService } from './recruiter-onboarding.service';
import { RecruiterOnboardingController } from './recruiter-onboarding.controller';
import { JobCommerceAdminController } from './job-commerce-admin.controller';
@Global()
@Module({
  imports: [PrismaModule, StorageModule, SearchModule],
  providers: [
    BenefitsService,
    JobCommerceService,
    JobPaymentProvider,
    RecruiterOnboardingService,
    OperationsService,
    HrEventsService,
    HrAnalyticsService,
    HrSupportService,
    BenefitsWorker,
  ],
  exports: [BenefitsService, OperationsService, HrEventsService, HrAnalyticsService, RecruiterOnboardingService],
  controllers: [
    BenefitsController,
    JobCommerceController,
    JobCommerceCatalogController,
    JobPaymentWebhookController,
    RecruiterOnboardingController,
    JobCommerceAdminController,
    AdminBenefitsController,
    HrEventsController,
    HrReportsController,
    HrSupportController,
    FeaturedController,
  ],
})
export class BenefitsModule {}
