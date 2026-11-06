import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { OperationsService } from '../benefits/operations.service';
import { BenefitsService } from '../benefits/benefits.service';
import { JobCommerceService } from '../benefits/job-commerce.service';
import { JobPaymentProvider } from '../benefits/job-payment.provider';
import { RecruiterOnboardingService } from '../benefits/recruiter-onboarding.service';
import { JobsService } from '../jobs/jobs.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { HrFlowService } from '../hr-flow/hr-flow.service';
import { AuthUser } from '../common/auth.decorators';

// A real database/storage smoke with no committed user, company, order or vacancy.
// No payment gateway, message, email, search publication or Tara calls are made.
async function main(){
 const expected=process.argv.find(v=>v.startsWith('--expected-database='))?.slice(20),url=new URL(process.env.DATABASE_URL??'');
 if(process.env.HR_FLOW_MARKET!=='id'||process.env.HR_CREATION_V2_ENABLED!=='true'||!expected||decodeURIComponent(url.pathname.slice(1))!==expected)throw Error('Explicit active Indonesia deployment and matching expected database required');
 const db=new PrismaClient(),storage=new StorageService(new ConfigService()),keys:string[]=[],rollback=Symbol('smoke rollback');let checks=0,fixtureUserId='';
 const proxyStorage=new Proxy(storage,{get(target,key){if(key==='putObject')return async(k:string,b:Buffer,t:string)=>{keys.push(k);return target.putObject(k,b,t);};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
 try{
  try{await db.$transaction(async tx=>{
   const adapter=new Proxy(tx,{get(target,key){if(key==='$transaction')return(fn:Function)=>fn(tx);return(target as any)[key];}}) as any;
   const user=await tx.user.create({data:{role:'RECRUITER',fullName:'HR deployment smoke '+randomUUID()}});fixtureUserId=user.id;
   const actor:AuthUser={id:user.id,role:'RECRUITER',fullName:user.fullName,isBanned:false,email:null};
   const groups=await tx.businessIndustryGroup.findMany({where:{archivedAt:null,taxonomy:{active:true}},take:2});assert.equal(groups.length,2);checks++;
   const city=await tx.city.findFirstOrThrow({where:{archivedAt:null,kind:'CITY',province:{country:{iso2:'ID'}}}});
   const company=await tx.company.create({data:{name:'Deployment smoke '+randomUUID(),slug:'deployment-smoke-'+randomUUID(),description:'A temporary, uncommitted deployment verification company.',cityId:city.id,size:'SIZE_1_10',industryGroups:{connect:groups.map(g=>({id:g.id}))},members:{create:{userId:user.id,role:'OWNER'}}}});
   const ops=new OperationsService(adapter),benefits=new BenefitsService(adapter,ops),commerce=new JobCommerceService(adapter,benefits,ops,new JobPaymentProvider()),search:any={syncJob:async()=>{},enabled:false};
   const companies=new CompaniesService(adapter,proxyStorage,{} as any,{} as any,new ConfigService(),search),onboarding=new RecruiterOnboardingService(adapter,benefits,proxyStorage);
   const jobs=new JobsService(adapter,companies,new MatchingService(adapter),{create:async()=>{throw Error('Unexpected notification');}} as any,search,{announceJob:async()=>{throw Error('Unexpected announcement');}} as any,undefined,benefits,undefined,undefined,onboarding);
   jobs.creationPublished=async()=>{};
   const flow=new HrFlowService(adapter,proxyStorage,jobs,benefits,ops,commerce);
   const bytes=Buffer.from('%PDF-1.4\n% private deployment verification\n%%EOF');
   const doc=await flow.upload(actor,{buffer:bytes,size:bytes.length,originalname:'deployment-check.pdf',mimetype:'application/pdf'} as Express.Multer.File);
   const document=await flow.document(actor,doc.id,true);assert.ok(document.downloadUrl);checks++;
   const signed=await fetch(document.downloadUrl!,{signal:AbortSignal.timeout(15000)});assert.equal(signed.status,200);assert.equal(Buffer.from(await signed.arrayBuffer()).equals(bytes),true);checks+=2;
   const unsigned=new URL(document.downloadUrl!);unsigned.search='';assert.equal((await fetch(unsigned,{signal:AbortSignal.timeout(15000)})).status,403);checks++;
   const session=await flow.create(actor,company.id,randomUUID()),order=await commerce.create(actor,{creationSessionId:session.id,code:'FREE',intent:'PURCHASE'},randomUUID());assert.equal(order.status,'PAID');assert.equal(order.amount,0);checks+=2;
   const current=await flow.get(actor,session.id),saved=await flow.patch(actor,session.id,{revision:current.revision,draft:{title:'Principal deployment verification role',description:'Temporary job content for transaction verification, never published publicly.',positionEntryMode:'MANUAL',workMode:'REMOTE',seniorityLevelCode:'L6',experienceRangeMin:3,experienceRangeMax:null,responsibilities:['Coordinate project delivery'],kpis:['Display-only outcome'],specificExpectations:'Display-only optional context'}});
   const key=randomUUID(),published=await flow.publish(actor,session.id,saved.revision,key);assert.equal((await flow.publish(actor,session.id,saved.revision,key)).jobId,published.jobId);checks++;
   const result=await tx.jobPost.findUniqueOrThrow({where:{id:published.jobId}});assert.equal(result.status,'PUBLISHED');assert.equal(result.experienceRangeSource,'EMPLOYER_ADJUSTED');assert.equal(result.seniorityYearsMin,10);assert.equal(result.experienceRangeMin,3);assert.equal(result.kpis.length,1);checks+=5;
   assert.equal(await tx.jobPost.count({where:{companyId:company.id}}),1);checks++;
   throw rollback;
  },{maxWait:15000,timeout:90000});}catch(e){if(e!==rollback)throw e;}
  assert.equal(await db.user.findUnique({where:{id:fixtureUserId}}),null);checks++;
  console.log(JSON.stringify({checks,databaseAndPublicationRolledBack:true,privateStorageVerified:true,livePaymentTransactions:0,externalMessages:0}));
 }finally{for(const key of keys)await storage.delete(key);await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
