import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeIntentService } from './employee-intent.service';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { OccupationRelationsService } from './occupation-relations.service';
import { VacancyTasksService } from './vacancy-tasks.service';
import { PositionGroupService } from './position-group.service';
import { employeeHierarchyMode } from './employee-hierarchy';

async function main() {
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(url.hostname==='127.0.0.1'&&url.port==='5434'&&/^\/talentio_selection_it_\d+$/.test(url.pathname),'Use a disposable selection database');
  const origin=new URL(process.env.SELECTION_LOCAL_API??'http://127.0.0.1:4097');
  assert.equal(origin.hostname,'127.0.0.1');
  const jwt=new JwtService({secret:process.env.JWT_SECRET});
  const db=new PrismaService(),prefix='selection-it-'+randomUUID(), companyId=prefix+'-company',userId=prefix+'-user',profileId=prefix+'-profile';
  const relations=new OccupationRelationsService(db);
  const catalog=new EmployeeCatalogSnapshot(db,undefined,relations);
  const tasks=new VacancyTasksService(db,relations);
  const groups=new PositionGroupService(db,relations);
  const service=new EmployeeIntentService(db,catalog,undefined,tasks,groups);
  let checks=0;
  const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;};
  try {
    const snapshot=await catalog.get(true);
    assert.ok('selectionRevision' in snapshot&&snapshot.selectionRevision,'Use an activated selection release on the disposable database');
    const desired=snapshot.index.resolve('Digital Media Designer');
    const graphic=snapshot.index.resolve('Graphic Designer');
    const chef=snapshot.index.resolve('Chef');
    const frontend=snapshot.index.resolve('Frontend Developer');
    const fullstack=snapshot.index.resolve('Full-stack Developer');
    assert.ok(desired&&graphic&&chef&&frontend&&fullstack&&desired!==graphic,'Resolve distinct catalog identities');
    await db.company.create({data:{id:companyId,name:'Selection integration fixture',slug:companyId}});
    const user=await db.user.create({data:{id:userId,email:userId+'@example.test',fullName:'Synthetic candidate',role:'EMPLOYEE',
      employeeProfile:{create:{id:profileId,matchingPreferencesReviewed:true,desiredRoles:{create:{jobTitleId:desired}}}}}});
    const token=await jwt.signAsync({sub:user.id,tv:user.tokenVersion},{expiresIn:300});
    const call=(route:string)=>fetch(new URL('/api'+route,origin),{headers:{Authorization:'Bearer '+token,'Accept-Language':'id'}});
    const api=async(route:string)=>{
      const response=await call(route);const body=await response.json();
      assert.equal(response.status,200,route+' '+JSON.stringify(body).slice(0,360));return body;
    };
    const posting=(suffix:string,jobTitleId:string,description:string,responsibilities:string[]=[])=>db.jobPost.create({data:{
      id:prefix+'-'+suffix,title:'Selection fixture '+suffix,companyId,jobTitleId,description,responsibilities,status:'PUBLISHED',publishedAt:new Date(),
    }});
    const [exact,related,negative,shortDescription]=await Promise.all([
      posting('exact',desired,'Produce digital content.'),
      posting('graphic',graphic,'Buat materi visual untuk publikasi di berbagai kanal.',
        ['Merancang aset visual untuk kampanye.','Mengembangkan konten digital untuk media sosial.','Menyunting foto untuk publikasi.']),
      posting('negative',chef,'Requirements: design graphics and develop digital content.',
        ['Prepare ingredients','Cook menu items']),
      posting('brief',graphic,'Join our team.'),
    ]);
    const strict=employeeHierarchyMode()==='strict';
    const misleading= strict?await Promise.all([
      posting('frontend',frontend,'Produce digital content.', ['Design graphics for publication', 'Develop digital content']),
      posting('fullstack',fullstack,'Produce digital content.', ['Design graphics for publication', 'Develop digital content']),
    ]):[];
    while(await tasks.refresh()) { /* consume bounded local batches */ }
    const context=await service.context(profileId);
    check(context.evidenceState==='REQUIRED','The fixture has no CV');
    check(context.vacancies?.decisions.get(related.id)?.eligibility.matchType==='RELATED','A Graphic Designer posting is selected for Digital Media Designer');
    check(context.vacancies?.decisions.get(shortDescription.id)?.eligibility.selectionEvidence==='PROFESSION_GRAPH','Strong graph evidence works when duties cannot be extracted');
    check(!context.vacancies?.decisions.has(negative.id),'Requirements in an unrelated job do not create task evidence');
    const decision=await service.explain(profileId,related.id);
    check(decision.matchType==='RELATED','Service detail agrees with selection');
    check(decision.matchScore===null,'Preference-only results do not report a CV score');
    check(decision.matchInsights?.relatedTasks?.length,'Service returns task reasons');
    const list=await api('/jobs/recommended?page=1&limit=50');
    const ids=list.items.map((row:any)=>row.id??row.job?.id);
    check(ids.includes(exact.id)&&ids.indexOf(exact.id)<ids.indexOf(related.id),'Exact is shown before related');
    check(!ids.includes(negative.id),'API excludes the negative posting');
    const relatedPage=await api('/jobs/recommended?feed=related&page=1&limit=50');
    check(relatedPage.items.some((row:any)=>(row.id??row.job?.id)===related.id),'Related feed shows the posting');
    check(relatedPage.selectionRevision===context.selectionRevision,'The feed exposes the activated revision');
    if(strict){
      check(misleading.every(job=>!context.vacancies?.decisions.has(job.id)),'Task evidence and old graph edges cannot add developers');
      check(relatedPage.relatedProfessions.some((row:any)=>row.id===graphic)
        &&relatedPage.relatedProfessions.every((row:any)=>row.id!==frontend&&row.id!==fullstack),'Related cards use the same eligibility');
      const filtered=await api('/jobs/recommended?feed=related&relatedRoleId='+graphic+'&page=1&limit=1');
      check(filtered.total>=2&&filtered.items.every((row:any)=>row.eligibility.canonicalRoleId===graphic),'Card opens its own paginated recommendations');
      const blocked=await api('/jobs/recommended?feed=related&relatedRoleId='+frontend+'&page=1');
      check(blocked.total===0&&blocked.items.length===0,'Direct related URL cannot grant eligibility');
      check((await call('/jobs/recommended?relatedRoleId='+graphic+'&page=1')).status===400,'Role filter is scoped to related recommendations');
      for(const job of misleading){
        const detail=await api('/jobs/'+job.id+'/match-insights');
        check(!detail.eligibility?.eligible,'Detail does not revive an outside-family vacancy');
      }
    }
    const detail=await api('/jobs/'+related.id+'/match-insights');
    check(detail.matchType==='RELATED','HTTP detail and the related feed agree');
    const match=await api('/jobs?sort=match&page=1&limit=24&companySlug='+companyId);
    const matchIds=match.items.map((row:any)=>row.id);
    check(matchIds.includes(related.id)&&!matchIds.includes(negative.id),'Best Match agrees with the related feed');
    const first=await api('/jobs/recommended?feed=related&page=1&limit=1');
    const second=await api('/jobs/recommended?feed=related&page=2&limit=1');
    check(first.total===second.total&&first.rankingRevision===second.rankingRevision&&first.items[0]?.job.id!==second.items[0]?.job.id,'Pagination uses a consistent revision without duplicates');
    const denied=await call('/admin/occupation-relations/trace?profileId='+profileId+'&jobId='+related.id);
    check(denied.status===403,'Only administrators can retrieve technical task traces');
    await db.application.create({data:{profileId,jobPostId:related.id}});
    check(!(await api('/jobs/recommended?feed=related&page=1&limit=50')).items.some((row:any)=>(row.id??row.job?.id)===related.id),'Applied posting excluded with warm cache');
    await db.application.deleteMany({where:{profileId,jobPostId:related.id}});
    await db.jobPost.update({where:{id:related.id},data:{status:'CLOSED'}});
    check(!(await api('/jobs/recommended?feed=related&page=1&limit=50')).items.some((row:any)=>(row.id??row.job?.id)===related.id),'Closed posting excluded with warm cache');
    console.log(JSON.stringify({suite:'employee-selection-postgres-http',checks,selectionRevision:context.selectionRevision}));
  } finally {
    await db.user.deleteMany({where:{id:userId}});
    await db.company.deleteMany({where:{id:companyId}});
    await db.$disconnect();
  }
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
