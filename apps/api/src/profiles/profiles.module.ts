import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { CandidateAccessService } from './candidate-access.service';
import { CandidateAccessController } from './candidate-access.controller';
import { CvParseService, CV_PARSE_QUEUE, CvParseJobPayload } from './cv-parse.service';
import { CV_PARSE_PROVIDER } from './parse/cv-parse.provider';
import { createCvParseProvider } from './parse/cv-parse.factory';
import { CompaniesModule } from '../companies/companies.module';
import { MatchingModule } from '../matching/matching.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [CompaniesModule, MatchingModule, StorageModule],
  controllers: [CandidateAccessController, ProfilesController],
  providers: [
    ProfilesService,
    CandidateAccessService,
    EmployeeOnboardingService,
    {
      provide: CV_PARSE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createCvParseProvider(config),
    },
    CvParseService,
  ],
  exports: [ProfilesService, CvParseService],
})
export class ProfilesModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfilesModule.name);
  private recovery?: ReturnType<typeof setInterval>;
  private recovering = false;
  private queue?: Queue;
  private worker?: Worker;
  private connections: IORedis[] = [];

  constructor(
    private cvParse: CvParseService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const recover = async () => {
      if (this.recovering) return;
      this.recovering = true;
      try { await this.cvParse.recoverStale(); } catch (error) { this.logger.warn(`CV recovery failed: ${(error as Error).message}`); }
      finally { this.recovering = false; }
    };
    void recover();
    this.recovery = setInterval(() => void recover(), 30_000);
    this.recovery.unref();
    const redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
    try {
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      connection.on('error', err => this.logger.warn(`CV Redis unavailable: ${err.message}`));
      const queue = new Queue<CvParseJobPayload>(CV_PARSE_QUEUE, { connection });
      this.queue = queue;
      const workerConnection = connection.duplicate();
      this.connections = [connection, workerConnection];
      queue.on('error', err => this.logger.warn(`CV queue unavailable: ${err.message}`));
      this.cvParse.setQueue(queue);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const worker = new Worker<CvParseJobPayload>(
        CV_PARSE_QUEUE,
        async (job) => {
          await this.cvParse.processResume(job.data.resumeId, job.data.generation);
        },
        {
          connection: workerConnection,
          concurrency: 2,
        },
      );
      this.worker = worker;

      worker.on('failed', (job, err) => {
        this.logger.warn(`CV parse job ${job?.id} failed: ${err.message}`);
      });
      worker.on('error', err => this.logger.warn(`CV worker unavailable: ${err.message}`));

      this.logger.log('CV parse worker started (provider=local; paid APIs disabled)');
    } catch (err) {
      this.logger.warn(`CV parse queue unavailable: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.recovery) clearInterval(this.recovery);
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    for (const connection of this.connections) connection.disconnect();
  }
}
