import 'reflect-metadata';
import assert from 'node:assert/strict';
import { evaluateEmployee, rankEmployeeJobs, OccupationIndex } from './employee-matching';
import { placeEmployeeBoosts } from './employee-boost-placement';
import { EmployeeMatchingService } from './employee-matching.service';
import { loadJobPromotions, resolveJobPromotion } from '../benefits/job-promotion';
import { toJobSearchDocument } from '../search/jobs-index.sync';
import { exposureLog } from '../benefits/benefit-policy';

async function main() {
  const now = new Date(), past = new Date(now.getTime()-86400000), future = new Date(now.getTime()+86400000);
  const benefit = {code:'STANDARD',startsAt:past,expiresAt:future,policySnapshot:{visibility:1.15},boosts:[{startsAt:past,endsAt:future}]};
  const state = resolveJobPromotion('PUBLISHED',benefit,true,now);
  assert.equal(state.publicState.boostActive,true);
  assert.equal(state.visibility,1.15);
  for (const status of ['DRAFT','PAUSED','CLOSED','EXPIRED']) assert.equal(resolveJobPromotion(status,benefit,true,now).publicState.active,false);
  assert.equal(resolveJobPromotion('PUBLISHED',benefit,false,now).visibility,1);
  assert.equal(resolveJobPromotion('PUBLISHED',{...benefit,startsAt:future},true,now).publicState.active,false);
  assert.equal(resolveJobPromotion('PUBLISHED',{...benefit,expiresAt:now},true,now).publicState.active,false);
  assert.equal(resolveJobPromotion('PUBLISHED',{...benefit,boosts:[{startsAt:past,endsAt:now}]},true,now).publicState.boostActive,false);
  assert.equal(resolveJobPromotion('PUBLISHED',{...benefit,boosts:[]},true,now).publicState.active,true,'active package promotion remains separate from boost');

  for (const [occupation,title] of ['Software Engineer','Accountant','Nurse','Chef','Architect','Teacher','Welder','Sales Manager','Farmer','Logistics Manager'].entries()) {
    const role={id:'role-'+occupation,name:title,nameId:title,nameRu:title,nameUz:title,normalizedKey:title.toLowerCase(),aliases:[]};
    const index=new OccupationIndex([role]);
    const profile={id:'profile',desiredPosition:title,skills:[],experiences:[],languages:[],preferredCountries:[]};
    const jobs=Array.from({length:80},(_,i)=>({id:'job-'+i,companyId:'company-'+(i%4),title,jobTitleId:role.id,workMode:'REMOTE',publishedAt:new Date(past.getTime()-i*60000),jobSkills:[],jobLanguages:[]}));
    const scored=jobs.map(job=>({job,evaluation:evaluateEmployee(profile,job,index,now)}));
    const organic=rankEmployeeJobs(scored), before=JSON.stringify(organic);
    const boostIds=new Set(jobs.filter((_,i)=>i>=6).map(job=>job.id));
    const placed=placeEmployeeBoosts(organic,boostIds);
    assert.equal(JSON.stringify(organic),before,'composition must not mutate scores or evidence');
    assert.deepEqual(placed.slice(0,2).map(r=>r.job.id),organic.slice(0,2).map(r=>r.job.id));
    assert.equal(placed.length,organic.length);assert.equal(new Set(placed.map(r=>r.job.id)).size,organic.length);
    const promotions=placed.filter(r=>r.placement==='BOOST');
    for(const [i,row] of placed.entries()) if(row.placement==='BOOST') assert.equal((i-2)%6,0);
    promotions.forEach((row,i)=>{if(i)assert.notEqual(row.job.companyId,promotions[i-1].job.companyId);});
    const moved=new Set(promotions.map(r=>r.job.id));
    assert.deepEqual(placed.filter(r=>!moved.has(r.job.id)).map(r=>r.job.id),organic.filter(r=>!moved.has(r.job.id)).map(r=>r.job.id));
    assert.deepEqual(placeEmployeeBoosts(organic,new Set()).map(r=>r.job.id),organic.map(r=>r.job.id));
    const unmet={...organic[6],evaluation:{...organic[6].evaluation,insights:{...organic[6].evaluation.insights,evidence:[{kind:'EXPERIENCE' as const,status:'UNMET' as const,required:true,label:'5',code:'BELOW_REQUIREMENT' as const,evidenceRefs:[]}]}}};
    const gated=[...organic];gated[6]=unmet;
    assert.ok(!placeEmployeeBoosts(gated,new Set([unmet.job.id])).some(r=>r.placement==='BOOST'),'known mandatory failure cannot buy a slot');
    const unknown={...unmet,evaluation:{...unmet.evaluation,insights:{...unmet.evaluation.insights,evidence:unmet.evaluation.insights.evidence.map(e=>({...e,status:'UNKNOWN' as const}))}}};
    gated[6]=unknown;
    assert.equal(placeEmployeeBoosts(gated,new Set([unknown.job.id]))[2].job.id,unknown.job.id,'unknown is not failed');
    const unrelated={...unknown,evaluation:{...unknown.evaluation,positiveCore:false}};gated[6]=unrelated;
    assert.ok(!placeEmployeeBoosts(gated,new Set([unrelated.job.id])).some(r=>r.placement==='BOOST'));
  }

  // Real recommendation service against an in-memory repository; no business writes.
  // Compare the optimized company queues with a deliberately simple reference.
  for (let sample=0;sample<120;sample++) {
    const rows=Array.from({length:sample},(_,i)=>({job:{id:'r'+i,companyId:'c'+(i%(sample%9+1)),title:'Role',workMode:'REMOTE',jobSkills:[],jobLanguages:[]},evaluation:{score:100-i,optionalScore:0,positiveCore:true,insights:{version:'test',mode:'PERSONALIZED' as const,evidence:[],reviewExperienceIds:[]}}}));
    const ids=new Set(rows.filter((_,i)=>(i*17+sample)%5!==0).map(r=>r.job.id));
    const emitted=new Set<string>(), expected:string[]=[];let previousCompany='';
    while(expected.length<rows.length){const next=rows.find(r=>!emitted.has(r.job.id))!;const slot=expected.length>=2&&(expected.length-2)%6===0;
      const candidate=slot?rows.find(r=>ids.has(r.job.id)&&!emitted.has(r.job.id)&&r.job.companyId!==previousCompany):undefined;
      const chosen=candidate&&candidate.job.id!==next.job.id?candidate:next;
      if(chosen!==next)previousCompany=chosen.job.companyId;
      emitted.add(chosen.job.id);expected.push(chosen.job.id);
    }
    assert.deepEqual(placeEmployeeBoosts(rows,ids).map(r=>r.job.id),expected,'company queue parity sample '+sample);
  }

  const role={id:'engineer',name:'Engineer',normalizedKey:'engineer',aliases:[]};
  const profile={id:'profile',desiredPosition:'Engineer',skills:[],experiences:[],languages:[]};
  const jobs=Array.from({length:30},(_,i)=>({id:'j'+i,companyId:'c'+i%3,title:'Engineer',jobTitleId:role.id,workMode:'REMOTE',publishedAt:new Date(past.getTime()-i*60000),jobSkills:[],jobLanguages:[],company:{name:'Company',slug:'company'},isAnonymous:false}));
  let flags=true, active=true, unavailable=false;
  const db={employeeProfile:{findUniqueOrThrow:async()=>profile},jobTitle:{findMany:async()=>[role]},jobPost:{findMany:async(args:any)=>args.where.id ? jobs.filter(j=>args.where.id.in.includes(j.id)) : jobs},
    featureFlag:{findMany:async()=>{if(unavailable)throw Error('injected read failure');return ['hr_packages','hr_promotions'].map(key=>({key,enabled:flags}));}},
    jobBenefit:{findMany:async()=>active ? [6,10,15].map(i=>({...benefit,jobId:'j'+i,job:{status:'PUBLISHED'}})) : []}};
  const env=process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED, cohort=process.env.EMPLOYEE_MATCHING_V2_PERCENT;
  try {
    process.env.EMPLOYEE_MATCHING_V2_PERCENT='100';process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED='false';
    const service=new EmployeeMatchingService(db as never);
    const base=await service.recommend(profile.id,1,24);
    process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED='true';
    const six=await service.recommend(profile.id,1,6), twelve=await service.recommend(profile.id,1,12), full=await service.recommend(profile.id,1,24);
    assert.equal(six.items[2].job.id,'j6');
    assert.deepEqual(six.items.map(r=>r.job.id),full.items.slice(0,6).map(r=>r.job.id));
    assert.deepEqual(twelve.items.map(r=>r.job.id),full.items.slice(0,12).map(r=>r.job.id));
    assert.equal(six.rankingRevision,full.rankingRevision);
    const second=await service.recommend(profile.id,2,12);
    assert.ok(second.items.every(row=>!twelve.items.some(first=>first.job.id===row.job.id)));
    const scores=new Map(base.items.map(r=>[r.job.id,[r.matchScore,r.matchInsights]]));
    full.items.forEach(r=>{if(scores.has(r.job.id))assert.deepEqual([r.matchScore,r.matchInsights],scores.get(r.job.id));});
    active=false;const ended=await service.recommend(profile.id,1,24);assert.notEqual(ended.rankingRevision,full.rankingRevision);
    assert.deepEqual(ended.items.map(r=>r.job.id),base.items.map(r=>r.job.id));
    flags=false;active=true;assert.ok((await service.recommend(profile.id)).items.every(r=>!r.job.isPromoted));
    unavailable=true;assert.deepEqual((await service.recommend(profile.id,1,24)).items.map(r=>r.job.id),base.items.map(r=>r.job.id));
    const failure=await loadJobPromotions(db as never,['j6'],now);assert.equal(failure.available,false);
    unavailable=false;flags=true;
    const legacy={scoreJobsForProfile:async()=>new Map(jobs.map(j=>[j.id,{total:10}]))};
    process.env.EMPLOYEE_MATCHING_V2_PERCENT='0';
    assert.ok((await new EmployeeMatchingService(db as never,legacy as never).recommend(profile.id)).items.every(r=>r.job.placement==='ORGANIC'));
    process.env.EMPLOYEE_MATCHING_V2_PERCENT='100';profile.desiredPosition='Unrelated role';
    const latest=await service.recommend(profile.id);assert.equal(latest.mode,'LATEST');assert.ok(latest.items.every(r=>r.job.placement==='ORGANIC'));
  } finally {
    if(env===undefined)delete process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED;else process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED=env;
    if(cohort===undefined)delete process.env.EMPLOYEE_MATCHING_V2_PERCENT;else process.env.EMPLOYEE_MATCHING_V2_PERCENT=cohort;
  }
  const documentJob={id:'indexed',status:'PUBLISHED',isAnonymous:true,title:'Engineer',description:'Fixture',publishedAt:past,benefit,company:{name:'Secret'},city:null,category:null,jobTitle:null,jobSkills:[],translations:[]};
  const doc=toJobSearchDocument(documentJob,true);
  assert.equal(doc.boostProjectedActive,true);assert.equal(doc.companyName,'');
  assert.ok(Math.abs(doc.exposureLog-exposureLog({publishedAt:past,visibility:state.visibility,boost:state.boost},now))<0.0001);
  assert.equal(toJobSearchDocument({...documentJob,status:'PAUSED'},true).boostProjectedActive,false);
  assert.equal(toJobSearchDocument(documentJob,false).boostProjectedActive,false);
  console.log('Employee boost: ten occupations, score/evidence invariance, slots, diversity, pagination, revisions, gates, rollback, flags, failures and projection parity passed.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
