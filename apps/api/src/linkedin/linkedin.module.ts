import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { LinkedInSettings } from './linkedin-settings';
import { LinkedInClient } from './linkedin-client';
import { LinkedInService } from './linkedin.service';
import { LinkedInWorkerService } from './linkedin-worker.service';
import { LinkedInAdminController,LinkedInCallbackController,LinkedInController,LinkedInJobController,LinkedInPostController } from './linkedin.controller';

@Module({imports:[PrismaModule,StorageModule],controllers:[LinkedInController,LinkedInCallbackController,LinkedInJobController,LinkedInPostController,LinkedInAdminController],providers:[LinkedInSettings,LinkedInClient,LinkedInService,LinkedInWorkerService],exports:[LinkedInService]})
export class LinkedInModule {}
