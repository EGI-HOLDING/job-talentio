import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { CvParseService, CV_PARSE_QUEUE, CvParseJobPayload } from './cv-parse.service';
import { CompaniesModule } from '../companies/companies.module';
import { MatchingModule } from '../matching/matching.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [CompaniesModule, MatchingModule, StorageModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, CvParseService],
  exports: [ProfilesService, CvParseService],
})
export class ProfilesModule implements OnModuleInit {
  private readonly logger = new Logger(ProfilesModule.name);

  constructor(
    private cvParse: CvParseService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
    try {
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue<CvParseJobPayload>(CV_PARSE_QUEUE, { connection });
      this.cvParse.setQueue(queue);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const worker = new Worker<CvParseJobPayload>(
        CV_PARSE_QUEUE,
        async (job) => {
          await this.cvParse.processResume(job.data.resumeId);
        },
        {
          connection: connection.duplicate(),
          concurrency: 2,
        },
      );

      worker.on('failed', (job, err) => {
        this.logger.warn(`CV parse job ${job?.id} failed: ${err.message}`);
      });

      this.logger.log('CV parse worker started');
    } catch (err) {
      this.logger.warn(`CV parse queue unavailable: ${(err as Error).message}`);
    }
  }
}
