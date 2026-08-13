import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [PrismaModule, MailModule, NotificationsModule, TelegramModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule implements OnModuleInit {
  private readonly logger = new Logger(AlertsModule.name);

  constructor(
    private alerts: AlertsService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
    try {
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue('job-alerts', { connection });
      this.alerts.setQueue(queue);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const worker = new Worker(
        'job-alerts',
        async () => {
          await this.alerts.processDueAlerts();
        },
        { connection: connection.duplicate() },
      );

      queue
        .add(
          'tick',
          {},
          {
            repeat: { every: 60_000 },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        )
        .catch((err) => this.logger.warn(`Alert queue schedule: ${err.message}`));

      this.logger.log('Job alerts worker started');
    } catch (err) {
      this.logger.warn(`Alerts queue unavailable: ${(err as Error).message}`);
    }
  }
}
