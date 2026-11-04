import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeIntentService } from './employee-intent.service';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { OccupationRelationsService } from './occupation-relations.service';
import { VacancyTasksService } from './vacancy-tasks.service';
import { FEATURED_COMPANIES } from '../scripts/featured-company-carousel-manifest';

async function main() {
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='5434'&&url.pathname==='/talentio_mapping_local_20261103','Prepared local copy required');
  process.env.EMPLOYEE_RECOMMENDATION_V32_ENABLED='true';
  process.env.EMPLOYEE_INTENT_V3_MODE='enabled';
  process.env.EMPLOYEE_VACANCY_TASK_MODE='enabled';
  const db=new PrismaService(), prefix='vacancy-it-'+Date.now()+'-';
  const companyId=prefix+'company', userId=prefix+'user', profileId=prefix+'profile';
  const relations=new OccupationRelationsService(db);
  const catalog=new EmployeeCatalogSnapshot(db,undefined,relations);
  const tasks=new VacancyTasksService(db,relations);
  const service=new EmployeeIntentService(db,catalog,undefined,tasks);
  try {
    const {index}=await catalog.get(true);
    const positions=['Sales Manager','Chef','Backend Developer','Accountant','Mechanical Engineer'].map(name=>index.resolve(name));
    assert.ok(positions.every(Boolean));
    const target=index.resolve('Eksekutif Penjualan Area');
    assert.ok(target);
    const documented=FEATURED_COMPANIES.flatMap(row=>row.roles).find(role=>role.title==='Eksekutif Penjualan Area');
    assert.ok(documented);
    const responsibilities='Tanggung jawab utama\n'+documented.duties.map(duty=>'• '+duty).join('\n');
    const support='Responsibilities\n• Perform customers’ needs analysis\n• Negotiate sales contracts';
    await db.company.create({data:{id:companyId,name:'Vacancy task integration',slug:companyId}});
    await db.user.create({data:{id:userId,email:userId+'@example.test',fullName:'Integration candidate',role:'EMPLOYEE',employeeProfile:{create:{id:profileId,matchingPreferencesReviewed:true,desiredRoles:{create:positions.map(id=>({jobTitleId:id!}))}}}}});
    const post=(suffix:string,jobTitleId:string,description:string)=>db.jobPost.create({data:{id:prefix+suffix,title:'Integration '+suffix,jobTitleId,companyId,description,status:'PUBLISHED',publishedAt:new Date()}});
    const [related,unrelated,exact]=await Promise.all([post('related',target,responsibilities),post('unrelated',target,support),post('exact',positions[0]!,'Short text')]);
    while(await tasks.refresh()) { /* drain the bounded batches */ }
    const c=await service.context(profileId);
    assert.equal(c.preferences.selectedIds.length,5);
    assert.equal(c.evidenceState,'REQUIRED');
    assert.equal(c.vacancies?.decisions.get(related.id)?.eligibility.matchType,'RELATED');
    assert.ok(!c.vacancies?.decisions.has(unrelated.id),'postings with the same title can have different eligibility');
    const result=await service.recommend(profileId,1,200,c);
    const exactIndex=result.items.findIndex(item=>item.job.id===exact.id);
    const relatedIndex=result.items.findIndex(item=>item.job.id===related.id);
    assert.ok(exactIndex>=0&&relatedIndex>exactIndex);
    assert.equal(result.items[relatedIndex]?.matchScore,null);
    assert.ok(result.items[relatedIndex]?.matchInsights.relatedTasks?.length);
    assert.equal((await service.explain(profileId,related.id)).matchType,'RELATED');
    assert.ok((await service.scoreJobsForProfile(profileId,[related.id,unrelated.id],c)).has(related.id));
    await db.jobPost.update({where:{id:related.id},data:{description:support}});
    assert.ok(!(await service.recommend(profileId,1,200,c)).items.some(item=>item.job.id===related.id),'cached selection cannot survive a posting revision');
    while(await tasks.refresh()) { /* replace stale evidence */ }
    assert.equal((await service.explain(profileId,related.id)).state,'NO_ELIGIBLE_JOBS');
    await db.jobPost.update({where:{id:exact.id},data:{status:'CLOSED'}});
    await db.application.create({data:{profileId,jobPostId:unrelated.id}});
    const page=await service.explore(profileId,1,24);
    const next=await service.explore(profileId,2,24);
    assert.equal(page.rankingRevision,next.rankingRevision);
    assert.ok(page.items.every(item=>item.matchScore===null&&item.recommendationType==='EXPLORATION'));
    assert.ok([...page.items,...next.items].every(item=>![exact.id,unrelated.id].includes(item.job.id)));
    assert.ok(next.items.every(item=>!page.items.some(other=>other.job.id===item.job.id)));
    console.log('Vacancy task integration passed: role parity, five choices, exact first, missing CV, stale evidence, status, applied exclusion and exploration pagination');
  } finally {
    await db.user.deleteMany({where:{id:userId}});
    await db.company.deleteMany({where:{id:companyId}});
    await db.$disconnect();
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
