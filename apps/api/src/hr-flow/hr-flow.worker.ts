import { Injectable,Logger,OnModuleInit,OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JobCommerceService } from '../benefits/job-commerce.service';
import { JobPaymentProvider } from '../benefits/job-payment.provider';
import { hrFlowEnabled } from './hr-flow.policy';

@Injectable()
export class HrFlowWorker implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private working=false;
  private lastCleanup=0;
  private readonly logger=new Logger(HrFlowWorker.name);
  constructor(private db:PrismaService,private storage:StorageService,private commerce:JobCommerceService,private provider:JobPaymentProvider){}
  onModuleInit(){
    if(!hrFlowEnabled()&&!this.provider.configured&&!this.provider.available)return;
    this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('HR maintenance will retry')),60000);this.timer.unref();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
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
