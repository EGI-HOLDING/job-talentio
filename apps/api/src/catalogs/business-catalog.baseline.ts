import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { EmployeeOccupationIndex,intentRoleInclude } from '../matching/employee-occupation';
import { applyEmployeeOverrides, type IntentFacts, type EvidenceOverride } from '../matching/employee-intent-evidence';
import { evaluateIntent,compareIntent } from '../matching/employee-intent';
const {url}=require('../../../../scripts/business-catalog-local.cjs');
url.pathname='/talentio_business_catalog_20261105';
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
 process.env.EMPLOYEE_EXPERIENCE_POLICY_ENABLED='false';
 const roles=await db.jobTitle.findMany({include:intentRoleInclude});
 const index=new EmployeeOccupationIndex(roles,true);
 const jobs=await db.jobPost.findMany({where:{status:'PUBLISHED'},select:{id:true,title:true,jobTitleId:true,companyId:true,publishedAt:true,countryId:true,cityId:true,workMode:true,experienceYearsMin:true,experienceLevel:true,salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true,jobSkills:{include:{skill:true}},jobLanguages:{include:{language:true}}},orderBy:{id:'asc'}});
 const profiles=await db.employeeProfile.findMany({select:{id:true,cityId:true,residenceCountryId:true,preferredCountries:{select:{id:true}},preferredWorkModes:true,desiredSalaryMin:true,desiredSalaryCurrency:true,desiredSalaryPeriod:true,desiredRoles:{select:{jobTitleId:true}},resumes:{where:{isPrimary:true,deletedAt:null},take:1,select:{currentVersion:{select:{employeeEvidence:true}}}}},orderBy:{id:'asc'}});
 const rows=profiles.map(profile=>{
  const evidence=profile.resumes[0]?.currentVersion?.employeeEvidence;
  const facts=evidence?.facts?applyEmployeeOverrides(evidence.facts as unknown as IntentFacts,(evidence.overrides??[]) as EvidenceOverride[]):{roles:[],skills:[],experiences:[],languages:[]} as IntentFacts;
  const preferences={...profile,selectedIds:profile.desiredRoles.map(row=>row.jobTitleId)};
  return {profile,facts,preferences};
 });
 const run=()=>rows.map(({profile,facts,preferences})=>({profileIdHash:hash(profile.id),results:jobs.map(job=>({id:job.id,evaluation:evaluateIntent(preferences,facts,job,index,new Date('2026-11-05T00:00:00Z'))})).filter(row=>row.evaluation.eligibility.eligible).sort((a,b)=>compareIntent(a.evaluation,b.evaluation)||(b.evaluation.score-a.evaluation.score)||a.id.localeCompare(b.id))}));
 const result=run();const times:number[]=[];
 for(let i=0;i<25;i++){const start=performance.now();run();times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 const report={profiles:rows.length,jobs:jobs.length,hash:hash(result),p95Ms:times[Math.floor(times.length*.95)],result};
 const file=path.resolve('output/business-catalog',process.argv.includes('--after')?'matching-after.json':'matching-baseline.json');
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({profiles:rows.length,jobs:jobs.length,hash:report.hash,p95Ms:report.p95Ms}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
