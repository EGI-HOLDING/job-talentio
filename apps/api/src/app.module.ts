import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { JobsModule } from './jobs/jobs.module';
import { ApplicationsModule } from './applications/applications.module';
import { ProfilesModule } from './profiles/profiles.module';
import { BillingModule } from './billing/billing.module';
import { ChatModule } from './chat/chat.module';
import { AlertsModule } from './alerts/alerts.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { MetaModule } from './meta/meta.module';
import { MatchingModule } from './matching/matching.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { BulkCommsModule } from './bulk-comms/bulk-comms.module';
import { HealthController } from './health.controller';
import { SeedService } from './seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    StorageModule,
    MailModule,
    MatchingModule,
    MetaModule,
    NotificationsModule,
    ReportsModule,
    AuthModule,
    CompaniesModule,
    JobsModule,
    ApplicationsModule,
    ProfilesModule,
    BillingModule,
    ChatModule,
    BulkCommsModule,
    AlertsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
