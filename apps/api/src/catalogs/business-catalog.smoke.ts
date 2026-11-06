import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { companySchema,jobPostSchema,jobSearchSchema,companyBrowseSchema } from '@job-talentio/shared';
import { INDUSTRY_GROUPS,SENIORITY_LEVELS,LEGACY_INDUSTRY_MAPPING,legacyIndustryGroupCode } from './business-catalog.data';
import { resolveCompanyIndustry,resolveSeniority } from './business-catalog';
import { candidateExperienceReference } from '../matching/employee-experience-policy';
import { evaluateIntent,compareIntent,type IntentExperienceCache } from '../matching/employee-intent';
import { benchmarkIndex,benchmarkJob,benchmarkRoles,makeEmployeeBenchmark } from '../matching/employee-intent.benchmark';
import type { IntentFacts } from '../matching/employee-intent-evidence';

async function main(){
 let assertions=0;
 const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
 check(INDUSTRY_GROUPS.length===29&&new Set(INDUSTRY_GROUPS.map(row=>row.code)).size===29,'29 distinct groups');
 for(const row of INDUSTRY_GROUPS)check([row.name,row.nameId,row.nameUz,row.nameRu,row.definition,row.boundaries].every(Boolean),'all labels and boundaries supplied');
 check(Object.keys(LEGACY_INDUSTRY_MAPPING).length===37,'every legacy industry reviewed');
 check(LEGACY_INDUSTRY_MAPPING['chemicals-pharma-manufacturing']==='MANUFACTURING','pharmaceutical factory is manufacturing');
 check(LEGACY_INDUSTRY_MAPPING['finance-banking-insurance']===null,'composite finance/insurance label is not guessed');
 check(legacyIndustryGroupCode('constructor')===null&&legacyIndustryGroupCode('__proto__')===null&&legacyIndustryGroupCode('new-local-industry')===null,'unknown/new industry identifiers cannot inherit a mapping');
 const expected=[[0,1],[0,2],[2,5],[4,7],[5,8],[7,10],[10,15],[12,18],[15,20],[15,25],[18,30],[20,30],[20,null],[20,null]];
 for(const [i,row] of SENIORITY_LEVELS.entries()){
  assert.deepEqual([row.yearsMin,row.yearsMax],expected[i]);assertions++;
  check(row.code===`L${i}`,'internal code and ordering');
 }
 const group=INDUSTRY_GROUPS[3],detail={id:'detail',slug:'factory'};
 const db:any={$queryRaw:async()=>[],industryTaxonomy:{findFirst:async()=>({version:group.version})},businessIndustryGroup:{findUnique:async({where}:any)=>where.code_version.code===group.code?{...group,archivedAt:null}:null},industry:{findFirst:async({where}:any)=>where.slug===detail.slug?detail:null},industryGroupMapping:{findUnique:async()=>({groupId:group.id,group:{...group,archivedAt:null}})},seniorityCatalog:{findFirst:async()=>({version:SENIORITY_LEVELS[0].version})},seniorityLevel:{findUnique:async({where}:any)=>SENIORITY_LEVELS.find(row=>row.code===where.code_version.code)}};
 assert.deepEqual(await resolveCompanyIndustry(db,{industryGroupCode:group.code}),{industryId:null,industryGroupId:group.id});assertions++;
 assert.deepEqual(await resolveCompanyIndustry(db,{industrySlug:detail.slug}),{industryId:detail.id,industryGroupId:group.id});assertions++;
 await assert.rejects(resolveCompanyIndustry(db,{industrySlug:'missing'}),/INDUSTRY_UNAVAILABLE/);assertions++;
 await assert.rejects(resolveCompanyIndustry(db,{industryGroupCode:'MISSING'}),/INDUSTRY_GROUP_UNAVAILABLE/);assertions++;
 const existing={industryId:detail.id,industryGroupId:group.id};
 await assert.rejects(resolveCompanyIndustry(db,{industryGroupCode:null},existing),/CONFLICT/);assertions++;
 assert.deepEqual(await resolveCompanyIndustry(db,{industryGroupCode:null,industrySlug:''},existing),{industryId:null,industryGroupId:null});assertions++;
 assert.deepEqual(await resolveCompanyIndustry(db,{},existing),{});assertions++;
 assert.deepEqual(await resolveCompanyIndustry(db,{industrySlug:''},existing),{industryId:null,industryGroupId:group.id});assertions++;
 for(const level of SENIORITY_LEVELS){
  const snapshot=await resolveSeniority(db,{seniorityLevelCode:level.code});
  check(snapshot.seniorityYearsMin===level.yearsMin&&snapshot.seniorityYearsMax===level.yearsMax,'automatic snapshot');
  check(candidateExperienceReference({experienceYearsMin:99,...snapshot},true).minimum===level.yearsMin,'snapshot takes precedence');
  check(candidateExperienceReference({experienceYearsMin:3,...snapshot},false).minimum===3,'legacy policy ignores new snapshot');
 }
 for(const field of ['seniorityYearsMin','seniorityYearsMax','seniorityVersion','seniorityLevelId']){
  await assert.rejects(resolveSeniority(db,{[field]:1}),/READ_ONLY/);assertions++;
  check(!jobPostSchema.partial().safeParse({[field]:1}).success,'HTTP schema rejects snapshot override');
 }
 await assert.rejects(resolveSeniority(db,{seniorityLevelCode:'L4',experienceYearsMin:5}),/AUTOMATIC/);assertions++;
 await assert.rejects(resolveSeniority(db,{experienceYearsMin:1},{seniorityLevelCode:'L4'}),/AUTOMATIC/);assertions++;
 assert.deepEqual(await resolveSeniority(db,{}, {seniorityLevelCode:'L4'}),{});assertions++;
 const cleared=await resolveSeniority(db,{seniorityLevelCode:null});check(Object.values(cleared).every(value=>value===null),'explicit clear');
 check(companySchema.safeParse({name:'Example',industryGroupCode:group.code}).success,'group-only contract');
 check(jobSearchSchema.parse({industryGroupCode:group.code}).industryGroupCode===group.code,'job group filter contract');
 check(companyBrowseSchema.parse({industryGroupCode:group.code}).industryGroupCode===group.code,'directory group filter contract');
 const now=new Date('2026-11-05T00:00:00Z');
 const empty:IntentFacts={roles:[],skills:[],experiences:[],languages:[]};
 const preferences={selectedIds:[benchmarkRoles[0].id],preferredCountries:[],preferredWorkModes:[],desiredSalaryMin:null,desiredSalaryCurrency:'IDR',desiredSalaryPeriod:'MONTHLY'};
 process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='true';
 for(const level of SENIORITY_LEVELS){
  const job={...benchmarkJob(0,0),jobSkills:[],experienceYearsMin:49,seniorityLevelCode:level.code,seniorityVersion:level.version,seniorityYearsMin:level.yearsMin,seniorityYearsMax:level.yearsMax};
  const noEvidence=evaluateIntent(preferences,empty,job,benchmarkIndex,now);
  const reference=noEvidence.insights.evidence.find(row=>row.experienceReference);
  check(reference?.required===false&&reference.experienceReference?.source==='CATALOG_DERIVED','derived years never mandatory');
  check(reference?.status===(level.yearsMin===0?'MET':'UNKNOWN'),'missing dates are unknown, zero needs no experience');
  check(noEvidence.eligibility.eligible,'missing CV never changes occupational eligibility');
  for(const years of [0,Math.max(0,level.yearsMin-1),level.yearsMin,level.yearsMin+1,(level.yearsMax??30)+10]){
   const facts={...empty,experiences:[{key:'experience',title:job.title,jobTitleId:job.jobTitleId,startDate:new Date(+now-years*31557600000).toISOString(),endDate:now.toISOString(),isCurrent:false,seniority:null,source:'CV' as const,confirmed:false}]};
   const evaluation=evaluateIntent(preferences,facts,job,benchmarkIndex,now);
   check(evaluation.eligibility.eligible&&evaluation.tier!==2,'derived experience shortfall is not a mandatory gap');
   const met=evaluation.insights.evidence.find(row=>row.experienceReference);
   check(met?.status===(years>=level.yearsMin?'MET':'UNMET'),'experience boundary status');
   if(years>=level.yearsMin)check(evaluation.score===100,'experience above maximum never penalized');
   const doubled=evaluateIntent(preferences,{...facts,experiences:[...facts.experiences,{...facts.experiences[0],key:'overlap'}]},job,benchmarkIndex,now);
   check(doubled.score===evaluation.score,'overlapping intervals not double-counted');
  }
 }
 const seniorJob={...benchmarkJob(0,0),jobSkills:[],experienceYearsMin:null,experienceLevel:'JUNIOR'};
 const seniorFacts={...empty,experiences:[{key:'s',title:seniorJob.title,jobTitleId:seniorJob.jobTitleId,startDate:'2020-01-01',endDate:'2025-01-01',isCurrent:false,seniority:'SENIOR',source:'CV' as const,confirmed:false}]};
 check(evaluateIntent(preferences,seniorFacts,seniorJob,benchmarkIndex,now).score===100,'above required seniority gets full credit');
 const careerCache:IntentExperienceCache=new Map();
 const yearsJob={...benchmarkJob(0,0),jobSkills:[],experienceYearsMin:10,experienceLevel:null};
 const firstCareer=evaluateIntent(preferences,seniorFacts,yearsJob,benchmarkIndex,now,undefined,true,careerCache);
 const repeatedCareer=evaluateIntent(preferences,seniorFacts,yearsJob,benchmarkIndex,now,undefined,true,careerCache);
 check(firstCareer.score===repeatedCareer.score&&careerCache.size===1,'request-local experience deduplication preserves output');
 const newRevision={...seniorFacts,experiences:seniorFacts.experiences.map(row=>({...row,startDate:'2000-01-01'}))};
 check(evaluateIntent(preferences,newRevision,yearsJob,benchmarkIndex,now,undefined,true,careerCache).score>firstCareer.score,'a different CV evidence object cannot reuse an old duration');
 const withoutCareer={...empty};
 check(evaluateIntent(preferences,withoutCareer,yearsJob,benchmarkIndex,now,undefined,true,careerCache).insights.evidence.some(row=>row.kind==='EXPERIENCE'&&row.status==='UNKNOWN'),'another profile cannot inherit cached experience');
 const currentCareer={...seniorFacts,experiences:seniorFacts.experiences.map(row=>({...row,endDate:null,isCurrent:true}))};
 const today=evaluateIntent(preferences,currentCareer,yearsJob,benchmarkIndex,now,undefined,true,careerCache);
 const later=evaluateIntent(preferences,currentCareer,yearsJob,benchmarkIndex,new Date('2030-11-05'),undefined,true,careerCache);
 check(later.score>today.score,'a new date invalidates request-local duration');
 const anotherRole={...yearsJob,jobTitleId:benchmarkRoles[1].id,title:benchmarkRoles[1].name};
 check(evaluateIntent({...preferences,selectedIds:[benchmarkRoles[1].id]},currentCareer,anotherRole,benchmarkIndex,now,undefined,true,careerCache).insights.evidence.some(row=>row.kind==='EXPERIENCE'&&row.status==='UNKNOWN'),'another canonical profession cannot inherit experience');
 process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='false';
 check(evaluateIntent(preferences,seniorFacts,seniorJob,benchmarkIndex,now).score===100,'stale experience flag cannot restore the retired seniority penalty');
 process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='true';
 const dataset=makeEmployeeBenchmark();
 for(const profile of dataset.profiles){
  const jobs=dataset.jobs.map(job=>({...job,seniorityLevelCode:'L6',seniorityVersion:'test-v1',seniorityYearsMin:10,seniorityYearsMax:15}));
  const ranked=jobs.map(job=>({job,evaluation:evaluateIntent(profile.preferences,profile.facts,job,benchmarkIndex,now)})).filter(row=>row.evaluation.eligibility.eligible).sort((a,b)=>compareIntent(a.evaluation,b.evaluation));
  check(ranked.length===12,'all relevant jobs retained across ten families');
  check(ranked.every(row=>row.job.jobTitleId===profile.preferences.selectedIds[0]),'experience never bypasses profession selection');
 }
 const report={suite:'business-catalog-unit',assertions,groups:29,seniorityLevels:14,families:10};
 const directory=path.resolve(__dirname,'../../../../output/business-catalog');
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'unit.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
