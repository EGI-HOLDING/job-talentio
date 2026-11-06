import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeIntentService, intentJobScope } from './employee-intent.service';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { OccupationRelationsService } from './occupation-relations.service';
import type { CandidateCache } from '../common/candidate-cache';

async function main(){
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5434'&&['/talentio_mapping_local_20261103','/talentio_business_catalog_20261105'].includes(url.pathname),'Prepared local copy only');

  const db=new PrismaService(),prefix='practical-it-'+Date.now(),profileId=prefix+'-profile',userId=prefix+'-user',companyId=prefix+'-company';
  const memory=new Map<string,Promise<unknown>>();let computations=0;
  const cache={version:async()=> 'test-epoch',ranked:async(key:unknown,load:()=>Promise<unknown>)=>{const k=JSON.stringify(key);if(!memory.has(k)){computations++;memory.set(k,load());}return memory.get(k);}} as unknown as CandidateCache;
  const catalog=new EmployeeCatalogSnapshot(db,undefined,new OccupationRelationsService(db));
  const service=new EmployeeIntentService(db,catalog,cache);
  const report:any={};
  try{
    const {index}=await catalog.get(true),names=['Sales Manager','Chef','Backend Developer','Accountant','Mechanical Engineer'];
    const roles=names.map(name=>index.resolve(name)!);assert.ok(roles.every(Boolean));
    const countries=await db.country.findMany({select:{id:true,iso2:true}}),home=countries.find(c=>c.iso2==='ID')!.id,abroad=countries.find(c=>c.iso2==='UZ')!.id;
    await db.company.create({data:{id:companyId,name:prefix,slug:prefix}});
    await db.user.create({data:{id:userId,email:prefix+'@example.test',fullName:'Integration',role:'EMPLOYEE',employeeProfile:{create:{id:profileId,matchingPreferencesReviewed:true,desiredRoles:{create:roles.map(jobTitleId=>({jobTitleId}))}}}}});
    const create=(suffix:string,role:number,extra:any={})=>db.jobPost.create({data:{id:prefix+'-'+suffix,title:suffix,jobTitleId:roles[role],companyId,description:'Integration responsibilities',status:'PUBLISHED',publishedAt:new Date(),countryId:home,currency:'IDR',salaryPeriod:'MONTHLY',salaryMin:200,salaryMax:300,...extra}});
    const [a,b,unknown,wrong,low]=await Promise.all([create('main-a',0),create('main-b',1),create('unknown',2,{salaryMin:null,salaryMax:null}),create('abroad',3,{countryId:abroad}),create('below',4,{salaryMin:100,salaryMax:200})]);

    let started=performance.now();const baseline=await service.recommend(profileId,1,1000);report.baselineMs=performance.now()-started;

    const noFilters=await service.recommend(profileId,1,1000);
    assert.deepEqual(noFilters.items.map(r=>r.job.id),baseline.items.map(r=>r.job.id),'No active filters preserve existing IDs and order');
    await db.employeeProfile.update({where:{id:profileId},data:{residenceCountryId:home,desiredSalaryMin:'257.50',desiredSalaryCurrency:'IDR',desiredSalaryPeriod:'MONTHLY'}});
    const context=await service.context(profileId);assert.equal(context.preferences.selectedIds.length,5);assert.equal(context.evidenceState,'REQUIRED');
    started=performance.now();const main=await service.recommend(profileId,1,1000,context);report.coldMs=performance.now()-started;
    const before=computations;started=performance.now();const unverified=await service.recommend(profileId,1,1000,context,'salary-unverified');report.warmOtherFeedMs=performance.now()-started;
    assert.equal(computations,before,'Both feeds share one ranking computation');
    const own=(rows:typeof main.items)=>rows.filter(r=>r.job.id.startsWith(prefix)).map(r=>r.job.id);
    assert.deepEqual(new Set(own(main.items)),new Set([a.id,b.id]));assert.deepEqual(own(unverified.items),[unknown.id]);
    assert.equal(main.salaryUnverifiedTotal,unverified.total);assert.equal(main.total,unverified.mainTotal);
    assert.ok(main.items.every(r=>r.matchInsights.practicalFit?.group==='MAIN'));
    assert.ok(unverified.items.every(r=>r.matchInsights.practicalFit?.group==='SALARY_UNVERIFIED'));
    assert.deepEqual(own(main.items),baseline.items.filter(r=>[a.id,b.id].includes(r.job.id)).map(r=>r.job.id),'Partitioning preserves original relative ranking');
    const scoped=await db.jobPost.findMany({where:intentJobScope(context),select:{id:true}});
    const scored=await service.scoreJobsForProfile(profileId,scoped.map(j=>j.id),context);
    assert.ok(scored.has(a.id)&&!scored.has(unknown.id)&&!scored.has(low.id)&&!scored.has(wrong.id),'Best Match uses main group only');
    assert.equal((await service.explain(profileId,unknown.id)).practicalFit?.group,'SALARY_UNVERIFIED');
    assert.equal((await service.explain(profileId,low.id)).practicalFit?.group,'EXCLUDED');
    // A warm cached rank cannot bypass salary/country changes, closing or applications.
    await db.jobPost.update({where:{id:a.id},data:{salaryMin:100,salaryMax:200}});
    assert.ok(!(await service.recommend(profileId,1,1000,context)).items.some(r=>r.job.id===a.id));
    await db.jobPost.update({where:{id:b.id},data:{countryId:abroad}});
    assert.ok(!(await service.recommend(profileId,1,1000,context)).items.some(r=>r.job.id===b.id));
    await db.jobPost.update({where:{id:unknown.id},data:{status:'CLOSED'}});
    assert.ok(!(await service.recommend(profileId,1,1000,context,'salary-unverified')).items.some(r=>r.job.id===unknown.id));
    await db.application.create({data:{profileId,jobPostId:wrong.id}});
    const exploration=await service.explore(profileId,1,1000);
    assert.ok(exploration.items.every(r=>r.matchScore===null));assert.ok(!exploration.items.some(r=>[wrong.id,unknown.id].includes(r.job.id)));
    await db.employeeProfile.update({where:{id:profileId},data:{preferredCountries:{set:[{id:abroad}]},desiredSalaryMin:null}});
    const changed=await service.recommend(profileId,1,1000);
    assert.ok(changed.items.some(r=>r.job.id===b.id),'Country destinations override residence; preference edit changes cache context');
    const p1=await service.recommend(profileId,1,1),p2=await service.recommend(profileId,2,1);
    assert.equal(p1.rankingRevision,p2.rankingRevision);assert.ok(!p1.items.some(r=>p2.items.some(s=>s.job.id===r.job.id))||p1.total<=1);
    report.baselineTotal=baseline.total;report.mainTotal=main.total;report.unverifiedTotal=unverified.total;report.fixtures=5;report.passed=true;
    fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/employee-practical-local-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await db.user.deleteMany({where:{id:userId}});await db.company.deleteMany({where:{id:companyId}});await db.$disconnect();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
