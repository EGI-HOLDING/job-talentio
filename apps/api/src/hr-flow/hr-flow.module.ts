import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { BenefitsModule } from '../benefits/benefits.module';
import { StorageModule } from '../storage/storage.module';
import { HrFlowController } from './hr-flow.controller';
import { HrFlowService } from './hr-flow.service';
import { HrFlowWorker } from './hr-flow.worker';
@Module({imports:[JobsModule,BenefitsModule,StorageModule],controllers:[HrFlowController],providers:[HrFlowService,HrFlowWorker]})
export class HrFlowModule {}
