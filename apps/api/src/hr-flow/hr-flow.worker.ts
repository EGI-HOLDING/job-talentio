import { ForbiddenException,Injectable,Logger,OnModuleInit,OnModuleDestroy,Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JobCommerceService } from '../benefits/job-commerce.service';
import { JobPaymentProvider } from '../benefits/job-payment.provider';
import { hrFlowEnabled } from './hr-flow.policy';
import { HrFlowService } from './hr-flow.service';

@Injectable()
export class HrFlowWorker implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private templateTimer?:ReturnType<typeof setInterval>;
  private publishingTemplates=false;
  private working=false;
  private lastCleanup=0;
  private readonly logger=new Logger(HrFlowWorker.name);
  constructor(private db:PrismaService,private storage:StorageService,private commerce:JobCommerceService,private provider:JobPaymentProvider,@Optional() private flow?:HrFlowService){}
  onModuleInit(){
    if(!hrFlowEnabled()&&!this.provider.configured&&!this.provider.available)return;
    this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('HR maintenance will retry')),60000);this.timer.unref();
    if(hrFlowEnabled()&&this.flow){
      this.templateTimer=setInterval(()=>void this.publishPaidTemplates().catch(()=>this.logger.warn('Paid template publication will retry')),5000);
      this.templateTimer.unref();
    }
  }
  onModuleDestroy(){
    if(this.timer)clearInterval(this.timer);
    if(this.templateTimer)clearInterval(this.templateTimer);
  }
  async publishPaidTemplates(){
    if(this.publishingTemplates||!this.flow||!hrFlowEnabled())return;
    const flow=this.flow;
    this.publishingTemplates=true;
    try{
      const sessions=await this.db.$transaction(async tx=>{
        const rows=await tx.$queryRaw<Array<{id:string;actorId:string;orderId:string;revision:number}>>`
          SELECT s.id, o."createdById" AS "actorId", o.id AS "orderId", s.revision
          FROM "JobCreationSession" s JOIN "JobPurchaseOrder" o ON o.id=s."orderId"
          WHERE s."templateId" IS NOT NULL AND s."jobId" IS NULL AND s."templateIssue" IS NULL AND s.phase='JOB'
            AND o.status='PAID' AND o."fulfilledAt" IS NULL AND o."creationSessionId"=s.id AND o."companyId"=s."companyId"
            AND (s."templateNextAttemptAt" IS NULL OR s."templateNextAttemptAt"<=NOW())
          ORDER BY s."templateNextAttemptAt" NULLS FIRST, s."updatedAt"
          LIMIT 10 FOR UPDATE OF s SKIP LOCKED`;
        await tx.jobCreationSession.updateMany({where:{id:{in:rows.map(row=>row.id)}},data:{templateNextAttemptAt:new Date(Date.now()+30000)}});
        return rows;
      });
      for(const row of sessions){
        try{
          const actor=await this.db.user.findUnique({where:{id:row.actorId},select:{id:true,role:true,fullName:true,email:true,isBanned:true,anonymizedAt:true}});
          if(!actor||actor.isBanned||actor.anonymizedAt||!['RECRUITER','SUPER_ADMIN'].includes(actor.role))throw new ForbiddenException();
          await flow.publishTemplate(actor,row.id);
        }catch(error){
          if(error instanceof ForbiddenException){
            await this.db.jobCreationSession.updateMany({
              where:{id:row.id,revision:row.revision,jobId:null,templateIssue:null,orderId:row.orderId},
              data:{templateIssue:'JOB_TEMPLATE_REVIEW_REQUIRED',templateNextAttemptAt:null,revision:{increment:1}},
            });
          }else this.logger.warn('Paid template publication will retry: '+row.id);
        }
      }
    }finally{this.publishingTemplates=false;}
  }
  async tick(){
    if(this.working)return;this.working=true;
    try{
      if(this.provider.configured||this.provider.available){
        const orders=await this.db.$transaction(async tx=>{
          const rows=await tx.$queryRaw<Array<{id:string}>>`
            SELECT o.id FROM "JobPurchaseOrder" o
            WHERE o.amount>0 AND o.status IN ('PENDING','REVIEW','EXPIRED','CANCELLED','FAILED')
              AND (o.provider=${this.provider.name} OR (o.provider IS NULL AND EXISTS
                (SELECT 1 FROM "OperationKey" k WHERE k.scope='job-payment-session' AND k.key=o.id)))
              AND (o."nextReconcileAt" IS NULL OR o."nextReconcileAt"<NOW())
            ORDER BY o."nextReconcileAt" NULLS FIRST,o."createdAt" LIMIT 20 FOR UPDATE SKIP LOCKED`;
          await tx.jobPurchaseOrder.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:{nextReconcileAt:new Date(Date.now()+3600000)}});
          return rows;
        });
        // At most two outbound status calls per process, independently of webhook delivery.
        for(let i=0;i<orders.length;i+=2)await Promise.all(orders.slice(i,i+2).map(async order=>{
          try{await this.commerce.settle(this.provider.name,await this.provider.queryStatus(order.id));}
          catch{this.logger.warn('Payment status not yet reconciled: '+order.id);}
        }));
      }
      if(hrFlowEnabled()&&Date.now()-this.lastCleanup>=3600000){this.lastCleanup=Date.now();await this.cleanupOrphans();}
    }finally{this.working=false;}
  }
  async cleanupOrphans(){
    const retired=await this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{id:string;fileKey:string}>>`
        SELECT d.id,d."fileKey" FROM "CompanyProfileDocument" d
        WHERE d."companyId" IS NULL AND (d."retiredAt" IS NOT NULL OR d."createdAt"<NOW()-INTERVAL '7 days')
          AND NOT EXISTS(SELECT 1 FROM "Company" c WHERE c."profileDocumentId"=d.id)
          AND NOT EXISTS(SELECT 1 FROM "RecruiterOnboarding" r
            WHERE r."companyDraft"->>'profileDocumentId'=d.id OR r."companyDraft"->>'logoAssetId'=d.id)
        ORDER BY d."createdAt" LIMIT 20 FOR UPDATE SKIP LOCKED`;
      await tx.companyProfileDocument.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:{retiredAt:new Date()}});
      return rows;
    });
    for(const row of retired){
      // Tombstones survive storage failures and are retried; active references never enter this set.
      await this.storage.delete(row.fileKey);
      await this.db.companyProfileDocument.deleteMany({where:{id:row.id,retiredAt:{not:null},companyId:null}});
    }
    return retired.length;
  }
}
