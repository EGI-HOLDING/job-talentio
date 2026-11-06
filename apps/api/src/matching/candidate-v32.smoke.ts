import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EMPLOYEE_INTENT_VERSION } from '@job-talentio/shared';
import { EmployeeMatchingService } from './employee-matching.service';
import { evaluateIntent,compareIntent } from './employee-intent';
import { EmployeeOccupationIndex } from './employee-occupation';
import { benchmarkRoles,benchmarkJob,makeEmployeeBenchmark } from './employee-intent.benchmark';

async function main(){
 let checks=0;const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++;};
 check(EMPLOYEE_INTENT_VERSION==='employee-intent-v3.2','responses identify the active engine');
 const calls:string[]=[];
 const current:any={catalog:async()=>{calls.push('catalog');},context:async()=>{calls.push('context');return {};},explain:async()=>{calls.push('explain');return {};},scoreJobsForProfile:async()=>{calls.push('score');return new Map();},recommend:async()=>{calls.push('recommend');return {version:EMPLOYEE_INTENT_VERSION};},explore:async()=>{calls.push('explore');return {};}};
 const facade=new EmployeeMatchingService({} as any,current);
 // Stale deployment flags cannot select a retired implementation.
 process.env['EMPLOYEE_'+'MATCHING_V2_PERCENT']='0';process.env['EMPLOYEE_'+'RECOMMENDATION_V32_ENABLED']='false';process.env['EMPLOYEE_INTENT_'+'V3_MODE']='off';
 await facade.warmCatalog();await facade.intentSearchScope('p');await facade.intentExplanation('p','j');await facade.scoreJobsForProfile('p',['j']);await facade.recommend('p');await facade.recommend('p',1,24,'salary-unverified');await facade.recommend('p',1,24,'exploration');
 assert.deepEqual(calls,['catalog','context','explain','score','recommend','recommend','explore']);checks++;
 current.recommend=async()=>{throw Error('Current engine unavailable');};await assert.rejects(()=>facade.recommend('p'),/Current engine unavailable/);checks++;
 const dataset=makeEmployeeBenchmark(),now=new Date('2026-11-03');
 for(let family=0;family<10;family++){
  const source=structuredClone(benchmarkRoles[family]),other=structuredClone(benchmarkRoles[(family+1)%10]);
  source.matchingMetadata={relatedRoles:[{id:other.id,kind:'RELATED',approved:true,reference:'fixture:core-task-overlap'}]};
  const index=new EmployeeOccupationIndex([source,other],true),profile=dataset.profiles[family*6];
  const preferences={...profile.preferences,selectedIds:[source.id]};
  const exact=benchmarkJob(family,0),related={...exact,id:'related',jobTitleId:other.id};
  const a=evaluateIntent(preferences,profile.facts,exact,index,now),b=evaluateIntent(preferences,profile.facts,related,index,now);
  check(a.eligibility.matchType==='EXACT'&&b.eligibility.matchType==='RELATED','exact and direct cross-family relations remain distinct');
  check(compareIntent(a,b)<0,'exact precedes related');
  const minimal=evaluateIntent(preferences,{roles:[],skills:[],experiences:[],languages:[]},exact,index,now);
  check(minimal.eligibility.eligible&&minimal.insights.evidence.some(e=>e.status==='UNKNOWN'),'missing CV evidence never removes an eligible occupation');
  const five=[...benchmarkRoles.slice(0,5),source];
  check(new EmployeeOccupationIndex(five,true).eligibility(five.map(r=>r.id),source.id).matchType==='EXACT','multiple choices are equal');
  const closedIdentity=evaluateIntent(preferences,profile.facts,{...exact,jobTitleId:null},index,now);
  check(!closedIdentity.eligibility.eligible,'unmapped manual titles do not invent an occupation match');
 }
 const matchingDir=__dirname;
 for(const retired of ['employee-boost-placement.ts','employee-quality-gate.ts','employee-recommendation-policy.ts'])check(!fs.existsSync(path.join(matchingDir,retired)),'retired scorer is physically absent: '+retired);
 check(!/export (?:function|const) (?:evaluateEmployee|rankEmployeeJobs|EMPLOYEE_MATCH_VERSION)/.test(fs.readFileSync(path.join(matchingDir,'employee-matching.ts'),'utf8')),'shared career helpers export no retired candidate scorer');
 const facadeSource=fs.readFileSync(path.join(matchingDir,'employee-matching.service.ts'),'utf8');
 check(!/MatchingService\s*=|rankEmployeeJobs|evaluateEmployee|process\.env|shadow|legacy\.score/.test(facadeSource),'facade contains no version switch or old fallback');
 console.log(JSON.stringify({suite:'candidate-v32-only',checks,families:10,engine:EMPLOYEE_INTENT_VERSION}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
