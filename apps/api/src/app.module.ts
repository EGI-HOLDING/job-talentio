import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LocaleInterceptor } from './common/locale.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { JobsModule } from './jobs/jobs.module';
import { ApplicationsModule } from './applications/applications.module';
import { ProfilesModule } from './profiles/profiles.module';
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
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { SearchModule } from './search/search.module';
import { NewsModule } from './news/news.module';
import { PresenceModule } from './presence/presence.module';
import { TranslationModule } from './translation/translation.module';
import { TelegramModule } from './telegram/telegram.module';
import { HealthController } from './health.controller';
import { SeedService } from './seed.service';
import { BenefitsModule } from './benefits/benefits.module';
import { LiveUpdatesModule } from './common/live-updates';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    RateLimitModule,
    LiveUpdatesModule,
    SearchModule,
    PresenceModule,
    TranslationModule,
    PrismaModule,
    BenefitsModule,
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

    ChatModule,
    BulkCommsModule,
    AlertsModule,
    AdminModule,
    NewsModule,
    TelegramModule,
  ],
  controllers: [HealthController],
  providers: [SeedService, { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor }],
})
export class AppModule {}
