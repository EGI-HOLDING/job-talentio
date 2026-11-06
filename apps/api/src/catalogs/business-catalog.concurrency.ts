import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CompaniesService } from '../companies/companies.service';
import { JobsService } from '../jobs/jobs.service';
import { MatchingService } from '../matching/matching.service';
import { INDUSTRY_GROUPS,SENIORITY_LEVELS } from './business-catalog.data';
import type { AuthUser } from '../common/auth.decorators';
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5434'&&url.pathname==='/talentio_business_catalog_20261105');
 const db=new PrismaClient();let userId:string|undefined,companyId:string|undefined,assertions=0;
 try{
  const user=await db.user.create({data:{fullName:'Concurrency fixture',role:'RECRUITER'}});userId=user.id;
  const actor:AuthUser={id:user.id,email:null,fullName:user.fullName,role:'RECRUITER',isBanned:false};
  const group=INDUSTRY_GROUPS.find(row=>row.code==='TECHNOLOGY_DIGITAL')!;
  const industry=await db.industry.findFirstOrThrow({where:{slug:'it'}});
  const co=await db.company.create({data:{name:'Concurrent fixture '+randomUUID(),slug:'concurrent-'+randomUUID(),industryId:industry.id,industryGroupId:group.id,members:{create:{userId:user.id,role:'OWNER'}}}});companyId=co.id;
  const search:any={syncJob:async()=>{}};
  const companies=new CompaniesService(db as any,{} as any,{} as any,{} as any,new ConfigService(),search);
  const matching=new MatchingService(db as any);
  const jobs=new JobsService(db as any,companies,matching,{} as any,search,{} as any);
  for(let i=0;i<8;i++){
   await Promise.all([companies.update(actor,co.id,{industryGroupCode:'MANUFACTURING',industrySlug:''}),companies.update(actor,co.id,{industryGroupCode:'TECHNOLOGY_DIGITAL',industrySlug:'it'})]);
   const row=await db.company.findUniqueOrThrow({where:{id:co.id}});
   assert.ok(row.industryId===null&&row.industryGroupId?.endsWith('MANUFACTURING')||row.industryId===industry.id&&row.industryGroupId===group.id);assertions++;
  }
  const role=await db.jobTitle.findFirstOrThrow({where:{archivedAt:null,matchingApproved:true,canonicalRoleId:null}});
  const job=await jobs.create(actor,co.id,{title:role.name,jobTitleSlug:role.slug,description:'Concurrent update test with a genuine canonical role.',workMode:'REMOTE',seniorityLevelCode:'L4'});
  assert.ok(job);assertions++;
  for(let i=0;i<8;i++){
   const before=await db.jobPost.findUniqueOrThrow({where:{id:job!.id}});
   const result:PromiseSettledResult<unknown>[]=await Promise.allSettled(['L1','L6'].map(async(seniorityLevelCode):Promise<unknown>=>jobs.update(actor,job!.id,{expectedUpdatedAt:before.updatedAt.toISOString(),seniorityLevelCode})));
   assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.filter(row=>row.status==='rejected').length,1);assertions+=2;
   const after:{seniorityLevelCode:string|null;seniorityYearsMin:number|null;seniorityYearsMax:number|null}=await db.jobPost.findUniqueOrThrow({where:{id:job!.id}});
   const level=SENIORITY_LEVELS.find(row=>row.code===after.seniorityLevelCode)!;
   assert.equal(after.seniorityYearsMin,level.yearsMin);assert.equal(after.seniorityYearsMax,level.yearsMax);assertions+=2;
  }
  fs.writeFileSync('output/business-catalog/concurrency.json',JSON.stringify({assertions,companyRaces:8,jobRevisionRaces:8},null,2));
  console.log(JSON.stringify({suite:'business-catalog-concurrency',assertions,companyRaces:8,jobRevisionRaces:8}));
 }finally{
  if(companyId)await db.company.delete({where:{id:companyId}});
  if(userId)await db.user.delete({where:{id:userId}});
  await db.$disconnect();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
