import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JobsService } from '../../jobs/jobs.service';
import { RecruitmentService } from './recruitment.service';
import { CvScoringService } from './cv-scoring.service';
import { scoringJob,scoreJobInclude,sameScoringJob } from './cv-job-context';
import { CV_RUBRIC,fileChecksum } from './cv-scoring.policy';
import { InvitationsService } from './invitations.service';
import { ScreeningPackets } from '../screening-packets.service';

const db=new PrismaService();
async function main(){
 await db.$connect();process.env.TARA_SCREENING_ENABLED='true';process.env.TARA_SCREENING_MARKET='id';
 const hr={id:'stale-hr',role:'RECRUITER',email:'stale-hr@example.test',fullName:'HR',isBanned:false} as const;
 await db.user.create({data:hr});
 const company=await db.company.create({data:{id:'stale-co',name:'Stale Company',slug:'stale-company',members:{create:{userId:hr.id,role:'OWNER'}}}});
 const companies={assertMember:async(user:{id:string},id:string)=>{if(user.id!==hr.id||id!==company.id)throw Error('Forbidden');return {company};},assertOpen:()=>{}};
 const job=await db.jobPost.create({data:{id:'stale-job',companyId:company.id,title:'Backend Developer',description:'Mengembangkan layanan backend dengan Node.js.',status:'PUBLISHED',workMode:'REMOTE'},include:scoreJobInclude});
 assert.ok(sameScoringJob({skills:[{name:'B',level:1},{name:'A',level:2}]},{skills:[{level:2,name:'A'},{level:1,name:'B'}]}),'relationship ordering is not a scoring change');
 const bytes=Buffer.from('%PDF-1.4 synthetic CV'),text='Mengembangkan API Node.js selama empat tahun.';
 const objects=new Map<string,Buffer>([['cvs/stale.pdf',bytes]]);
 const storage={getObjectBuffer:async(key:string)=>objects.get(key)!,getPresignedPutUrl:async(key:string)=>'https://private.test/'+key,putObject:async(key:string,data:Buffer)=>{objects.set(key,data);},delete:async(key:string)=>{objects.delete(key);}};
 const row=await db.recruitmentCandidate.create({data:{id:'stale-candidate',companyId:company.id,jobId:job.id,filename:'CV.pdf',fileKey:'cvs/stale.pdf',contentType:'application/pdf',sizeBytes:bytes.length,checksum:fileChecksum(bytes),fullName:'Synthetic Candidate',email:'stale@example.test',scoreStatus:'READY',cvScore:75,jobSnapshot:scoringJob(job),cvResult:{cvText:text}}});
 const service=new RecruitmentService(db,storage as never,companies as never);
 const jobs=new JobsService(db,companies as never,{} as never,{} as never,{syncJob:async()=>{}} as never,{} as never);
 const invitations=new InvitationsService(db,new ConfigService({JWT_SECRET:'stale-test-signing-secret-for-disposable-tests-only',WEB_URL:'https://local.example.test'}),service,storage as never,{} as never,{} as never,{} as never,new ScreeningPackets(db));
 const inviteInput={mode:'TEXT' as const,requestKey:'stale-invitation-request'};
 const invitation=await invitations.create(hr,row.id,inviteInput);
 const frozen=JSON.stringify((await db.screeningInvitation.findUniqueOrThrow({where:{id:invitation.id}})).snapshot);
 await jobs.update(hr,job.id,{salaryMax:15000000});
 assert.equal((await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}})).scoreStatus,'READY','salary edit does not invalidate criteria');
 await db.aiScreeningWork.create({data:{kind:'CV_SCORE',subjectId:row.id,key:'CV_SCORE:'+row.id+':0'}});
 await jobs.update(hr,job.id,{description:'Mengembangkan layanan data dengan Python dan PostgreSQL.'});
 let saved=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}});
 assert.equal(saved.scoreStatus,'STALE');assert.equal(saved.cvScore,null);assert.equal(saved.revision,1);
 assert.equal((await db.aiScreeningWork.findUniqueOrThrow({where:{key:'CV_SCORE:'+row.id+':0'}})).status,'DONE');
 assert.equal((await invitations.create(hr,row.id,inviteInput)).id,invitation.id,'idempotent replay returns frozen invitation even after criteria change');
 await assert.rejects(invitations.create(hr,row.id,{...inviteInput,requestKey:'stale-new-invitation-request'}));
 assert.equal(JSON.stringify((await db.screeningInvitation.findUniqueOrThrow({where:{id:invitation.id}})).snapshot),frozen,'existing invitation retains original job and score');
 let release!:()=>void,started!:()=>void,calls=0;
 const gate=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r);
 const provider={run:async()=>{calls++;started();await gate;return {readable:true,fullName:'Synthetic Candidate',email:'stale@example.test',phone:null,headline:'Developer',summary:'Pengalaman API.',cvText:text,criteria:CV_RUBRIC.map(c=>({criterionId:c.id,level:3,reason:'Tertulis di CV.',evidence:[text]})),limitations:[]};}};
 const scorer=new CvScoringService(db,storage as never,provider as never,new ConfigService({}));
 await service.retry(hr,row.id);
 const work=await db.aiScreeningWork.findUniqueOrThrow({where:{key:'CV_SCORE:'+row.id+':2'}});
 const running=scorer.process(work.id,row.id);await begun;
 const pendingCall=await db.aiScreeningCall.create({data:{key:'stale-running-provider-call',workId:work.id,subjectId:row.id,task:'cv-score',model:'gpt-6-luna',promptVersion:'test',inputHash:'old-criteria',status:'RUNNING',responseId:'resp_stale_criteria'}});

 await jobs.update(hr,job.id,{description:'Mengembangkan layanan data Python, PostgreSQL, dan Apache Kafka.'});
 saved=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}});
 assert.equal(saved.scoreStatus,'STALE');assert.equal(saved.cvScore,null,'old in-flight result cannot restore obsolete score');
 assert.equal(calls,1,'job edits never invoke paid scoring');
 await assert.rejects(service.bulk(hr,{companyId:company.id,selection:{ids:[row.id,'foreign-candidate']},action:{kind:'rescore'}}));
 try {
  assert.equal((await service.bulk(hr,{companyId:company.id,selection:{ids:[row.id]},action:{kind:'rescore'}})).count,1,'an explicit rescore with changed criteria does not resume an obsolete running response');
 } finally { release();await running; }
 assert.equal((await db.aiScreeningCall.findUniqueOrThrow({where:{id:pendingCall.id}})).responseId,'resp_stale_criteria');
 assert.equal((await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}})).scoreStatus,'PENDING','old result cannot overwrite the explicitly requested new criteria');

 await scorer.failure(row.id,'OLD_FAILURE',work.key);
 saved=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.scoreStatus,'PENDING','old worker failure cannot fail a new revision');
 await scorer.process(work.id,row.id);assert.equal(calls,1,'obsolete durable work cannot spend on a newer revision');
 const latest=await db.aiScreeningWork.findUniqueOrThrow({where:{key:'CV_SCORE:'+row.id+':4'}});
 await scorer.process(latest.id,row.id);assert.equal(calls,2);assert.equal((await db.recruitmentCandidate.findUniqueOrThrow({where:{id:row.id}})).cvScore,75);
 const batch=await service.createImport(hr,{companyId:company.id,jobId:job.id,requestKey:'stale-upload-request',files:[{clientId:'one',filename:'Other.pdf',size:bytes.length,contentType:'application/pdf'}]});
 const uploading=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:batch.files[0].id}});objects.set(uploading.uploadKey!,bytes);
 await jobs.update(hr,job.id,{description:'Mengembangkan layanan data Python, PostgreSQL, Kafka, dan Redis.'});
 await service.completeUpload(hr,uploading.id);
 const uploaded=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:uploading.id}});
 const uploadWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:'CV_SCORE:'+uploaded.id+':'+uploaded.revision}});
 await scorer.process(uploadWork.id,uploaded.id);assert.equal((await db.recruitmentCandidate.findUniqueOrThrow({where:{id:uploaded.id}})).scoreStatus,'READY','upload spanning a job edit uses latest job snapshot and revision');
 console.log('CV staleness integration passed: actual JobsService edits, relevant criteria only, no automatic AI spending, frozen invitation/idempotency, in-flight result/failure isolation, bulk rescore, and upload spanning job edit. Paid calls: 0.');
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});
