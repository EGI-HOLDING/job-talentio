import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CatalogRole, EmployeeMatchJob, EmployeeMatchProfile, OccupationIndex, evaluateEmployee, rankEmployeeJobs } from './employee-matching';
import { backfillJobLanguages } from '../common/job-language-backfill';

async function main() {
const dataset=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../prisma/data/job-titles/audit-2026-10-24.json'),'utf8'));
const roles:CatalogRole[]=dataset.rows.map((row:any)=>({id:row.targetId,name:row.name,nameId:row.nameId,nameUz:row.nameUz,normalizedKey:row.key,aliases:[]}));
const index=new OccupationIndex(roles);
const now=new Date('2026-10-24T00:00:00Z');
const skill=(name:string)=>({name,slug:name,normalizedKey:name,aliases:[]});
const profile=(role:string):EmployeeMatchProfile=>({id:'profile',headline:role,skills:[],experiences:[],languages:[]});
const job=(role:CatalogRole):EmployeeMatchJob=>({id:'job',companyId:'company',title:role.name,jobTitleId:role.id,workMode:'ONSITE',jobSkills:[],jobLanguages:[],publishedAt:now});
const counts:Record<string,number>={}; const reviewSamples:any[]=[];
let assertions=0;
function check(value:unknown,message:string){assert.ok(value,message);assertions++;}
for(const group of ['0','1','2','3','4','5','6','7','8','9']){
  const rows=dataset.rows.filter((row:any)=>row.source?.isco08?.startsWith(group)).slice(0,12);
  check(rows.length>0,`missing group ${group}`);
  for(const row of rows){
    const role=roles.find(r=>r.id===row.targetId)!; const j=job(role);
    const values=[role.name,role.nameId!,role.nameUz!].map(label=>evaluateEmployee(profile(label),j,index,now));
    check(values.every(v=>v.score===15&&v.positiveCore),`language parity: ${role.name}`);
    const p=profile(role.name);p.skills=[{skillId:'one',level:'INTERMEDIATE',skill:skill('competency-one')}];
    j.jobSkills=[{skillId:'one',isRequired:true,weight:1,skill:skill('competency-one')}];
    const original=evaluateEmployee(p,j,index,now);
    check(original.score===55,`no implicit level penalty: ${role.name}`);
    p.skills.push({skillId:'other',level:'EXPERT',skill:skill('unrelated')});
    check(evaluateEmployee(p,j,index,now).score===original.score,`broad-profile invariant: ${role.name}`);
    const empty=evaluateEmployee(profile(''),j,index,now);
    check(empty.insights.evidence.every(e=>e.status!=='UNMET'),`unknown is not failure: ${role.name}`);
    j.jobSkills.push({skillId:'missing',isRequired:true,weight:1,skill:skill('competency-two')});
    p.skills[0].level='EXPERT';
    const missing=evaluateEmployee(p,j,index,now);
    check(missing.score<original.score&&missing.insights.evidence.some(e=>e.status==='UNKNOWN'&&e.required),`required gap remains: ${role.name}`);
    counts[group]=(counts[group]??0)+1;
    reviewSamples.push({iscoMajorGroup:group,occupationId:role.id,labels:{en:role.name,id:role.nameId,uz:role.nameUz},
      scenario:'synthetic invariant fixture; not human relevance ground truth',humanRelevance:null,reviewer:null});
  }
}
const first=roles[0],second=roles.find(r=>r.id!==first.id)!;
const p=profile(`${first.name} / ${second.name}`);
check(evaluateEmployee(p,job(first),index,now).positiveCore,'compound role 1');
check(evaluateEmployee(p,job(second),index,now).positiveCore,'compound role 2');
const aliasIndex=new OccupationIndex([{...first,aliases:[{alias:'QA',aliasKey:'qa'},{alias:'Ўзбекча касб',aliasKey:'ўзбекча-касб'}]}]);
check(aliasIndex.resolve('QA').has(first.id),'short aliases');check(aliasIndex.resolve('Ўзбекча касб').has(first.id),'Unicode aliases');
const collision=new OccupationIndex([{...first,name:'Duplicate'},{...second,name:'Duplicate'}]);
check(collision.resolve('Duplicate').size===0,'ambiguous aliases are not arbitrary');
check(!evaluateEmployee(profile('Duplicate'),{...job(first),title:'Duplicate'},collision,now).positiveCore,'raw text cannot bypass ambiguous catalog identity');
const jp=job(first);jp.experienceYearsMin=3;
const xp=profile(first.name);xp.experiences=[{id:'unrelated',title:second.name,startDate:new Date('2010-01-01'),endDate:new Date('2025-01-01'),isCurrent:false}];
check(evaluateEmployee(xp,jp,index,now).insights.evidence.some(e=>e.kind==='EXPERIENCE'&&e.status==='UNKNOWN'),'unrelated career does not fulfill experience');
xp.experiences=[{id:'one',title:first.name,startDate:new Date('2024-01-01'),endDate:new Date('2026-01-01'),isCurrent:false},{id:'two',title:first.name,startDate:new Date('2024-01-01'),endDate:new Date('2026-01-01'),isCurrent:false}];
check(evaluateEmployee(xp,jp,index,now).insights.evidence.some(e=>e.kind==='EXPERIENCE'&&e.status==='UNMET'),'overlap not double counted');
xp.experiences.push({id:'heading',title:'PROFESSIONAL EXPERIENCE',startDate:new Date('2000-01-01'),endDate:new Date('2025-01-01'),isCurrent:false});
check(evaluateEmployee(xp,jp,index,now).insights.reviewExperienceIds.includes('heading'),'review parsing headings without deleting');
jp.jobLanguages=[{id:'lang',language:{code:'uz',name:'Uzbek'},minLevel:'B2',isRequired:true,provenance:'LEGACY_UNVERIFIED'}];
const unverified=evaluateEmployee(profile(first.name),jp,index,now);
check(unverified.insights.evidence.some(e=>e.code==='UNVERIFIED_REQUIREMENT'&&e.status==='UNKNOWN'&&!e.required),'unverified language not a failing requirement');
jp.jobLanguages[0].provenance='EMPLOYER_CONFIRMED';const lp=profile(first.name);lp.languages=[{language:{code:'uz'},level:'A1'}];
check(evaluateEmployee(lp,jp,index,now).insights.evidence.some(e=>e.kind==='LANGUAGE'&&e.status==='UNMET'),'explicit low language level is unmet');
const kp=profile(first.name);kp.skills=[{skillId:'one',level:'EXPERT',levelSource:'CV_DEFAULT',skill:skill('one')}];const kj=job(first);kj.jobSkills=[{skillId:'one',skill:skill('one'),isRequired:true,weight:1,minLevel:'ADVANCED'}];
check(evaluateEmployee(kp,kj,index,now).insights.evidence.some(e=>e.kind==='SKILL'&&e.status==='UNKNOWN'),'default skill level is not verified');
kp.skills[0].levelSource='USER_CONFIRMED';kp.skills[0].level='BEGINNER';
check(evaluateEmployee(kp,kj,index,now).insights.evidence.some(e=>e.kind==='SKILL'&&e.status==='UNMET'),'confirmed low skill level is unmet');
const noData=profile('');const recent=job(first);const old={...job(second),id:'old',publishedAt:new Date('2020-01-01')};
const ranked=rankEmployeeJobs([old,recent].map(j=>({job:j,evaluation:evaluateEmployee(noData,j,index,now)})));
check(ranked[0].job.id===recent.id,'no evidence fallback is recent');
const probe=await backfillJobLanguages(new Proxy({},{get:()=>{throw Error('backfill must not access DB');}}) as never);
check(probe.filled===0,'no inference writes');
const neutralJob=job(first);const neutral=profile(first.name);const neutralScore=evaluateEmployee(neutral,neutralJob,index,now).score;
for(const extras of [{fullName:'Different name',gender:'FEMALE',avatarUrl:'photo',birthDate:'1960-01-01'},
  {educations:[{degree:'PHD'}],certifications:[{name:'Unrelated certificate'}]},
  {languages:[{language:{code:'en'},level:'NATIVE'}]}]) {
  check(evaluateEmployee({...neutral,...extras},neutralJob,index,now).score===neutralScore,'identity, education and unrequested language invariance');
}
const skillAliasJob=job(first);skillAliasJob.jobSkills=[{skillId:'canonical',isRequired:true,weight:1,skill:{...skill('canonical'),aliases:[{aliasKey:'alternate'}]}}];
const skillAliasProfile=profile('');skillAliasProfile.skills=[{skillId:'different-id',level:'INTERMEDIATE',skill:skill('alternate')}];
check(evaluateEmployee(skillAliasProfile,skillAliasJob,index,now).score===40,'skill aliases work independently of occupation tokens');
skillAliasJob.jobSkills[0].minLevel='ADVANCED';
skillAliasProfile.skills[0].levelSource='CV_DEFAULT';
skillAliasProfile.skills.push({skillId:'canonical',level:'ADVANCED',levelSource:'USER_CONFIRMED',skill:skill('canonical')});
check(evaluateEmployee(skillAliasProfile,skillAliasJob,index,now).score===40,'confirmed alias evidence takes precedence over imported defaults');
const noRelationIndex=new OccupationIndex([{...first,matchingMetadata:{isco08:'1234',relatedRoles:[]}},{...second,matchingMetadata:{isco08:'1234',relatedRoles:[]}}]);
check(!evaluateEmployee(profile(first.name),job(second),noRelationIndex,now).positiveCore,'same ISCO group is not equivalence');
const relationIndex=new OccupationIndex([{...first,matchingMetadata:{relatedRoles:[{id:second.id,approved:true,kind:'RELATED',reference:'Fixture occupational source'}]}},second]);
const related=evaluateEmployee(profile(first.name),job(second),relationIndex,now);
check(related.score===8&&related.insights.evidence.some(e=>e.code==='RELATED_ROLE'),'approved related role is distinct from identity');
const historical=profile('');historical.experiences=[{id:'past',title:first.name,startDate:new Date('2020-01-01'),endDate:new Date('2024-01-01'),isCurrent:false}];
const historyResult=evaluateEmployee(historical,job(first),index,now);
check(historyResult.positiveCore&&historyResult.score===8&&historyResult.insights.evidence.some(e=>e.code==='PAST_ROLE'),'past relevant role supports personalization without a headline');
if(process.argv.includes('--samples')){
  const output=path.resolve(__dirname,'../../../../output/matching');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'employee-v2-review-samples.json'),JSON.stringify({version:'employee-evidence-v2',humanValidated:false,metrics:{ndcgAt10:null,precisionAt10:null},samples:reviewSamples},null,2));
}
console.log(JSON.stringify({passed:assertions,occupationFixtures:reviewSamples.length,groups:counts,languages:['en','id','uz'],humanValidated:false}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
