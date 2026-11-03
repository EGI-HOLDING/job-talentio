import { Module,OnModuleInit,OnModuleDestroy,Logger } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EmployeeEvidenceService } from './employee-evidence.service';
import { EmployeeEvidenceController } from './employee-evidence.controller';
import { EmployeeIntentService } from './employee-intent.service';
import { MatchingService } from './matching.service';
import { EmployeeMatchingService } from './employee-matching.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { EmployeeMatchingStatusController } from './employee-status.controller';

@Module({
  imports: [PrismaModule,StorageModule],
  controllers:[EmployeeEvidenceController,EmployeeMatchingStatusController],
  providers: [MatchingService, EmployeeMatchingService,EmployeeIntentService,EmployeeEvidenceService,EmployeeCatalogSnapshot],
  exports: [MatchingService, EmployeeMatchingService,EmployeeCatalogSnapshot],
})
export class MatchingModule implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  constructor(private evidence:EmployeeEvidenceService,private matching:EmployeeMatchingService){}
  async onModuleInit(){await this.matching.warmCatalog();const recover=()=>void this.evidence.recover().catch(e=>new Logger('EmployeeEvidence').warn(e.message));recover();this.timer=setInterval(recover,30000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
