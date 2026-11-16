import { scoringJob,scoreJobInclude } from './cv-job-context';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecruitmentService } from './recruitment.service';
import { InvitationsService } from './invitations.service';
import { invitationToken, validInvitationToken, tokenHash } from './invitation.policy';
import { ScreeningPackets } from '../screening-packets.service';
import { ScreeningCandidatePlans } from '../screening-candidate-plans.service';
import { ScreeningSessions } from '../screening-sessions.service';
import { ScreeningWorker } from '../screening-worker.service';
import { MatchingService } from '../../matching/matching.service';
import { fileChecksum } from './cv-scoring.policy';
import type { AuthUser } from '../../common/auth.decorators';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceService } from '../voice/voice.service';
import { VoiceProvider } from '../voice/voice.provider';
import { VoiceTranscriptJournal } from '../voice/voice-transcript-journal';
import type { NativeDelivery } from '../voice/voice-native';
import { UserErasureService } from '../../users/user-erasure.service';
import { CURRENT_CONVERSATION } from '../conversation.policy';
import { TAKA_INTERVIEW_VERSION } from '../taka-interview';
import { frozenRoleRubric, ROLE_ASSESSMENT_VERSION, ROLE_RUBRIC_VERSION } from '../role-rubric';
import type { PackagePayload } from '../screening.schemas';
import type { RoleAssessment } from '../taka-role-assessment';
import { TAKA_LIVE_COMPLETION_VERSION, TAKA_ROLE_EVIDENCE_VERSION, TAKA_ROLE_VALIDATION_VERSION } from '../taka-versions';
import { liveCompletion, liveEvaluationKey, markLiveEvaluationUnrecoverable } from '../voice/voice-completion';
import { hash } from '../screening.policy';
import { inspectTakaReassessment, queueTakaReassessment, TAKA_REASSESS_KIND } from '../taka-reassessment';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';

