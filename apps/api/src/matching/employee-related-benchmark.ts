import {makeEmployeeBenchmark,benchmarkJob} from './employee-intent.benchmark';
import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
import {evaluateIntent,compareIntent,type IntentPreferences,type IntentJob} from './employee-intent';
import type {IntentFacts} from './employee-intent-evidence';
import {culinaryRelatedPositions} from './employee-related-curation';
import {EMPLOYEE_RELATED_RANKING_VERSION} from '@job-talentio/shared';
export function makeRelatedBenchmark(){
 const dataset=structuredClone(makeEmployeeBenchmark());
 dataset.rankingVersion=EMPLOYEE_RELATED_RANKING_VERSION;
 const chef=dataset.catalog.find(r=>r.name==='Chef')!;
 const children:IntentRole[]=culinaryRelatedPositions.map((name,n)=>({...chef,id:'culinary:'+n,name,nameId:name,aliases:[]}));
 chef.matchingMetadata={sources:[],relatedRoles:children.map(r=>({id:r.id,kind:'RELATED',approved:true,reference:'fixture:culinary-direct-related-roles-v32'}))};
 dataset.catalog=[...dataset.catalog,...children];
 dataset.jobs.push(...children.map((r,n)=>({...benchmarkJob(5,n),id:'culinary-job:'+n,title:r.name,jobTitleId:r.id})));
 return dataset;
}
export function relatedBenchmarkRank(preferences:IntentPreferences,facts:IntentFacts,jobs:IntentJob[]){
 const index=new EmployeeOccupationIndex(makeRelatedBenchmark().catalog,true);
 return jobs.map(job=>({job,evaluation:evaluateIntent(preferences,facts,job,index,new Date('2026-11-03'))})).filter(r=>r.evaluation.eligibility.eligible).sort((a,b)=>compareIntent(a.evaluation,b.evaluation)||(b.job.publishedAt?.getTime()??0)-(a.job.publishedAt?.getTime()??0)||a.job.id.localeCompare(b.job.id)).map(r=>r.job.id);
}
