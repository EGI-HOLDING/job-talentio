import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingController } from './billing.controller';
import { BillingWebhooksController } from './billing-webhooks.controller';
import { BillingService } from './billing.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { CompaniesModule } from '../companies/companies.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [CompaniesModule, JobsModule],
  controllers: [BillingController, BillingWebhooksController],
  providers: [
    BillingService,
    MockPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [MockPaymentProvider, ConfigService],
      useFactory: (mock: MockPaymentProvider, config: ConfigService): PaymentProvider => {
        const name = String(
          config.get('PAYMENTS_PROVIDER') ?? config.get('PAYMENT_PROVIDER') ?? 'mock',
        ).toLowerCase();
        if (name !== 'mock') {
          // Stripe/Midtrans adapters plug in here once keys exist.
          new Logger('BillingModule').warn(
            `Payment provider "${name}" not implemented yet; falling back to mock`,
          );
        }
        return mock;
      },
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