const db=new PrismaService();
async function main(){
 const audiblePacket = Buffer.alloc(960);
 for (let offset = 0; offset < audiblePacket.length; offset += 2) audiblePacket.writeInt16LE(1200, offset);
 const voiceDelta = audiblePacket.toString('base64');
 await db.$connect();process.env.TARA_SCREENING_ENABLED='true';process.env.TARA_SCREENING_MARKET='id';
 process.env.TARA_TIMED_INTERVIEW_ENABLED='false';process.env.TARA_SKILL_INTERVIEW_ENABLED='true';
 process.env.TAKA_INTERVIEW_EVIDENCE_ENABLED='false';
 const hr:AuthUser={id:'invite-hr',fullName:'Invitation HR',role:'RECRUITER',email:'hr-invite@example.test',isBanned:false};
 await db.user.create({data:{id:hr.id,fullName:hr.fullName,role:'RECRUITER',email:hr.email}});
 const company=await db.company.create({data:{id:'invite-co',name:'Invitation Company',slug:'invitation-test-company',members:{create:{userId:hr.id,role:'OWNER'}}}});
 const job=await db.jobPost.create({data:{id:'invite-job',companyId:company.id,title:'Backend Developer',description:'Membangun API dan dokumentasi layanan.',status:'PUBLISHED'},include:scoreJobInclude});
 const bytes=Buffer.from('%PDF-1.4 synthetic immutable CV'),cvText=['Kandidat Undangan',...Array.from({length:10},(_,i)=>`Membantu tim proyek ${i+1} membangun API dengan Node.js.`)].join('\n');
 const candidate=await db.recruitmentCandidate.create({data:{id:'invite-candidate',companyId:company.id,jobId:job.id,fullName:'Kandidat Undangan',email:'invited@example.test',filename:'CV.pdf',fileKey:'cvs/invite.pdf',contentType:'application/pdf',sizeBytes:bytes.length,checksum:fileChecksum(bytes),scoreStatus:'READY',cvScore:87.5,jobSnapshot:scoringJob(job),cvResult:{cvText},stage:'IN_REVIEW'}});
 const objects=new Map<string,Buffer>([['cvs/invite.pdf',bytes]]),emails:Array<{to:string;html:string}>=[];
 const storage={getObjectBuffer:async(key:string)=>{if(!objects.has(key))throw Error('Missing file');return objects.get(key)!;},putObject:async(key:string,data:Buffer)=>{objects.set(key,data);},delete:async(key:string)=>{objects.delete(key);},getPresignedGetUrl:async(key:string)=>'https://private.test/'+key};
 const companies={assertMember:async(user:AuthUser,id:string)=>{if(user.id!==hr.id||id!==company.id)throw Error('Forbidden');return {company};},assertOpen:()=>{}};
 const config=new ConfigService({JWT_SECRET:'invitation-test-signing-key-not-used-in-production',WEB_URL:'https://local.example.test',CV_PARSE_OCR:'false'});
 const packets=new ScreeningPackets(db),plans=new ScreeningCandidatePlans(db,packets),sessions=new ScreeningSessions(db,storage as never,companies as never,packets,config,plans);
 let mailUncertain=false;
 const candidates=new RecruitmentService(db,storage as never,companies as never),mail={send:async(to:string,_subject:string,html:string)=>{emails.push({to,html});return mailUncertain?null:{id:'mock-email'};}};
 const invitations=new InvitationsService(db,config,candidates,storage as never,plans,sessions,mail as never,packets);
 let calls=0, alternativeSkillFixture=false, corruptTakaRef=false;
 let candidateCvSegments: string[] = [];
 const takaRequests: string[][] = [];
 const roleRequests: Array<{ criteria: string[]; answerCount: number }> = [];
 let roleRepairFixture = false;
 const roleRepairAttempts: string[][] = [];
 function roleJudgement(input: { criteria: Array<{ id: string; name: string }>; evidence: Array<{ id: string; ref: string; text: string }>;
  transcript: Array<{ id: string; question?: boolean; topicId?: string }> }) {
  roleRequests.push({ criteria: input.criteria.map(row => row.id), answerCount: new Set(input.evidence.map(row => row.ref)).size });
  return { criteria: Object.fromEntries(input.criteria.map(row => {
   const first = row.name.includes('endpoint');
   const evidence = input.evidence.find(item => item.text.includes(first ? 'menulis endpoint' : 'menyusun panduan API'));
   return [row.id, { level: evidence ? first ? 4 : 3 : null, clarity: evidence ? first ? 3 : 4 : null,
    basis: evidence ? 'EVIDENCE' : 'INSUFFICIENT', evidence: evidence ? [evidence.id] : [],
    questionRef: input.transcript.find(turn => turn.question && turn.topicId === row.id)?.id ?? null,
    redirectRef: null, discrepancyRef: null, reason: 'Tindakan kandidat dinilai dengan patokan lowongan.' }];
  })) };
 }
 function takaJudgement(input: { claims: Array<{id:string}>; evidenceCatalog: Array<{id:string;text:string}> }) {
  takaRequests.push(input.claims.map(c=>c.id));
  const evidence=input.evidenceCatalog.find(row=>row.text.includes('menulis endpoint Node.js'));
  const quoteRef=corruptTakaRef?'answer:other-session:0':evidence?.id;
  corruptTakaRef=false;
  return { claims:Object.fromEntries(input.claims.map(c=>[c.id,c.id==='skill-0'&&quoteRef
   ? {level:'STRONG',reason:'Kandidat menjelaskan bagian endpoint yang ia kerjakan.',evidence:[{quoteRef,fields:['TASK','ACTION']}],discrepancyRef:null}
   : null])) };
 }
 const rubric={context:'Layanan backend',criteria:['API','Dokumentasi','Pengujian'].map((name,i)=>({id:'c'+i,name,requirementRef:'API',anchors:['Tidak tersedia','Terbatas','Sebagian','Jelas','Lengkap']}))};
 let liveAgendaCalls=0;
 const provider={run:async(_work:string,_subject:string,task:string,input:any,preset?:{version:string;instructions?:string})=>{
  calls++;
  if(task==='prepare')return rubric;
  if(task==='live-agenda'){
   liveAgendaCalls++;
   const criteria=input.criteria as Array<{id:string;name:string}>;
   const englishLabels:Record<string,string>={'Bangun endpoint API':'Build an API endpoint','Tulis panduan penggunaan API':'Write an API usage guide',
    'Tangani insiden produksi':'Handle production incidents','Kelola persetujuan akses admin':'Manage administrator access approvals'};
   return {topics:criteria.map(({id,name})=>({criterionId:id,equivalentIds:[],
    question:name.includes('endpoint')?'Apa langkah pertama lu untuk membuat endpoint API yang aman?':'Gimana lu akan menyusun panduan penggunaan API untuk tim baru?'})),
    ...(preset?.instructions?.includes('nama singkat dalam English')?{displayLabels:criteria.map(({id,name})=>({criterionId:id,name:englishLabels[name]??name}))}:{}),
    merges:[]};
  }
  if(task==='candidate'&&input.duties){
   candidateCvSegments=input.cvSegments.map((row:{text:string})=>row.text);
   const line=input.cvSegments.find((row:{text:string})=>row.text.includes('Node.js'));
   if(input.coreCriterionIds){
    const target=(input.job as PackagePayload).criteria.find(row=>row.name.includes('endpoint'));
    return {claims:line&&target?[{sourceRef:line.id,skillText:'Node.js',criterionId:target.id,relevance:'CORE'}]:[]};
   }
   return {claims:alternativeSkillFixture?[]:[
    {sourceRef:line.id,skillText:'Node.js',criterionId:'c0',relevance:'CORE'},
    {sourceRef:'unknown-line',skillText:'Unstated skill',criterionId:'c0',relevance:'CORE'},
    {sourceRef:line.id,skillText:'API',criterionId:'c0',relevance:'CORE'},
   ]};
  }
  if(task==='follow-up'&&input.topic){
   const answer=input.chain.at(-1).answer;
   const unrelated=answer.includes('mengelola gudang');
   return {outcome:unrelated?'OFF_TOPIC':'EXAMPLE',answerQuote:answer,question:'Gue tarik balik dikit ya. Bagian mana yang lu kerjain pakai keahlian tadi?',
    ...(input.assessmentTopics?{evidence:unrelated?[]:input.assessmentTopics.map((topic:any)=>({
    topicId:topic.id,quote:answer,fields:answer.includes('mendokumentasikan perubahan')||
      topic.id==='skill-0'&&answer.includes('menulis dokumentasi API')||
      topic.id===input.topic.id&&/di proyek inventaris/iu.test(answer)?topic.fields:['TASK','ACTION'],
    }))}:{})};
  }
  if(task==='evaluate'&&preset?.version===TAKA_INTERVIEW_VERSION)return takaJudgement(input);
  if(task==='evaluate'&&preset?.version===ROLE_ASSESSMENT_VERSION)return roleJudgement(input);
  throw Error('Unexpected task '+task);
 }};
 const worker=new ScreeningWorker(db,config,storage as never,new MatchingService(db),packets,sessions,plans,provider as never,undefined,candidates,invitations);
 async function deliver(kind:string,subjectId?:string,via=worker){
  if(kind==='CANDIDATE'&&subjectId){
   const plan=await db.aiCandidatePlan.findUniqueOrThrow({where:{id:subjectId},include:{package:true}});
   if(plan.package.status==='PENDING')await deliver('PREPARE',plan.packageId);
  }
  const work=await db.aiScreeningWork.findFirstOrThrow({where:{kind,...(subjectId?{subjectId}:{}),status:'PENDING'},orderBy:{createdAt:'asc'}});
  const readyIn=+work.availableAt-Date.now();
  if(readyIn>0&&readyIn<=100)await new Promise(resolve=>setTimeout(resolve,readyIn+5));
  await via.process(work.id);
  const saved=await db.aiScreeningWork.findUniqueOrThrow({where:{id:work.id}});
  assert.equal(saved.status,'DONE',kind+': '+saved.error+' next='+saved.availableAt.toISOString());
  return saved;
 }
 const created=await invitations.create(hr,candidate.id,{mode:'TEXT',requestKey:'invite-text-request-001'});
 assert.equal(created.mode,'TEXT');assert.equal(calls,0,'invitation creation uses durable work instead of synchronous model calls');
 assert.equal((await invitations.create(hr,candidate.id,{mode:'TEXT',requestKey:'invite-text-request-001'})).id,created.id);
 await assert.rejects(invitations.create({...hr,id:'foreign-hr'},candidate.id,{mode:'TEXT',requestKey:'foreign-request-001'}));
 let invitation=await db.screeningInvitation.findUniqueOrThrow({where:{id:created.id}});
 const token=invitationToken(invitation.id,invitation.tokenNonce,config.get('JWT_SECRET')!);
 assert.ok(validInvitationToken(token,invitation.tokenHash));assert.ok(!validInvitationToken(token+'x',invitation.tokenHash));assert.equal(tokenHash(token),invitation.tokenHash);
 const preview=await invitations.preview(token);assert.equal(preview.jobTitle,job.title);assert.ok(!('recipientEmail' in preview));assert.ok(!('snapshot' in preview));
 await assert.rejects(invitations.preview(token.slice(0,-1)+(token.endsWith('A')?'B':'A')));
 await deliver('INVITE_DELIVERY',created.id);
 invitation=await db.screeningInvitation.findUniqueOrThrow({where:{id:created.id}});
 assert.equal(invitation.emailStatus,'SENT');assert.equal(invitation.messageStatus,'WAITING_ACCOUNT');assert.equal(emails.length,1);assert.ok(emails[0].html.includes('/id/screening/'));
 await invitations.deliver(created.id);assert.equal(emails.length,1,'delivery retry never resends successful email');
 const user:AuthUser={id:'invite-user',fullName:'Kandidat Undangan',email:'invited@example.test',role:'EMPLOYEE',isBanned:false};
 await db.user.create({data:{id:user.id,fullName:user.fullName,email:user.email,role:'EMPLOYEE',emailVerified:false}});
 await assert.rejects(invitations.claim(user,token));
 await db.user.update({where:{id:user.id},data:{emailVerified:true}});
 const wrong:AuthUser={...user,id:'invite-wrong-user',email:'other@example.test'};
 await db.user.create({data:{id:wrong.id,fullName:'Wrong user',role:'EMPLOYEE',email:wrong.email,emailVerified:true}});
 await assert.rejects(invitations.claim(wrong,token));
 // Simulate an existing invitation on the retired v6 policy with no Taka preset.
 const originalPackage=await db.aiScreeningPackage.findUniqueOrThrow({where:{id:invitation.packageId}});
 const retired=await db.aiScreeningPackage.create({data:{jobId:job.id,version:0,fingerprint:'frozen-v6-fixture',
  jobSnapshot:originalPackage.jobSnapshot!,companySnapshot:originalPackage.companySnapshot!,promptVersion:CURRENT_CONVERSATION.version,
  promptSnapshot:originalPackage.promptSnapshot!,conversationPolicy:CURRENT_CONVERSATION}});
 const oldSnapshot={...(invitation.snapshot as Record<string,unknown>)};
 delete oldSnapshot.takaInterviewAssessment;
 await db.screeningInvitation.update({where:{id:invitation.id},data:{packageId:retired.id,snapshot:oldSnapshot as never}});
 assert.equal((await invitations.preview(token)).conversationPolicy.version,'tara-conversation-v8.0.0');
 const beforeAccounts=await db.user.count();
 const [claim,concurrent]=await Promise.all([invitations.claim(user,token),invitations.claim(user,token)]);
 assert.equal(claim.session.id,concurrent.session.id);assert.equal(await db.user.count(),beforeAccounts,'claim never invents an account');
 assert.equal(objects.size,2,'one original CV and one private pinned screening copy');
 assert.equal(await db.resume.count({where:{profile:{userId:user.id},deletedAt:null}}),0,
  'a CV kept for an invitation does not become an editable CV library item');
 invitation=await db.screeningInvitation.findUniqueOrThrow({where:{id:created.id}});
 assert.equal(invitation.messageStatus,'SENT');assert.equal(await db.chatMessage.count({where:{id:invitation.messageId!}}),1);
 const conversation=await db.conversation.findFirstOrThrow({where:{jobPostId:job.id}});assert.ok(conversation.userAId===user.id||conversation.userBId===user.id);
 const frozenPackage=invitation.packageId;
 assert.notEqual(frozenPackage,retired.id);
 const upgraded=await db.aiScreeningPackage.findUniqueOrThrow({where:{id:frozenPackage}});
 assert.deepEqual(upgraded.jobSnapshot,retired.jobSnapshot);
 assert.deepEqual(upgraded.companySnapshot,retired.companySnapshot);
 assert.deepEqual((invitation.snapshot as Record<string,unknown>).cvResult,oldSnapshot.cvResult);
 assert.equal((invitation.snapshot as any).takaInterviewAssessment.version,TAKA_INTERVIEW_VERSION);
 assert.equal((await db.aiScreeningPackage.findUniqueOrThrow({where:{id:retired.id}})).status,'PENDING');
 await db.jobPost.update({where:{id:job.id},data:{description:'Kebutuhan API pekerjaan telah berubah.',status:'CLOSED'}});
 const newer=await packets.sync(job.id,true);assert.notEqual(newer!.id,frozenPackage);
 await deliver('PREPARE',frozenPackage);
 const plan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:claim.session.id}});assert.equal(plan.packageId,frozenPackage);
 await deliver('CANDIDATE',plan.id);
 const clientId='invited-screening-client-123';
 await sessions.claim(user,claim.session.id,clientId);
 await assert.rejects(sessions.save(user,claim.session.id,{resumeId:'another-cv'}),'invited CV cannot be changed');
 let state=await sessions.start(user,claim.session.id,clientId);
 assert.equal(state.conversationPolicy.maxQuestions,10);assert.equal(state.status,'ACTIVE');assert.equal(state.questions.length,1,'future prepared questions remain hidden');
 let answers=0;
 for(let step=0;step<10&&state.status!=='COMPLETED';step++){
  if(state.status==='GENERATING'){await deliver('ADVANCE',state.id);state=await sessions.state(user,state.id);if(state.status==='COMPLETED')break;}
  const question=state.questions.find(q=>q.answer===null);assert.ok(question);
  await sessions.claim(user,state.id,clientId);
  state=await sessions.shown(user,state.id,clientId,question.id);
  const shown=state.questions.find(q=>q.id===question.id)!;assert.equal(Date.parse(shown.deadlineAt!.toISOString())-Date.parse(shown.shownAt!.toISOString()),60000);
  state=await sessions.answer(user,state.id,clientId,question.id,'Saya menulis endpoint Node.js dan mendokumentasikan perubahan untuk tim.',true);answers++;
 }
 if(state.status==='GENERATING'){await deliver('ADVANCE',state.id);state=await sessions.state(user,state.id);}
 assert.equal(state.status,'COMPLETED');assert.equal(answers,2);
 await sessions.completeInvited(user,state.id);await deliver('EVALUATE',state.id);
 const result=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:state.id}});
 assert.equal(result.cvScore,87.5);assert.equal(result.screeningScore,100);assert.equal(result.finalScore,null,'CV and Tara are never merged for invited screening');assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(await db.application.count({where:{jobPostId:job.id}}),0,'screening completion does not submit or duplicate an application');
 assert.equal((await invitations.report(hr,created.id)).pdfStatus,'PENDING');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'PDF',subjectId:state.id}}),1,'opening the text report reuses the evaluation PDF work');
 const paidBeforePdf=calls;await deliver('PDF',state.id);assert.equal(calls,paidBeforePdf,'PDF rendering never calls AI');
 const rendered=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:state.id}});fs.mkdirSync('output/pdf',{recursive:true});fs.writeFileSync('output/pdf/tara-invited-current.pdf',objects.get(rendered.pdfKey!)!);
 const report=await invitations.report(hr,created.id);assert.equal(report.questions.length,2);assert.equal(report.evaluation!.score,100);assert.ok(report.pdfUrl);assert.ok(!('cvSnapshot' in report.invitation.session!));assert.ok(!('leaseToken' in report.invitation.session!));
 await assert.rejects(invitations.report({...hr,id:'foreign-hr'},created.id));
 await invitations.claim(user,token);assert.equal(await db.chatMessage.count({where:{conversationId:conversation.id}}),1,'reopening does not duplicate the invitation message');
 const refreshedJob=await db.jobPost.findUniqueOrThrow({where:{id:job.id},include:scoreJobInclude});
 await db.recruitmentCandidate.update({where:{id:candidate.id},data:{jobSnapshot:scoringJob(refreshedJob)}}); // Fixture represents an explicit rescore after the earlier direct job edit.
 const evaluationWork=await db.aiScreeningWork.findFirstOrThrow({where:{subjectId:state.id,kind:'EVALUATE'}});
 await db.aiScreeningWork.update({where:{id:evaluationWork.id},data:{status:'FAILED',error:'SYNTHETIC_FAILURE'}});await db.aiScreeningEvaluation.update({where:{sessionId:state.id},data:{status:'FAILED'}});
 await assert.rejects(invitations.retryEvaluation({...hr,id:'foreign-hr'},created.id));
 const uncertainCall=await db.aiScreeningCall.create({data:{key:'uncertain-recovery-test',workId:evaluationWork.id,subjectId:state.id,task:'evaluate',model:'gpt-6-luna',promptVersion:'test',inputHash:'test',status:'UNCERTAIN'}});
 await assert.rejects(invitations.retryEvaluation(hr,created.id),'unknown billing cannot be retried by HR');
 await db.aiScreeningCall.update({where:{id:uncertainCall.id},data:{status:'FAILED'}});
 assert.equal((await invitations.retryEvaluation(hr,created.id)).count,1);assert.equal((await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:state.id}})).status,'PENDING');
 assert.equal((await db.aiScreeningCall.findUniqueOrThrow({where:{id:uncertainCall.id}})).status,'RECOVERED');await assert.rejects(invitations.retryEvaluation(hr,created.id),'repeated retry does not queue another evaluation');
 await db.aiScreeningWork.update({where:{id:evaluationWork.id},data:{status:'FAILED',error:'LEGACY_POLL_INTERRUPTED'}});
 await db.aiScreeningEvaluation.update({where:{sessionId:state.id},data:{status:'FAILED'}});
 await db.aiScreeningCall.update({where:{id:uncertainCall.id},data:{status:'RUNNING',responseId:'resp_known_evaluation'}});
 await assert.rejects(invitations.retryEvaluation(hr,created.id),'an unresolved retired assessment cannot start another provider request');
 await db.aiScreeningCall.update({where:{id:uncertainCall.id},data:{promptVersion:TAKA_INTERVIEW_VERSION}});
 const knownCallCount=await db.aiScreeningCall.count({where:{workId:evaluationWork.id}});
 assert.equal((await invitations.retryEvaluation(hr,created.id)).count,1,'a failed evaluation with a known running response resumes its existing work');
 const knownCall=await db.aiScreeningCall.findUniqueOrThrow({where:{id:uncertainCall.id}});
 assert.equal(knownCall.status,'RUNNING');
 assert.equal(knownCall.responseId,'resp_known_evaluation');
 assert.equal(await db.aiScreeningCall.count({where:{workId:evaluationWork.id}}),knownCallCount);
 await assert.rejects(invitations.retryEvaluation(hr,created.id),'simultaneous retry cannot create another evaluation');
 await db.aiScreeningCall.update({where:{id:uncertainCall.id},data:{status:'RECOVERED'}});
 await db.aiScreeningWork.update({where:{id:evaluationWork.id},data:{status:'DONE'}});await db.aiScreeningEvaluation.update({where:{sessionId:state.id},data:{status:'READY'}});
 const second=await invitations.create(hr,candidate.id,{mode:'TEXT',requestKey:'invite-text-request-002'});assert.notEqual(second.id,created.id);
 const fresh=await db.screeningInvitation.findUniqueOrThrow({where:{id:second.id}});const secondToken=invitationToken(fresh.id,fresh.tokenNonce,config.get('JWT_SECRET')!);
 const secondClaim=await invitations.claim(user,secondToken);assert.notEqual(secondClaim.session.id,state.id,'repeat invitations preserve earlier sessions and results');
 assert.equal(await db.resume.count({where:{profile:{userId:user.id}}}),1,'repeat screening reuses the private CV instead of polluting the CV library');
 await invitations.cancel(hr,second.id);await assert.rejects(invitations.claim(user,secondToken));await assert.rejects(sessions.state(user,secondClaim.session.id));
 const uncertainInvite=await invitations.create(hr,candidate.id,{mode:'TEXT',requestKey:'invite-uncertain-email-test'});
 mailUncertain=true;await invitations.deliver(uncertainInvite.id);mailUncertain=false;
 assert.equal((await db.screeningInvitation.findUniqueOrThrow({where:{id:uncertainInvite.id}})).emailStatus,'UNCERTAIN');
 const emailCount=emails.length;await invitations.deliver(uncertainInvite.id);assert.equal(emails.length,emailCount,'uncertain email is never silently resent');
 await assert.rejects(invitations.retryDelivery(hr,uncertainInvite.id));await invitations.retryDelivery(hr,uncertainInvite.id,true);
 const uncertainWork=await db.aiScreeningWork.findFirstOrThrow({where:{kind:'INVITE_DELIVERY',subjectId:uncertainInvite.id}});
 await db.aiScreeningWork.update({where:{id:uncertainWork.id},data:{status:'RUNNING'}});await assert.rejects(invitations.retryDelivery(hr,uncertainInvite.id,true),'active sending cannot be reset');
 await db.aiScreeningWork.update({where:{id:uncertainWork.id},data:{status:'PENDING'}});await deliver('INVITE_DELIVERY',uncertainInvite.id);await invitations.cancel(hr,uncertainInvite.id);
 let holdCreate:Promise<void>|null=null,holdOpen:Promise<void>|null=null;
 let nextVoiceUsage=840;
 let omitVoiceAnswer=false;
 let nextVoiceHttpResult:Response|Error|undefined;
 let confirmCloseDuringFallback=false;
 let latePrimaryTranscript:Record<string,unknown>|undefined;
 let startupCloseWithoutReceipt=false;
 let startupTranscript:string|undefined;
 let afterCloseForTest:(()=>void)|undefined;
 let onEvent:(event:any)=>void=()=>{},onLost:()=>void=()=>{},creates=0,sidebandCloses=0;const commands:any[]=[], attachments:string[]=[],closeProviderIds:string[]=[];
 let lastVoiceRequest: ReturnType<typeof import('../prompts/voice-session').createVoiceRequest> | undefined;
 const liveProvider={configured:true,create:async(body:NonNullable<typeof lastVoiceRequest>)=>{
  creates++;lastVoiceRequest=body;if(holdCreate)await holdCreate;
  assert.equal(body.session.model,'gpt-live-1');assert.equal(body.session.delegation.type,'client');
  assert.ok(body.session.client.data_channel.allowed_client_events.every(event=>event==='session.close'));
  const englishSession=body.session.instructions.startsWith('Speak English');
  assert.match(body.session.instructions,englishSession?/Let the candidate finish/u:/Biarkan kandidat menyelesaikan jawabannya/u);
  const opening=body.session.input[1].content[0].text;
  assert.match(opening, englishSession
   ? /Ready to get started|pick up where we left off/u
   : /Bisa kita mulai\?.*Tunggu kandidat menyatakan siap|Kita lanjut, ya.*percakapan tersimpan/u);
  assert.equal(JSON.parse(body.session.input[0].content[0].text.split('\n')[1]).candidateName,'Kandidat');
  if(nextVoiceHttpResult){
   const result=nextVoiceHttpResult,fetch=globalThis.fetch;
   nextVoiceHttpResult=undefined;
   globalThis.fetch=async input=>{
    assert.equal(String(input),'https://api.openai.com/v1/live/sessions');
    if(result instanceof Error)throw result;
    return result;
   };
   try{return await new VoiceProvider(config).create(body);}finally{globalThis.fetch=fetch;}
  }
  return {session:{id:'live_mock_'+creates},transport:{sdp:omitVoiceAnswer?'':'v=0 mock SDP answer'}};
 },attach:(id:string,event:any,lost:any)=>{
  attachments.push(id);onEvent=event;onLost=lost;
  return {opened:holdOpen??Promise.resolve(),
   requestOpening:(opening:string)=>commands.push({type:'session.commentary.append',event_id:'tara-opening',opening}),
   closeSession:()=>{
    commands.push({type:'session.close'});
    if(confirmCloseDuringFallback)return;
    onEvent({type:'session.closed',event_id:'closed-'+creates,usage:{seconds:nextVoiceUsage},reason:'close_requested'});
    afterCloseForTest?.();
   },dispose:()=>{}};
 },closeWebRtc:async(providerId:string,receive:(event:Record<string,unknown>)=>void)=>{
  sidebandCloses++;
  closeProviderIds.push(providerId);
  if(confirmCloseDuringFallback){
   confirmCloseDuringFallback=false;
   const receipt={type:'session.closed',event_id:'delayed-close-'+creates,usage:{seconds:nextVoiceUsage},reason:'close_requested'};
   const tail=latePrimaryTranscript;
   if(tail){
    receive(receipt);
    const primaryReceive=onEvent;
    setTimeout(()=>{
     primaryReceive(tail);
     primaryReceive(tail);
    },75);
    return {usage:receipt.usage};
   }
   onEvent(receipt);
   return;
  }
  if(startupTranscript) receive({type:'session.output_transcript.delta',event_id:'startup-close-transcript',
   delta:startupTranscript,start_ms:600,end_ms:1800});
  if(startupCloseWithoutReceipt)return;
  return {usage:{seconds:nextVoiceUsage}};
 }};
 const liveEvaluationRequests:Array<{ ids:string[]; repair?: string[]; instructions?: string }>=[];
 let corruptFirstCompletionReport=false;
 let unavailableCompletionCriterion:'NON_ENDPOINT'|'DOCUMENTATION'|undefined;
 const voiceEvaluator={run:async(_work:string,_subject:string,_task:string,input:any,preset?:{version:string;instructions?:string})=>{
  if(preset?.version===TAKA_INTERVIEW_VERSION)return takaJudgement(input);
  if(preset?.version===ROLE_ASSESSMENT_VERSION)return roleJudgement(input);
  if(preset?.version===TAKA_LIVE_COMPLETION_VERSION){
   liveEvaluationRequests.push({ids:input.criteria.map((row:any)=>row.id),repair:input.criteria[0]?.repair,instructions:preset.instructions});
   const english=preset.instructions?.includes('kalimat alasan dalam English');
   return {criteria:Object.fromEntries(input.criteria.map((row:any)=>{
    const endpoint=row.name.includes('endpoint');
    const evidenceTerm=endpoint?'menulis endpoint':row.name.includes('panduan')?'menyusun panduan':
     row.name.includes('insiden')?'menghentikan deploy':'meminta persetujuan';
    const relevant=input.answers.find((answer:any)=>answer.text.includes(evidenceTerm));
    const question=input.questions.find((item:any)=>item.answers.includes(relevant?.id));
    const fields={level:null,clarity:null,evidence:[],fit:null,requiresQuestionContext:false,discrepancyRef:null,redirectRef:null};
    if(unavailableCompletionCriterion==='NON_ENDPOINT'&&!endpoint ||
     unavailableCompletionCriterion==='DOCUMENTATION'&&row.name.includes('panduan')) return [row.id,{...fields,level:3,clarity:3,fit:'DIRECT',evidence:['a9999'],
     questionRef:null,reason:'Rujukan jawaban tidak tersedia.'}];
    if(corruptFirstCompletionReport&&!endpoint&&relevant&&!row.repair)
     return [row.id,{...fields,questionRef:null,reason:'Klaim bukti kurang meski ada jawaban.'}];
    return [row.id,relevant?{...fields,level:endpoint?4:3,clarity:endpoint?3:4,fit:'DIRECT',
     evidence:[relevant.id],questionRef:question?.id??null,requiresQuestionContext:!!question,
     reason:english?'The recorded answer supports the candidate’s actions.':'Tindakan kandidat didukung percakapan.'}:{...fields,questionRef:null,
     reason:english?'The discussion provides no assessable evidence for this competency.':'Belum ada pertanyaan dan jawaban yang menguji kompetensi ini.'}];
   }))};
  }
  if(preset?.version===TAKA_ROLE_EVIDENCE_VERSION){
   const graded = roleJudgement({...input, evidence: input.answers.map((row:any)=>({...row,ref:row.turnId}))});
   if(roleRepairFixture) roleRepairAttempts.push(input.criteria.map((row:any)=>row.id));
   return {criteria:Object.fromEntries(Object.entries(graded.criteria).map(([id,row])=>[id,{...row,
    level:roleRepairFixture&&row.level===3?null:row.level,clarity:roleRepairFixture&&row.level===3?null:row.clarity,
    basis:roleRepairFixture&&row.level===3?'INSUFFICIENT':row.basis,
    evidence:roleRepairFixture&&row.level===3?[]:row.evidence,
    questionRef:roleRepairFixture&&row.level===3?(roleRepairAttempts.length===1?'not-a-question':null):row.level===null?null:id,
    fit:row.level===null||roleRepairFixture&&row.level===3?null:'DIRECT',
    actionRef:roleRepairFixture&&row.level===3?null:row.evidence[0]??null,requiresQuestionContext:false,
   }]))};
  }
  throw Error('Retired voice evaluator invoked');
 }};
 const voiceService=new VoiceService(db,config,sessions,{
  ...liveProvider,
 } as never,voiceEvaluator as never);
 async function nextVoice(key:string){const inv=await invitations.create(hr,candidate.id,{mode:'VOICE',requestKey:key}),row=await db.screeningInvitation.findUniqueOrThrow({where:{id:inv.id}}),claimed=await invitations.claim(user,invitationToken(row.id,row.tokenNonce,config.get('JWT_SECRET')!));const plan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:claimed.session.id}});await deliver('CANDIDATE',plan.id);return voiceService.create(user,claimed.session.id,clientId,'v=0 fault recovery mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);}
 let releaseCreate:()=>void=()=>{};holdCreate=new Promise<void>(resolve=>{releaseCreate=resolve;});
 const slowInvite=await invitations.create(hr,candidate.id,{mode:'VOICE',requestKey:'voice-slow-startup-test'}),slowRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:slowInvite.id}}),slowClaim=await invitations.claim(user,invitationToken(slowRow.id,slowRow.tokenNonce,config.get('JWT_SECRET')!));
 const slowPlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:slowClaim.session.id}});await deliver('CANDIDATE',slowPlan.id);
 const creating=voiceService.create(user,slowClaim.session.id,clientId,'v=0 slow startup mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);
 let slowVoice=await db.voiceInterview.findUnique({where:{sessionId:slowClaim.session.id}});
 for(let i=0;!slowVoice&&i<100;i++){await new Promise(resolve=>setTimeout(resolve,20));slowVoice=await db.voiceInterview.findUnique({where:{sessionId:slowClaim.session.id}});}
 assert.ok(slowVoice);const startupNow=new Date();await db.voiceInterview.update({where:{id:slowVoice.id},data:{startedAt:new Date(+startupNow-40_000),heartbeatAt:new Date(+startupNow-40_000)}});
 await voiceService.tick(startupNow);assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:slowVoice.id}})).status,'CREATING','provider setup is not mistaken for a disconnected candidate at 30 seconds');
 let releaseOpen:()=>void=()=>{};holdOpen=new Promise<void>(resolve=>{releaseOpen=resolve;});releaseCreate();holdCreate=null;
 for(let i=0;i<100&&(await db.voiceInterview.findUniqueOrThrow({where:{id:slowVoice.id}})).status!=='ACTIVE';i++)await new Promise(resolve=>setTimeout(resolve,20));
 await voiceService.tick(startupNow);assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:slowVoice.id}})).status,'ACTIVE','WebRTC can be active before sideband opens');
 const earlySdp=await Promise.race([creating,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('SDP waited for transcript capture')),1000))]);
 assert.ok(earlySdp.sdp);releaseOpen();holdOpen=null;await voiceService.end(user,slowClaim.session.id,clientId);
 assert.equal((await voiceService.heartbeat(user,slowClaim.session.id,clientId))?.status,'ENDED','late heartbeat after finalization returns the saved terminal state');
 const technical=await nextVoice('voice-technical-end-test');const technicalRow=await db.voiceInterview.findUniqueOrThrow({where:{id:technical.id}});await voiceService.end(user,technicalRow.sessionId!,clientId,'CONNECTION_LOST');assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:technical.id}})).closeReason,'CONNECTION_LOST','connection failure cannot be recorded as candidate ending');
 const hard=await nextVoice('voice-hard-ceiling-test'),hardNow=new Date(); (voiceService as any).active.get(hard.id).delivery.clockStartedAt=+hardNow-900000;await db.voiceInterview.update({where:{id:hard.id},data:{startedAt:new Date(+hardNow-900000),heartbeatAt:hardNow}});await voiceService.tick(hardNow);assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:hard.id}})).status,'ENDED','hard 15-minute ceiling closes actual durable session without earlier watchdog ticks');
 const lost=await nextVoice('voice-sideband-lost-test');
 const lostRow=await db.voiceInterview.findUniqueOrThrow({where:{id:lost.id}});
 await voiceService.media(user,lostRow.sessionId!,clientId,'READY',1,0);
 onEvent({type:'session.input_transcript.delta',event_id:'before-sideband-loss',delta:'Bukti tersimpan sebelum sambungan catatan terputus.',start_ms:700,end_ms:900});
 const attachmentCount=attachments.length;
 onLost();
 await voiceService.tick(new Date(Date.now()+1200));
 assert.equal(attachments.length,attachmentCount+1);
 assert.equal(attachments.at(-1),lostRow.providerId,'sideband reconnects to the same media session');
 onEvent({type:'session.input_transcript.delta',event_id:'before-sideband-loss',delta:'Replay duplicate.',start_ms:700,end_ms:900});
 onEvent({type:'session.input_transcript.delta',event_id:'after-sideband-reconnect',delta:'Bukti tersimpan setelah tersambung.',start_ms:1000,end_ms:1200});
 await voiceService.tick(new Date(Date.now()+4000));
 await voiceService.heartbeat(user,lostRow.sessionId!,clientId);
 assert.equal((await voiceService.state(user,lostRow.sessionId!))?.status,'ACTIVE','loss of transcript capture cannot hang up an active session');
 await voiceService.end(user,lostRow.sessionId!,clientId);
 assert.equal(await db.voiceFragment.count({where:{voiceId:lost.id}}),2,'reconnect keeps original transcript IDs');
 const remote=await nextVoice('voice-provider-remote-hangup-test');
 onEvent({type:'session.closed',event_id:'remote-hangup',usage:{seconds:31},reason:'remote_hangup'});
 for(let i=0;i<80&&(await db.voiceInterview.findUniqueOrThrow({where:{id:remote.id}})).status!=='ENDED';i++)await new Promise(r=>setTimeout(r,25));
 const remoteRow=await db.voiceInterview.findUniqueOrThrow({where:{id:remote.id}});
 assert.equal(remoteRow.status,'ENDED');assert.equal(remoteRow.closeReason,'CANDIDATE_DISCONNECTED');assert.equal(remoteRow.transcriptComplete,false);
 assert.equal((await db.screeningInvitation.findUniqueOrThrow({where:{sessionId:remoteRow.sessionId!}})).status,'COMPLETED','voice and invitation terminal states commit together');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'VOICE_EVALUATE',subjectId:remoteRow.sessionId!}}),1);
 const orphan=await nextVoice('voice-terminal-before-outbox-test');
 const orphanRow=await db.voiceInterview.update({where:{id:orphan.id},data:{status:'ENDED',closeReason:'CONNECTION_LOST',endedAt:new Date()}});
 assert.equal(await db.aiScreeningWork.count({where:{kind:'VOICE_EVALUATE',subjectId:orphanRow.sessionId!}}),0);
 await voiceService.tick();await voiceService.tick();
 assert.equal((await db.screeningInvitation.findUniqueOrThrow({where:{sessionId:orphanRow.sessionId!}})).status,'COMPLETED','watchdog recovers an older terminal voice row without its outbox');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'VOICE_EVALUATE',subjectId:orphanRow.sessionId!}}),1);
 const restart=await nextVoice('voice-server-restart-test');
 await db.voiceInterview.update({where:{id:restart.id},data:{leaseUntil:new Date(0)}});
 const restartedService=new VoiceService(db,config,sessions,liveProvider as never,voiceEvaluator as never);
 const beforeRestartCloses=sidebandCloses;
 await restartedService.tick();
 assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:restart.id}})).closeReason,'SERVER_RESTART');
 assert.equal(sidebandCloses,beforeRestartCloses+1,'the new server uses WebRTC sideband closure of the existing provider session');
 await voiceService.finish(restart.id,'SERVER_RESTART');
 await restartedService.onModuleDestroy();
 const closedInvite=await invitations.create(hr,candidate.id,{mode:'TEXT',requestKey:'closed-stage-guard-test'}),closedRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:closedInvite.id}}),closedToken=invitationToken(closedRow.id,closedRow.tokenNonce,config.get('JWT_SECRET')!),closedSession=await invitations.claim(user,closedToken);
 const originalStage=(await db.recruitmentCandidate.findUniqueOrThrow({where:{id:candidate.id}})).stage;
 for(const stage of ['REJECTED','HIRED','WITHDRAWN'] as const){
  await db.recruitmentCandidate.update({where:{id:candidate.id},data:{stage}});
  await assert.rejects(invitations.claim(user,closedToken),'closed stage cannot claim old unused invitation');
  await assert.rejects(sessions.owned(user,closedSession.session.id),'closed stage cannot access unused session');
  await assert.rejects(invitations.retryDelivery(hr,closedInvite.id),'closed stage cannot resend invitation');
  const listed=await invitations.list(hr,candidate.id);assert.equal(listed.find(i=>i.id===closedInvite.id)?.closedByStage,true);
  assert.ok((await invitations.report(hr,created.id)).evaluation,'historical report is still readable after closure');
 }
 await db.recruitmentCandidate.update({where:{id:candidate.id},data:{stage:originalStage}});await invitations.cancel(hr,closedInvite.id);
 const prepareSkillInvite=async(mode:'TEXT'|'VOICE',requestKey:string)=>{
  const created=await invitations.create(hr,candidate.id,{mode,requestKey});
  const row=await db.screeningInvitation.findUniqueOrThrow({where:{id:created.id}});
  const token=invitationToken(row.id,row.tokenNonce,config.get('JWT_SECRET')!);
  const claimed=await invitations.claim(user,token);
  const prepared=await db.aiScreeningPackage.findUniqueOrThrow({where:{id:row.packageId}});
  if(prepared.status!=='READY')await deliver('PREPARE',row.packageId);
  const plan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:claimed.session.id}});
  await deliver('CANDIDATE',plan.id);
  return {invitationId:created.id,sessionId:claimed.session.id,token};
 };
 let guidedText: Awaited<ReturnType<ScreeningSessions["start"]>>;
 const submitText=async(answer:string)=>{
  const active=guidedText.questions.find(q=>q.answer===null)!;
  await sessions.shown(user,guidedText.id,clientId,active.id);
  await sessions.answer(user,guidedText.id,clientId,active.id,answer,true);
  await sessions.answer(user,guidedText.id,clientId,active.id,'Late duplicate',true);
  await deliver('ADVANCE',guidedText.id);
  guidedText=await sessions.state(user,guidedText.id);
 };
 alternativeSkillFixture=true;
 const alternate=await prepareSkillInvite('TEXT','text-skill-alternative-test');
 await sessions.claim(user,alternate.sessionId,clientId);
 guidedText=await sessions.start(user,alternate.sessionId,clientId);
 await submitText('Saya membantu dosen membuat endpoint untuk arsip kelas.');
 await deliver('EVALUATE',guidedText.id);
 const alternateReport=await invitations.report(hr,alternate.invitationId);
 assert.equal(alternateReport.evaluation!.status,'READY');
 assert.equal(alternateReport.evaluation!.score,null);
 assert.equal((alternateReport.evaluation!.result as {taraInterview:{topics:Array<{alternative:boolean}>}}).taraInterview.topics[0].alternative,true);
 await deliver('PDF',guidedText.id);
 alternativeSkillFixture=false;
 const timedText=await prepareSkillInvite('TEXT','text-timed-interview-test');
 await sessions.claim(user,timedText.sessionId,clientId);
 guidedText=await sessions.start(user,timedText.sessionId,clientId);
 assert.equal(guidedText.conversationPolicy.version,'tara-conversation-v8.0.0');
 assert.ok(!('interviewDeadlineAt' in guidedText),'draft and preparation do not consume the session clock');
 const firstTimedQuestion=guidedText.questions[0].id;
 const firstShown=await sessions.shown(user,timedText.sessionId,clientId,firstTimedQuestion);
 const firstDeadline=(firstShown as {interviewDeadlineAt?:Date}).interviewDeadlineAt!;
 assert.ok(+firstDeadline-Date.now()>899_000);
 assert.equal(+(await sessions.shown(user,timedText.sessionId,clientId,firstTimedQuestion) as {interviewDeadlineAt?:Date}).interviewDeadlineAt!,+firstDeadline);
 await submitText('Saya membuat endpoint Node.js dan menulis dokumentasi API.');
 assert.match(guidedText.questions.at(-1)!.text,/Soal API/);
 await submitText('Saya menulis contoh penggunaan API untuk tim.');
 assert.equal(guidedText.status,'COMPLETED');
 await deliver('EVALUATE',timedText.sessionId);
 const timedReport=await invitations.report(hr,timedText.invitationId);
 const notes=(timedReport.evaluation!.result as {taraInterview:{topics:Array<{evidence:Array<{fromTopic:string}>;opportunities:Array<{delivery:string}>}>}}).taraInterview;
 assert.ok(notes.topics[1].evidence.some(row=>row.fromTopic==='skill-0'));
 assert.equal(notes.topics[0].opportunities[0].delivery,'CHAT');
 assert.equal(timedReport.evaluation!.score,null,'partial evidence cannot be misrepresented as a score');

 const partial=await prepareSkillInvite('TEXT','text-timed-partial-test');
 await sessions.claim(user,partial.sessionId,clientId);
 const partialStart=await sessions.start(user,partial.sessionId,clientId), partialQ=partialStart.questions[0].id;
 await sessions.shown(user,partial.sessionId,clientId,partialQ);
 await sessions.answer(user,partial.sessionId,clientId,partialQ,'Draf terakhir milik kandidat',false);
 await sessions.answer(user,partial.sessionId,clientId,partialQ,'Saya mengelola gudang.',true);
 await db.aiScreeningSession.update({where:{id:partial.sessionId},data:{taraAdvanceAt:new Date(0)}});
 const continued=await sessions.state(user,partial.sessionId);
 assert.match(continued.questions.at(-1)!.text,/bagian mana yang lu kerjain sendiri/i);
 await sessions.shown(user,partial.sessionId,clientId,continued.questions.at(-1)!.id);
 await sessions.answer(user,partial.sessionId,clientId,continued.questions.at(-1)!.id,'Draf terakhir sebelum penutupan',false);
 await db.aiScreeningSession.update({where:{id:partial.sessionId},data:{taraDeadlineAt:new Date(Date.now()+59_000)}});
 const timedOut=await sessions.state(user,partial.sessionId);
 assert.equal(timedOut.status,'COMPLETED');
 assert.equal(timedOut.questions.at(-1)!.answer,'Draf terakhir sebelum penutupan');
 await deliver('EVALUATE',partial.sessionId);
 const partialReport=await invitations.report(hr,partial.invitationId);
 assert.equal(partialReport.evaluation!.status,'NEEDS_REVIEW');
 assert.equal(partialReport.evaluation!.score,null);
 await deliver('PDF',partial.sessionId);

 const nativeVoice=await prepareSkillInvite('VOICE','voice-direct-playback-test');
 const createsBefore=creates, beforeOpening=commands.length;
 await assert.rejects(voiceService.create(user,nativeVoice.sessionId,clientId,'v=0 outdated mock SDP offer'),/Muat ulang/);
 assert.equal(creates,createsBefore,'outdated browsers are rejected before any provider request');
 const native=await voiceService.create(user,nativeVoice.sessionId,clientId,'v=0 native mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);
 assert.equal(native.voiceMode,'NATIVE');
 assert.equal(native.audioProtocol,TARA_LIVE_AUDIO_PROTOCOL);
 assert.deepEqual(lastVoiceRequest!.session.client.data_channel.allowed_client_events,[]);
 assert.equal(native.clockRunning,false);
 await assert.rejects(voiceService.media(wrong,nativeVoice.sessionId,clientId,'READY',1,0));
 await assert.rejects(voiceService.media(user,nativeVoice.sessionId,'another-owner-tab','READY',1,0));
 onEvent({type:'session.started'});
 await voiceService.media(user,nativeVoice.sessionId,clientId,'READY',1,0);
 await voiceService.media(user,nativeVoice.sessionId,clientId,'INPUT_QUIET',2,0);
 await voiceService.tick(new Date(Date.now()+4000));
 assert.equal(commands.length,beforeOpening,'the fallback greeting waits for a playable element');
 await voiceService.media(user,nativeVoice.sessionId,clientId,'PLAYBACK_READY',3,0);
 onEvent({type:'session.output_audio.delta',start_ms:0,end_ms:20,delta:Buffer.alloc(960).toString('base64')});
 await voiceService.tick(new Date(Date.now()+4000));
 await voiceService.tick(new Date(Date.now()+4500));
 assert.deepEqual(commands.slice(beforeOpening).map(c=>c.event_id),['tara-opening'],'silent startup can request a single greeting');
 assert.equal(commands.at(-1).opening,lastVoiceRequest!.session.input[1].content[0].text);
 assert.match(lastVoiceRequest!.session.input[1].content[0].text,/Bisa kita mulai\?/);
 onEvent({type:'session.output_audio.delta',start_ms:100,end_ms:120,delta:voiceDelta});
 const opened=await voiceService.media(user,nativeVoice.sessionId,clientId,'AUDIBLE',4,0);
 assert.ok(opened.clockRunning);
 assert.equal((await voiceService.media(user,nativeVoice.sessionId,clientId,'AUDIBLE',4,0)).startedAt.toISOString(),opened.startedAt.toISOString());
 onEvent({type:'session.output_transcript.delta',event_id:'native-question',delta:'Soal Node.js, bagian mana yang lu kerjain sendiri?',start_ms:100,end_ms:260});
 onEvent({type:'session.input_transcript.delta',event_id:'native-answer',delta:'Saya menulis endpoint Node.js.',start_ms:620,end_ms:900});
 onEvent({type:'session.input_transcript.delta',event_id:'native-answer',delta:'Duplicate fragment',start_ms:620,end_ms:900});
 await new Promise(resolve=>setTimeout(resolve,240));
 await voiceService.media(user,nativeVoice.sessionId,clientId,'QUIET',5,0);
 onEvent({type:'session.delegation.created',delegation:{id:'del_fixture'}});
 onEvent({type:'session.delegation.created',delegation:{id:'del_fixture'}});
 const transitionAt=new Date(+opened.startedAt+181_000);
 await db.voiceInterview.update({where:{id:native.id},data:{heartbeatAt:transitionAt}});
 await voiceService.tick(transitionAt);
 await (voiceService as any).active.get(native.id).pending;
 assert.deepEqual(commands.slice(beforeOpening).map(c=>c.event_id),['tara-opening'],'the recorder never steers the dialogue');
 assert.equal(await db.aiScreeningWork.count({where:{subjectId:nativeVoice.sessionId,kind:'VOICE_TURN'}}),0);
 assert.equal(await db.voiceFragment.count({where:{voiceId:native.id}}),2);
 await voiceService.end(user,nativeVoice.sessionId,clientId,'CONNECTION_LOST');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'VOICE_EVALUATE',subjectId:nativeVoice.sessionId}}),1);
 process.env.TAKA_INTERVIEW_EVIDENCE_ENABLED='false';
 takaRequests.length=0;
 const takaText=await prepareSkillInvite('TEXT','taka-evidence-text-test');
 const takaVoice=await prepareSkillInvite('VOICE','taka-evidence-voice-test');
 process.env.TAKA_INTERVIEW_EVIDENCE_ENABLED='false';
 const takaAnswer='Saya menulis endpoint Node.js.';
 await sessions.claim(user,takaText.sessionId,clientId);
 guidedText=await sessions.start(user,takaText.sessionId,clientId);
 await submitText(takaAnswer);
 assert.equal(guidedText.questions.at(-1)?.shownAt,null);
 await db.aiScreeningSession.update({where:{id:takaText.sessionId},data:{taraDeadlineAt:new Date(Date.now()+59_000)}});
 assert.equal((await sessions.state(user,takaText.sessionId)).status,'COMPLETED');
 corruptTakaRef=true;
 const takaTextWork=await deliver('EVALUATE',takaText.sessionId);
 assert.deepEqual(takaRequests,[['skill-0','skill-1'],['skill-0']],'only the claim with an invalid citation is repaired');
 await deliver('PDF',takaText.sessionId);
 const takaTextReport=await invitations.report(hr,takaText.invitationId);
 assert.equal(takaTextReport.evaluation?.score,100);
 assert.equal(takaTextReport.evaluation?.status,'NEEDS_REVIEW');
 assert.equal(takaTextReport.pdfStatus,'READY');
 await assert.rejects(invitations.report({...hr,id:'foreign-hr'},takaText.invitationId));

 const voicePilot=await voiceService.create(user,takaVoice.sessionId,clientId,'v=0 taka evidence mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);
 onEvent({type:'session.started',event_id:'taka-evidence-start'});
 await voiceService.media(user,takaVoice.sessionId,clientId,'READY',1,0);
 onEvent({type:'session.output_audio.delta',start_ms:100,end_ms:120,delta:voiceDelta});
 await voiceService.media(user,takaVoice.sessionId,clientId,'AUDIBLE',2,0);
 onEvent({type:'session.output_transcript.delta',event_id:'taka-evidence-question',delta:'Soal Node.js, bagian mana yang lu kerjain sendiri?',start_ms:100,end_ms:260});
 onEvent({type:'session.input_transcript.delta',event_id:'taka-evidence-answer',delta:takaAnswer,start_ms:600,end_ms:900});
 await new Promise(resolve=>setTimeout(resolve,240));
 await voiceService.media(user,takaVoice.sessionId,clientId,'QUIET',3,0);
 await new Promise(resolve=>setTimeout(resolve,700));
 await voiceService.end(user,takaVoice.sessionId,clientId,'CONNECTION_LOST');
 const voiceWork=await db.aiScreeningWork.findFirstOrThrow({where:{kind:'VOICE_EVALUATE',subjectId:takaVoice.sessionId}});
 const restartedWorker=new ScreeningWorker(db,config,storage as never,new MatchingService(db),packets,sessions,plans,provider as never,
    undefined,candidates,invitations,voiceService);
 await restartedWorker.process(voiceWork.id);
 await deliver('PDF',takaVoice.sessionId);
 const takaVoiceReport=await invitations.report(hr,takaVoice.invitationId);
 assert.equal(takaVoiceReport.evaluation?.score,takaTextReport.evaluation?.score);
 const documents=await Promise.all([takaText.sessionId,takaVoice.sessionId].map(sessionId=>db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId}})));
 const extract=(new Function('specifier','return import(specifier)')) as (specifier:string)=>Promise<typeof import('pdfjs-dist')>;
 const pdfjs=await extract('pdfjs-dist/legacy/build/pdf.mjs');
 for(const result of documents){
  const payload=result.result as unknown as {interviewAssessment:{version:string;plannedClaims:number;assessedClaims:number;state:string};claims:Array<{score:number|null;evidence:Array<{quote:string}>}>};
  assert.equal(result.promptVersion,TAKA_INTERVIEW_VERSION);
  assert.equal(result.cvScore,87.5);
  assert.equal(result.finalScore,null);
  assert.deepEqual(payload.claims.map(row=>row.score),[4,null]);
  assert.equal(payload.claims[0].evidence[0].quote,takaAnswer);
  assert.deepEqual([payload.interviewAssessment.assessedClaims,payload.interviewAssessment.plannedClaims,payload.interviewAssessment.state],[1,2,'PARTIAL']);
  assert.ok(objects.get(result.pdfKey!)?.subarray(0,5).equals(Buffer.from('%PDF-')));
  const loading=pdfjs.getDocument({data:new Uint8Array(objects.get(result.pdfKey!)!),verbosity:0});
  try{
   const cover=await (await (await loading.promise).getPage(1)).getTextContent();
   const text=cover.items.flatMap(item=>'str' in item?[item.str]:[]).join(' ');
   assert.match(text,/100\s*\/\s*100/);
   assert.match(text,/Hasil parsial/);
   assert.match(text,/1 dari 2 klaim dinilai/);
  }finally{await loading.destroy();}
 }
 assert.deepEqual(takaRequests,[['skill-0','skill-1'],['skill-0'],['skill-0','skill-1']]);
 await db.aiScreeningWork.update({where:{id:takaTextWork.id},data:{status:'PENDING',availableAt:new Date(0)}});
 await restartedWorker.process(takaTextWork.id);
 assert.equal(takaRequests.length,3,'same evaluation after restart incurs no second provider request');
 assert.equal(await db.aiScreeningEvaluationRevision.count({where:{evaluationId:documents[0].id}}),1);
 assert.equal(await db.aiScreeningWork.count({where:{kind:'PDF',subjectId:takaText.sessionId}}),1);
 console.log('Taka evidence integration passed: retired flags cannot select an older evaluator, text fallback, partial Chat and Live parity, scoped retry, matching PDF coverage, tenant isolation and restart deduplication. Paid calls: 0.');

 console.log('Tara timed integration passed: server clock, cross-skill notes, bounded fallback, partial PDF, direct playback, deduplication and preserved Taka scoring.');

 process.env.TAKA_ROLE_ASSESSMENT_ENABLED='true';
 const roleJob=await db.jobPost.create({data:{companyId:company.id,title:'API Engineer',status:'PUBLISHED',
  description:'Membangun dan mendokumentasikan API internal.',responsibilities:['Bangun endpoint API','Tulis panduan penggunaan API']},include:scoreJobInclude});
 const roleCandidate=await db.recruitmentCandidate.create({data:{companyId:company.id,jobId:roleJob.id,fullName:candidate.fullName,email:candidate.email,
  filename:candidate.filename,fileKey:candidate.fileKey,contentType:candidate.contentType,sizeBytes:candidate.sizeBytes,checksum:candidate.checksum,
  scoreStatus:'READY',cvScore:80,cvResult:{cvText},jobSnapshot:{title:roleJob.title},stage:'IN_REVIEW'}});
 assert.equal((await candidates.detail(hr,roleCandidate.id)).cvMethodologyUpgradeAvailable,true);
 await assert.rejects(invitations.create(hr,roleCandidate.id,{mode:'TEXT',requestKey:'role-legacy-cv'}));
 await candidates.retry(hr,roleCandidate.id);
 const pendingRole=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:roleCandidate.id}});
 const frozenRole=frozenRoleRubric(pendingRole.jobSnapshot)!;
 assert.equal(frozenRole.interviewIds.length,2);
 await db.recruitmentCandidate.update({where:{id:roleCandidate.id},data:{scoreStatus:'READY',cvScore:80,cvResult:{cvText,
  roleAssessment:{rubricRevision:frozenRole.revision}}}});
 async function roleInvite(mode:'VOICE'|'TEXT',key:string){
  const invite=await invitations.create(hr,roleCandidate.id,{mode,requestKey:key});
  const row=await db.screeningInvitation.findUniqueOrThrow({where:{id:invite.id}});
  const claimed=await invitations.claim(user,invitationToken(row.id,row.tokenNonce,config.get('JWT_SECRET')!));
  const candidatePlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:claimed.session.id}});
  await deliver('CANDIDATE',candidatePlan.id);
  if(mode==='VOICE'){
   const packet=await db.aiScreeningPackage.findUniqueOrThrow({where:{id:row.packageId}});
   assert.equal((packet.payload as {liveAgenda?:{source:string}}).liveAgenda?.source,'JOB_REQUIREMENTS');
   const prepared=await db.aiCandidatePlan.findUniqueOrThrow({where:{id:candidatePlan.id}});
   assert.match((prepared.payload as {roleTopics:Array<{question:string}>}).roleTopics[0].question,/membuat endpoint API yang aman/);
  }
  return {id:invite.id,sessionId:claimed.session.id};
 }
 // The fixture provider deliberately returns no CV claims on the new criteria.
 alternativeSkillFixture=true;
 const roleText=await roleInvite('TEXT','role-complete-text');
 await sessions.claim(user,roleText.sessionId,clientId);
 guidedText=await sessions.start(user,roleText.sessionId,clientId);
 assert.match(guidedText.questions[0].text,/^Halo, gue Tara\./);
 const apiAnswer='Saya menulis endpoint Node.js dan memvalidasi input dengan tes batas.';
 const docAnswer='Saya menyusun panduan API dan mencatat cara menangani kesalahan akses.';
 for(const [index,answer] of [apiAnswer,docAnswer].entries()){
  const currentQuestion=await db.aiScreeningQuestion.findUniqueOrThrow({where:{id:guidedText.questions.find(row=>row.answer===null)!.id}});
  assert.equal(currentQuestion.claimId,frozenRole.interviewIds[index]);
  await submitText(answer);
 }
 assert.equal(guidedText.status,'COMPLETED');
 await deliver('EVALUATE',roleText.sessionId);
 await deliver('PDF',roleText.sessionId);
 const roleReport=await invitations.report(hr,roleText.id);
 const rolePayload=(roleReport.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment;
 assert.equal(roleReport.evaluation?.finalScore,85.3);
 assert.equal(roleReport.evaluation?.status,'READY');
 assert.equal(rolePayload.criteria[0].evidence[0].quote,apiAnswer);
 assert.equal(rolePayload.criteria[1].evidence[0].quote,docAnswer);
 assert.equal(rolePayload.rubricRevision,frozenRole.revision);
 assert.equal((await invitations.list(hr,roleCandidate.id))[0].session?.evaluation?.finalScore,85.3);

 const roleVoice=await roleInvite('VOICE','role-complete-voice');
 assert.equal(liveAgendaCalls,1,'one job preparation serves the whole Live package');
 const noAi=roleRequests.length;
 const connected=await voiceService.create(user,roleVoice.sessionId,clientId,'v=0 role evidence mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);
 const liveCommands=commands.length;
 onEvent({type:'session.started',event_id:'role-start'});
 await voiceService.media(user,roleVoice.sessionId,clientId,'READY',1,0);
 onEvent({type:'session.output_audio.delta',start_ms:100,end_ms:120,delta:voiceDelta});
 const audio=await voiceService.media(user,roleVoice.sessionId,clientId,'AUDIBLE',2,0);
 onEvent({type:'session.output_transcript.delta',event_id:'role-question-1',delta:'Halo, gue Tara. Apa yang lu kerjakan untuk bikin endpoint?',start_ms:100,end_ms:260});
 onEvent({type:'session.input_transcript.delta',event_id:'role-answer-1',delta:apiAnswer,start_ms:590,end_ms:900});
 await new Promise(resolve=>setTimeout(resolve,280));
 await voiceService.media(user,roleVoice.sessionId,clientId,'QUIET',3,0);
 onEvent({type:'session.delegation.created',delegation:{id:'del_role_fixture'}});
 onEvent({type:'session.output_transcript.delta',event_id:'role-question-2',delta:'Gimana cara lu bikin panduan untuk pemakai API?',start_ms:7500,end_ms:8100});
 onEvent({type:'session.input_transcript.delta',event_id:'role-answer-2',delta:docAnswer,start_ms:9000,end_ms:10000});
 await voiceService.tick(new Date(+audio.startedAt+16_000));
 assert.equal(commands.length,liveCommands,'no prompts, replays or delegation replies during dialogue');
 assert.equal(roleRequests.length,noAi,'live audio never calls the evaluator');
 await voiceService.end(user,roleVoice.sessionId,clientId,'CONNECTION_LOST');
 await restartedWorker.process((await db.aiScreeningWork.findFirstOrThrow({where:{kind:'VOICE_EVALUATE',subjectId:roleVoice.sessionId}})).id);
 await deliver('PDF',roleVoice.sessionId);
 const voiceRoleReport=await invitations.report(hr,roleVoice.id);
 assert.equal(voiceRoleReport.evaluation?.finalScore,85.3,'concrete evidence that survived disconnect remains eligible');
 assert.deepEqual(roleRequests.map(request=>request.answerCount),[2,2]);
 const roleVoiceRow=await db.voiceInterview.findUniqueOrThrow({where:{id:connected.id}});
 assert.equal(roleVoiceRow.promptVersion,TARA_LIVE_AUDIO_PROTOCOL);
 for(const sessionId of [roleText.sessionId,roleVoice.sessionId]){
  const evaluation=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId}});
  const loading=pdfjs.getDocument({data:new Uint8Array(objects.get(evaluation.pdfKey!)!),verbosity:0});
  try{
   const page=await (await (await loading.promise).getPage(1)).getTextContent();
   const content=page.items.flatMap(item=>'str' in item?[item.str]:[]).join(' ');
   assert.match(content,/Skor akhir 85,3\s*\/\s*100/);
   assert.match(content,/2 dari 2 kompetensi inti dinilai/);
  }finally{await loading.destroy();}
 }
 assert.equal((await invitations.report(hr,takaText.invitationId)).evaluation?.finalScore,null,'new scoring does not replace history');
 await assert.rejects(invitations.report({...hr,id:'foreign-hr'},roleVoice.id));

 // Give the already completed synthetic session a historical result and the mistaken saved references from the audit.
 const evaluated = await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:roleVoice.sessionId}});
 const originalHash = 'legacy-reference-regression';
 await db.aiScreeningEvaluation.update({where:{id:evaluated.id},data:{promptVersion:ROLE_ASSESSMENT_VERSION,inputHash:originalHash,
  status:'NEEDS_REVIEW',screeningScore:null,finalScore:null}});
 await db.aiScreeningEvaluationRevision.create({data:{evaluationId:evaluated.id,inputHash:originalHash,promptVersion:ROLE_ASSESSMENT_VERSION,
  snapshot:{pdfKey:evaluated.pdfKey,pdfVersion:evaluated.pdfVersion,tag:'frozen'}}});
 await db.aiScreeningCall.create({data:{key:'past-role-reference-regression',workId:'past-role-work',subjectId:roleVoice.sessionId,task:'evaluate',
  promptVersion:ROLE_ASSESSMENT_VERSION,model:'gpt-6-luna',inputHash:'fixture',status:'COMPLETED',
  result:{criteria:Object.fromEntries(frozenRole.interviewIds.map(id=>[id,{questionRef:id,level:3}]))}}});
 const dryRun = await inspectTakaReassessment(db,roleVoice.sessionId);
 assert.equal(dryRun?.badReferences,2);
 assert.equal(await db.$transaction(tx=>queueTakaReassessment(tx,roleVoice.sessionId,'stale-revision')),null);
 const replay=await db.$transaction(tx=>queueTakaReassessment(tx,roleVoice.sessionId,dryRun!.key));
 assert.equal(replay?.kind,TAKA_REASSESS_KIND);
 assert.equal((await db.$transaction(tx=>queueTakaReassessment(tx,roleVoice.sessionId,dryRun!.key)))?.id,replay!.id);
 roleRepairFixture=true;
 await restartedWorker.process(replay!.id);
 roleRepairFixture=false;
 assert.deepEqual(roleRepairAttempts,[frozenRole.interviewIds,[frozenRole.interviewIds[1]]]);
 const revised=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{id:evaluated.id}});
 const revisedAssessment=(revised.result as {roleAssessment:RoleAssessment}).roleAssessment;
 assert.equal(revised.promptVersion,TAKA_ROLE_VALIDATION_VERSION);
 assert.deepEqual(revisedAssessment.criteria.map(row=>[row.level,row.state]),[[4,'ASSESSED'],[null,'NOT_ASKED']]);
 assert.deepEqual(revisedAssessment.partial,{competency:100,explanation:75});
 assert.equal(revised.finalScore,null);
 await deliver('PDF',roleVoice.sessionId);
 const revisedReport=await invitations.report(hr,roleVoice.id), revisedList=(await invitations.list(hr,roleCandidate.id)).find(row=>row.id===roleVoice.id);
 assert.deepEqual(revisedReport.evaluation?.result,revisedList?.session?.evaluation?.result);
 assert.equal(revisedReport.pdfStatus,'READY');
 assert.deepEqual((await db.aiScreeningEvaluationRevision.findUniqueOrThrow({where:{evaluationId_inputHash:{evaluationId:evaluated.id,inputHash:originalHash}}})).snapshot,
  {pdfKey:evaluated.pdfKey,pdfVersion:evaluated.pdfVersion,tag:'frozen'});
 const revisedPdf=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{id:evaluated.id}});
 assert.notEqual(revisedPdf.pdfKey,evaluated.pdfKey);
 const partialPdf=pdfjs.getDocument({data:new Uint8Array(objects.get(revisedPdf.pdfKey!)!),verbosity:0});
 try{
  const page=await (await (await partialPdf.promise).getPage(1)).getTextContent();
  const content=page.items.flatMap(item=>'str' in item?[item.str]:[]).join(' ');
  assert.match(content,/100\s*\/\s*100 kompetensi \(parsial\)/);
  assert.match(content,/1 dari 2 kompetensi inti dinilai/);
 }finally{await partialPdf.destroy();}
 assert.equal((await db.$transaction(tx=>queueTakaReassessment(tx,roleVoice.sessionId,dryRun!.key)))?.status,'DONE');
 assert.equal(await db.aiScreeningWork.count({where:{kind:TAKA_REASSESS_KIND,subjectId:roleVoice.sessionId}}),1);

 const silentInvite=await roleInvite('VOICE','role-no-speaker');
 assert.equal(liveAgendaCalls,1,'a subsequent Live invitation reuses the frozen agenda');
 const silentVoice=await voiceService.create(user,silentInvite.sessionId,clientId,'v=0 local silent playback',TARA_LIVE_AUDIO_PROTOCOL);
 await voiceService.media(user,silentInvite.sessionId,clientId,'READY',1,0);
 onEvent({type:'session.output_transcript.delta',event_id:'silent-preserved',delta:'Gimana lu membangun API?',start_ms:0,end_ms:2400});
 const noPlaybackAt=new Date(Date.now()+61_000);
 await db.voiceInterview.update({where:{id:silentVoice.id},data:{heartbeatAt:noPlaybackAt}});
 await voiceService.tick(noPlaybackAt);
 await (voiceService as any).active.get(silentVoice.id).pending;
 const silentResult=await voiceService.state(user,silentInvite.sessionId);
 assert.equal(silentResult?.status,'ACTIVE','missing playback telemetry cannot cut a connected call');
 assert.equal(silentResult?.transcript[0].text,'Gimana lu membangun API?');
 assert.equal(silentResult?.clockRunning,true);
 await voiceService.tick(new Date(+noPlaybackAt+61_000));
 assert.equal((await voiceService.state(user,silentInvite.sessionId))?.status,'ACTIVE','a temporary HTTP outage does not disconnect WebRTC');
 await voiceService.end(user,silentInvite.sessionId,clientId);

 const farewellInvite=await roleInvite('VOICE','role-direct-farewell');
 const farewellVoice=await voiceService.create(user,farewellInvite.sessionId,clientId,'v=0 farewell mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);
 const farewellCommands=commands.length;
 await voiceService.media(user,farewellInvite.sessionId,clientId,'READY',1,0);
 onEvent({type:'session.output_audio.delta',start_ms:100,end_ms:600,delta:voiceDelta});
 onEvent({type:'session.output_transcript.delta',event_id:'direct-farewell',delta:'Makasih udah cerita. Wawancara kita selesai.',start_ms:100,end_ms:600});
 const heardFarewell=await voiceService.media(user,farewellInvite.sessionId,clientId,'AUDIBLE',2,0);
 await voiceService.tick();
 await (voiceService as any).active.get(farewellVoice.id).pending;
 await new Promise(resolve=>setTimeout(resolve,540));
 await voiceService.media(user,farewellInvite.sessionId,clientId,'QUIET',3,0);
 await voiceService.media(user,farewellInvite.sessionId,clientId,'INPUT_ACTIVE',4,0);
 await voiceService.tick(new Date(+heardFarewell.startedAt+4000));
 assert.equal((await voiceService.state(user,farewellInvite.sessionId))?.status,'ACTIVE','a candidate speaking during closing keeps the session open');
 onEvent({type:'session.input_transcript.delta',event_id:'direct-farewell-extra',delta:'Ada satu hal yang mau gue tambahkan.',start_ms:700,end_ms:1200});
 await voiceService.media(user,farewellInvite.sessionId,clientId,'INPUT_QUIET',5,0);
 await voiceService.tick(new Date(Date.now()+3500));
 await (voiceService as any).active.get(farewellVoice.id).pending;
 assert.equal(commands.length,farewellCommands,'a prior farewell is not reused after the candidate resumes');
 onEvent({type:'session.output_audio.delta',start_ms:1300,end_ms:1810,delta:voiceDelta});
 onEvent({type:'session.output_transcript.delta',event_id:'direct-farewell-final',delta:'Makasih udah cerita. Wawancara kita selesai.',start_ms:1300,end_ms:1800});
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,+heardFarewell.startedAt+1200-Date.now())));
 await voiceService.media(user,farewellInvite.sessionId,clientId,'AUDIBLE',6,Math.max(0,Date.now()-(+heardFarewell.startedAt+1200)));
 await voiceService.tick();
 await (voiceService as any).active.get(farewellVoice.id).pending;
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,+heardFarewell.startedAt+1740-Date.now())));
 await voiceService.media(user,farewellInvite.sessionId,clientId,'QUIET',7,0);
 await voiceService.media(user,farewellInvite.sessionId,clientId,'INPUT_QUIET',8,0);
 await voiceService.tick(new Date(Date.now()+3100));
 assert.equal((await voiceService.state(user,farewellInvite.sessionId))?.closeReason,'TARA_FINISHED');
 assert.deepEqual(commands.slice(farewellCommands).map(command=>command.type),['session.close'],'verified farewell only closes the connection');

 const noMediaTelemetry=await roleInvite('VOICE','role-connected-heartbeat');
 await voiceService.create(user,noMediaTelemetry.sessionId,clientId,'v=0 connected heartbeat mock SDP',TARA_LIVE_AUDIO_PROTOCOL);
 await voiceService.heartbeat(user,noMediaTelemetry.sessionId,clientId,true);
 await voiceService.tick(new Date(Date.now()+8500));
 assert.equal((await voiceService.state(user,noMediaTelemetry.sessionId))?.clockRunning,true,'transport readiness backs up missing media telemetry');
 await voiceService.end(user,noMediaTelemetry.sessionId,clientId);

 const noDiagnostics=await roleInvite('VOICE','role-no-diagnostics');
 const unobserved=await voiceService.create(user,noDiagnostics.sessionId,clientId,'v=0 missing diagnostics mock SDP',TARA_LIVE_AUDIO_PROTOCOL);
 onLost();
 const receivedSdp=Date.now();
 await voiceService.tick(new Date(receivedSdp+61_000));
 const recoveredClock=await voiceService.state(user,noDiagnostics.sessionId);
 assert.equal(recoveredClock?.status,'ACTIVE','loss of both diagnostics paths cannot hang up a media session');
 assert.equal(recoveredClock?.clockRunning,true,'a negotiated session always gets a hard deadline');
 await voiceService.tick(new Date(receivedSdp+900_000));
 assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:unobserved.id}})).closeReason,'TIME_LIMIT');
 process.env.TAKA_ALIGNED_ROLE_RUBRIC_ENABLED='true';
 const alignedJob=await db.jobPost.create({data:{companyId:company.id,title:'API Engineer · Rubrik bersama',status:'PUBLISHED',
  description:'Mengembangkan API dan menulis panduan.',responsibilities:['Tulis panduan penggunaan API','Bangun endpoint API','Bangun endpoint API']},include:scoreJobInclude});
 const alignedCvText='Kandidat Undangan\nMembantu tim proyek inventaris membangun API dengan Node.js.';
 const alignedCandidate=await db.recruitmentCandidate.create({data:{companyId:company.id,jobId:alignedJob.id,fullName:candidate.fullName,email:candidate.email,
  filename:candidate.filename,fileKey:candidate.fileKey,contentType:candidate.contentType,sizeBytes:candidate.sizeBytes,checksum:candidate.checksum,
  scoreStatus:'READY',cvScore:80,cvResult:{cvText:alignedCvText},jobSnapshot:{title:alignedJob.title},stage:'IN_REVIEW'}});
 await candidates.retry(hr,alignedCandidate.id);
 const alignedPacket=(await packets.sync(alignedJob.id,'VOICE'))!;
 await deliver('PREPARE',alignedPacket.id);
 const alignedRubric=((await db.aiScreeningPackage.findUniqueOrThrow({where:{id:alignedPacket.id}})).payload as PackagePayload).roleRubric!;
 assert.equal(alignedRubric.version,ROLE_RUBRIC_VERSION);
 assert.equal(alignedRubric.criteria.length,2);
 const alignedPending=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:alignedCandidate.id}});
 // CV outcome supplied by the simulated provider in cv-assessment.integration.smoke.ts.
 await db.recruitmentCandidate.update({where:{id:alignedCandidate.id},data:{scoreStatus:'READY',cvScore:80,
  cvResult:{cvText:alignedCvText,roleAssessment:{rubricRevision:alignedRubric.revision}},
  jobSnapshot:{...alignedPending.jobSnapshot as object,resolvedRoleRubric:alignedRubric as unknown as Prisma.InputJsonObject}}});
 const alignedInvite=await invitations.create(hr,alignedCandidate.id,{mode:'TEXT',requestKey:'aligned-chat'});
 const alignedRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:alignedInvite.id}});
 assert.equal(alignedRow.packageId,alignedPacket.id);
 const alignedClaim=await invitations.claim(user,invitationToken(alignedRow.id,alignedRow.tokenNonce,config.get('JWT_SECRET')!));
 const alignedPlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:alignedClaim.session.id}});
 await deliver('CANDIDATE',alignedPlan.id);
 await sessions.claim(user,alignedClaim.session.id,clientId);
 guidedText=await sessions.start(user,alignedClaim.session.id,clientId);
 assert.match(guidedText.questions[0].text,/(?:CV[^\n]*Node\.js|Node\.js[^\n]*CV)/);
 for(const answer of ['Di proyek inventaris, saya membantu tim dengan menulis endpoint Node.js dan memvalidasi input dengan tes batas.',docAnswer])await submitText(answer);
 assert.equal(guidedText.status,'COMPLETED');
 await deliver('EVALUATE',alignedClaim.session.id);
 await deliver('PDF',alignedClaim.session.id);
 const alignedReport=await invitations.report(hr,alignedInvite.id);
 const alignedResult=(alignedReport.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment;
 assert.equal(alignedResult.rubricRevision,alignedRubric.revision);
 assert.equal(alignedResult.coverage.assessed,2);
 assert.equal(alignedReport.pdfStatus,'READY');
 assert.equal((await invitations.report(hr,roleText.id)).evaluation?.finalScore,85.3);
 config.set('TARA_LIVE_COMPLETION_ENABLED','true');
 async function newCompletionInvite(key:string,candidateId=alignedCandidate.id){
  const invitation=await invitations.create(hr,candidateId,{mode:'VOICE',requestKey:key});
  const stored=await db.screeningInvitation.findUniqueOrThrow({where:{id:invitation.id}});
  assert.equal((stored.snapshot as {liveCompletionVersion?:string}).liveCompletionVersion,'tara-live-completion-v1');
  const token=invitationToken(stored.id,stored.tokenNonce,config.get('JWT_SECRET')!);
  const started=await invitations.claim(user,token);
  const prepared=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:started.session.id}});
  if(prepared.status!=='READY')await deliver('CANDIDATE',prepared.id);
  return {id:invitation.id,sessionId:started.session.id,token};
 }
 config.set('TARA_LIVE_VOICE','marin');
 const partialInvite=await newCompletionInvite('live-completion-resume');
 const partialStored=await db.screeningInvitation.findUniqueOrThrow({where:{id:partialInvite.id}});
 const frozen=partialStored.snapshot as unknown as {
  liveVoicePrompt: import('../prompts/voice-session').FrozenLiveVoicePrompt;
  liveEvidencePrompt: string;
 };
 // Reproduce an invitation saved with a different prompt revision from the executing code.
 frozen.liveVoicePrompt.initial.instructions+='\n\nInstruksi awal dari undangan sintetis.';
 frozen.liveVoicePrompt.resumed.instructions+='\n\nInstruksi kelanjutan dari undangan sintetis.';
 frozen.liveVoicePrompt.resumed.opening+=' Sapaan kelanjutan dari undangan sintetis.';
 const frozenEvaluation=JSON.parse(frozen.liveEvidencePrompt) as import('../taka-live-evidence').FrozenLiveEvidencePrompt;
 frozenEvaluation.preset.instructions+='\n\nPedoman penilaian dari undangan sintetis.';
 frozenEvaluation.repair+=' Pedoman pemulihan dari undangan sintetis.';
 frozen.liveEvidencePrompt=JSON.stringify(frozenEvaluation);
 await db.screeningInvitation.update({where:{id:partialInvite.id},data:{snapshot:frozen as unknown as Prisma.InputJsonValue}});
 config.set('TARA_LIVE_VOICE','sage');
 const firstConnection=await voiceService.create(user,partialInvite.sessionId,clientId,'v=0 completion test initial SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const initialConnectionId=firstConnection.connectionId;
 assert.ok(initialConnectionId);
 assert.equal(lastVoiceRequest!.session.audio.output.voice,'marin','opening uses the voice chosen when the invitation was created');
 assert.equal(lastVoiceRequest!.session.instructions,frozen.liveVoicePrompt.initial.instructions);
 assert.equal(liveEvaluationRequests.length,0);
 onEvent({type:'session.started',event_id:'completion-start'});
 await voiceService.media(user,partialInvite.sessionId,clientId,'READY',1,0,initialConnectionId);
 onEvent({type:'session.output_audio.delta',start_ms:100,end_ms:120,delta:voiceDelta});
 const began=await voiceService.media(user,partialInvite.sessionId,clientId,'AUDIBLE',2,0,initialConnectionId);
  assert.ok(began.deadlineAt);
 const firstAgenda=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]).topics;
 const endpointTopic=firstAgenda.find((topic:{competence:string})=>topic.competence.includes('endpoint'));
 assert.ok(endpointTopic);
 onEvent({type:'session.output_transcript.delta',event_id:'completion-q-initial',delta:endpointTopic.workScenario??endpointTopic.question,start_ms:100,end_ms:260});
 onEvent({type:'session.input_transcript.delta',event_id:'completion-a-initial',delta:apiAnswer,start_ms:600,end_ms:900});
 onEvent({type:'session.input_transcript.delta',event_id:'completion-fragment-invalid',delta:'Fragmen uji tanpa waktu sah',start_ms:1200,end_ms:0});
 await voiceService.media(user,partialInvite.sessionId,clientId,'QUIET',3,0,initialConnectionId);
 const unverifiedQuestion='Gimana lo menentukan kapan catatan penggunaan API perlu diperbarui?';
 onEvent({type:'session.output_transcript.delta',event_id:'completion-unverified-question',delta:unverifiedQuestion,start_ms:5000,end_ms:6300});
 const liveState=(voiceService as any).active.get(initialConnectionId);
 liveState.candidateLastSpeechAt=+began.startedAt+600;
 const beforePhases=commands.length;
 const heartbeatGap=new Date(+began.startedAt+60_000);
 await voiceService.tick(heartbeatGap);
 assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:initialConnectionId}})).status,'ACTIVE',
  'an unknown heartbeat and quiet recorder are not evidence WebRTC disconnected');
 // Exercise the same boundaries without sending any conversational commands.
 for(const minute of [9,12]){
  const tickAt=new Date(+began.startedAt+minute*60_000);
   liveState.inputQuiet=true;
   liveState.inputObservedAt=+tickAt;
  await db.voiceInterview.update({where:{id:initialConnectionId},data:{heartbeatAt:tickAt}});
  await voiceService.tick(tickAt);
 }
 assert.equal(commands.length,beforePhases,'crossing the phase boundaries does not send instructions to Tara');
 assert.equal(liveEvaluationRequests.length,0,'Live records the conversation without running the evaluator');
  nextVoiceUsage=420;
  liveState.inputQuiet=true;
  liveState.inputObservedAt=Date.now();
  await voiceService.end(user,partialInvite.sessionId,clientId,'CONNECTION_LOST',initialConnectionId);
 assert.equal((await db.screeningInvitation.findUniqueOrThrow({where:{id:partialInvite.id}})).status,'STARTED');
  assert.equal(await db.aiScreeningWork.count({where:{key:liveEvaluationKey(partialInvite.sessionId,1)}}),0);
 const resumable=await voiceService.state(user,partialInvite.sessionId);
 assert.equal(resumable?.completion?.status,'RESUMABLE');
 assert.equal(resumable?.transcriptComplete,false);
 const recordedLeg=await db.voiceInterview.findUniqueOrThrow({where:{id:initialConnectionId}});
 assert.ok((recordedLeg.taraInterview as {captureGaps?:Array<{reason:string}>}).captureGaps?.some(gap=>gap.reason==='INVALID_TRANSCRIPT_FRAGMENT'));
 assert.equal(resumable?.completion?.canResume,true);
  assert.equal(resumable?.remainingVoiceMs,480000);
 assert.deepEqual(liveCompletion((await db.aiScreeningSession.findUniqueOrThrow({where:{id:partialInvite.sessionId}})).voiceCompletion)?.missingCriterionIds,[]);
  assert.equal(resumable?.deadlineAt,undefined);
  assert.ok(resumable?.resumeUntil&&Date.parse(resumable.resumeUntil)>Date.now()+6*86400000);
 assert.equal((await invitations.report(hr,partialInvite.id)).pdfStatus,'NOT_READY');
 assert.equal((await invitations.claim(user,partialInvite.token)).session.id,partialInvite.sessionId);
 const connectionResults=await Promise.allSettled([clientId,'second-browser-tab'].map(tab=>
   voiceService.create(user,partialInvite.sessionId,tab,'v=0 completion continuation offer SDP',TARA_LIVE_AUDIO_PROTOCOL)));
 assert.equal(connectionResults.filter(row=>row.status==='fulfilled').length,1,
  connectionResults.flatMap(row=>row.status==='rejected'?[String(row.reason)]:[]).join('\n'));
 const replacement=(await db.voiceInterview.findFirstOrThrow({where:{resumedForId:partialInvite.sessionId},orderBy:{connectionNumber:'desc'}})).id;
 const resumedTab=connectionResults[0].status==='fulfilled'?clientId:'second-browser-tab';
 const resumedSdp=(connectionResults.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof voiceService.create>>>).value;
  assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:replacement}})).reservedVoiceMs,480000);
  assert.ok(+resumedSdp.deadlineAt!-Date.now()<=480000,'the provider receives only the unused voice budget');
 await voiceService.media(user,partialInvite.sessionId,resumedTab,'READY',1,0,replacement);
 const replacementState=(voiceService as any).active.get(replacement);
 await voiceService.tick(new Date(replacementState.acceptedAt+61_000));
 assert.equal((await voiceService.state(user,partialInvite.sessionId))?.status,'ACTIVE',
  'a connected peer with no output observations is not forcibly closed while startup telemetry is unavailable');
 const continuedAgenda=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]);
 assert.equal(lastVoiceRequest!.session.audio.output.voice,'marin','a replacement uses the original invitation voice');
 assert.equal(lastVoiceRequest!.session.instructions,frozen.liveVoicePrompt.resumed.instructions);
 assert.equal(lastVoiceRequest!.session.input[1].content[0].text,frozen.liveVoicePrompt.resumed.opening);
 await voiceService.media(user,partialInvite.sessionId,resumedTab,'PLAYBACK_READY',2,0,replacement);
 await voiceService.media(user,partialInvite.sessionId,resumedTab,'INPUT_QUIET',3,0,replacement);
 await voiceService.tick(new Date(Date.now()+1000));
 assert.equal(commands.at(-1).opening,frozen.liveVoicePrompt.resumed.opening,'greeting recovery uses the same saved greeting');
 assert.deepEqual(continuedAgenda.topics,firstAgenda,'the new connection is seeded with the frozen agenda');
 assert.ok(continuedAgenda.previousConversation.some((turn:{speaker:string;text:string})=>turn.speaker==='CANDIDATE' && turn.text===apiAnswer));
 assert.ok(!continuedAgenda.previousConversation.some((turn:{text:string})=>turn.text===unverifiedQuestion),
  'an unverified question at disconnect is not introduced as shared history');
 assert.equal(await db.voiceFragment.count({where:{voiceId:initialConnectionId,eventId:'completion-unverified-question'}}),1,
  'the original question remains available for assessment and diagnostics');
 assert.equal(continuedAgenda.remainingSeconds,480);
 assert.equal(continuedAgenda.elapsedSeconds,420);
 await assert.rejects(voiceService.end(user,partialInvite.sessionId,resumedTab,'CANDIDATE_ENDED',initialConnectionId));
 await assert.rejects(voiceService.media(user,partialInvite.sessionId,resumedTab,'AUDIBLE',40,0,initialConnectionId));
 nextVoiceUsage=45;
 await voiceService.end(user,partialInvite.sessionId,resumedTab,'CANDIDATE_PAUSED',replacement);
 const secondPause=await voiceService.state(user,partialInvite.sessionId);
 assert.equal(secondPause?.completion?.status,'RESUMABLE');
 assert.equal(secondPause?.completion?.reason,'CANDIDATE_PAUSED');
 assert.equal(secondPause?.remainingVoiceMs,435000);
 assert.equal(secondPause?.resumeUntil,resumable?.resumeUntil,'a second pause does not extend the original access window');
 const third=await voiceService.create(user,partialInvite.sessionId,resumedTab,'v=0 completion test third SDP',TARA_LIVE_AUDIO_PROTOCOL);
 assert.equal(third.connectionNumber,3);
 assert.equal(lastVoiceRequest!.session.audio.output.voice,'marin');
 config.set('TARA_LIVE_VOICE','marin');
 onEvent({type:'session.started',event_id:'completion-resumed'});
 onEvent({type:'session.output_transcript.delta',event_id:'completion-q-resumed',delta:'Gimana cara lu menyusun panduan penggunaan API?',start_ms:100,end_ms:800});
 onEvent({type:'session.input_transcript.delta',event_id:'completion-a-resumed',delta:docAnswer,start_ms:1200,end_ms:2300});
  nextVoiceUsage=165;
  await voiceService.end(user,partialInvite.sessionId,resumedTab,'CANDIDATE_ENDED',third.connectionId);
 const finalWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(partialInvite.sessionId,3)}});
 await db.aiScreeningWork.update({where:{id:finalWork.id},data:{status:'DONE'}});
 await db.aiScreeningSession.update({where:{id:partialInvite.sessionId},data:{updatedAt:new Date(Date.now()-45000)}});
 (voiceService as any).nextEvaluationCheck=0;
 await voiceService.tick();
 assert.equal((await db.aiScreeningWork.findUniqueOrThrow({where:{id:finalWork.id}})).status,'PENDING',
  'reconciliation recovers a worker that exited before publishing any score');
  corruptFirstCompletionReport=true;
  await restartedWorker.process(finalWork.id);
  corruptFirstCompletionReport=false;
 await deliver('PDF',partialInvite.sessionId);
 const completed=await invitations.report(hr,partialInvite.id);
 const completedRole=(completed.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment;
 assert.equal(completed.invitation.session?.completion?.status,'COMPLETE');
 assert.equal(completed.evaluation?.finalScore,85.3);
 assert.equal(completedRole.coverage.assessed,2);
  assert.deepEqual(liveEvaluationRequests.map(request=>request.ids.length),[2,1], 'Taka scores both connections together and retries only one disputed competency');
  assert.deepEqual(liveEvaluationRequests[1].repair,['INSUFFICIENT_WITH_ANSWER']);
 assert.ok(liveEvaluationRequests.every(request=>request.instructions?.includes('Pedoman penilaian dari undangan sintetis.')));
 assert.ok(liveEvaluationRequests[1].instructions?.includes('Pedoman pemulihan dari undangan sintetis.'));
 assert.ok(completed.voice?.transcript?.some(turn=>turn.text===apiAnswer));
 assert.ok(completed.voice?.transcript?.some(turn=>turn.text===docAnswer));
 assert.equal((await invitations.list(hr,alignedCandidate.id)).find(row=>row.id===partialInvite.id)?.session?.evaluation?.finalScore,85.3);
 assert.equal(completed.pdfStatus,'READY');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'PDF',subjectId:partialInvite.sessionId}}),1);
 const completedEvaluation=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:partialInvite.sessionId}});
 const completedPdf=pdfjs.getDocument({data:new Uint8Array(objects.get(completedEvaluation.pdfKey!)!),verbosity:0});
 try {
  const doc=await completedPdf.promise;
  const page=await(await doc.getPage(1)).getTextContent();
  assert.match(page.items.flatMap(item=>'str' in item?[item.str]:[]).join(' '),/Skor akhir 85,3\s*\/\s*100/);
 } finally {await completedPdf.destroy();}
 await assert.rejects(voiceService.create(user,partialInvite.sessionId,resumedTab,'v=0 completion cannot reopen SDP',TARA_LIVE_AUDIO_PROTOCOL));
 await assert.rejects(invitations.report({...hr,id:'foreign-hr'},partialInvite.id));

 const knownGapInvite=await newCompletionInvite('live-completion-evaluated-resume');
 const knownGapFirst=await voiceService.create(user,knownGapInvite.sessionId,clientId,'v=0 evaluated resume first SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const knownGapAgenda=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]).topics as
  Array<{criterionId:string;competence:string;question:string;workScenario?:string}>;
 const apiTopic=knownGapAgenda.find(topic=>topic.competence.includes('endpoint'))!;
 const docTopic=knownGapAgenda.find(topic=>topic.competence.includes('panduan'))!;
 onEvent({type:'session.output_transcript.delta',event_id:'known-gap-api-question',delta:apiTopic.workScenario??apiTopic.question,start_ms:100,end_ms:800});
 onEvent({type:'session.input_transcript.delta',event_id:'known-gap-api-answer',delta:apiAnswer,start_ms:2000,end_ms:3500});
 nextVoiceUsage=740;
 await voiceService.end(user,knownGapInvite.sessionId,clientId,'CANDIDATE_ENDED',knownGapFirst.connectionId);
 await restartedWorker.process((await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(knownGapInvite.sessionId,1)}})).id);
 const afterCoverage=await voiceService.state(user,knownGapInvite.sessionId);
 assert.equal(afterCoverage?.completion?.reason,'COVERAGE');
 assert.equal(afterCoverage?.completion?.canResume,true);
 assert.equal(afterCoverage?.remainingVoiceMs,160000);
 assert.equal((await invitations.report(hr,knownGapInvite.id)).evaluation,null,'an in-progress interview publishes no final assessment');
 const knownGapSecond=await voiceService.create(user,knownGapInvite.sessionId,clientId,'v=0 evaluated resume second SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const narrowedAgenda=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]);
 assert.deepEqual(narrowedAgenda.topics,[docTopic],'only outstanding work is routed to the next Live brief');
 assert.deepEqual(narrowedAgenda.assessedCriterionIds,[apiTopic.criterionId]);
 assert.ok(narrowedAgenda.previousConversation.some((turn:{text:string})=>turn.text===apiAnswer));
 assert.equal(narrowedAgenda.elapsedSeconds,740);
 const beforeKnownEvaluation=liveEvaluationRequests.length;
 onEvent({type:'session.output_transcript.delta',event_id:'known-gap-doc-question',delta:docTopic.workScenario??docTopic.question,start_ms:100,end_ms:900});
 onEvent({type:'session.input_transcript.delta',event_id:'known-gap-doc-answer',delta:docAnswer,start_ms:2200,end_ms:3800});
 assert.equal(liveEvaluationRequests.length,beforeKnownEvaluation,'Taka remains off the audio path of the resumed connection');
 nextVoiceUsage=30;
 await voiceService.end(user,knownGapInvite.sessionId,clientId,'CANDIDATE_PAUSED',knownGapSecond.connectionId);
 const afterNewAnswer=await voiceService.state(user,knownGapInvite.sessionId);
 assert.equal(afterNewAnswer?.completion?.canResume,true);
 assert.equal(afterNewAnswer?.remainingVoiceMs,130000);
 const knownGapThird=await voiceService.create(user,knownGapInvite.sessionId,clientId,'v=0 resume again after candidate answered',TARA_LIVE_AUDIO_PROTOCOL);
 const latestBrief=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]);
 assert.equal(latestBrief.missingCriterionIds,undefined,'a previous assessment cannot label a competency missing after more answers arrive');
 assert.deepEqual(latestBrief.previouslyMissingCriterionIds,[docTopic.criterionId]);
 assert.deepEqual(latestBrief.topics,[docTopic]);
 assert.ok(latestBrief.previousConversation.some((turn:{text:string})=>turn.text===docAnswer));
 assert.equal(liveEvaluationRequests.length,beforeKnownEvaluation,'rejoining does not wait for a new review of the additional answer');
 await voiceService.end(user,knownGapInvite.sessionId,clientId,'CANDIDATE_ENDED',knownGapThird.connectionId);
 await restartedWorker.process((await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(knownGapInvite.sessionId,3)}})).id);
 await deliver('PDF',knownGapInvite.sessionId);
 const knownGapComplete=await invitations.report(hr,knownGapInvite.id);
 assert.deepEqual(liveEvaluationRequests.slice(beforeKnownEvaluation).map(request=>request.ids),[[docTopic.criterionId]]);
 assert.equal(knownGapComplete.pdfStatus,'READY');
 assert.equal(knownGapComplete.evaluation?.finalScore,85.3);
 assert.equal((knownGapComplete.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment.coverage.assessed,2);
 console.log('Live evaluated resume passed: pending agenda, preserved transcript, one outstanding evaluation and final PDF. Paid calls: 0.');

 const expiredInvite=await newCompletionInvite('live-completion-deadline');
 const expiring=await voiceService.create(user,expiredInvite.sessionId,clientId,'v=0 completion no answers SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const expiredConnectionId=expiring.connectionId!;
 assert.deepEqual(lastVoiceRequest!.session.client.data_channel.allowed_client_events,['session.close']);
 const openingCommands=commands.length;
 await voiceService.media(user,expiredInvite.sessionId,clientId,'READY',1,0,expiredConnectionId);
 await voiceService.media(user,expiredInvite.sessionId,clientId,'PLAYBACK_READY',2,0,expiredConnectionId);
 await voiceService.media(user,expiredInvite.sessionId,clientId,'INPUT_QUIET',3,0,expiredConnectionId);
 const startupRuntime=(voiceService as any).active.get(expiredConnectionId);
 startupRuntime.delivery.playbackReadyAt=Date.now()-1000;
 // The microphone reached GPT-Live before the browser's next INPUT_ACTIVE or a transcript delta.
 onEvent({type:'session.input_audio.append',audio:voiceDelta});
 await voiceService.tick();
 assert.equal(commands.length,openingCommands,'the fallback greeting cannot compete with newly received microphone audio');
 onEvent({type:'session.input_audio.append',audio:Buffer.alloc(960).toString('base64')});
 await voiceService.tick(new Date(Date.now()+300));
 assert.equal(commands.length,openingCommands,'one silent packet does not establish a quiet input window');
 await voiceService.tick(new Date(Date.now()+800));
 assert.equal(commands.slice(openingCommands).filter(command=>command.event_id==='tara-opening').length,1,
  'an already joined WebRTC session can request its opening even when sideband missed session.started');
 assert.equal(await db.voiceFragment.count({where:{voiceId:expiredConnectionId}}),0,'raw microphone audio is never stored as evidence');
  assert.equal((await voiceService.state(user,expiredInvite.sessionId))?.clockRunning,true,'the budget counts provider-active setup as well as speech');
 await voiceService.media(user,expiredInvite.sessionId,clientId,'AUDIBLE',4,0,expiredConnectionId);
 onEvent({type:'session.closed',event_id:'front-end-early-close',usage:{seconds:40},reason:'close_requested'});
 for(let i=0;i<80&&(await db.voiceInterview.findUniqueOrThrow({where:{id:expiredConnectionId}})).status!=='ENDED';i++)
  await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:expiredConnectionId}})).closeReason,'PROVIDER_ENDED',
  'a client closure only counts as time limit after the server deadline');
  const expires=(await voiceService.state(user,expiredInvite.sessionId))?.resumeUntil;
  assert.ok(expires);
  assert.equal((await voiceService.state(user,expiredInvite.sessionId))?.completion?.status,'RESUMABLE');
  await voiceService.tick(new Date(Date.parse(expires)+1));
  await deliver('VOICE_EVALUATE',expiredInvite.sessionId,restartedWorker);
 assert.equal(liveCompletion((await db.aiScreeningSession.findUniqueOrThrow({where:{id:expiredInvite.sessionId}})).voiceCompletion)?.status,'INTERRUPTED');
 const expiredReport=await invitations.report(hr,expiredInvite.id);
 assert.equal(expiredReport.invitation.status,'INTERRUPTED');
 assert.equal(expiredReport.evaluation?.finalScore,null);
 assert.equal(await db.voiceInterview.count({where:{resumedForId:expiredInvite.sessionId}}),0);

 const browserDeadline=await newCompletionInvite('live-completion-browser-hard-deadline');
 const timedVoice=await voiceService.create(user,browserDeadline.sessionId,clientId,'v=0 completion hard deadline SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const timedId=timedVoice.connectionId!,timedRuntime=(voiceService as any).active.get(timedId);
 clearTimeout(timedRuntime.hardTimer);
 timedRuntime.completion.deadlineAt=Date.now()-1;
 onEvent({type:'session.input_transcript.delta',event_id:'answer-before-deadline',delta:apiAnswer,start_ms:880000,end_ms:885000});
 const requestsBeforeBrowserDeadline=commands.length;
 onEvent({type:'session.closed',event_id:'front-end-deadline-close',usage:{seconds:900},reason:'close_requested'});
 for(let i=0;i<80&&(await db.voiceInterview.findUniqueOrThrow({where:{id:timedId}})).status!=='ENDED';i++)
  await new Promise(resolve=>setTimeout(resolve,25));
 const timedRow=await db.voiceInterview.findUniqueOrThrow({where:{id:timedId}});
 assert.equal(timedRow.closeReason,'TIME_LIMIT');
 assert.equal(timedRow.billedVoiceMs,900000);
 assert.equal(commands.length,requestsBeforeBrowserDeadline,'trusted provider acknowledgement settles the close once');
 const timedState=await voiceService.state(user,browserDeadline.sessionId);
 assert.equal(timedState?.remainingVoiceMs,0);
 assert.equal(timedState?.completion?.canResume,false);
 assert.ok(timedState?.transcript?.some(turn=>turn.text===apiAnswer));
 const timedWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(browserDeadline.sessionId,1)}});
 await restartedWorker.process(timedWork.id);
 assert.equal((await voiceService.state(user,browserDeadline.sessionId))?.completion?.status,'INTERRUPTED');
 console.log('Live browser deadline integration passed: trusted provider receipt, time-limit classification and preserved answer. Paid calls: 0.');

 const interruptedInvite=await newCompletionInvite('live-completion-restart-after-receipt');
 const interruptedVoice=await voiceService.create(user,interruptedInvite.sessionId,clientId,
  'v=0 completion restart receipt SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const interruptedId=interruptedVoice.connectionId!;
 const interruptedRuntime=(voiceService as any).active.get(interruptedId);
 onEvent({type:'session.usage.updated',usage:{seconds:419.5}});
 onEvent({type:'session.usage.updated',usage:{seconds:400}});
 await voiceService.tick();
 const inProgressUsage=await db.voiceInterview.findUniqueOrThrow({where:{id:interruptedId}});
 assert.equal(inProgressUsage.observedVoiceMs,419500,'lagging sideband usage cannot replace the cumulative observation');
 assert.equal(inProgressUsage.billedVoiceMs,null,'only final usage settles the reservation');
 const persistDeadline=(voiceService as any).persistDeadline.bind(voiceService);
 let rejectedOnce=false;
 (voiceService as any).persistDeadline=async (live:any)=>{
  if(live===interruptedRuntime&&!rejectedOnce){rejectedOnce=true;throw Error('SYNTHETIC_DATABASE_OUTAGE_AFTER_PROVIDER_RECEIPT');}
  return persistDeadline(live);
 };
 onEvent({type:'session.output_transcript.delta',event_id:'receipt-question',delta:'Bagaimana lo menyusun endpoint API?',start_ms:100,end_ms:850});
 onEvent({type:'session.input_transcript.delta',event_id:'receipt-first-answer',delta:apiAnswer,start_ms:1100,end_ms:2300});
 onEvent({type:'session.output_transcript.delta',event_id:'receipt-doc-question',
  delta:'Bagaimana lo menyusun panduan supaya tim lain bisa pakai endpoint?',start_ms:2700,end_ms:4000});
 interruptedRuntime.backupReady=true;
 afterCloseForTest=()=>setTimeout(()=>onEvent({type:'session.input_transcript.delta',event_id:'receipt-answer',
  delta:docAnswer,start_ms:4400,end_ms:5500}),20);
 nextVoiceUsage=420;
 try {await voiceService.end(user,interruptedInvite.sessionId,clientId,'CANDIDATE_ENDED',interruptedId);}
 finally {afterCloseForTest=undefined;(voiceService as any).persistDeadline=persistDeadline;}
 assert.equal(rejectedOnce,true);
 const beforeRestart=await db.voiceInterview.findUniqueOrThrow({where:{id:interruptedId}});
 assert.equal(beforeRestart.status,'CLOSING');
 assert.equal(beforeRestart.closeReason,'CANDIDATE_ENDED');
 assert.equal(beforeRestart.billedVoiceMs,420000,'closure receipt survives the database error after provider closed');
 assert.equal(beforeRestart.observedVoiceMs,419500);
 assert.equal(await db.voiceFragment.count({where:{voiceId:interruptedId}}),4,'last answer is retained when its subscriber trails the close event');
 const commandsBeforeRestart=commands.length;
 let postRestartProviderClose=0;
 const receiptRecovery=new VoiceService(db,config,sessions,{...liveProvider,closeWebRtc:async()=>{
  postRestartProviderClose++;throw Error('PROVIDER_REPLAY_ENDED');
 }} as never,voiceEvaluator as never);
 try {await receiptRecovery.tick();}
 finally {await receiptRecovery.onModuleDestroy();}
 const afterRestart=await voiceService.state(user,interruptedInvite.sessionId);
 assert.equal(postRestartProviderClose,0,'restart consumes committed receipt without another provider close request');
 assert.equal(commands.length,commandsBeforeRestart);
 assert.equal(afterRestart?.completion?.status,'ASSESSING','worker takeover preserves the already-requested normal ending');
 assert.equal(afterRestart?.remainingVoiceMs,480000);
 assert.ok(afterRestart?.transcript?.some(turn=>turn.text===apiAnswer));
 assert.ok(afterRestart?.transcript?.some(turn=>turn.text===docAnswer));
 const recoveredEvaluation=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(interruptedInvite.sessionId,1)}});
 await restartedWorker.process(recoveredEvaluation.id);
 await deliver('PDF',interruptedInvite.sessionId);
 const recoveredReport=await invitations.report(hr,interruptedInvite.id);
 assert.equal(recoveredReport.invitation.session?.completion?.status,'COMPLETE');
 assert.equal(recoveredReport.evaluation?.finalScore,85.3);
 assert.equal(recoveredReport.pdfStatus,'READY');
 await voiceService.finish(interruptedId,'SERVER_RESTART');

 const normalJob=await db.jobPost.create({data:{companyId:company.id,title:'Platform Engineer · Empat kompetensi',status:'PUBLISHED',assessmentLanguage:'en',locale:'id',
  description:'Mengembangkan API, melindungi perubahan produksi, dan mendokumentasikan layanan.',
  responsibilities:['Bangun endpoint API','Tulis panduan penggunaan API','Tangani insiden produksi','Kelola persetujuan akses admin']},include:scoreJobInclude});
 const normalCandidate=await db.recruitmentCandidate.create({data:{companyId:company.id,jobId:normalJob.id,fullName:candidate.fullName,email:candidate.email,
  filename:candidate.filename,fileKey:candidate.fileKey,contentType:candidate.contentType,sizeBytes:candidate.sizeBytes,checksum:candidate.checksum,
  scoreStatus:'READY',cvScore:80,cvResult:{cvText},jobSnapshot:{title:normalJob.title},stage:'IN_REVIEW'}});
 await candidates.retry(hr,normalCandidate.id);
 const normalPacket=(await packets.sync(normalJob.id,'VOICE'))!;
 await deliver('PREPARE',normalPacket.id);
 const normalRubric=((await db.aiScreeningPackage.findUniqueOrThrow({where:{id:normalPacket.id}})).payload as PackagePayload).roleRubric!;
 const normalPending=await db.recruitmentCandidate.findUniqueOrThrow({where:{id:normalCandidate.id}});
 const scoredNormal=await db.recruitmentCandidate.update({where:{id:normalCandidate.id},data:{scoreStatus:'READY',cvScore:80,
  cvResult:{cvText,roleAssessment:{rubricRevision:normalRubric.revision}},
  jobSnapshot:{...normalPending.jobSnapshot as object,resolvedRoleRubric:normalRubric as unknown as Prisma.InputJsonObject}}});
 const normalInvite=await newCompletionInvite('live-completion-normal',normalCandidate.id);
 const frozenEnglish=await db.screeningInvitation.findUniqueOrThrow({where:{id:normalInvite.id}});
 assert.equal((frozenEnglish.snapshot as {assessmentLanguage?:string}).assessmentLanguage,'en');
 const beforeAssessment=await invitations.report(hr,normalInvite.id);
 assert.equal(beforeAssessment.invitation.assessmentLanguage,'en');
 assert.equal(beforeAssessment.evaluation,null);
 const liveCheckpointDb=Object.create(db) as PrismaService;
 let failPlaybackCheckpoint=false,failedPlaybackCheckpoints=0;
 Object.defineProperty(liveCheckpointDb,'voiceInterview',{value:new Proxy(db.voiceInterview,{get(target,property,receiver){
  if(property!=='updateMany')return Reflect.get(target,property,receiver);
  return async (args:Prisma.VoiceInterviewUpdateManyArgs)=>{
   if(failPlaybackCheckpoint&&args.data.taraInterview){
    failPlaybackCheckpoint=false;
    failedPlaybackCheckpoints++;
    throw Error('SYNTHETIC_PLAYBACK_CHECKPOINT_OUTAGE');
   }
   return target.updateMany(args);
  };
 }})});
 const normalVoice=new VoiceService(liveCheckpointDb,config,sessions,liveProvider as never,voiceEvaluator as never);
 nextVoiceUsage=735;
 const normalConnection=await normalVoice.create(user,normalInvite.sessionId,clientId,'v=0 completion normal four-topic SDP',TARA_LIVE_AUDIO_PROTOCOL);
 const normalId=normalConnection.connectionId!;
 const normalTopics=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]).topics;
 assert.equal(normalTopics.length,4);
 assert.match(lastVoiceRequest!.session.input[1].content[0].text,/Ready to get started/u);
 const dialogue=[
  ['What did you personally do to build that API endpoint?',apiAnswer],
  ['How would you write an API guide for a team that is new to it?',docAnswer],
  ['What would you do if a production release caused an increase in errors?',
   'Saya sendiri menghentikan deploy, membandingkan error dengan versi sebelumnya, lalu memulihkan versi stabil.'],
  ['What would you do before granting admin access to a production service?',
   'Saya meminta persetujuan pemilik sistem dan mencatat alasan serta tanggal berakhirnya akses admin.'],
 ] as const;
 await normalVoice.media(user,normalInvite.sessionId,clientId,'READY',1,0,normalId);
 const normalLive=(normalVoice as any).active.get(normalId);
 const normalOpeningCommands=commands.length;
 await normalVoice.media(user,normalInvite.sessionId,clientId,'PLAYBACK_READY',2,0,normalId);
 onEvent({type:'session.output_transcript.delta',event_id:'normal-greeting',delta:'Hi, I’m Tara. Ready to get started?',start_ms:0,end_ms:500});
 await normalVoice.media(user,normalInvite.sessionId,clientId,'INPUT_QUIET',3,0,normalId);
 await normalVoice.tick(new Date(Date.now()+1200));
 assert.equal(normalLive.delivery.firstAudioMs,undefined);
 assert.equal(commands.length,normalOpeningCommands,'a started greeting is never requested again while its audio is in flight');
 await normalLive.pending;
 failPlaybackCheckpoint=true;
 await normalVoice.media(user,normalInvite.sessionId,clientId,'AUDIBLE',4,0,normalId);
 await normalLive.pending;
 assert.equal(failedPlaybackCheckpoints,1,'a playback checkpoint failed while the connection remained active');
 assert.equal(normalLive.delivery.firstAudioMs,undefined,'WebRTC audio can be heard before the sideband copy arrives');
 onEvent({type:'session.output_audio.delta',start_ms:0,end_ms:20,delta:voiceDelta});
 assert.equal(normalLive.delivery.playbackVerified,true,'the late sideband copy verifies playback already heard by the candidate');
 await normalVoice.media(user,normalInvite.sessionId,clientId,'QUIET',5,0,normalId);
 await normalLive.pending;
 const normalStart=Date.now()-12*60_000-26_000;
 const providerStart=normalStart+8000;
 normalLive.delivery={ ...normalLive.delivery, firstAudible:providerStart,clockStartedAt:providerStart,windows:[] };
 normalLive.latestOutputReceivedAt=providerStart+20;
 normalLive.completion.deadlineAt=normalStart+900_000;
 normalLive.completion.startedAt=normalStart;
 await db.aiScreeningSession.update({where:{id:normalInvite.sessionId},data:{voiceDeadlineAt:new Date(normalStart+900_000)}});
 await db.voiceInterview.update({where:{id:normalId},data:{startedAt:new Date(normalStart)}});
 const times=[37_000,153_000,279_000,424_000];
 const beforeNormal=liveEvaluationRequests.length;
 for(const [index,[question,answer]] of dialogue.entries()){
  const at=times[index];
  onEvent({type:'session.output_transcript.delta',event_id:'normal-question-'+index,delta:question,start_ms:at,end_ms:at+2500});
  onEvent({type:'session.input_transcript.delta',event_id:'normal-answer-'+index,delta:answer,start_ms:at+4000,end_ms:at+8000});
  normalLive.delivery.windows.push({start:providerStart+at-50,end:providerStart+at+2650});
 }
 const earlyFarewell=12*60_000-4000;
 onEvent({type:'session.output_transcript.delta',event_id:'normal-early-farewell',delta:'Thanks for sharing. This concludes our interview.',
  start_ms:earlyFarewell,end_ms:earlyFarewell+800});
 normalLive.delivery.windows.push({start:providerStart+earlyFarewell-10,end:providerStart+earlyFarewell+1000});
 normalLive.playbackObservedAt=providerStart+earlyFarewell+1000;
 normalLive.inputQuiet=true;
 normalLive.inputObservedAt=Date.now();
 normalLive.candidateLastSpeechAt=providerStart+times.at(-1)!+8000;
 await normalVoice.tick();
 if(normalLive.flushing) await normalLive.flushing;
 await normalVoice.tick();
 const stillActive=await db.voiceInterview.findUniqueOrThrow({where:{id:normalId}});
 assert.equal(stillActive.status,'ACTIVE','startup delay never counts toward the earliest farewell on the provider timeline');
 const farewellAt=providerStart+12*60_000+9000;
 onEvent({type:'session.output_transcript.delta',event_id:'normal-farewell',delta:'Thanks for sharing. This concludes our interview.',
  start_ms:farewellAt-providerStart,end_ms:farewellAt-providerStart+800});
 normalLive.delivery.windows.push({start:farewellAt-10,end:farewellAt+1000});
 normalLive.playbackObservedAt=farewellAt+1000;
 normalLive.inputQuiet=true;
 normalLive.inputObservedAt=Date.now();
 normalLive.candidateLastSpeechAt=farewellAt+300;
 await normalVoice.tick();
 if(normalLive.flushing) await normalLive.flushing;
 await normalVoice.tick();
 const overlappingFarewell=await db.voiceInterview.findUniqueOrThrow({where:{id:normalId}});
 assert.equal(overlappingFarewell.status,'ACTIVE',
  'microphone activity during a farewell keeps the call open even if the candidate speech never reached the transcript');
 const repeatedFarewellAt=Date.now()+600;
 onEvent({type:'session.input_audio.append',audio:voiceDelta});
 assert.ok(normalLive.lastInputAudioAt>=repeatedFarewellAt-600&&normalLive.lastInputAudioAt<repeatedFarewellAt);
 onEvent({type:'session.input_transcript.delta',event_id:'normal-late-quiet-estimate',delta:'No more details. Please end the interview.',
  start_ms:repeatedFarewellAt-providerStart-2200,end_ms:repeatedFarewellAt-providerStart+400});
 normalLive.candidateLastSpeechAt=repeatedFarewellAt-650;
 normalLive.inputObservedAt=repeatedFarewellAt+3900;
 onEvent({type:'session.output_transcript.delta',event_id:'normal-farewell-thanks',delta:'Thanks for sharing.',
  start_ms:repeatedFarewellAt-providerStart,end_ms:repeatedFarewellAt-providerStart+200});
 onEvent({type:'session.output_transcript.delta',event_id:'normal-farewell-after-candidate',delta:' This concludes our interview.',
  start_ms:repeatedFarewellAt-providerStart+200,end_ms:repeatedFarewellAt-providerStart+800});
 normalLive.delivery.windows.push({start:repeatedFarewellAt+319,end:repeatedFarewellAt+1000});
 normalLive.playbackObservedAt=repeatedFarewellAt+1000;
 normalLive.latestOutputReceivedAt=repeatedFarewellAt+1100;
 const finalQuietCheck=new Date(repeatedFarewellAt+4100);
 await normalVoice.tick(finalQuietCheck);
 if(normalLive.flushing) await normalLive.flushing;
 await normalVoice.tick(finalQuietCheck);
 const pendingPlayback=await db.voiceInterview.findUniqueOrThrow({where:{id:normalId}});
 assert.equal(pendingPlayback.status,'ACTIVE','reflected audio after the last quiet report keeps the call open');
 normalLive.latestOutputReceivedAt=repeatedFarewellAt+800;
 const finalFragmentText=' Kalimat terakhir ini tercatat dari koneksi pencatatan awal.';
 latePrimaryTranscript={type:'session.input_transcript.delta',event_id:'normal-delayed-final-fragment',delta:finalFragmentText,
  start_ms:times.at(-1)!+8040,end_ms:times.at(-1)!+9020};
 confirmCloseDuringFallback=true;
 await normalVoice.tick(finalQuietCheck);
 assert.equal(liveEvaluationRequests.length,beforeNormal,'the score model stays off the native audio path');
 if(normalLive.flushing) await normalLive.flushing;
 await normalVoice.tick(finalQuietCheck);
 const normalRow=await db.voiceInterview.findUniqueOrThrow({where:{id:normalId}});
 assert.equal(normalRow.closeReason,'TARA_FINISHED');
 assert.equal(normalRow.transcriptComplete,true,'a recovered playback checkpoint does not mark a complete transcript as interrupted');
 assert.equal((normalRow.taraInterview as {nativeDelivery?:{playbackVerified?:boolean}})?.nativeDelivery?.playbackVerified,true);
 latePrimaryTranscript=undefined;
 assert.equal(await db.voiceFragment.count({where:{voiceId:normalId,eventId:'normal-delayed-final-fragment'}}),1,
  'a terminal receipt on the fallback subscriber must not discard a delayed fragment from the primary subscriber');
 await normalVoice.onModuleDestroy();
 const normalWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(normalInvite.sessionId,1)}});
 await restartedWorker.process(normalWork.id);
 await deliver('PDF',normalInvite.sessionId);
 const normalReport=await invitations.report(hr,normalInvite.id);
 assert.equal(normalReport.invitation.session?.completion?.status,'COMPLETE');
 assert.equal(normalReport.pdfStatus,'READY');
 const englishReport=normalReport.evaluation?.result as {assessmentLanguage?:string;roleAssessment:RoleAssessment};
 assert.equal(englishReport.assessmentLanguage,'en');
 assert.ok(englishReport.roleAssessment.criteria.some(item=>item.name==='Bangun endpoint API'&&item.displayName==='Build an API endpoint'));
 assert.ok(englishReport.roleAssessment.criteria.every(item=>item.reason.startsWith('The recorded answer')));
 assert.ok(englishReport.roleAssessment.criteria.some(item=>item.evidence.some(evidence=>evidence.quote.includes('menulis endpoint'))));
 assert.equal((normalReport.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment.coverage.assessed,4);
 assert.ok(normalReport.voice?.transcript?.some(turn=>turn.text.includes(finalFragmentText.trim())));
 assert.ok(times.every(at=>at+8000 <= 9*60_000));
 assert.ok(normalRow.endedAt&&+normalRow.endedAt-normalStart<=900_000);
 assert.equal(liveEvaluationRequests.length,beforeNormal+1);
 console.log('Live normal completion replay passed: four first opportunities before minute 9, farewell after minute 12, one evaluation and matching PDF. Paid calls: 0.');
 function anotherScoredCandidate(){return db.recruitmentCandidate.create({data:{companyId:scoredNormal.companyId,jobId:scoredNormal.jobId,
  fullName:scoredNormal.fullName,email:scoredNormal.email,filename:scoredNormal.filename,fileKey:scoredNormal.fileKey,
  contentType:scoredNormal.contentType,sizeBytes:scoredNormal.sizeBytes,checksum:scoredNormal.checksum,
  scoreStatus:'READY',cvScore:80,cvResult:scoredNormal.cvResult as Prisma.InputJsonObject,
  jobSnapshot:scoredNormal.jobSnapshot as Prisma.InputJsonObject,stage:'IN_REVIEW'}});}
 const retryCandidate=await anotherScoredCandidate();
 const retryInvite=await newCompletionInvite('live-completion-retry-review',retryCandidate.id);
 const retryConnection=await voiceService.create(user,retryInvite.sessionId,clientId,'v=0 recover failed criterion',TARA_LIVE_AUDIO_PROTOCOL);
 for(const [index,[question,answer]] of dialogue.entries()){
  const at=1000+index*7000;
  onEvent({type:'session.output_transcript.delta',event_id:'retry-question-'+index,delta:question,start_ms:at,end_ms:at+1800});
  onEvent({type:'session.input_transcript.delta',event_id:'retry-answer-'+index,delta:answer,start_ms:at+2500,end_ms:at+5000});
 }
 nextVoiceUsage=735;
 await voiceService.end(user,retryInvite.sessionId,clientId,'CANDIDATE_ENDED',retryConnection.connectionId);
 const failedWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(retryInvite.sessionId,1)}});
 unavailableCompletionCriterion='NON_ENDPOINT';
 try{await restartedWorker.process(failedWork.id);}finally{unavailableCompletionCriterion=undefined;}
 const beforeRecovery=await invitations.report(hr,retryInvite.id);
 assert.equal(beforeRecovery.invitation.session?.completion?.status,'REVIEW_REQUIRED');
 assert.equal(beforeRecovery.evaluation?.finalScore,null);
 assert.equal(await db.aiScreeningWork.count({where:{id:failedWork.id,status:'FAILED'}}),1);
 const retryAt=liveEvaluationRequests.length;
 const recoveryRequests=await Promise.allSettled([invitations.retryEvaluation(hr,retryInvite.id),invitations.retryEvaluation(hr,retryInvite.id)]);
 assert.equal(recoveryRequests.filter(request=>request.status==='fulfilled').length,1);
 const replacementWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(retryInvite.sessionId,1,1)}});
 await markLiveEvaluationUnrecoverable(db,retryInvite.sessionId,failedWork.key,failedWork.id,'RETIRED_WORK_RESULT');
 assert.equal((await invitations.report(hr,retryInvite.id)).invitation.session?.completion?.status,'ASSESSING',
  'a stale worker must not overwrite the current recovery');
 await db.aiScreeningWork.update({where:{id:replacementWork.id},data:{status:'DONE'}});
 await db.aiScreeningSession.update({where:{id:retryInvite.sessionId},data:{updatedAt:new Date(Date.now()-45_000)}});
 (voiceService as any).nextEvaluationCheck=0;
 await voiceService.tick();
 assert.equal((await db.aiScreeningWork.findUniqueOrThrow({where:{id:replacementWork.id}})).status,'PENDING',
  'reconciliation must requeue the repair and leave the rejected original work closed');
 await restartedWorker.process(replacementWork.id);
 const recoveredInterview=await invitations.report(hr,retryInvite.id);
 assert.equal(recoveredInterview.evaluation?.finalScore,82.2,'recovery must replace the rejected result even with the same interview transcript');
 assert.equal(recoveredInterview.invitation.session?.completion?.status,'COMPLETE');
 assert.notEqual(replacementWork.id,failedWork.id,'an explicit recovery must not replay the rejected model response');
 assert.deepEqual(liveEvaluationRequests.slice(retryAt).map(request=>request.ids.length),[3],
  'an explicit recovery of rejected results keeps the previously verified criterion');
 assert.deepEqual(liveEvaluationRequests[retryAt].repair,['INVALID_ANSWER_REF']);
 assert.equal(await db.aiScreeningWork.count({where:{id:failedWork.id,status:'FAILED'}}),1);
 await deliver('PDF',retryInvite.sessionId);
 const restoredReport=await invitations.report(hr,retryInvite.id);
 const restoredScore=(await invitations.list(hr,retryCandidate.id)).find(row=>row.id===retryInvite.id)?.session?.evaluation?.finalScore;
 assert.equal(restoredReport.pdfStatus,'READY');
 assert.equal(restoredScore,82.2);
 const restoredResult=await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:retryInvite.sessionId}});
 assert.equal(await db.aiScreeningEvaluationRevision.count({where:{evaluationId:restoredResult.id}}),2);
 const restoredPdf=pdfjs.getDocument({data:new Uint8Array(objects.get(restoredResult.pdfKey!)!),verbosity:0});
 try{
  const contents=await(await(await restoredPdf.promise).getPage(1)).getTextContent();
  assert.match(contents.items.flatMap(item=>'str' in item?[item.str]:[]).join(' '),/Final score 82\.2\s*\/\s*100/);
 }finally{await restoredPdf.destroy();}
 console.log('Taka explicit Live recovery passed: only unresolved criteria, one new evaluation revision, one final score. Paid calls: 0.');
 const mixedInvite=await newCompletionInvite('live-completion-mixed-coverage',retryCandidate.id);
 const mixedConnection=await voiceService.create(user,mixedInvite.sessionId,clientId,'v=0 before mixed recovery',TARA_LIVE_AUDIO_PROTOCOL);
 for(const [index,[question,answer]] of dialogue.slice(0,2).entries()){
  const at=1000+index*7000;
  onEvent({type:'session.output_transcript.delta',event_id:'mixed-question-'+index,delta:question,start_ms:at,end_ms:at+1800});
  onEvent({type:'session.input_transcript.delta',event_id:'mixed-answer-'+index,delta:answer,start_ms:at+2500,end_ms:at+5000});
 }
 nextVoiceUsage=420;
 await voiceService.end(user,mixedInvite.sessionId,clientId,'CANDIDATE_ENDED',mixedConnection.connectionId);
 const mixedWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(mixedInvite.sessionId,1)}});
 unavailableCompletionCriterion='DOCUMENTATION';
 try{await restartedWorker.process(mixedWork.id);}finally{unavailableCompletionCriterion=undefined;}
 const mixedState=liveCompletion((await db.aiScreeningSession.findUniqueOrThrow({where:{id:mixedInvite.sessionId}})).voiceCompletion)!;
 assert.equal(mixedState.status,'RESUMABLE');
 assert.equal(mixedState.missingCriterionIds.length,2);
 assert.equal(mixedState.retained?.length,1);
 const mixedSaved=(await db.aiScreeningEvaluation.findUniqueOrThrow({where:{sessionId:mixedInvite.sessionId}})).result as {roleAssessment:RoleAssessment};
 assert.equal(mixedSaved.roleAssessment.criteria.find(row=>row.name.includes('panduan'))?.state,'ASSESSMENT_UNAVAILABLE');
 const beforeMixedEvaluation=liveEvaluationRequests.length;
 const mixedResume=await voiceService.create(user,mixedInvite.sessionId,clientId,'v=0 resume missing opportunities',TARA_LIVE_AUDIO_PROTOCOL);
 const mixedBrief=JSON.parse(lastVoiceRequest!.session.input[0].content[0].text.split('\n')[1]);
 assert.deepEqual(mixedBrief.topics.map((row:{criterionId:string})=>row.criterionId),mixedState.missingCriterionIds,
  'the candidate resumes only missing opportunities and does not repeat an answer that Taka failed to score');
 assert.ok(mixedBrief.previousConversation.some((turn:{text:string})=>turn.text===docAnswer));
 for(const [index,[question,answer]] of dialogue.slice(2).entries()){
  const at=1000+index*7000;
  onEvent({type:'session.output_transcript.delta',event_id:'mixed-resume-question-'+index,delta:question,start_ms:at,end_ms:at+1800});
  onEvent({type:'session.input_transcript.delta',event_id:'mixed-resume-answer-'+index,delta:answer,start_ms:at+2500,end_ms:at+5000});
 }
 assert.equal(liveEvaluationRequests.length,beforeMixedEvaluation,'Taka does not run while the replacement connection is open');
 nextVoiceUsage=160;
 await voiceService.end(user,mixedInvite.sessionId,clientId,'CANDIDATE_ENDED',mixedResume.connectionId);
 const mixedFinalWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(mixedInvite.sessionId,2)}});
 await restartedWorker.process(mixedFinalWork.id);
 await deliver('PDF',mixedInvite.sessionId);
 const mixedReport=await invitations.report(hr,mixedInvite.id);
 assert.equal(mixedReport.invitation.session?.completion?.status,'COMPLETE');
 assert.equal(mixedReport.evaluation?.finalScore,82.2);
 assert.equal(mixedReport.pdfStatus,'READY');
 assert.deepEqual(liveEvaluationRequests.slice(beforeMixedEvaluation).map(request=>request.ids.length),[3]);
 const mixedGrades=(mixedReport.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment.criteria;
 assert.ok(mixedGrades.find(row=>row.name.includes('panduan'))?.evidence.some(item=>item.quote.includes('menyusun panduan')));
 console.log('Mixed Live recovery passed: candidates answer missed topics; Taka recovers the earlier answer and publishes one final report. Paid calls: 0.');

 const expiryRetryCandidate=await anotherScoredCandidate();
 const expiryRetry=await newCompletionInvite('live-completion-review-after-expiry',expiryRetryCandidate.id);
 const expiryFirst=await voiceService.create(user,expiryRetry.sessionId,clientId,'v=0 first connection before expiry',TARA_LIVE_AUDIO_PROTOCOL);
 for(const [index,[question,answer]] of dialogue.slice(0,2).entries()){
  const at=1000+index*7000;
  onEvent({type:'session.output_transcript.delta',event_id:'expiry-question-'+index,delta:question,start_ms:at,end_ms:at+1800});
  onEvent({type:'session.input_transcript.delta',event_id:'expiry-answer-'+index,delta:answer,start_ms:at+2500,end_ms:at+5000});
 }
 nextVoiceUsage=420;
 await voiceService.end(user,expiryRetry.sessionId,clientId,'CANDIDATE_PAUSED',expiryFirst.connectionId);
 const pausedForExpiry=await voiceService.state(user,expiryRetry.sessionId);
 assert.equal(pausedForExpiry?.remainingVoiceMs,480000);
 assert.ok(pausedForExpiry?.resumeUntil);
 const expiryResume=await voiceService.create(user,expiryRetry.sessionId,clientId,'v=0 rejoin just before expiry',TARA_LIVE_AUDIO_PROTOCOL);
 nextVoiceUsage=75;
 await voiceService.end(user,expiryRetry.sessionId,clientId,'CANDIDATE_ENDED',expiryResume.connectionId);
 const awaitingExpiryAssessment=await db.aiScreeningSession.findUniqueOrThrow({where:{id:expiryRetry.sessionId}});
 const expiryCompletion=liveCompletion(awaitingExpiryAssessment.voiceCompletion)!;
 assert.equal(expiryCompletion.resumeExpiresAt,pausedForExpiry.resumeUntil);
 // Simulate Taka starting after the original seven-day access window elapsed.
 const originalExpiry=new Date(Date.now()-1000).toISOString();
 await db.aiScreeningSession.update({where:{id:expiryRetry.sessionId},data:{voiceCompletion:{...expiryCompletion,resumeExpiresAt:originalExpiry} as Prisma.InputJsonObject}});
 const connectionCountBeforeReview=creates;
 const expiryWork=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(expiryRetry.sessionId,2)}});
 unavailableCompletionCriterion='DOCUMENTATION';
 try{await restartedWorker.process(expiryWork.id);}finally{unavailableCompletionCriterion=undefined;}
 const needsReview=await invitations.report(hr,expiryRetry.id);
 assert.equal(needsReview.invitation.session?.completion?.status,'REVIEW_REQUIRED');
 assert.equal(needsReview.evaluation?.finalScore,null);
 await invitations.retryEvaluation(hr,expiryRetry.id);
 const expiryRepair=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(expiryRetry.sessionId,2,1)}});
 await restartedWorker.process(expiryRepair.id);
 const afterExpiryRepair=await voiceService.state(user,expiryRetry.sessionId);
 assert.equal(afterExpiryRepair?.completion?.status,'INTERRUPTED','retrying Taka cannot renew an expired Live access window');
 assert.equal(afterExpiryRepair?.completion?.canResume,false);
 assert.equal(afterExpiryRepair?.resumeUntil,originalExpiry);
 assert.equal(afterExpiryRepair?.remainingVoiceMs,405000);
 await assert.rejects(voiceService.create(user,expiryRetry.sessionId,clientId,'v=0 cannot renew expired access',TARA_LIVE_AUDIO_PROTOCOL),/Sesi ini sudah berakhir/);
 await deliver('PDF',expiryRetry.sessionId);
 const expiredAfterRepair=await invitations.report(hr,expiryRetry.id);
 assert.equal(expiredAfterRepair.evaluation?.finalScore,null);
 assert.equal((expiredAfterRepair.evaluation?.result as {roleAssessment:RoleAssessment}).roleAssessment.coverage.assessed,2);
 assert.equal(expiredAfterRepair.pdfStatus,'READY');
 assert.equal(creates,connectionCountBeforeReview,'repairing evidence requires no additional voice connection');
 console.log('Live continuation expiry survives Taka review and repair: two evidenced grades, no invented score or extra connection. Paid calls: 0.');

 const startupInvite=await newCompletionInvite('live-completion-startup-receipt',normalCandidate.id);
 const startupAfterClose=sidebandCloses;
 nextVoiceUsage=17;omitVoiceAnswer=true;
 try {
  await assert.rejects(voiceService.create(user,startupInvite.sessionId,clientId,
   'v=0 provider answer omitted',TARA_LIVE_AUDIO_PROTOCOL));
 } finally {omitVoiceAnswer=false;}
 const startupState=await voiceService.state(user,startupInvite.sessionId);
 assert.equal(sidebandCloses,startupAfterClose+1);
 assert.equal(startupState?.remainingVoiceMs,883000,'provider startup usage is saved even when no SDP answer arrives');
 assert.equal(startupState?.completion?.status,'RESUMABLE');
 assert.equal(await db.aiScreeningWork.count({where:{key:liveEvaluationKey(startupInvite.sessionId,1)}}),0);
 const startupResume=await voiceService.create(user,startupInvite.sessionId,clientId,
  'v=0 retry after confirmed close',TARA_LIVE_AUDIO_PROTOCOL);
 assert.equal(startupResume.connectionNumber,2);
 nextVoiceUsage=20;
 await voiceService.end(user,startupInvite.sessionId,clientId,'CANDIDATE_PAUSED',startupResume.connectionId);
 console.log('Live startup receipt passed: failed SDP retained confirmed usage and resumed under the same invitation. Paid calls: 0.');

 const rejectedStartup=await newCompletionInvite('live-resume-rejected-by-provider',(await anotherScoredCandidate()).id);
 const firstForRejection=await voiceService.create(user,rejectedStartup.sessionId,clientId,
  'v=0 initial connection',TARA_LIVE_AUDIO_PROTOCOL);
 nextVoiceUsage=420;
 await voiceService.end(user,rejectedStartup.sessionId,clientId,'CANDIDATE_PAUSED',firstForRejection.connectionId);
 const beforeRejection=await voiceService.state(user,rejectedStartup.sessionId);
 assert.equal(beforeRejection?.remainingVoiceMs,480_000);
 nextVoiceHttpResult=Response.json({error:{type:'server_error',message:'Synthetic startup unavailable'}},{status:503});
 await assert.rejects(voiceService.create(user,rejectedStartup.sessionId,clientId,
  'v=0 definitive startup rejection',TARA_LIVE_AUDIO_PROTOCOL));
 const afterRejection=await voiceService.state(user,rejectedStartup.sessionId);
 assert.equal(afterRejection?.completion?.status,'RESUMABLE','an API startup rejection must keep the invitation resumable');
 assert.equal(afterRejection?.remainingVoiceMs,480_000);
 assert.equal(afterRejection?.resumeUntil,beforeRejection?.resumeUntil);
 assert.equal(afterRejection?.completion?.evidenceRevision,beforeRejection?.completion?.evidenceRevision);
 assert.equal(afterRejection?.connectionId,firstForRejection.connectionId);
 assert.equal(await db.aiScreeningWork.count({where:{subjectId:rejectedStartup.sessionId,kind:'VOICE_EVALUATE'}}),0);
 const recoveredStartup=await voiceService.create(user,rejectedStartup.sessionId,clientId,
  'v=0 successful retry after rejection',TARA_LIVE_AUDIO_PROTOCOL);
 assert.equal(recoveredStartup.connectionNumber,2);
 assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:recoveredStartup.connectionId}})).reservedVoiceMs,480_000);
 nextVoiceUsage=20;
 await voiceService.end(user,rejectedStartup.sessionId,clientId,'CANDIDATE_PAUSED',recoveredStartup.connectionId);

 for(const [key,result] of [
  ['unconfirmed-gateway',new Response('Synthetic gateway timeout',{status:504})],
  ['unconfirmed-network',new DOMException('Synthetic timeout','TimeoutError')],
 ] as const){
  const unconfirmedStartup=await newCompletionInvite('live-startup-'+key,(await anotherScoredCandidate()).id);
  nextVoiceHttpResult=result;
  const beforeCreate=creates;
  await assert.rejects(voiceService.create(user,unconfirmedStartup.sessionId,clientId,
   'v=0 unconfirmed startup',TARA_LIVE_AUDIO_PROTOCOL));
  const held=await voiceService.state(user,unconfirmedStartup.sessionId);
  assert.equal(held?.status,'CREATE_UNCERTAIN');
  assert.equal(held?.completion?.canResume,false);
  await assert.rejects(voiceService.create(user,unconfirmedStartup.sessionId,clientId,
   'v=0 must not start another connection',TARA_LIVE_AUDIO_PROTOCOL));
  assert.equal(creates,beforeCreate+1,'an unconfirmed startup must not create a second provider session');
 }
 console.log('Live startup rejection passed: HTTP 503 preserves a paused invitation, unconfirmed startups prevent duplicate sessions. Paid calls: 0.');

 const journalDirectory=fs.mkdtempSync(join(tmpdir(),'talentio-receipt-it-'));
 config.set('TARA_TRANSCRIPT_JOURNAL_DIR',journalDirectory);
 const journal=new VoiceTranscriptJournal(journalDirectory);
 const receiptDb=Object.create(db) as PrismaService;
 const voiceRows=db.voiceInterview;
 let disconnectBeforeReceipt=false,disconnectBeforeClosing=false;
 let disconnectDuringRetry=false,disconnectTranscriptWrites=false,disconnectPlaybackWrites=false;
 const transaction=db.$transaction.bind(db);
 Object.defineProperty(receiptDb,'$transaction',{value:(...args:unknown[])=>{
  if(disconnectTranscriptWrites) throw Error('SYNTHETIC_DATABASE_OUTAGE_DURING_TRANSCRIPT_WRITE');
  return (transaction as (...args:unknown[])=>unknown)(...args);
 }});
 Object.defineProperty(receiptDb,'voiceInterview',{value:{
  findUnique:voiceRows.findUnique.bind(voiceRows),findFirst:voiceRows.findFirst.bind(voiceRows),count:voiceRows.count.bind(voiceRows),
  findMany:voiceRows.findMany.bind(voiceRows),create:voiceRows.create.bind(voiceRows),update:voiceRows.update.bind(voiceRows),
  updateMany:async (args:Prisma.VoiceInterviewUpdateManyArgs)=>{
   if(disconnectPlaybackWrites&&args.data.taraInterview)throw Error('SYNTHETIC_DATABASE_OUTAGE_DURING_PLAYBACK_CHECKPOINT');
   if(disconnectBeforeClosing&&args.data.status==='CLOSING'){
    disconnectBeforeClosing=false;
    throw Error('SYNTHETIC_DATABASE_OUTAGE_BEFORE_CLOSING_STATE');
   }
   if(disconnectDuringRetry&&args.data.error==='Penutupan koneksi sedang dicoba ulang.')
    throw Error('SYNTHETIC_DATABASE_OUTAGE_DURING_CLOSE_RETRY');
   if(disconnectBeforeReceipt&&args.data.billedVoiceMs===420000){
    disconnectBeforeReceipt=false;
    throw Error('SYNTHETIC_DATABASE_OUTAGE_BEFORE_PROVIDER_RECEIPT');
   }
   return voiceRows.updateMany(args);
  },
 }});
 // The previous invitation is still resumable. Exercise the outage on its next connection.
 const receiptOwner=new VoiceService(receiptDb,config,sessions,liveProvider as never,voiceEvaluator as never);
 let journalConnection:string|undefined;
 let earlyJournalConnection:string|undefined;
 let queuedAtCloseConnection:string|undefined;
 let startupJournalConnection:string|undefined;
 let startupPendingConnection:string|undefined;
 let restartJournalConnection:string|undefined;
 let delayedHeartbeatConnection:string|undefined;
 try{
  const joinAfterPause=await receiptOwner.create(user,startupInvite.sessionId,clientId,'v=0 then restart before receipt',TARA_LIVE_AUDIO_PROTOCOL);
  journalConnection=joinAfterPause.connectionId!;
  nextVoiceUsage=420;
  disconnectBeforeReceipt=true;
  await receiptOwner.end(user,startupInvite.sessionId,clientId,'CANDIDATE_PAUSED',journalConnection);
  assert.equal(disconnectBeforeReceipt,false);
  const awaitingReceipt=await voiceRows.findUniqueOrThrow({where:{id:journalConnection}});
  assert.equal(awaitingReceipt.status,'CLOSING');
  assert.equal(awaitingReceipt.billedVoiceMs,null);
  assert.equal((await journal.readClosure(journalConnection))?.billedVoiceMs,420000);
  const previousProviderClose=sidebandCloses;
  const recovery=new VoiceService(db,config,sessions,liveProvider as never,voiceEvaluator as never);
  try{await recovery.tick();}finally{await recovery.onModuleDestroy();}
  assert.equal(sidebandCloses,previousProviderClose,'restart consumes a journaled final receipt without asking the provider again');
  const recoveredState=await recovery.state(user,startupInvite.sessionId);
  assert.equal(recoveredState?.completion?.status,'RESUMABLE');
  assert.equal(recoveredState?.remainingVoiceMs,443000);
  assert.equal(await journal.readClosure(journalConnection),undefined);
  console.log('Live usage journal passed: terminal receipt survives a database failure before it is saved. Paid calls: 0.');
  const candidateFinish=await recovery.create(user,startupInvite.sessionId,clientId,'v=0 candidate ends incomplete',TARA_LIVE_AUDIO_PROTOCOL);
  const finishRuntime=(recovery as any).active.get(candidateFinish.connectionId!);
  finishRuntime.inputQuiet=true;
  onEvent({type:'session.output_transcript.delta',event_id:'manual-close-question',
   delta:'Apa langkah lo ketika membangun endpoint API?',start_ms:1100,end_ms:2400});
  onEvent({type:'session.input_transcript.delta',event_id:'manual-close-answer',
   delta:apiAnswer,start_ms:2800,end_ms:4400});
  nextVoiceUsage=30;
  await recovery.end(user,startupInvite.sessionId,clientId,'CANDIDATE_ENDED',candidateFinish.connectionId);
  const ended=await db.aiScreeningSession.findUniqueOrThrow({where:{id:startupInvite.sessionId}});
  const endedCompletion=liveCompletion(ended.voiceCompletion)!;
  const work=await db.aiScreeningWork.findUniqueOrThrow({where:{key:liveEvaluationKey(ended.id,endedCompletion.evidenceRevision)}});
  await restartedWorker.process(work.id);
  const remaining=await recovery.state(user,ended.id);
  assert.equal(remaining?.completion?.status,'RESUMABLE','an incomplete interview with time left can continue even after closing from the UI');
  assert.equal(remaining?.remainingVoiceMs,413000);
  assert.equal(remaining?.resumeUntil,recoveredState?.resumeUntil,'closing again keeps the original continuation window');
  assert.equal((await invitations.report(hr,startupInvite.id)).evaluation,null);
  console.log('Live candidate end passed: an unfinished interview can use remaining time on the original invitation. Paid calls: 0.');
  const earlyClose=await receiptOwner.create(user,startupInvite.sessionId,clientId,'v=0 then database outage at closure',TARA_LIVE_AUDIO_PROTOCOL);
  earlyJournalConnection=earlyClose.connectionId!;
  const earlyRuntime=(receiptOwner as any).active.get(earlyJournalConnection);
  disconnectPlaybackWrites=true;
  try{
   onEvent({type:'session.output_audio.delta',start_ms:1000,end_ms:1020,delta:voiceDelta});
   await receiptOwner.media(user,startupInvite.sessionId,clientId,'AUDIBLE',1,0,earlyJournalConnection);
   await new Promise(resolve=>setTimeout(resolve,850));
   await receiptOwner.media(user,startupInvite.sessionId,clientId,'QUIET',2,0,earlyJournalConnection);
   await earlyRuntime.pending;
  }finally{disconnectPlaybackWrites=false;}
  const heardBeforeRestart:NativeDelivery=JSON.parse(JSON.stringify(earlyRuntime.delivery));
  assert.equal(heardBeforeRestart.playbackVerified,true);
  assert.equal(heardBeforeRestart.windows.length,1);
  const withoutCheckpoint=await voiceRows.findUniqueOrThrow({where:{id:earlyJournalConnection}});
  assert.equal((withoutCheckpoint.taraInterview as {nativeDelivery?:NativeDelivery})?.nativeDelivery,undefined,
   'PostgreSQL must not already contain the verified playback window');
  let releaseStalledWrite!:()=>void;
  earlyRuntime.pending=new Promise<void>(resolve=>{releaseStalledWrite=resolve;});
  const lastEarlyAnswer='Saya memasang pengujian batas jumlah inventaris sebelum merilis endpoint.';
  const secondJournaledAnswer='Saya membandingkan respons gagal dengan catatan perubahan inventaris.';
  onEvent({type:'session.output_transcript.delta',event_id:'outage-final-question',
   delta:'Gimana lo menguji batas jumlah inventaris?',start_ms:1000,end_ms:1800});
  onEvent({type:'session.input_transcript.delta',event_id:'outage-final-answer',
   delta:lastEarlyAnswer,start_ms:2200,end_ms:4000});
  try{
   await new Promise(resolve=>setTimeout(resolve,650));
   assert.ok((await journal.batches(earlyJournalConnection)).rows.flat().some(turn=>turn.text===lastEarlyAnswer),
    'a stalled PostgreSQL write cannot stop the durable transcript capture');
   onEvent({type:'session.input_transcript.delta',event_id:'outage-late-answer',
    delta:secondJournaledAnswer,start_ms:6300,end_ms:8500});
   await new Promise(resolve=>setTimeout(resolve,650));
   assert.ok((await journal.batches(earlyJournalConnection)).rows.flat().some(turn=>turn.text===secondJournaledAnswer),
    'subsequent fragments must still reach the journal while the previous write is stalled');
  }finally{releaseStalledWrite();}
  nextVoiceUsage=55;
 const beforeFallback=sidebandCloses;
 confirmCloseDuringFallback=true;
 disconnectBeforeClosing=true;disconnectTranscriptWrites=true;
 try{await receiptOwner.end(user,startupInvite.sessionId,clientId,'CANDIDATE_PAUSED',earlyJournalConnection);}
 finally{disconnectTranscriptWrites=false;}
  assert.equal(sidebandCloses,beforeFallback+1,'the separate close attempt times out after the original channel delivers confirmation');
  assert.equal(disconnectBeforeClosing,false);
  assert.equal((await voiceRows.findUniqueOrThrow({where:{id:earlyJournalConnection}})).status,'ACTIVE');
  const earlyReceipt=await journal.readClosure(earlyJournalConnection);
  assert.equal(earlyReceipt?.billedVoiceMs,55000,'the late receipt on the original channel must survive a timeout on the fallback channel and a failed CLOSING write');
  assert.equal(earlyReceipt?.closeReason,'CANDIDATE_PAUSED');
  assert.deepEqual(earlyReceipt?.playback?.nativeDelivery,heardBeforeRestart);
 assert.ok((await journal.batches(earlyJournalConnection)).rows.flat().some(turn=>turn.text===lastEarlyAnswer));
  const closesBeforeRecovery=sidebandCloses;
  const attachesBeforeRecovery=attachments.length;
  // A crash can leave only the journaled receipt while the browser still reports connected.
  await voiceRows.update({where:{id:earlyJournalConnection},data:{error:null}});
  await recovery.heartbeat(user,startupInvite.sessionId,clientId,true,earlyJournalConnection);
  const finalizeAfterRestart=(recovery as any).finalize.bind(recovery);
  let rejectedFinalize=false;
  (recovery as any).finalize=async(id:string,change?:Prisma.VoiceInterviewUpdateManyMutationInput)=>{
   if(id===earlyJournalConnection&&change?.status==='ENDED'){
    rejectedFinalize=true;
    throw Error('SYNTHETIC_DATABASE_OUTAGE_BEFORE_TERMINAL_COMMIT');
   }
   return finalizeAfterRestart(id,change);
  };
  try{await recovery.tick();}finally{(recovery as any).finalize=finalizeAfterRestart;}
  assert.equal(rejectedFinalize,true);
  const pendingTerminal=await voiceRows.findUniqueOrThrow({where:{id:earlyJournalConnection}});
  assert.equal(pendingTerminal.status,'CLOSING');
  assert.equal(pendingTerminal.billedVoiceMs,55000);
  assert.deepEqual((await journal.readClosure(earlyJournalConnection))?.playback?.nativeDelivery,heardBeforeRestart,
   'persisted usage alone must not consume the playback checkpoint');
  await recovery.tick();
  assert.equal(sidebandCloses,closesBeforeRecovery);
  assert.equal(attachments.length,attachesBeforeRecovery,'a terminal receipt takes precedence over a connected heartbeat');
  const earlyRecovered=await recovery.state(user,startupInvite.sessionId);
  assert.equal(earlyRecovered?.completion?.status,'RESUMABLE');
  assert.equal(earlyRecovered?.completion?.reason,'CANDIDATE_PAUSED');
  assert.equal(earlyRecovered?.remainingVoiceMs,358000);
  assert.ok(earlyRecovered?.transcript?.some(turn=>turn.text===lastEarlyAnswer),
   'replacement process recovers the final answer even when database I/O fails before CLOSING');
  assert.equal(earlyRecovered?.transcript?.filter(turn=>turn.text===secondJournaledAnswer).length,1);
  const playbackAfterRestart=await voiceRows.findUniqueOrThrow({where:{id:earlyJournalConnection}});
  assert.deepEqual((playbackAfterRestart.taraInterview as {nativeDelivery?:NativeDelivery})?.nativeDelivery,heardBeforeRestart,
   'replacement process also restores the verified playback window');
  assert.equal(await journal.readClosure(earlyJournalConnection),undefined);
 console.log('Live early closure passed: usage, final answer and verified playback survive database failure, restart and terminal retry. Paid calls: 0.');

 const queuedAtClose=await receiptOwner.create(user,startupInvite.sessionId,clientId,'v=0 final text still queued when process stops',TARA_LIVE_AUDIO_PROTOCOL);
 const queuedConnection=queuedAtCloseConnection=queuedAtClose.connectionId!;
 const queuedRuntime=(receiptOwner as any).active.get(queuedConnection);
 const stoppedRecorder=(receiptOwner as any);
 const recorderJournal=stoppedRecorder.journal as VoiceTranscriptJournal;
 const appendNormally=recorderJournal.append.bind(recorderJournal);
 const drainNormally=stoppedRecorder.drainTranscript.bind(receiptOwner);
 const uncommittedTexts=['Saya membandingkan kedua versi data.', 'Saya menghubungi tim untuk konfirmasi hasil.'];
 try{
  // The first batch has left the in-memory queue but has not reached disk. The second is still in the queue.
  recorderJournal.append=async(id,fragments)=>id===queuedConnection ? new Promise<void>(()=>{}) : appendNormally(id,fragments);
  stoppedRecorder.drainTranscript=async(id:string,runtime:unknown)=>{
   if(id===queuedConnection)throw Error('SYNTHETIC_STOP_AFTER_TERMINAL_RECEIPT');
   return drainNormally(id,runtime);
  };
  onEvent({type:'session.input_transcript.delta',event_id:'final-batch-in-flight',delta:uncommittedTexts[0],start_ms:7000,end_ms:8100});
  queuedRuntime.flushing=stoppedRecorder.flush(queuedConnection,queuedRuntime);
  onEvent({type:'session.input_transcript.delta',event_id:'final-batch-in-queue',delta:uncommittedTexts[1],start_ms:10_500,end_ms:12_000});
  nextVoiceUsage=24;
  await assert.rejects(receiptOwner.end(user,startupInvite.sessionId,clientId,'CANDIDATE_PAUSED',queuedConnection),/SYNTHETIC_STOP_AFTER_TERMINAL_RECEIPT/);
 }finally{
  recorderJournal.append=appendNormally;
  stoppedRecorder.drainTranscript=drainNormally;
  stoppedRecorder.detachRecorder(queuedConnection,queuedRuntime);
 }
 assert.equal((await journal.readClosure(queuedConnection))?.billedVoiceMs,24000);
 assert.equal((await journal.batches(queuedConnection)).rows.length,0,'the ordinary transcript journal did not flush before restart');
 assert.equal(await db.voiceFragment.count({where:{voiceId:queuedConnection}}),0);
 await voiceRows.update({where:{id:queuedConnection},data:{leaseUntil:new Date(0)}});
 const beforeRestoringTail=sidebandCloses;
 await recovery.tick();
 const restoredTail=await recovery.state(user,startupInvite.sessionId);
 assert.equal(restoredTail?.completion?.status,'RESUMABLE');
 assert.equal(restoredTail?.remainingVoiceMs,334000);
 assert.equal(sidebandCloses,beforeRestoringTail,'a durable close replays the transcript without sending another provider command');
 assert.deepEqual((await db.voiceFragment.findMany({where:{voiceId:queuedConnection},orderBy:{startMs:'asc'}})).map(fragment=>fragment.text),uncommittedTexts,
  'the record that settles the voice reservation must also recover both uncommitted transcript fragments');
 assert.equal(await journal.readClosure(queuedConnection),undefined);
 console.log('Live closure before transcript flush passed: one restored receipt, two retained candidate fragments, same invitation. Paid calls: 0.');

  const outageCandidate=await db.recruitmentCandidate.create({data:{companyId:scoredNormal.companyId,jobId:scoredNormal.jobId,
   fullName:scoredNormal.fullName,email:scoredNormal.email,filename:scoredNormal.filename,fileKey:scoredNormal.fileKey,
   contentType:scoredNormal.contentType,sizeBytes:scoredNormal.sizeBytes,checksum:scoredNormal.checksum,
   scoreStatus:'READY',cvScore:80,cvResult:scoredNormal.cvResult as Prisma.InputJsonObject,
   jobSnapshot:scoredNormal.jobSnapshot as Prisma.InputJsonObject,stage:'IN_REVIEW'}});
  const startupOutage=await newCompletionInvite('live-completion-startup-receipt-outage',outageCandidate.id);
  const closesBeforeStartup=sidebandCloses;
  const savedStartupQuestion='Halo, gua Tara. Bisa kita mulai?';
  startupTranscript=savedStartupQuestion;
  nextVoiceUsage=18;omitVoiceAnswer=true;disconnectBeforeClosing=true;disconnectDuringRetry=true;
  try{
   await assert.rejects(receiptOwner.create(user,startupOutage.sessionId,clientId,
    'v=0 incomplete response and database outage',TARA_LIVE_AUDIO_PROTOCOL));
  }finally{omitVoiceAnswer=false;disconnectDuringRetry=false;startupTranscript=undefined;}
  const startupOutageRow=await voiceRows.findUniqueOrThrow({where:{sessionId:startupOutage.sessionId}});
  startupJournalConnection=startupOutageRow.id;
  assert.equal(startupOutageRow.status,'CREATING');
  assert.equal(startupOutageRow.providerId,null);
  assert.equal(disconnectBeforeClosing,false);
  assert.equal(sidebandCloses,closesBeforeStartup+1);
  assert.equal((await journal.readClosure(startupJournalConnection))?.billedVoiceMs,18000,'preserve a startup receipt before the provider ID can be persisted');
  assert.ok((await journal.batches(startupJournalConnection)).rows.flat().some(turn=>turn.text===savedStartupQuestion),
   'preserve provider transcript fragments captured while closing a failed startup');
  await recovery.tick(new Date(+startupOutageRow.leaseUntil+1));
  assert.equal(sidebandCloses,closesBeforeStartup+1);
  const startupRestored=await recovery.state(user,startupOutage.sessionId);
  assert.ok(startupRestored?.transcript?.some(turn=>turn.text===savedStartupQuestion));
  assert.equal(startupRestored?.completion?.status,'RESUMABLE');
  assert.equal(startupRestored?.remainingVoiceMs,882000);
  assert.equal(await journal.readClosure(startupJournalConnection),undefined);
  console.log('Live startup outage passed: persisted transcript and usage recover without the provider ID in PostgreSQL. Paid calls: 0.');

  const startupPending=await newCompletionInvite('live-completion-startup-no-close-receipt',(await anotherScoredCandidate()).id);
  const expectedCreates=creates+1,providerReference='live_mock_'+expectedCreates;
  startupTranscript='Halo, gua Tara. Ini sambungan awal.';
  omitVoiceAnswer=true;startupCloseWithoutReceipt=true;disconnectBeforeClosing=true;disconnectDuringRetry=true;
  try{
   await assert.rejects(receiptOwner.create(user,startupPending.sessionId,clientId,
    'v=0 no SDP and no startup close receipt',TARA_LIVE_AUDIO_PROTOCOL));
  }finally{omitVoiceAnswer=false;startupCloseWithoutReceipt=false;disconnectDuringRetry=false;}
  const startupPendingRow=await voiceRows.findUniqueOrThrow({where:{sessionId:startupPending.sessionId}});
  startupPendingConnection=startupPendingRow.id;
  assert.equal(startupPendingRow.status,'CREATING');
  assert.equal(startupPendingRow.providerId,null,'database I/O failed before the handle was stored');
  assert.equal(await journal.readProviderId(startupPendingConnection),providerReference);
  assert.equal(await journal.readClosure(startupPendingConnection),undefined);
  assert.equal(closeProviderIds.filter(id=>id===providerReference).length,1);
  nextVoiceUsage=21;
  try{await recovery.tick(new Date(+startupPendingRow.leaseUntil+1));}finally{startupTranscript=undefined;}
  assert.equal(closeProviderIds.filter(id=>id===providerReference).length,2,
   'a replacement process closes the accepted startup on the same provider handle when the first close was unconfirmed');
  assert.equal(creates,expectedCreates,'recovery must never create a second provider session');
  const reconciledStartup=await recovery.state(user,startupPending.sessionId);
  assert.equal(reconciledStartup?.completion?.status,'RESUMABLE');
  assert.equal(reconciledStartup?.completion?.canResume,true);
  assert.equal(reconciledStartup?.remainingVoiceMs,879000);
  assert.equal(reconciledStartup?.closeReason,'SERVER_RESTART');
  assert.equal(await db.voiceFragment.count({where:{voiceId:startupPendingConnection,eventId:'startup-close-transcript'}}),1);
  assert.equal(await db.aiScreeningWork.count({where:{subjectId:startupPending.sessionId,kind:'VOICE_EVALUATE'}}),0);
  assert.equal(await journal.readProviderId(startupPendingConnection),undefined,'clean up only after the reconciled close is committed');
  console.log('Live startup handle recovery passed: restart closes the original provider session and restores the invitation from confirmed usage. Paid calls: 0.');

 const restartInvite=await newCompletionInvite('live-media-survives-recorder-restart',(await anotherScoredCandidate()).id);
 const recorder=new VoiceService(db,config,sessions,liveProvider as never,voiceEvaluator as never);
 try{
  const joined=await recorder.create(user,restartInvite.sessionId,clientId,'v=0 existing media before recorder restart',TARA_LIVE_AUDIO_PROTOCOL);
  const connectionId=restartJournalConnection=joined.connectionId!;
  const beforeRestart={type:'session.input_transcript.delta',event_id:'before-recorder-restart',
   delta:'Gue menulis endpoint inventaris.',start_ms:3000,end_ms:4500};
  const heldInJournal={eventId:'journaled-during-restart',speaker:'CANDIDATE',text:'Gue tes permintaan yang duplikat.',startMs:4600,endMs:5900};
  onEvent(beforeRestart);
  const oldRuntime=(recorder as any).active.get(connectionId);
  await (recorder as any).drainTranscript(connectionId,oldRuntime);
  await oldRuntime.pending;
  await journal.append(connectionId,[heldInJournal]);
  const expiredLease=new Date(Date.now()-1);
  const oldConnection=await voiceRows.update({where:{id:connectionId},data:{leaseUntil:expiredLease}});
  const beforeTakeover={creates,sidebandCloses,commands:commands.length,attachments:attachments.length};
  await assert.rejects(recovery.heartbeat(user,restartInvite.sessionId,'stale-recorder-tab',true,connectionId));
  await recovery.heartbeat(user,restartInvite.sessionId,clientId,true,connectionId);
  await recovery.tick();
  const continued=await recovery.state(user,restartInvite.sessionId);
  assert.equal(continued?.status,'ACTIVE','a replacement API process must keep a confirmed healthy WebRTC connection active');
  assert.equal(continued?.connectionId,connectionId);
  assert.equal(+continued!.deadlineAt!,+joined.deadlineAt!,'the original hard deadline survives recorder takeover');
  assert.deepEqual(attachments.slice(beforeTakeover.attachments),[oldConnection.providerId],'reattach the recorder to the original session only');
  await recorder.tick();
  assert.equal((recorder as any).active.has(connectionId),false,'the former owner drops its recorder after takeover');
  assert.equal(creates,beforeTakeover.creates);
  assert.equal(sidebandCloses,beforeTakeover.sidebandCloses);
  assert.deepEqual(commands.slice(beforeTakeover.commands),[],'recorder recovery sends no speech or closure commands');
  assert.ok(continued?.transcript?.some(turn=>turn.text.includes(beforeRestart.delta)));
  assert.ok(continued?.transcript?.some(turn=>turn.text.includes(heldInJournal.text)));
  onEvent(beforeRestart);
  const afterRestart='Terus gue uji ulang respons endpoint.';
  onEvent({type:'session.input_transcript.delta',event_id:'after-recorder-restart',delta:afterRestart,start_ms:6500,end_ms:8000});
  nextVoiceUsage=65;
  await recovery.end(user,restartInvite.sessionId,clientId,'CANDIDATE_PAUSED',connectionId);
  const closed=await recovery.state(user,restartInvite.sessionId);
  assert.equal(closed?.completion?.status,'RESUMABLE');
  assert.equal(closed?.remainingVoiceMs,835000);
  assert.ok(closed?.transcript?.some(turn=>turn.text.includes(afterRestart)));
  assert.equal(await db.voiceFragment.count({where:{voiceId:connectionId,eventId:beforeRestart.event_id}}),1);
  assert.equal(await db.aiScreeningWork.count({where:{subjectId:restartInvite.sessionId,kind:'VOICE_EVALUATE'}}),0);
  console.log('Live recorder takeover passed: original WebRTC connection and deadline survive a recorder restart; replayed evidence is deduplicated. Paid calls: 0.');

  const delayed=await recorder.create(user,restartInvite.sessionId,clientId,'v=0 existing media with delayed heartbeat',TARA_LIVE_AUDIO_PROTOCOL);
  delayedHeartbeatConnection=delayed.connectionId!;
  await recorder.heartbeat(user,restartInvite.sessionId,clientId,true,delayedHeartbeatConnection);
  const delayedPulse=new Date(Date.now()-20_000);
  const interruptedRecorder=await voiceRows.update({where:{id:delayedHeartbeatConnection},data:{leaseUntil:expiredLease,
   createdAt:new Date(+delayedPulse-30_000),heartbeatAt:delayedPulse,mediaConnectedAt:delayedPulse}});
  const beforeDelayedTakeover={creates,sidebandCloses,commands:commands.length,attachments:attachments.length};
  await recovery.tick();
  assert.equal((await recovery.state(user,restartInvite.sessionId))?.status,'ACTIVE',
   'after an API outage, the new recorder should give the browser time to confirm the same media connection');
  assert.deepEqual(attachments.slice(beforeDelayedTakeover.attachments),[interruptedRecorder.providerId]);
  assert.deepEqual(commands.slice(beforeDelayedTakeover.commands),[]);
  assert.equal(creates,beforeDelayedTakeover.creates);
  assert.equal(sidebandCloses,beforeDelayedTakeover.sidebandCloses);
  await recorder.heartbeat(user,restartInvite.sessionId,clientId,true,delayedHeartbeatConnection);
  await recorder.tick();
  await recovery.tick(new Date(Date.now()+13_000));
  assert.equal((await recovery.state(user,restartInvite.sessionId))?.status,'ACTIVE',
   'the recorder recognizes a connected heartbeat received by another API process');
  nextVoiceUsage=835;
  await recovery.tick(delayed.deadlineAt!);
  const exhausted=await recovery.state(user,restartInvite.sessionId);
  assert.equal(exhausted?.status,'ENDED');
  assert.equal(exhausted?.closeReason,'TIME_LIMIT','a restored recorder must stop at the original hard deadline');
  assert.equal(exhausted?.remainingVoiceMs,0);
  const closedRecorder=await voiceRows.findUniqueOrThrow({where:{id:delayedHeartbeatConnection}});
  const gaps=(closedRecorder.taraInterview as {captureGaps?: Array<{reason:string}>})?.captureGaps;
  assert.ok(gaps?.some(gap=>gap.reason==='SIDEBAND_REPLAY_WINDOW'),'record the coverage gap after the provider replay window passed');
  await (recorder as any).finalize(delayedHeartbeatConnection,{status:'ENDED',taraInterview:{captureGaps:[]}});
  assert.deepEqual((await voiceRows.findUniqueOrThrow({where:{id:delayedHeartbeatConnection}})).taraInterview,closedRecorder.taraInterview,
   'a late finalizer cannot overwrite the committed playback and capture evidence');
  console.log('Live delayed heartbeat passed: takeover allows media confirmation after API downtime and stops at the original hard deadline. Paid calls: 0.');
 }finally{await recorder.onModuleDestroy();await recovery.onModuleDestroy();}
 }finally{
  await receiptOwner.onModuleDestroy();
  for(const connectionId of [journalConnection,earlyJournalConnection,queuedAtCloseConnection,startupJournalConnection,startupPendingConnection,
   restartJournalConnection,delayedHeartbeatConnection])if(connectionId){
   await journal.remove(connectionId);
   await journal.remove(connectionId,'.closed');
   await journal.remove(connectionId,'.provider');
  }
  fs.rmdirSync(journalDirectory);
  config.set('TARA_TRANSCRIPT_JOURNAL_DIR',undefined);
 }
 config.set('TARA_LIVE_COMPLETION_ENABLED','false');
  console.log('Live completion integration passed: no phase commands, one invitation and cumulative provider usage across connections, authorization, matching report/PDF and continuation expiry. Paid calls: 0.');
 process.env.TAKA_ALIGNED_ROLE_RUBRIC_ENABLED='false';
 process.env.TAKA_ROLE_ASSESSMENT_ENABLED='false';
 console.log('Role scoring integration passed: frozen rubrics, Chat and native Live, whole transcript, consistent final score in list/detail/PDF, preserved history and access checks. Paid calls: 0.');

 const applicationJob=await db.jobPost.create({data:{companyId:company.id,title:'Application Backend Developer',
  description:'Membangun API dan dokumentasi layanan.',status:'PUBLISHED'},include:scoreJobInclude});
 const applicant:AuthUser={id:'invite-applicant',email:'invite-applicant@example.test',fullName:'Kandidat Lamaran',role:'EMPLOYEE',isBanned:false};
 await db.user.create({data:{id:applicant.id,email:applicant.email,fullName:applicant.fullName,role:'EMPLOYEE',emailVerified:true}});
 const applicantProfile=await db.employeeProfile.create({data:{userId:applicant.id}});
 const submittedKey='cvs/application-submitted.pdf', updatedKey='cvs/application-new.pdf';
 const submittedBytes=Buffer.from('%PDF-1.4 submitted CV'), updatedBytes=Buffer.from('%PDF-1.4 replacement CV');
 objects.set(submittedKey,submittedBytes);objects.set(updatedKey,updatedBytes);
 const applicantCv=await db.resume.create({data:{profileId:applicantProfile.id,fileKey:submittedKey,title:'Submitted CV'}});
 const submittedVersion=await db.resumeVersion.create({data:{resumeId:applicantCv.id,fileKey:submittedKey,checksum:fileChecksum(submittedBytes)}});
 await db.resume.update({where:{id:applicantCv.id},data:{currentVersionId:submittedVersion.id}});
 const otherReading='Node.js tercatat di daftar keahlian tanpa konteks proyek. Hasil prediksi disusun untuk tim operasi.';
 await db.aiCvSource.create({data:{versionId:submittedVersion.id,checksum:submittedVersion.checksum!,status:'READY',text:otherReading}});
 const application=await db.application.create({data:{jobPostId:applicationJob.id,profileId:applicantProfile.id,status:'IN_REVIEW',
  resumeId:applicantCv.id,resumeVersionId:submittedVersion.id,resumeSnapshot:{resume:{fileKey:submittedKey,title:'Submitted CV'}}}});
 const captured=await candidates.captureApplication(application.id);
 assert.ok(captured);
 const assessedText='Node.js dipakai untuk menulis endpoint inventaris dan menyusun dokumentasi permintaan.';
 await db.recruitmentCandidate.update({where:{id:captured.id},data:{scoreStatus:'READY',cvScore:85,cvResult:{cvText:assessedText}}});
 const submittedInvite=await invitations.create(hr,captured.id,{mode:'TEXT',requestKey:'invite-pinned-application-text'});
 const submittedRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:submittedInvite.id}});
 const submittedToken=invitationToken(submittedRow.id,submittedRow.tokenNonce,config.get('JWT_SECRET')!);
 const submittedClaim=await invitations.claim(applicant,submittedToken);
 const submittedPlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:submittedClaim.session.id}});
 await deliver('CANDIDATE',submittedPlan.id);
 assert.deepEqual(candidateCvSegments,[assessedText],'preparation must use the CV reading frozen with the Taka score');
 const submittedPacket=await db.aiScreeningPackage.findUniqueOrThrow({where:{id:submittedPlan.packageId}});
 const priorFingerprint=hash([submittedVersion.id,submittedKey,submittedPacket.fingerprint,submittedPacket.promptVersion]);
 await db.aiCandidatePlan.update({where:{id:submittedPlan.id},data:{fingerprint:priorFingerprint}});
 const reloaded=await sessions.state(applicant,submittedClaim.session.id);
 assert.equal(reloaded.preparation.status,'PROCESSING','reload must refresh a draft prepared under the previous CV source');
 assert.notEqual(reloaded.preparation.planId,submittedPlan.id);
 await deliver('CANDIDATE',reloaded.preparation.planId!);
 const readyAfterReload=await sessions.state(applicant,submittedClaim.session.id);
 assert.equal(readyAfterReload.preparation.status,'READY');
 assert.equal(readyAfterReload.preparation.planId,reloaded.preparation.planId,'refresh reuses the repaired plan');
 await deliver('INVITE_DELIVERY',submittedInvite.id);
 assert.match(emails.at(-1)!.html,/maksimal 10 pertanyaan.*waktu 1 menit per pertanyaan/);
 assert.equal((await db.aiCvSource.findUniqueOrThrow({where:{versionId:submittedVersion.id}})).text,otherReading);
 const updatedVersion=await db.resumeVersion.create({data:{resumeId:applicantCv.id,fileKey:updatedKey,checksum:fileChecksum(updatedBytes)}});
 await db.resume.update({where:{id:applicantCv.id},data:{fileKey:updatedKey,title:'New CV',currentVersionId:updatedVersion.id}});
 await sessions.claim(applicant,submittedClaim.session.id,clientId);
 assert.equal((await sessions.start(applicant,submittedClaim.session.id,clientId)).status,'ACTIVE');
 const pinnedTextSession=await db.aiScreeningSession.findUniqueOrThrow({where:{id:submittedClaim.session.id}});
 assert.equal(pinnedTextSession.resumeVersionId,submittedVersion.id);
 assert.equal((pinnedTextSession.cvSnapshot as {resume:{fileKey:string}}).resume.fileKey,submittedKey);
 assert.equal((pinnedTextSession.cvSnapshot as {resume:{title:string}}).resume.title,'Submitted CV');
 const applicantVoice=await invitations.create(hr,captured.id,{mode:'VOICE',requestKey:'invite-pinned-application-voice'});
 const applicantVoiceRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:applicantVoice.id}});
 const applicantVoiceToken=invitationToken(applicantVoiceRow.id,applicantVoiceRow.tokenNonce,config.get('JWT_SECRET')!);
 const applicantVoiceClaim=await invitations.claim(applicant,applicantVoiceToken);
 const applicantVoicePlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:applicantVoiceClaim.session.id}});
 assert.equal(applicantVoicePlan.resumeVersionId,submittedVersion.id,'updated library CV never replaces the submitted version');
 await deliver('CANDIDATE',applicantVoicePlan.id);
 assert.deepEqual(candidateCvSegments,[assessedText]);
 assert.equal((await sessions.state(applicant,applicantVoiceClaim.session.id)).preparation.status,'READY');
 assert.equal(await db.aiScreeningWork.count({where:{kind:'CV_SOURCE',subjectId:submittedVersion.id}}),0,
  'invitation preparation never enqueues a second extraction of a scored CV');
 console.log('Invitation CV integration passed: assessment reading pinned across Chat and Live, new library CV excluded, Chat email timing accurate. Paid calls: 0.');

 const eraseInvite=await invitations.create(hr,candidate.id,{mode:'VOICE',requestKey:'invite-voice-erasure'}),eraseRow=await db.screeningInvitation.findUniqueOrThrow({where:{id:eraseInvite.id}}),eraseToken=invitationToken(eraseRow.id,eraseRow.tokenNonce,config.get('JWT_SECRET')!),eraseClaim=await invitations.claim(user,eraseToken);
 const erasePlan=await db.aiCandidatePlan.findFirstOrThrow({where:{sessionId:eraseClaim.session.id}});await deliver('CANDIDATE',erasePlan.id);await sessions.claim(user,eraseClaim.session.id,clientId);
 const erasing=await voiceService.create(user,eraseClaim.session.id,clientId,'v=0 erasure mock SDP offer',TARA_LIVE_AUDIO_PROTOCOL);onEvent({type:'session.input_transcript.delta',event_id:'erase-input',delta:'Pengalaman kandidat yang harus dihapus.',start_ms:1000,end_ms:2000});await (voiceService as any).active.get(erasing.id).pending;
 await new UserErasureService(db,{...storage,keyFromPublicUrl:()=>null} as never).erase(user.id);
 const erasedVoice=await db.voiceInterview.findUniqueOrThrow({where:{id:erasing.id}});assert.equal(erasedVoice.sessionId,null,'provider reference survives until confirmed closure');assert.deepEqual(erasedVoice.promptSnapshot,{erased:true});assert.equal(await db.voiceFragment.count({where:{voiceId:erasing.id}}),0);assert.equal((await db.screeningInvitation.findUniqueOrThrow({where:{id:eraseInvite.id}})).status,'CANCELLED');await assert.rejects(invitations.preview(eraseToken));
 onEvent({type:'session.input_transcript.delta',event_id:'late-erased-input',delta:'Late fragment must not survive erasure.',start_ms:2000,end_ms:3000});await (voiceService as any).active.get(erasing.id).pending;assert.equal(await db.voiceFragment.count({where:{voiceId:erasing.id}}),0);
 await voiceService.tick();assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:erasing.id}})).status,'ENDED');assert.equal((await db.recruitmentCandidate.findUniqueOrThrow({where:{id:candidate.id}})).fileKey,null);
 await voiceService.onModuleDestroy();
 console.log('Voice integration passed: direct audio protocol, capture reconnect, deduplicated fragments, one session creation, 15-minute limit, delivered farewell, separate scores and unasked coverage. Paid calls: 0.');
 console.log('Invitation integration passed: email + Talentio delivery, idempotency, verified-email ownership, token integrity, concurrent claim, frozen CV/job, upgraded v6 invitation and v8 Chat, independent history, no application submission, separate scores, cancellation and mode boundaries. Paid calls: 0.');
}
main().finally(()=>db.$disconnect()).catch(error=>{console.error(error);process.exitCode=1;});
