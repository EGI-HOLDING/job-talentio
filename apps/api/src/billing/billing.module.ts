import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { CompaniesModule } from '../companies/companies.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [CompaniesModule, JobsModule],
  controllers: [BillingController],
  providers: [BillingService, MockPaymentProvider],
  exports: [BillingService],
})
export class BillingModule {}
