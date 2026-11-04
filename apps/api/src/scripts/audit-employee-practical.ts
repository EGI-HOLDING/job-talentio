import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { VacancyTasksService } from '../matching/vacancy-tasks.service';
import { EmployeeIntentService } from '../matching/employee-intent.service';
import { practicalFit, EMPLOYEE_PRACTICAL_POLICY_VERSION } from '../matching/employee-practical-policy';
import { liveJobWhere } from '../benefits/benefit-policy';

/** Read-only inventory comparison; never changes preferences, catalog or evidence. */
async function main(){
  const db=new PrismaService(),cache=new CandidateCache(new ConfigService(process.env));
  const relations=new OccupationRelationsService(db),catalog=new EmployeeCatalogSnapshot(db,cache,relations);
  const service=new EmployeeIntentService(db,catalog,cache,new VacancyTasksService(db,relations));
  const rows:unknown[]=[];
  try{
    const profiles=await db.employeeProfile.findMany({select:{id:true}});
    for(const profile of profiles){
      process.env.EMPLOYEE_PRACTICAL_POLICY_ENABLED='false';
      const context=await service.context(profile.id);
      if(context.state!=='READY'){rows.push({profile:createHash('sha256').update(profile.id).digest('hex').slice(0,12),state:context.state});continue;}
      const before=await service.recommend(profile.id,1,100000,context);
      const started=Date.now();
      const next={...context,practicalEnabled:true,fingerprint:createHash('sha256').update(context.fingerprint+EMPLOYEE_PRACTICAL_POLICY_VERSION).digest('hex')};
      const main=await service.recommend(profile.id,1,100000,next);
      const unknown=await service.recommend(profile.id,1,100000,next,'salary-unverified');
      const jobs=await db.jobPost.findMany({where:{...liveJobWhere(),id:{in:before.items.map(r=>r.job.id)},applications:{none:{profileId:profile.id}}},select:{id:true,countryId:true,city:{select:{province:{select:{countryId:true}}}},salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true}});
      const fits=new Map(jobs.map(job=>[job.id,practicalFit(context.preferences,job)]));
      const ids=before.items.map(r=>r.job.id);
      assert.deepEqual(main.items.map(r=>r.job.id),ids.filter(id=>fits.get(id)?.group==='MAIN'));
      assert.deepEqual(unknown.items.map(r=>r.job.id),ids.filter(id=>fits.get(id)?.group==='SALARY_UNVERIFIED'));
      assert.equal(main.total,unknown.mainTotal);assert.equal(main.salaryUnverifiedTotal,unknown.total);
      rows.push({profile:createHash('sha256').update(profile.id).digest('hex').slice(0,12),before:before.total,main:main.total,salaryUnverified:unknown.total,excluded:before.total-main.total-unknown.total,comparisonMs:Date.now()-started});
    }
    console.log(JSON.stringify({policy:EMPLOYEE_PRACTICAL_POLICY_VERSION,readOnly:true,profiles:rows.length,rows}));
  }finally{cache.onModuleDestroy();await db.$disconnect();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
