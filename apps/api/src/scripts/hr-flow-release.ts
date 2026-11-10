import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { installBusinessCatalog } from '../catalogs/business-catalog.backfill';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { VacancyTasksService } from '../matching/vacancy-tasks.service';
import { VACANCY_TASK_VERSION } from '../matching/vacancy-tasks';

/** Explicit Indonesian release tool, never called by application bootstrap. */
async function main(){
 const expected=process.argv.find(v=>v.startsWith('--expected-database='))?.slice(20),url=new URL(process.env.DATABASE_URL??'');
 if(process.env.HR_FLOW_MARKET!=='id'||!expected||decodeURIComponent(url.pathname.slice(1))!==expected)throw Error('Explicit Indonesia market and matching --expected-database are required');
 const db=new PrismaClient(),apply=process.argv.includes('--apply');
 try{
  const fingerprint=async()=>{
   const result:Record<string,unknown>={};
   for(const table of ['JobTitle','JobFamily','ResumeVersion','Application','ApplicationRecruiterEvaluation']){
    result[table]=await db.$queryRawUnsafe(`SELECT COUNT(*)::int count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) digest FROM "${table}" t`);
   }return result;
  };
  const before=await fingerprint(),report=await installBusinessCatalog(db,!apply);
  if(apply)await db.$executeRaw`INSERT INTO "_CompanyIndustryGroups" ("A","B") SELECT c."industryGroupId",c.id FROM "Company" c WHERE c."industryGroupId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "_CompanyIndustryGroups" x WHERE x."B"=c.id) ON CONFLICT DO NOTHING`;
  const after=await fingerprint();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical/profession data changed unexpectedly');
  let tasks:unknown=null;
  if(process.argv.includes('--tasks')){
   const relations=new OccupationRelationsService(db as any),service=new VacancyTasksService(db as any,relations);
   const jobs=await db.jobPost.findMany({where:{status:'PUBLISHED'},select:{id:true,jobTitleId:true,description:true,responsibilities:true,updatedAt:true},orderBy:{id:'asc'}});
   const changed=jobs.filter(job=>(service.project({...job,responsibilities:[]}).keys??[]).join('|')!==(service.project(job).keys??[]).join('|')).map(job=>job.id);
   let processed=0;
   if(apply){if(VACANCY_TASK_VERSION!=='vacancy-tasks-v4')throw Error('Explicit v4 task version required');for(let i=0;i<10000;i++){const n=await service.refresh(100);processed+=n;if(!n)break;}}
   tasks={version:VACANCY_TASK_VERSION,jobs:jobs.length,changedByResponsibilities:changed,processed};
  }
  console.log(JSON.stringify({dryRun:!apply,report,history:before,historyPreserved:true,tasks,checksum:createHash('sha256').update(JSON.stringify(report)).digest('hex')},null,2));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
