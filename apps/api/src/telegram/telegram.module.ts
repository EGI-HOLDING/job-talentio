import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramService } from './telegram.service';
import { TelegramWebhookController } from './telegram.webhook.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [TelegramWebhookController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
