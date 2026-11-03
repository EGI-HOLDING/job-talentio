import fs from 'node:fs';
import path from 'node:path';
import { EmployeeOccupationIndex } from './employee-occupation';
import { evaluateHr, compareHr, hrHash, emptyHrFacts, type HrCatalog, type HrProfile } from './recruiter-ranking';

/** Synthetic, profession-specific review material. No evaluator-generated human labels. */
const occupations=[
  ['241','Accountant','Akuntan','General ledger','Tax Staff'],
  ['343','Chef','Koki','Food safety','Waiter'],
  ['214','Mechanical Engineer','Insinyur Mesin','Thermodynamics','Electrician'],
  ['251','Backend Developer','Pengembang Backend','SQL','Graphic Designer'],
  ['222','Nurse','Perawat','Patient care','Receptionist'],
  ['234','Primary School Teacher','Guru Sekolah Dasar','Lesson planning','Administrative Assistant'],
  ['741','Electrician','Teknisi Listrik','Electrical wiring','Plumber'],
  ['216','Graphic Designer','Desainer Grafis','Adobe Illustrator','Sales Staff'],
  ['122','Sales Manager','Manajer Penjualan','Sales forecasting','Accountant'],
  ['432','Inventory Clerk','Petugas Persediaan','Inventory control','Security Guard'],
];
const scenarios=['experienced','synonym','different-headline','unconfirmed-level','confirmed-gap','missing-skill','fresh-graduate','career-change','senior','partial-dates','negated-skill','processing'];
export function makeHrBenchmark(){
  const jobs:any[]=[],profiles:Array<{jobId:string;split:string;id:string;scenario:string;cvText:string;profile:HrProfile}>=[];
  const roles=occupations.flatMap(([familyId,name,nameId,,other],i)=>[
    {id:'role'+i,name,nameId,familyId,canonicalRoleId:null,matchingApproved:true,archivedAt:null,family:{id:familyId,name:'Fixture '+familyId,archivedAt:null},aliases:[]},
    {id:'other'+i,name:other,familyId:'other'+i,canonicalRoleId:null,matchingApproved:true,archivedAt:null,family:{id:'other'+i,name:'Other fixture',archivedAt:null},aliases:[]},
  ]);
  const skills=occupations.map((o,i)=>({id:'skill'+i,name:o[3],slug:'skill'+i,matchingKind:'PROFESSIONAL',aliases:[]}));
  const catalog:HrCatalog={roles,skills,languages:[],revision:'hr-benchmark-v1',index:new EmployeeOccupationIndex(roles)};
  for(const split of ['tuning','evaluation'])for(let i=0;i<10;i++){
    const jobId=split+'-job'+i;
    jobs.push({id:jobId,companyId:'synthetic-company',title:occupations[i][1],jobTitleId:'role'+i,workMode:'ONSITE',experienceYearsMin:2,jobSkills:[{skillId:'skill'+i,skill:skills[i],isRequired:true,weight:1,minLevel:'INTERMEDIATE'}],jobLanguages:[]});
    for(let n=0;n<12;n++){
      const id=jobId+'-candidate'+n,facts=emptyHrFacts();
      const different=[2,7].includes(n),title=different?occupations[i][4]:n===1?occupations[i][2]:occupations[i][1];
      facts.roles=[{key:'role',jobTitleId:(different?'other':'role')+i,title,source:'CV',confirmed:false}];
      if(![5,10,11].includes(n))facts.skills=[{key:'skill',skillId:'skill'+i,level:n===3?null:n===4?'BEGINNER':n===8?'EXPERT':'ADVANCED',source:'USER',confirmed:n!==3}];
      if(![6,11].includes(n))facts.experiences=[{key:'exp',jobTitleId:(n===7?'other':'role')+i,title:n===2?occupations[i][1]:title,startDate:n===9?null:n===8?'2010-01-01':split==='tuning'?'2020-03-01':'2019-07-01',endDate:'2025-01-01',isCurrent:false,seniority:null,source:'CV',confirmed:false}];
      if(n===6)facts.experienceComplete=true;
      const cvText=['Synthetic '+id,title,n===6?'Fresh graduate':n===7?'Career transition':'Professional experience',...facts.experiences.map(e=>`${e.title}\nCompany ${id}\n${e.startDate??'Date missing'} - 2025-01-01`),'Skills',n===10?'No experience with '+skills[i].name:facts.skills.length?skills[i].name:'Skills not provided'].join('\n');
      profiles.push({jobId,split,id,scenario:scenarios[n],cvText,profile:{id,skills:[],experiences:[],languages:[],hr:{facts,state:n===11?'CV_PROCESSING':'READY',asOf:'2026-01-01T00:00:00Z',source:'APPLICATION',revision:id}}});
    }
  }
  return {catalog,jobs,profiles};
}
function main(){
  const directory=path.resolve(process.argv[2]??'output/hr-ranking-benchmark');fs.mkdirSync(directory,{recursive:true});
  const data=makeHrBenchmark(),digest=hrHash(data),manifest={version:'hr-benchmark-v1',digest,jobs:20,families:10,profiles:240,tuningJobs:10,evaluationJobs:10};
  const output=data.jobs.map(job=>({job,split:job.id.startsWith('evaluation')?'evaluation':'tuning',candidates:data.profiles.filter(p=>p.jobId===job.id).map(p=>({...p,assessment:evaluateHr(p.profile,job,data.catalog,new Date('2026-11-03'))})).sort((a,b)=>compareHr(a.assessment,b.assessment)||a.id.localeCompare(b.id))}));
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(directory,'fixtures.json'),JSON.stringify(data,null,2));
  fs.writeFileSync(path.join(directory,'algorithm-results.json'),JSON.stringify(output,null,2));
  const reviewFile=path.join(directory,'human-review.json');
  if(!fs.existsSync(reviewFile))fs.writeFileSync(reviewFile,JSON.stringify({digest,labels:data.profiles.map(p=>({jobId:p.jobId,profileId:p.id,relevance:null,requirementGroup:null,reviewer:null}))},null,2));
  const review=JSON.parse(fs.readFileSync(reviewFile,'utf8'));if(review.digest!==digest)throw Error('Review fixture digest changed');
  const evaluation=review.labels.filter((l:any)=>l.jobId.startsWith('evaluation'));
  const validated=evaluation.length===120&&evaluation.every((l:any)=>Number.isInteger(l.relevance)&&l.relevance>=0&&l.relevance<=3&&['MET','INCOMPLETE','UNMET','UNASSESSABLE'].includes(l.requirementGroup)&&typeof l.reviewer==='string'&&l.reviewer.trim());
  let metrics:Record<string,number>|null=null;
  if(validated){let dcg=0,accuracy=0,pairs=0,concordant=0;
    for(const group of output.filter(g=>g.split==='evaluation')){
      const labels=new Map(evaluation.filter((l:any)=>l.jobId===group.job.id).map((l:any)=>[l.profileId,l]));
      const grades=group.candidates.map(p=>(labels.get(p.id) as any).relevance as number);
      const score=(v:number[])=>v.slice(0,10).reduce((s,g,i)=>s+(2**g-1)/Math.log2(i+2),0);
      const ideal=score([...grades].sort((a,b)=>b-a));dcg+=ideal?score(grades)/ideal:1;
      group.candidates.forEach(p=>{if(p.assessment.requirementGroup===(labels.get(p.id) as any).requirementGroup)accuracy++;});
      for(let a=0;a<grades.length;a++)for(let b=a+1;b<grades.length;b++)if(grades[a]!==grades[b]){pairs++;if(grades[a]>grades[b])concordant++;}
    }
    metrics={ndcg10:dcg/10,groupAccuracy:accuracy/120,pairwise:pairs?concordant/pairs:1};
  }
  const report={...manifest,humanValidated:validated,metrics,activationGatePassed:!!metrics&&metrics.groupAccuracy===1&&metrics.ndcg10>=.85&&metrics.pairwise>=.9};
  fs.writeFileSync(path.join(directory,'quality-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main();
