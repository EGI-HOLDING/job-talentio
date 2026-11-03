import 'reflect-metadata';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PrismaService} from '../prisma/prisma.service';
import {EmployeeIntentService} from '../matching/employee-intent.service';
import {catalogDigest} from '../matching/employee-catalog-repair';
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Local imported database only');
 process.env.EMPLOYEE_RECOMMENDATION_V32_ENABLED='true';
 const db=new PrismaService();
 try{await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const profile=await tx.employeeProfile.findFirst({select:{id:true}});if(!profile)throw Error('No local profile available');
  const service=new EmployeeIntentService(tx as any),context=await service.context(profile.id),catalog=await service.catalog();
  const chef=context.index.resolve('Chef');if(!chef)throw Error('Reviewed Chef identity missing');
  const preferences={...context.preferences,selectedIds:[chef]};
  const simulation={...context,preferences,state:'READY' as const,preferencesOnly:true,evidenceState:'REVIEW_REQUIRED' as const,facts:{roles:[],skills:[],experiences:[],languages:[]},allowedIds:catalog.roles.filter(r=>context.index.eligibility([chef],r.id).eligible).map(r=>r.id),fingerprint:catalogDigest(['local-chef-simulation',catalog.recommendationRevision])};
  const results=await service.recommend(profile.id,1,24,simulation);
  assert.equal(results.total,5);assert.equal(results.mode,'PREFERENCES_BASED');assert.ok(results.items.every(r=>r.matchType==='RELATED'&&r.matchScore===null));
  const report={scenario:'Chef preference simulated in memory against imported local jobs; no profile changed',state:results.state,total:results.total,mode:results.mode,jobs:results.items.map(r=>({title:r.job.title,matchType:r.matchType,matchScore:r.matchScore})),readOnly:true};
  fs.writeFileSync('output/recommendation-v32/local-chef-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 },{timeout:30000});}finally{await db.$disconnect();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1});
