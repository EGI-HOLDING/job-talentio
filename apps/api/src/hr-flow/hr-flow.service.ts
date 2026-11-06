import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jobPostSchema } from '@job-talentio/shared';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { StorageService } from '../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { BenefitsService } from '../benefits/benefits.service';
import { OperationsService } from '../benefits/operations.service';
import { JobCommerceService } from '../benefits/job-commerce.service';
import { HR_PUBLICATION_LOCK } from '../benefits/benefit-policy';
import { parseDto } from '../common/utils';
import { assertHrFlowEnabled } from './hr-flow.policy';
import { resolveSeniority } from '../catalogs/business-catalog';
import { isDocxPackage } from './document-upload';

@Injectable()
export class HrFlowService {
  private readonly logger=new Logger(HrFlowService.name);
  constructor(private db:PrismaService,private storage:StorageService,private jobs:JobsService,private benefits:BenefitsService,private operations:OperationsService,private commerce:JobCommerceService){}

  async get(user:AuthUser,id:string,tx:Prisma.TransactionClient=this.db){
    assertHrFlowEnabled();
    const session=await tx.jobCreationSession.findUnique({where:{id}});
    if(!session)throw new NotFoundException('Draft not found');
    const company=await this.benefits.member(user,session.companyId,tx);
    const order=session.orderId?await tx.jobPurchaseOrder.findUnique({where:{id:session.orderId}}):null;
    return {...session,company,order};
  }
  async list(user:AuthUser,companyId:string){
    assertHrFlowEnabled();await this.benefits.member(user,companyId);
    const sessions=await this.db.jobCreationSession.findMany({where:{companyId,jobId:null},orderBy:{updatedAt:'desc'}});
    const orders=await this.db.jobPurchaseOrder.findMany({where:{id:{in:sessions.flatMap(s=>s.orderId?[s.orderId]:[])},companyId},select:{id:true,code:true,status:true}});
    const byId=new Map(orders.map(o=>[o.id,o]));return sessions.map(row=>({...row,order:row.orderId?byId.get(row.orderId):null}));
  }
  async create(user:AuthUser,companyId:string,key?:string){
    assertHrFlowEnabled();
    return (await this.operations.transaction('hr-create:'+user.id,key,{companyId},async tx=>{
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
      await this.benefits.member(user,companyId,tx);
      const session=await tx.jobCreationSession.create({data:{companyId,createdById:user.id}});
      await tx.recruiterOnboarding.updateMany({where:{userId:user.id,status:'IN_PROGRESS',companyId},data:{creationSessionId:session.id,flowVersion:2,phase:'PACKAGE',revision:{increment:1}}});
      return session;
    })).value;
  }
  async patch(user:AuthUser,id:string,input:{revision:number;draft?:Record<string,unknown>;phase?:string;packageCode?:'FREE'|'STANDARD'|'PREMIUM'}){
    return this.db.$transaction(async tx=>{
      const before=await this.get(user,id,tx);
      if(before.jobId)throw new ConflictException('This draft is already published');
      if(input.draft&&before.order?.status!=='PAID')throw new ConflictException('Confirm checkout before editing the job');
      if(input.phase==='JOB'&&before.order?.status!=='PAID')throw new ConflictException('Confirm checkout first');
      if(input.packageCode&&before.order?.status==='PAID'&&input.packageCode!==before.order.code)throw new ConflictException('Package already confirmed');
      let draft=input.draft;
      if(draft){
        const previous=before.draft as Record<string,unknown>;
        const snapshot=draft.seniorityLevelCode&&(draft.seniorityLevelCode!==previous.seniorityLevelCode||!previous._senioritySnapshot)?await resolveSeniority(tx,{seniorityLevelCode:draft.seniorityLevelCode}):draft.seniorityLevelCode?previous._senioritySnapshot:null;
        draft={...draft,_senioritySnapshot:snapshot,_selectedPackageCode:(before.draft as Record<string,unknown>)._selectedPackageCode??null};
      }
      if(input.packageCode)draft={...(draft??before.draft as Record<string,unknown>),_selectedPackageCode:input.packageCode};
      const changed=await tx.jobCreationSession.updateMany({where:{id,revision:input.revision,jobId:null},data:{draft:draft as Prisma.InputJsonValue|undefined,phase:input.phase,revision:{increment:1}}});
      if(!changed.count)throw new ConflictException('Draft changed in another tab. Refresh before saving.');
      return this.get(user,id,tx);
    });
  }
  async publish(user:AuthUser,id:string,revision:number,key?:string){
    assertHrFlowEnabled();
    const result=await this.operations.transaction('hr-publish:'+user.id,key,{id,revision},async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock_shared(${HR_PUBLICATION_LOCK}::bigint)`);
      const initial=await this.get(user,id,tx);
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${initial.companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "JobCreationSession" WHERE id=${id} FOR UPDATE`;
      const session=await this.get(user,id,tx);
      if(session.jobId)return {jobId:session.jobId,created:false};
      if(session.revision!==revision)throw new ConflictException('Draft changed. Review before publishing.');
      const order=session.order;
      if(!order||order.status!=='PAID'||order.creationSessionId!==id||order.companyId!==session.companyId||order.fulfilledAt)throw new ConflictException('A confirmed unused package is required');
      const raw=session.draft as Record<string,unknown>;
      const data=parseDto(jobPostSchema,{...raw,responsibilities:(raw.responsibilities as string[]|undefined)?.filter(v=>v.trim()),kpis:(raw.kpis as string[]|undefined)?.filter(v=>v.trim())});
      const snapshot=raw._senioritySnapshot as {seniorityVersion?:string}|null;
      const job=await this.jobs.createInside(user,session.companyId,{...data,isAnonymous:false},tx,snapshot?.seniorityVersion);
      if(!job)throw new BadRequestException('Could not create the job');
      await this.jobs.assertCreationPublication(user,job.id,tx);
      await this.benefits.applyPurchase(user,job.id,order.code,'PURCHASE',{version:order.policyVersion,settings:order.policySnapshot as never},tx);
      await this.benefits.publish(job.id,tx);
      await tx.jobPost.update({where:{id:job.id},data:{status:'PUBLISHED',publishedAt:new Date()}});
      await tx.jobPurchaseOrder.update({where:{id:order.id},data:{jobId:job.id,jobTitle:job.title,fulfilledAt:new Date()}});
      await tx.jobCreationSession.update({where:{id},data:{jobId:job.id,phase:'PUBLISHED',revision:{increment:1}}});
      await tx.recruiterOnboarding.updateMany({where:{userId:user.id,status:'IN_PROGRESS',companyId:session.companyId},data:{status:'COMPLETE',step:3,phase:'COMPLETE',creationSessionId:id,jobId:job.id,completedAt:new Date(),revision:{increment:1}}});
      await tx.auditLog.create({data:{actorId:user.id,action:'HR_CREATION_PUBLISHED',entityType:'JobCreationSession',entityId:id,metadata:{jobId:job.id,orderId:order.id}}});
      return {jobId:job.id,created:true};
    });
    if(result.value.created&&!result.replayed)await this.jobs.creationPublished(result.value.jobId).catch(()=>this.logger.warn('Publication committed; follow-up synchronization will retry: '+result.value.jobId));
    return {jobId:result.value.jobId};
  }
  async upload(user:AuthUser,file:Express.Multer.File,kind:'DOCUMENT'|'LOGO'='DOCUMENT'){
    assertHrFlowEnabled();
    if(!file?.buffer?.length||file.size>5*1024*1024)throw new BadRequestException('PDF or DOCX, maximum 5 MB');
    const pdf=/\.pdf$/i.test(file.originalname)&&file.mimetype==='application/pdf'&&file.buffer.subarray(0,5).toString()==='%PDF-';
    const docx=/\.docx$/i.test(file.originalname)&&file.mimetype==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'&&isDocxPackage(file.buffer);
    const logo=kind==='LOGO'&&(/\.png$/i.test(file.originalname)&&file.mimetype==='image/png'&&file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||/\.jpe?g$/i.test(file.originalname)&&file.mimetype==='image/jpeg'&&file.buffer[0]===255&&file.buffer[1]===216||/\.webp$/i.test(file.originalname)&&file.mimetype==='image/webp'&&file.buffer.subarray(8,12).toString()==='WEBP');
    if(kind==='DOCUMENT'?!pdf&&!docx:!logo)throw new BadRequestException('File extension, type and signature do not match');
    const filename=file.originalname.replace(/[\\/\x00-\x1f]/g,'_').slice(0,200);
    const key='company-profiles/'+user.id+'/'+randomUUID()+(kind==='LOGO'?'.'+file.mimetype.split('/')[1]:pdf?'.pdf':'.docx');
    await this.storage.putObject(key,file.buffer,file.mimetype);
    try{
      const row=await this.db.companyProfileDocument.create({data:{ownerId:user.id,kind,fileKey:key,filename,contentType:file.mimetype,sizeBytes:file.size,checksum:createHash('sha256').update(file.buffer).digest('hex')}});
      return {id:row.id,filename:row.filename,sizeBytes:row.sizeBytes,status:'UPLOADED'};
    }catch(error){await this.storage.delete(key);throw error;}
  }
  async document(user:AuthUser,id:string,download=false){
    assertHrFlowEnabled();
    const row=await this.db.companyProfileDocument.findUnique({where:{id}});
    if(!row||row.retiredAt)throw new NotFoundException('Document not found');
    if(row.companyId)await this.benefits.member(user,row.companyId);
    else if(row.ownerId!==user.id)throw new ForbiddenException();
    return {id:row.id,filename:row.filename,sizeBytes:row.sizeBytes,status:'UPLOADED',...(download?{downloadUrl:await this.storage.getPresignedGetUrl(row.fileKey,300,{filename:row.filename,contentType:row.contentType})}:{})};
  }
}
