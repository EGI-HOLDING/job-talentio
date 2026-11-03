import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsService } from '../applications/applications.service';
import { MatchingService } from './matching.service';
import { rankHrApplications, loadHrCatalog } from './recruiter-ranking.service';
import { HR_PARSER, HR_VERSION, emptyHrFacts, parseHrEvidence } from './recruiter-ranking';
import { freezeHrSubmission } from './recruiter-evidence';
import { RecruiterEvidenceWorker } from './recruiter-evidence.worker';
import type { AuthUser } from '../common/auth.decorators';
import type { StorageService } from '../storage/storage.service';

async function main(){
  const url=new URL(process.env.DATABASE_URL!);assert.match(url.pathname,/^\/talentio_hr_v2_it_\d+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5434');
  const db=new PrismaService();let count=0;const check=(v:unknown,m:string)=>{assert.ok(v,m);count++;};
  try{
    const hr=await db.user.create({data:{id:'hr',fullName:'Synthetic HR',role:'RECRUITER'}}) as AuthUser;
    const company=await db.company.create({data:{id:'company',name:'Synthetic HR company',slug:'hr-v2-fixture',members:{create:{userId:hr.id,role:'OWNER'}}}});
    const companies={assertMember:async(user:AuthUser,id:string)=>{if(user.id!==hr.id||id!==company.id)throw Error('Forbidden company');}};
    const matching=new MatchingService(db),service=new ApplicationsService(db,{} as never,companies as never,matching,{create:async()=>{}} as never,{} as never);
    await db.jobFamily.create({data:{id:'f',code:'241',name:'Finance professionals',source:'Synthetic test',sourceVersion:'1'}});
    await db.jobTitle.create({data:{id:'accountant',name:'Accountant',slug:'accountant',normalizedKey:'accountant',familyId:'f',matchingApproved:true}});
    await db.jobTitle.create({data:{id:'akuntan',name:'Akuntan',slug:'akuntan',normalizedKey:'akuntan',familyId:'f',canonicalRoleId:'accountant',matchingApproved:true}});
    await db.skill.create({data:{id:'ledger',name:'Ledger',nameId:'Buku Besar',slug:'ledger',matchingKind:'PROFESSIONAL'}});
    const job=await db.jobPost.create({data:{id:'job',title:'Accountant',jobTitleId:'accountant',companyId:company.id,description:'Synthetic job',status:'PUBLISHED',publishedAt:new Date(),jobSkills:{create:{skillId:'ledger',minLevel:'ADVANCED',weight:1,isRequired:true}}}});
    let catalog=await loadHrCatalog(db);
    const facts=parseHrEvidence('Synthetic Person\nAkuntan\nSkills\nLedger\nWork experience\nAkuntan\nPT Synthetic\nJanuary 2020 - January 2025',catalog);
    const skillKey=facts.skills[0].key;
    for(let i=0;i<111;i++){
      const user=await db.user.create({data:{id:'u'+i,fullName:'Synthetic Applicant '+i,role:'EMPLOYEE',employeeProfile:{create:{id:'p'+i}}}});
      const resume=await db.resume.create({data:{id:'r'+i,profileId:'p'+i,title:'Submitted fixture CV',fileKey:'hr-fixtures/'+i+'.pdf',isPrimary:true}});
      const version=await db.resumeVersion.create({data:{id:'v'+i,resumeId:resume.id,fileKey:resume.fileKey!,parseGeneration:1,parseStatus:'READY',matchingData:{headline:'Akuntan',skills:[],experiences:[],educations:[]}}});
      await db.resume.update({where:{id:resume.id},data:{currentVersionId:version.id}});
      const at=new Date('2026-01-01'),snapshot=freezeHrSubmission(version,{},at);
      snapshot.corrections=[{kind:'SKILL',key:skillKey,value:{skillId:'ledger',level:i===110?'EXPERT':i===109?'BEGINNER':null}}];
      await db.application.create({data:{id:'app'+String(i).padStart(3,'0'),jobPostId:job.id,profileId:'p'+i,resumeId:resume.id,resumeVersionId:version.id,createdAt:at,matchScore:3,matchBreakdown:{version:'historical',total:3},resumeSnapshot:{resume:{fileKey:resume.fileKey,title:'Submitted fixture CV'},cvEvidence:version.matchingData},hrSubmissionSnapshot:JSON.parse(JSON.stringify(snapshot))}});
      await db.resumeRecruiterEvidence.create({data:{versionId:version.id,parserVersion:HR_PARSER,catalogRevision:catalog.revision,generation:1,status:i===108?'PENDING':'READY',facts:JSON.parse(JSON.stringify(facts))}});
    }
    const first=await service.searchForJob(hr,job.id,{sort:'match',page:1,limit:10},'id');
    check(first.items[0].id==='app110','best applicant beyond scan batch appears first');
    check((first.items[0] as any).rank===1&&(first.items[0] as any).rankingVersion===HR_VERSION,'active metadata and rank');
    check(first.total===111,'all applicants remain visible');
    const detail=await service.getForJob(hr,job.id,'app110','id');check(detail.matchScore===first.items[0].matchScore,'list/detail identical');
    check((detail as any).rank===1,'detail rank uses full pool');
    check(!JSON.stringify(detail).includes('hr-fixtures/')&&!('hrSubmissionSnapshot' in detail),'storage keys and frozen private payload hidden');
    const before=await db.application.findUniqueOrThrow({where:{id:'app110'}});
    await db.profileSkill.create({data:{profileId:'p110',skillId:'ledger',level:'BEGINNER',levelSource:'USER_CONFIRMED'}});
    await db.employeeProfile.update({where:{id:'p110'},data:{headline:'Sales'}});
    check((await service.getForJob(hr,job.id,'app110','id')).matchScore===detail.matchScore,'mutable profile does not change submitted evidence');
    await service.rescore(hr,'app110');
    const after=await db.application.findUniqueOrThrow({where:{id:'app110'}});
    check(after.matchScore===3&&JSON.stringify(before.hrSubmissionSnapshot)===JSON.stringify(after.hrSubmissionSnapshot),'rescore preserves original score and submission');
    await assert.rejects(()=>db.application.update({where:{id:'app110'},data:{hrSubmissionSnapshot:{changed:true}}}));count++;
    await assert.rejects(()=>db.application.update({where:{id:'app110'},data:{hrSubmissionSnapshot:require('@prisma/client').Prisma.DbNull}}));count++;
    check(await db.applicationRecruiterEvaluation.count({where:{applicationId:'app110'}})===1,'duplicate input does not duplicate evaluation history');
    const filtered=await service.searchForJob(hr,job.id,{sort:'match',page:1,limit:10,skills:'ledger',skillMode:'AND'},'id');check(filtered.total===110,'filter uses submitted evidence, excluding processing only when filter explicit');
    const newest=await service.searchForJob(hr,job.id,{sort:'newest',page:1,limit:10},'id');check(newest.items[0].id==='app000','newest uses stable creation order');
    await assert.rejects(()=>service.searchForJob({id:'outsider'} as AuthUser,job.id,{sort:'match',page:1,limit:10},'id'));count++;
    const pages=new Set<string>();for(let page=1;page<=12;page++){const result=await service.searchForJob(hr,job.id,{sort:'match',page,limit:10},'id');for(const row of result.items)pages.add(row.id);}check(pages.size===111,'pagination has no lost or duplicate applicants');
    const tied=first.items.slice(1);check(tied.every(row=>(row as any).rank===2),'equal competence shares rank');
    await db.jobPostSkill.updateMany({where:{jobPostId:job.id},data:{minLevel:'EXPERT'}});
    const changed=await service.searchForJob(hr,job.id,{sort:'match',page:1,limit:10},'id');check(changed.rankingRevision!==first.rankingRevision,'employer requirement change refreshes ranking');
    check(await db.applicationRecruiterEvaluation.count({where:{applicationId:'app110'}})===2,'requirements change creates new evaluation history');
    await db.jobPostSkill.deleteMany({where:{jobPostId:job.id}});
    const empty=await service.searchForJob(hr,job.id,{sort:'match',page:1,limit:10},'id');check(empty.state==='JOB_REQUIREMENTS_REQUIRED'&&empty.items[0].id==='app000','unmeasurable job uses newest without a false rank');
    await db.jobPostSkill.create({data:{jobPostId:job.id,skillId:'ledger',minLevel:'ADVANCED'}});
    // Actual PDF extraction and historical, non-primary CV worker recovery.
    const PDFDocument=require('pdfkit');const doc=new PDFDocument();const chunks:Buffer[]=[];const complete=new Promise<Buffer>(resolve=>{doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));});
    doc.text('Synthetic Applicant\nAccountant\nSkills\nLedger\nProfessional experience\nAccountant\nSynthetic Company\nJanuary 2020 - January 2025');doc.end();const buffer=await complete;
    const worker=new RecruiterEvidenceWorker(db,{getObjectBuffer:async()=>buffer} as unknown as StorageService,new ConfigService({CV_PARSE_OCR:'false'}));
    const pending=await db.resumeRecruiterEvidence.findFirstOrThrow({where:{versionId:'v108'}});await worker.process(pending.id);
    check((await db.resumeRecruiterEvidence.findUniqueOrThrow({where:{id:pending.id}})).status==='READY','worker reads actual PDF for submitted CV');
    // Generation changed while storage was blocked: an old worker cannot publish.
    await db.resumeRecruiterEvidence.update({where:{id:pending.id},data:{status:'PENDING'}});let release!:()=>void;const wait=new Promise<void>(r=>release=r);let reached!:()=>void;const started=new Promise<void>(r=>reached=r);
    const slow=new RecruiterEvidenceWorker(db,{getObjectBuffer:async()=>{reached();await wait;return buffer;}} as unknown as StorageService,new ConfigService({CV_PARSE_OCR:'false'}));
    const running=slow.process(pending.id);await started;await db.resumeVersion.update({where:{id:'v108'},data:{parseGeneration:2}});release();await running;
    check((await db.resumeRecruiterEvidence.findUniqueOrThrow({where:{id:pending.id}})).status!=='READY','generation fence rejects late result');
    const originalFind=db.resumeRecruiterEvidence.findMany;
    try{db.resumeRecruiterEvidence.findMany=(async()=>{throw Error('Injected HR evidence outage');}) as typeof originalFind;
      const fallback=await service.searchForJob(hr,job.id,{sort:'match',page:1,limit:10},'id');check(fallback.rankingAvailable===false&&fallback.total===111&&fallback.items[0].id==='app000','ranking outage preserves all applicants in newest order');
    }finally{db.resumeRecruiterEvidence.findMany=originalFind;}
    if(process.argv.includes('--performance')){
      const timing:unknown[]=[];
      for(const size of [100,1000,5000]){
        const ids=Array.from({length:size},(_,i)=>'perf'+size+'-'+i);
        await db.user.createMany({data:ids.map(id=>({id,fullName:'Synthetic '+id,role:'EMPLOYEE' as const}))});
        await db.employeeProfile.createMany({data:ids.map(id=>({id,userId:id}))});
        const template=await db.application.findUniqueOrThrow({where:{id:'app110'}});
        await db.application.createMany({data:ids.map(id=>({id,jobPostId:job.id,profileId:id,resumeVersionId:'v110',createdAt:template.createdAt,matchScore:3,hrSubmissionSnapshot:template.hrSubmissionSnapshot!,resumeSnapshot:template.resumeSnapshot!}))});
        const where={jobPostId:job.id,id:{in:ids}};const samples:number[]=[];const cold=performance.now();await rankHrApplications(db,where,job.id,{page:1,limit:10});const coldMs=performance.now()-cold;
        for(let n=0;n<12;n++){const start=performance.now();await rankHrApplications(db,where,job.id,{page:1,limit:10});samples.push(performance.now()-start);}
        const baseline:number[]=[];process.env.HR_RANKING_V2_MODE='off';
        try{for(let n=0;n<3;n++){const start=performance.now();await (service as any).applicationWindow(where,job.id,{sort:'match',page:1,limit:10});baseline.push(performance.now()-start);}}
        finally{process.env.HR_RANKING_V2_MODE='enabled';}
        timing.push({applicants:size,baselineP95Ms:Math.round(Math.max(...baseline)),coldMs:Math.round(coldMs),warmP95Ms:Math.round(samples.sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1])});
      }
      fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/hr-ranking-performance.json',JSON.stringify(timing,null,2));console.log(JSON.stringify({performance:timing}));
    }
    console.log(JSON.stringify({suite:'hr-ranking-db',passed:count,database:'disposable',humanValidated:false}));
  }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
