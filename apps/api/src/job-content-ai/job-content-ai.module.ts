import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../common/openai/openai.client';
import { CompaniesModule } from '../companies/companies.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { JobContentAiController } from './job-content-ai.controller';
import { JOB_CONTENT_AI_CLIENT, JobContentAiService } from './job-content-ai.service';

@Module({
  imports: [CompaniesModule, PrismaModule, StorageModule],
  controllers: [JobContentAiController],
  providers: [
    {
      provide: JOB_CONTENT_AI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new OpenAiClient({
        apiKey: config.get<string>('OPENAI_API_KEY') || '',
        model: config.get<string>('JOB_CONTENT_AI_MODEL') || 'gpt-6-luna',
      }),
    },
    JobContentAiService,
  ],
})
export class JobContentAiModule {}
