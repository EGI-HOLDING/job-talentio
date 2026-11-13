import { scoringJob,scoreJobInclude } from './cv-job-context';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
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
import { VoiceService } from '../voice/voice.service';
import { UserErasureService } from '../../users/user-erasure.service';
import { CURRENT_CONVERSATION } from '../conversation.policy';
import { TAKA_INTERVIEW_VERSION } from '../taka-interview';
import { frozenRoleRubric, ROLE_ASSESSMENT_VERSION } from '../role-rubric';
import type { RoleAssessment } from '../taka-role-assessment';
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
 const takaRequests: string[][] = [];
 const roleRequests: Array<{ criteria: string[]; answerCount: number }> = [];
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
 const provider={run:async(_work:string,_subject:string,task:string,input:any,preset?:{version:string})=>{
  calls++;
  if(task==='prepare')return rubric;
  if(task==='live-agenda'){
   liveAgendaCalls++;
   const criteria=input.criteria as Array<{id:string;name:string}>;
   return {topics:criteria.map(({id,name})=>({criterionId:id,equivalentIds:[],
    question:name.includes('endpoint')?'Apa langkah pertama lu untuk membuat endpoint API yang aman?':'Gimana lu akan menyusun panduan penggunaan API untuk tim baru?'}))};
  }
  if(task==='candidate'&&input.duties){
   const line=input.cvSegments.find((row:{text:string})=>row.text.includes('Node.js'));
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
      topic.id==='skill-0'&&answer.includes('menulis dokumentasi API')?topic.fields:['TASK','ACTION'],
    }))}:{})};
  }
  if(task==='evaluate'&&preset?.version===TAKA_INTERVIEW_VERSION)return takaJudgement(input);
  if(task==='evaluate'&&preset?.version===ROLE_ASSESSMENT_VERSION)return roleJudgement(input);
  throw Error('Unexpected task '+task);
 }};
 const worker=new ScreeningWorker(db,config,storage as never,new MatchingService(db),packets,sessions,plans,provider as never,undefined,candidates,invitations);
 async function deliver(kind:string,subjectId?:string){
  if(kind==='CANDIDATE'&&subjectId){
   const plan=await db.aiCandidatePlan.findUniqueOrThrow({where:{id:subjectId},include:{package:true}});
   if(plan.package.status==='PENDING')await deliver('PREPARE',plan.packageId);
  }
  const work=await db.aiScreeningWork.findFirstOrThrow({where:{kind,...(subjectId?{subjectId}:{}),status:'PENDING'},orderBy:{createdAt:'asc'}});
  await worker.process(work.id);
  const saved=await db.aiScreeningWork.findUniqueOrThrow({where:{id:work.id}});
  assert.equal(saved.status,'DONE',kind+': '+saved.error);
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
 let onEvent:(event:any)=>void=()=>{},onLost:()=>void=()=>{},creates=0,hangups=0;const commands:any[]=[], attachments:string[]=[];
 const liveProvider={configured:true,create:async(body:any)=>{creates++;if(holdCreate)await holdCreate;assert.equal(body.session.model,'gpt-live-1');assert.equal(body.session.delegation.type,'client');assert.deepEqual(body.session.client.data_channel.allowed_client_events,[]);assert.match(body.session.instructions,/Tunggu kandidat selesai bicara/);return {session:{id:'live_mock_'+creates},transport:{sdp:'v=0 mock SDP answer'}};},attach:(id:string,event:any,lost:any)=>{attachments.push(id);onEvent=event;onLost=lost;return {opened:holdOpen??Promise.resolve(),send:(command:any)=>{commands.push(command);if(command.type==='session.output_audio.fixture.play')onEvent({type:'session.output_audio.fixture.played',event_id:'fixture-'+creates});if(command.type==='session.close')onEvent({type:'session.closed',event_id:'closed-'+creates,usage:{seconds:840},reason:'close_requested'});},dispose:()=>{}};},hangup:async()=>{hangups++;}};
 const voiceEvaluator={run:async(_work:string,_subject:string,_task:string,input:any,preset?:{version:string})=>{
  if(preset?.version===TAKA_INTERVIEW_VERSION)return takaJudgement(input);
  if(preset?.version===ROLE_ASSESSMENT_VERSION)return roleJudgement(input);
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
 const restart=await nextVoice('voice-server-restart-test');await db.voiceInterview.update({where:{id:restart.id},data:{leaseUntil:new Date(0)}});const restartedService=new VoiceService(db,config,sessions,liveProvider as never,voiceEvaluator as never),beforeHangups=hangups;await restartedService.tick();assert.equal((await db.voiceInterview.findUniqueOrThrow({where:{id:restart.id}})).closeReason,'SERVER_RESTART');assert.ok(hangups>beforeHangups,'new server closes orphaned provider session instead of recreating it');await voiceService.finish(restart.id,'SERVER_RESTART');await restartedService.onModuleDestroy();
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
 process.env.TAKA_ROLE_ASSESSMENT_ENABLED='false';
 console.log('Role scoring integration passed: frozen rubrics, Chat and native Live, whole transcript, consistent final score in list/detail/PDF, preserved history and access checks. Paid calls: 0.');

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
