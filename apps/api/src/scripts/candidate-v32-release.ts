import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EMPLOYEE_INTENT_VERSION } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { VacancyTasksService } from '../matching/vacancy-tasks.service';
import { EmployeeIntentService } from '../matching/employee-intent.service';
import { EmployeeMatchingService } from '../matching/employee-matching.service';

/** Explicit release verification. Existing text choices are linked only by unique official labels/aliases. */
async function main(){
 const expected=process.argv.find(a=>a.startsWith('--expected-database='))?.slice(20),url=new URL(process.env.DATABASE_URL??'');
 if(!expected||decodeURIComponent(url.pathname.slice(1))!==expected)throw Error('Explicit matching --expected-database required');
 const apply=process.argv.includes('--apply-preferences'),db=new PrismaService(),cache=new CandidateCache(new ConfigService(process.env));
 const relations=new OccupationRelationsService(db,cache),catalog=new EmployeeCatalogSnapshot(db,cache,relations),tasks=new VacancyTasksService(db,relations);
 const engine=new EmployeeIntentService(db,catalog,cache,tasks),facade=new EmployeeMatchingService(db,engine);
 try{
  const history=async()=>{const rows:unknown[]=[];for(const table of ['JobTitle','JobFamily','ResumeVersion','Application','ApplicationRecruiterEvaluation'])rows.push(await db.$queryRawUnsafe(`SELECT COUNT(*)::int n,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) digest FROM "${table}" t`));return rows;};
  const before=await history(),snapshot=await catalog.get(true);
  const profiles=await db.employeeProfile.findMany({include:{desiredRoles:true},orderBy:{id:'asc'}});
  let resolvableProfiles=0,linkedProfiles=0;
  for(const p of profiles){
   if(p.desiredRoles.length)continue;
   const texts=p.desiredPositions.length?p.desiredPositions:p.desiredPosition?[p.desiredPosition]:[];
   const ids=[...new Set(texts.map(t=>snapshot.index.resolve(t)).filter((id):id is string=>!!id))];
   if(!ids.length||ids.length>10)continue;
   resolvableProfiles++;
   if(apply)await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE id=${p.id} FOR UPDATE`;
    const current=await tx.employeeProfile.findUniqueOrThrow({where:{id:p.id},include:{desiredRoles:true}});
    if(current.desiredRoles.length||JSON.stringify([current.desiredPositions,current.desiredPosition])!==JSON.stringify([p.desiredPositions,p.desiredPosition]))return;
    await tx.employeeProfile.update({where:{id:p.id},data:{matchingPreferencesReviewed:texts.every(t=>!!snapshot.index.resolve(t)),desiredRoles:{create:ids.map(jobTitleId=>({jobTitleId}))}}});linkedProfiles++;
   });
  }
  if(apply)await cache.invalidateAndWait();
  const rows:unknown[]=[],states:Record<string,number>={};
  for(const p of profiles){
   const result=await facade.recommend(p.id,1,3),unknown=await facade.recommend(p.id,1,3,'salary-unverified');
   assert.equal(result.version,EMPLOYEE_INTENT_VERSION);assert.equal(unknown.version,EMPLOYEE_INTENT_VERSION);
   assert.ok(result.items.every(i=>i.eligibility.eligible&&['EXACT','RELATED'].includes(i.recommendationType)&&i.matchInsights.practicalFit?.group==='MAIN'));
   assert.ok(unknown.items.every(i=>i.eligibility.eligible&&i.matchInsights.practicalFit?.group==='SALARY_UNVERIFIED'));
   states[result.state]=(states[result.state]??0)+1;
   rows.push({profile:createHash('sha256').update(p.id).digest('hex').slice(0,12),state:result.state,evidence:result.evidenceState,main:result.total,salaryUnverified:unknown.total});
  }
  assert.deepEqual(await history(),before,'Historical CV/application/HR evidence and profession catalog must remain unchanged');
  console.log(JSON.stringify({engine:EMPLOYEE_INTENT_VERSION,apply,profiles:profiles.length,resolvableProfiles,linkedProfiles,states,historyPreserved:true,rows}));
 }finally{cache.onModuleDestroy();await db.$disconnect();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
