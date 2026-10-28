import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramService } from './telegram.service';
import { TelegramWebhookController } from './telegram.webhook.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchingModule } from '../matching/matching.module';
import { TelegramLocalPollingService } from './telegram-local-polling.service';

@Module({
  imports: [PrismaModule, NotificationsModule, MatchingModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramService, TelegramLocalPollingService],
  exports: [TelegramService, TelegramLocalPollingService],
})
export class TelegramModule {}
