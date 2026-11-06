import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CandidateCache } from '../common/candidate-cache';
import { MetaService } from '../meta/meta.service';
import { CompaniesService } from '../companies/companies.service';
import { JobsService } from '../jobs/jobs.service';
import { MatchingService } from '../matching/matching.service';
import { EmployeeMatchingService } from '../matching/employee-matching.service';
import { evaluateIntent } from '../matching/employee-intent';
import { benchmarkIndex,makeEmployeeBenchmark } from '../matching/employee-intent.benchmark';
const legacy=(file:string)=>require(path.resolve('output/business-catalog/legacy',file.replace(/\.ts$/,'.cjs')));
async function main(){
 const url=new URL(process.env.DATABASE_URL||'');
 if(url.pathname!=='/talentio_business_catalog_20261105'||url.port!=='5434'||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Local audit database only');
 const db=new PrismaClient();let cache:CandidateCache|undefined;
 try{
  cache=new CandidateCache(new ConfigService({DATABASE_URL:url.toString(),REDIS_URL:process.env.REDIS_URL}));
  await cache.invalidateAndWait();
  const production=process.argv.includes('--production');
  const built=(file:string)=>require(path.resolve('apps/api/dist',file+'.js'));
  const CurrentMeta=production?built('meta/meta.service').MetaService:MetaService;
  const CurrentCompanies=production?built('companies/companies.service').CompaniesService:CompaniesService;
  const CurrentJobs=production?built('jobs/jobs.service').JobsService:JobsService;
  const currentEvaluator:typeof evaluateIntent=production?built('matching/employee-intent').evaluateIntent:evaluateIntent;
  const oldMeta=new (legacy('meta.service.ts').MetaService)(db),newMeta=new CurrentMeta(db as any,cache);
  const search:any={rankedIds:async()=>null,syncJob:async()=>{},enabled:false};
  const args=[db,{}, {},{},new ConfigService(),search] as const;
  const oldCompanies=new (legacy('companies.service.ts').CompaniesService)(...args);
  const companies=new CurrentCompanies(db as any,{} as any,{} as any,{} as any,new ConfigService(),search);
  const matching=new MatchingService(db as any),employee=new EmployeeMatchingService(db as any,matching);
  const jobArgs=[db,companies,matching,{},search,{},employee] as const;
  const oldJobs=new (legacy('jobs.service.ts').JobsService)(...jobArgs);
  const jobs=new CurrentJobs(db as any,companies,matching,{} as any,search,{} as any,employee,undefined,undefined,undefined,undefined,undefined,cache);
  const oldEvaluator=legacy('employee-intent.ts').evaluateIntent;
  const data=makeEmployeeBenchmark(),now=new Date('2026-11-05T00:00:00Z');
  const rows:any[]=[],samples=Math.max(60,Math.min(600,Number(process.env.PERFORMANCE_SAMPLES)||120));
  async function compare(name:string,before:()=>Promise<unknown>|unknown,after:()=>Promise<unknown>|unknown){
   for(let i=0;i<12;i++){await before();await after();}
   const a:number[]=[],b:number[]=[];
   const sample=async(fn:()=>unknown|Promise<unknown>,values:number[])=>{const start=performance.now();await fn();values.push(performance.now()-start);};
   for(let i=0;i<samples;i++){if(i%2){await sample(after,b);await sample(before,a);}else{await sample(before,a);await sample(after,b);}}
   a.sort((x,y)=>x-y);b.sort((x,y)=>x-y);
   const p95=(v:number[])=>v[Math.ceil(v.length*.95)-1];const baseline=p95(a),current=p95(b),regression=(current/baseline-1)*100;
   const row={name,samples,baselineP95Ms:baseline,currentP95Ms:current,regressionPercent:regression,passes:regression<=20};rows.push(row);console.log(JSON.stringify(row));
  }
  await compare('industry metadata',()=>oldMeta.industries(),()=>newMeta.industries());
  await compare('company directory',()=>oldCompanies.browse({sort:'name',page:1,limit:24}),()=>companies.browse({sort:'name',page:1,limit:24}));
  await compare('job search and facets',()=>oldJobs.search({sort:'newest',page:1,limit:12}),()=>jobs.search({sort:'newest',page:1,limit:12}));
  const run=(evaluator:typeof evaluateIntent)=>data.profiles.map(profile=>{
    const experienceCache=new Map();
    return data.jobs.map(job=>evaluator(profile.preferences,profile.facts,job,benchmarkIndex,now,undefined,true,experienceCache));
  });
  await compare('candidate evaluator, 60 profiles / 130 jobs',()=>run(oldEvaluator),()=>run(currentEvaluator));
  fs.writeFileSync('output/business-catalog/performance.json',JSON.stringify({production,method:`Alternating paired HEAD/current implementations; same local database, 12 warmups and ${samples} samples per implementation. Production mode loads Nest build output and the same TypeScript compiler for baseline. Service timings exclude HTTP and network.`,rows},null,2));
  if(rows.some(row=>!row.passes))process.exitCode=1;
 }finally{cache?.onModuleDestroy();await db.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
