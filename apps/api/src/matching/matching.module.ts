import { Module,OnModuleInit,OnModuleDestroy,Logger } from '@nestjs/common';
import { RecruiterEvidenceWorker } from './recruiter-evidence.worker';
import { StorageModule } from '../storage/storage.module';
import { EmployeeEvidenceService } from './employee-evidence.service';
import { EmployeeEvidenceController } from './employee-evidence.controller';
import { EmployeeIntentService } from './employee-intent.service';
import { MatchingService } from './matching.service';
import { EmployeeMatchingService } from './employee-matching.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { EmployeeMatchingStatusController } from './employee-status.controller';
import {OccupationRelationsService} from './occupation-relations.service';
import {OccupationRelationsController} from './occupation-relations.controller';
import { VacancyTasksService } from './vacancy-tasks.service';
import {PositionGroupService} from './position-group.service';
import {PositionGroupsController,PositionGroupsAdminController} from './position-groups.controller';

@Module({
  imports: [PrismaModule,StorageModule],
  controllers:[EmployeeEvidenceController,EmployeeMatchingStatusController,OccupationRelationsController,PositionGroupsController,PositionGroupsAdminController],
  providers: [MatchingService, EmployeeMatchingService,EmployeeIntentService,EmployeeEvidenceService,EmployeeCatalogSnapshot,RecruiterEvidenceWorker,OccupationRelationsService,VacancyTasksService,PositionGroupService],
  exports: [MatchingService, EmployeeMatchingService,EmployeeCatalogSnapshot,PositionGroupService],
})
export class MatchingModule implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  constructor(private evidence:EmployeeEvidenceService,private matching:EmployeeMatchingService){}
  async onModuleInit(){await this.matching.warmCatalog();const recover=()=>void this.evidence.recover().catch(e=>new Logger('EmployeeEvidence').warn(e.message));recover();this.timer=setInterval(recover,5000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
