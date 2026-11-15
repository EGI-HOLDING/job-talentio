import { cvJobRequirements, scoringJob, scoreJobInclude, sameScoringJob } from './cv-job-context';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException,Optional } from '@nestjs/common';
import { LiveUpdates } from '../../common/live-updates';
import { candidateRevealActivities } from '../../chat/recruitment-chat-access';
import { ANONYMOUS_REVEAL_STATUSES,revealsAnonymousEmployer } from '../../common/anonymous-job';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MailService } from '../../mail/mail.service';
import type { AuthUser } from '../../common/auth.decorators';
import { escapeHtml } from '../../common/utils';
import { RecruitmentService } from './recruitment.service';
import { ScreeningCandidatePlans } from '../screening-candidate-plans.service';
import { ScreeningSessions } from '../screening-sessions.service';
import { enqueueEvaluationPdf, enqueueWork, ScreeningPackets } from '../screening-packets.service';
import { newConversationPolicy, publicConversationPolicy } from '../conversation.policy';
import { json, screeningEnabled, PDF_TEMPLATE_VERSION } from '../screening.policy';
import { registerCvVersion } from '../../profiles/cv-evidence';
import { CV_MAX_BYTES, fileChecksum } from './cv-scoring.policy';
import { voiceTurns } from '../voice/voice.policy';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { nativeVoiceTurns, NATIVE_VOICE_VERSION } from '../voice/voice-native';
import { roleVoiceTurns, ROLE_VOICE_VERSION } from '../voice/voice-role';
import { freezeTakaInterview, TAKA_INTERVIEW_VERSION } from '../taka-interview';
import { isTakaRoleEvidence, TAKA_LIVE_COMPLETION_VERSION, TAKA_ROLE_EVIDENCE_VERSION } from '../taka-versions';
import { canPublishLiveReport, LIVE_COMPLETION_VERSION, LIVE_EVALUATION_WORK, liveCompletion, liveEvaluationKey, liveTranscript } from '../voice/voice-completion';
import { freezeRoleAssessment } from '../taka-role-assessment';
import { freezeLiveEvidencePrompt } from '../taka-live-evidence';
import { freezeLiveVoicePrompt } from '../prompts/voice-session';
import { alignedRoleFromPacket, frozenRoleRubric, ROLE_RUBRIC_VERSION } from '../role-rubric';
import type { PackagePayload } from '../screening.schemas';
import { invitationCreateSchema, invitationId, invitationNonce, invitationToken, INVITATION_TTL_MS, tokenHash, validInvitationToken } from './invitation.policy';

type FrozenInvitation={filename:string;fileKey:string;checksum:string|null;contentType:string;cvText:string;cvScore:number|null;cvResult:unknown;job:unknown;jobId:string;jobTitle:string;companyName:string};
const inviteInclude={candidate:{include:{job:true,company:true,application:{include:{profile:{include:{user:true}},resumeVersion:{select:{id:true,fileKey:true,resumeId:true}}}}}},session:{select:{id:true,status:true,startedAt:true,completedAt:true,voiceCompletion:true,voiceDeadlineAt:true,evaluation:{select:{status:true,screeningScore:true,finalScore:true,result:true}}}},package:{select:{conversationPolicy:true}}} satisfies Prisma.ScreeningInvitationInclude;
type Invitation=Prisma.ScreeningInvitationGetPayload<{include:typeof inviteInclude}>;
@Injectable()
export class InvitationsService {
 constructor(private db:PrismaService,private config:ConfigService,private candidates:RecruitmentService,private storage:StorageService,private plans:ScreeningCandidatePlans,private sessions:ScreeningSessions,private mail:MailService,private packets:ScreeningPackets,@Optional() private live?:LiveUpdates){}
 private token(row:{id:string;tokenNonce:string}){return invitationToken(row.id,row.tokenNonce,this.config.get<string>('JWT_SECRET')??'');}
 private url(row:{id:string;tokenNonce:string}){const base=this.config.get<string>('WEB_URL')??'http://localhost:3000';const url=new URL('/id/screening/'+this.token(row),base);if(!['http:','https:'].includes(url.protocol))throw Error('WEB_URL_INVALID');return url.toString();}
 private safe(row:Invitation){
  const completion=liveCompletion(row.session?.voiceCompletion);
  return {id:row.id,mode:row.mode,status:row.status,closedByStage:['HIRED','REJECTED','WITHDRAWN'].includes(row.candidate.stage)&&!row.session?.startedAt,expiresAt:row.expiresAt,recipientEmail:row.recipientEmail,emailStatus:row.emailStatus,messageStatus:row.messageStatus,error:row.error,createdAt:row.createdAt,
   session:row.session?{id:row.session.id,status:row.session.status,startedAt:row.session.startedAt,completedAt:row.session.completedAt,evaluation:canPublishLiveReport(completion)?row.session.evaluation:null,
    ...(completion ? {completion:{status:completion.status,reason:completion.reason,deadlineAt:row.session.voiceDeadlineAt,
     canRetry:completion.canRetry,remainingVoiceMs:completion.remainingVoiceMs,resumeUntil:completion.resumeExpiresAt}}:{})}:null};
 }
 async create(user:AuthUser,candidateId:string,input:z.infer<typeof invitationCreateSchema>){
  if(!screeningEnabled())throw new ServiceUnavailableException('Screening baru sedang dijeda.');
  const candidate=await this.candidates.owned(user,candidateId);

  if(['HIRED','REJECTED','WITHDRAWN'].includes(candidate.stage))throw new BadRequestException('Kandidat pada tahap selesai tidak dapat diundang screening.');
  const details=await this.db.recruitmentCandidate.findUniqueOrThrow({where:{id:candidateId},include:{job:true,company:true,application:{include:{profile:{include:{user:true}}}}}});
  if(details.job?.isAnonymous&&!revealsAnonymousEmployer(details.stage)&&!await this.db.candidateActivity.count({where:{candidateId,...candidateRevealActivities}})&&!(details.applicationId&&await this.db.pipelineEvent.count({where:{applicationId:details.applicationId,toStatus:{in:[...ANONYMOUS_REVEAL_STATUSES]}}})))throw new BadRequestException('Pindahkan kandidat ke tahap Wawancara sebelum mengundangnya untuk lowongan yang dirahasiakan.');
  const account=details.application?.profile.user;
  const email=(input.email??account?.email??details.email)?.trim().toLowerCase();
  if(!email||!invitationCreateSchema.shape.email.unwrap().safeParse(email).success)throw new BadRequestException('Lengkapi email kandidat untuk mengirim undangan.');
  if(account?.email&&email!==account.email.toLowerCase())throw new BadRequestException('Gunakan email akun kandidat yang terhubung dengan lamaran ini.');
  const existing=await this.db.screeningInvitation.findUnique({where:{candidateId_requestKey:{candidateId,requestKey:input.requestKey}},include:inviteInclude});
  if(existing){if(existing.mode!==input.mode||existing.recipientEmail!==email)throw new ConflictException('Kunci undangan sudah digunakan.');return this.safe(existing);}
  if(!candidate.jobId||!candidate.fileKey||!['READY'].includes(candidate.scoreStatus))throw new BadRequestException('Pilih lowongan dan selesaikan penilaian CV sebelum mengundang kandidat.');
  if(!details.job)throw new BadRequestException('Lowongan belum tersedia untuk screening.');
  const active=await this.db.screeningInvitation.findFirst({where:{candidateId,mode:input.mode,status:{in:['INVITED','STARTED']},OR:[{expiresAt:{gt:new Date()}},{session:{startedAt:{not:null},status:{in:['ACTIVE','GENERATING']}}}]},include:inviteInclude});
  if(active)return this.safe(active);
  const packet=await this.packets.sync(candidate.jobId,input.mode==='VOICE'?'VOICE':true);
  if(!packet)throw new BadRequestException('Konteks lowongan belum tersedia.');
  const roleSources = frozenRoleRubric(packet.jobSnapshot);
  const roleRubric = alignedRoleFromPacket(packet.jobSnapshot, packet.payload as PackagePayload | null);
  const completionEnabled=input.mode==='VOICE'&&this.config.get('TARA_LIVE_COMPLETION_ENABLED')==='true';
  if(roleSources?.version===ROLE_RUBRIC_VERSION&&!roleRubric)throw new ConflictException('Rubrik lowongan sedang disiapkan. Periksa kembali status penilaian CV.');
  if(completionEnabled&&!roleRubric?.interviewIds.length)
    throw new ConflictException('Siapkan tanggung jawab atau keahlian wajib lowongan sebelum mengundang wawancara suara.');
  const roleAssessmentPrompt = roleRubric ? freezeRoleAssessment() : undefined;
  const takaInterviewAssessment = freezeTakaInterview();
  const liveSnapshot = completionEnabled ? {
   liveCompletionVersion:LIVE_COMPLETION_VERSION,
   liveVoicePrompt:freezeLiveVoicePrompt(this.config.get<string>('TARA_LIVE_VOICE')??'marin'),
   // Preserve Structured Outputs field order through PostgreSQL jsonb.
   liveEvidencePrompt:JSON.stringify(freezeLiveEvidencePrompt()),
  } : undefined;
  const id=randomUUID(),tokenNonce=invitationNonce(),token=this.token({id,tokenNonce});
  const row=await this.db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id=${candidate.companyId} FOR UPDATE`);
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "RecruitmentCandidate" WHERE id=${candidateId} FOR UPDATE`);
   const repeated=await tx.screeningInvitation.findFirst({where:{candidateId,mode:input.mode,status:{in:['INVITED','STARTED']},OR:[
    {expiresAt:{gt:new Date()}},{session:{startedAt:{not:null},status:{in:['ACTIVE','GENERATING']}}},
   ]},include:inviteInclude});
   if(repeated)return repeated;
   const current=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id:candidateId}});if(['HIRED','REJECTED','WITHDRAWN'].includes(current.stage))throw new ConflictException('Proses rekrutmen kandidat sudah ditutup.');
   const currentJob=await tx.jobPost.findUniqueOrThrow({where:{id:candidate.jobId!},include:scoreJobInclude});
   if(current.scoreStatus!=='READY'||current.revision!==candidate.revision||!sameScoringJob(cvJobRequirements(current.jobSnapshot),scoringJob(currentJob)))throw new ConflictException('Penilaian CV perlu diperbarui sebelum membuat undangan baru.');
   const text=(current.cvResult as {cvText?:unknown}|null)?.cvText;
   if(typeof text!=='string'||!text.trim())throw new BadRequestException('Isi CV belum tersedia untuk screening.');
   const assessedRubric = (current.cvResult as {roleAssessment?: {rubricRevision?: string}}|null)?.roleAssessment?.rubricRevision;
   const candidateRubric = roleSources?.version === ROLE_RUBRIC_VERSION ? assessedRubric : frozenRoleRubric(current.jobSnapshot)?.revision;
   if(roleRubric?.revision !== candidateRubric)
     throw new ConflictException('Perbarui penilaian CV dengan rubrik lowongan sebelum membuat undangan.');
   if(!sameScoringJob(scoringJob(packet.jobSnapshot as never),scoringJob(currentJob)))
     throw new ConflictException('Lowongan atau penilaian CV baru saja berubah. Coba buat undangan lagi.');
   if(completionEnabled&&(typeof current.cvScore!=='number'||!Number.isFinite(current.cvScore)||current.cvScore<0||current.cvScore>100||assessedRubric!==roleRubric?.revision))
     throw new ConflictException('Perbarui penilaian CV dengan rubrik lowongan sebelum membuat undangan.');
   const created=await tx.screeningInvitation.create({data:{id,candidateId,packageId:packet.id,mode:input.mode,recipientEmail:email,createdById:user.id,requestKey:input.requestKey,tokenNonce,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+INVITATION_TTL_MS),snapshot:json({filename:current.filename,fileKey:current.fileKey,checksum:current.checksum,contentType:current.contentType,cvText:text,cvScore:current.cvScore,cvResult:current.cvResult,job:current.jobSnapshot,jobId:current.jobId,jobTitle:currentJob.title,companyName:currentJob.isAnonymous?'Perusahaan dirahasiakan':details.company.name,takaInterviewAssessment,roleAssessmentPrompt,
    ...liveSnapshot})},include:inviteInclude});
   const restored=await tx.aiScreeningPackage.updateMany({where:{id:packet.id,status:'SUPERSEDED'},data:{status:'PENDING'}});
   if(restored.count)await tx.aiScreeningWork.updateMany({where:{key:'PREPARE:'+packet.id,status:'DONE'},data:{status:'PENDING',availableAt:new Date()}});
   await enqueueWork(tx,'INVITE_DELIVERY',id);
   await tx.candidateActivity.create({data:{candidateId,actorUserId:user.id,kind:'SCREENING_INVITED',detail:json({invitationId:id,mode:input.mode})}});
   return created;
  });
  return this.safe(row);
 }
 async list(user:AuthUser,candidateId:string){await this.candidates.owned(user,candidateId);return (await this.db.screeningInvitation.findMany({where:{candidateId},include:inviteInclude,orderBy:{createdAt:'desc'}})).map(row=>this.safe(row));}
 async report(user:AuthUser,id:string){
  const row=await this.db.screeningInvitation.findUnique({where:{id},include:{...inviteInclude,session:{include:{questions:{orderBy:{position:'asc'}},evaluation:true,currentPlan:{select:{payload:true}}}}}});
  if(!row)throw new NotFoundException();await this.candidates.owned(user,row.candidateId);
  const completion=liveCompletion(row.session?.voiceCompletion);
  const evaluation=canPublishLiveReport(completion)?row.session?.evaluation:null;
  const claims=((row.session?.currentPlan?.payload as {claims?:Array<{id:string;statement:string;quote:string}>}|null)?.claims??[]).map(c=>({id:c.id,statement:c.statement,quote:c.quote}));
  let pdfStatus='NOT_READY';
  if(evaluation?.result&&row.sessionId){
   if(evaluation.pdfKey&&evaluation.pdfVersion===PDF_TEMPLATE_VERSION)pdfStatus='READY';
   else{
    const legacyKeys=['PDF:'+row.sessionId+':'+PDF_TEMPLATE_VERSION];
    if(row.mode==='VOICE')legacyKeys.push('PDF:'+row.sessionId+':'+evaluation.promptVersion);
    const work=await enqueueEvaluationPdf(this.db,row.sessionId,evaluation.inputHash,legacyKeys);
    pdfStatus=work.status==='FAILED'?'FAILED':'PENDING';
   }
  }
  const voice=row.sessionId?await this.db.voiceInterview.findUnique({where:{sessionId:row.sessionId},include:{fragments:{orderBy:{id:'asc'}}}}):null;
  const resumed=completion&&row.sessionId?await this.db.voiceInterview.findMany({where:{resumedForId:row.sessionId},
   include:{fragments:{orderBy:{id:'asc'}}},orderBy:{connectionNumber:'asc'}}):[];
  const transcript = voice && (completion ? liveTranscript([voice,...resumed]) :
    voice.promptVersion === ROLE_VOICE_VERSION || voice.promptVersion === TARA_LIVE_AUDIO_PROTOCOL ? roleVoiceTurns(voice.fragments) :
    voice.promptVersion === NATIVE_VOICE_VERSION ? nativeVoiceTurns(voice.fragments) : voiceTurns(voice.fragments));
  const last=resumed.at(-1)??voice;
  return {claims,pdfStatus,invitation:this.safe(row),voice:last&&voice?{status:last.status,startedAt:voice.startedAt,endedAt:last.endedAt,closeReason:last.closeReason,
   transcriptComplete:[voice,...resumed].every(connection=>connection.transcriptComplete),transcript}:null,questions:voice?[]:row.session?.questions.map(q=>({id:q.id,text:q.text,answer:q.answer,shownAt:q.shownAt,answeredAt:q.answeredAt,timedOut:q.timedOut}))??[],evaluation:evaluation?{status:evaluation.status,score:evaluation.screeningScore,finalScore:evaluation.finalScore,result:evaluation.result}:null,pdfUrl:pdfStatus==='READY'&&evaluation?.pdfKey?await this.storage.getPresignedGetUrl(evaluation.pdfKey,300,{filename:'Hasil-screening-Tara.pdf',contentType:'application/pdf'}):null};
 }
 async retryDelivery(user:AuthUser,id:string,acknowledgePossibleDuplicate=false){
  const row=await this.db.screeningInvitation.findUnique({where:{id}});if(!row)throw new NotFoundException();await this.candidates.owned(user,row.candidateId);
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${id} FOR UPDATE`);
   const current=await tx.screeningInvitation.findUniqueOrThrow({where:{id}});
   const candidate=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id:current.candidateId},select:{stage:true}});if(['HIRED','REJECTED','WITHDRAWN'].includes(candidate.stage))throw new ConflictException('Proses rekrutmen kandidat sudah ditutup.');
   if(current.status==='CANCELLED'||current.expiresAt<=new Date())throw new ConflictException('Buat undangan baru untuk kandidat ini.');
   const work=await enqueueWork(tx,'INVITE_DELIVERY',id);
   if(work.status==='RUNNING')throw new ConflictException('Pengiriman masih berlangsung. Periksa statusnya lagi sebentar.');
   if(['SENDING','UNCERTAIN'].includes(current.emailStatus)&&!acknowledgePossibleDuplicate)throw new ConflictException('Status email belum pasti. Konfirmasikan kemungkinan email ganda sebelum mengirim ulang.');
   await tx.screeningInvitation.update({where:{id},data:{emailStatus:current.emailStatus==='SENT'?'SENT':'PENDING',error:null}});
   await tx.aiScreeningWork.update({where:{id:work.id},data:{status:'PENDING',availableAt:new Date(),error:null,attempts:0}});
  });return {status:'PENDING'};
 }
 async retryEvaluation(user:AuthUser,id:string){
  const row=await this.db.screeningInvitation.findUnique({where:{id}});if(!row)throw new NotFoundException();await this.candidates.owned(user,row.candidateId);
  if(!row.sessionId||!['COMPLETED','STARTED','INTERRUPTED'].includes(row.status))throw new BadRequestException('Interview belum selesai.');
  const sessionId=row.sessionId;
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${id} FOR UPDATE`);
   const current=await tx.screeningInvitation.findUniqueOrThrow({where:{id},include:{session:true}});
   if(current.sessionId!==sessionId)throw new ConflictException('Interview tidak lagi tersedia.');
   const completion=liveCompletion(current.session?.voiceCompletion);
   const evaluation=await tx.aiScreeningEvaluation.findUnique({where:{sessionId}});
   if(completion?.status==='REVIEW_REQUIRED'&&completion.reason==='ASSESSMENT'){
    const repair=completion.evaluationRepair??0;
    const work=await tx.aiScreeningWork.findUnique({where:{key:liveEvaluationKey(sessionId,completion.evidenceRevision,repair)}});
    if(!work||work.kind!==LIVE_EVALUATION_WORK||!['FAILED','DONE'].includes(work.status))throw new ConflictException('Pemulihan penilaian sedang berjalan atau perlu diperiksa operator.');
    const unresolved=await tx.aiScreeningCall.findMany({where:{workId:work.id,status:{in:['RUNNING','UNCERTAIN']}},select:{responseId:true}});
    if(unresolved.some(call=>!call.responseId))throw new ConflictException('Status panggilan AI perlu diperiksa operator sebelum dicoba ulang.');
    const reuseWork=!evaluation?.result||unresolved.length>0;
    const nextRepair=reuseWork?repair:repair+1;
    if(reuseWork){
     const claimed=await tx.aiScreeningWork.updateMany({where:{id:work.id,status:work.status},data:{status:'PENDING',attempts:0,availableAt:new Date(),error:null}});
     if(!claimed.count)return {count:0};
    }else{
     await enqueueWork(tx,LIVE_EVALUATION_WORK,sessionId,liveEvaluationKey(sessionId,completion.evidenceRevision,nextRepair));
    }
    await tx.aiScreeningSession.update({where:{id:sessionId},data:{voiceCompletion:json({...completion,status:'ASSESSING',evaluationRepair:nextRepair}),revision:{increment:1}}});
    await tx.aiScreeningEvaluation.updateMany({where:{sessionId},data:{status:'PENDING',error:null}});
    await tx.candidateActivity.create({data:{candidateId:row.candidateId,actorUserId:user.id,kind:'SCREENING_EVALUATION_RETRY',
     detail:json({invitationId:id,kind:LIVE_EVALUATION_WORK})}});
    return {count:1};
   }
   if(!['COMPLETED','INTERRUPTED'].includes(current.status))throw new ConflictException('Interview tidak lagi tersedia.');
   const kind=evaluation?.status==='FAILED'?(row.mode==='VOICE'?'VOICE_EVALUATE':'EVALUATE'):'PDF';
   const works=await tx.aiScreeningWork.findMany({where:{subjectId:sessionId,kind,status:'FAILED'}});
   if(!works.length)throw new ConflictException('Tidak ada proses gagal yang perlu diulang.');
   const unresolved = await tx.aiScreeningCall.findMany({
    where: { workId: { in: works.map(work => work.id) }, status: { in: ['RUNNING', 'UNCERTAIN'] } },
    select: { responseId: true, promptVersion: true },
   });
   if (unresolved.some(call => !(call.promptVersion===TAKA_INTERVIEW_VERSION||isTakaRoleEvidence(call.promptVersion)) || !call.responseId || !/^resp_[a-zA-Z0-9_-]+$/.test(call.responseId))) {
    throw new ConflictException('Status panggilan AI perlu diperiksa operator sebelum dicoba ulang.');
   }
   await tx.aiScreeningCall.updateMany({where:{workId:{in:works.map(w=>w.id)},status:{in:['FAILED','INVALID']},
    promptVersion:{notIn:[TAKA_ROLE_EVIDENCE_VERSION,TAKA_LIVE_COMPLETION_VERSION]}},data:{status:'RECOVERED'}});
   const claim=await tx.aiScreeningWork.updateMany({where:{id:{in:works.map(w=>w.id)},status:'FAILED'},data:{status:'PENDING',attempts:0,availableAt:new Date(),error:null}});
   if(kind!=='PDF')await tx.aiScreeningEvaluation.updateMany({where:{sessionId,status:'FAILED'},data:{status:'PENDING',error:null}});
   await tx.candidateActivity.create({data:{candidateId:row.candidateId,actorUserId:user.id,kind:'SCREENING_EVALUATION_RETRY',detail:json({invitationId:id,kind})}});
   return {count:claim.count};
  });
 }
 private async fromToken(token:string){
  const id=invitationId(token);if(!id)throw new NotFoundException('Undangan tidak ditemukan.');
  const row=await this.db.screeningInvitation.findUnique({where:{id},include:inviteInclude});
  if(!row||!validInvitationToken(token,row.tokenHash)||!row.candidate.jobId||row.candidate.company.isBanned||row.candidate.company.anonymizedAt||row.status==='CANCELLED')throw new NotFoundException('Undangan tidak tersedia.');
  if(['HIRED','REJECTED','WITHDRAWN'].includes(row.candidate.stage)&&!row.session?.startedAt)throw new ConflictException('Proses rekrutmen sudah ditutup. Undangan ini tidak dapat dimulai.');
  if(row.expiresAt<=new Date()&&!row.session?.startedAt)throw new ConflictException('Undangan sudah kedaluwarsa. Hubungi HR untuk undangan baru.');
  return row;
 }
 async preview(token:string){const row=await this.fromToken(token),snapshot=row.snapshot as unknown as FrozenInvitation;return {mode:row.mode,jobTitle:snapshot.jobTitle,companyName:snapshot.companyName,expiresAt:row.expiresAt,status:row.status,conversationPolicy:publicConversationPolicy(newConversationPolicy())};}
 async claim(user:AuthUser,token:string){
  if(user.role!=='EMPLOYEE')throw new ForbiddenException('Gunakan akun kandidat untuk mengikuti screening.');
  const row=await this.fromToken(token),account=await this.db.user.findUnique({where:{id:user.id},select:{id:true,email:true,emailVerified:true,isBanned:true,anonymizedAt:true}});
  if(!account||account.isBanned||account.anonymizedAt||!account.emailVerified||account.email?.toLowerCase()!==row.recipientEmail)throw new ForbiddenException('Masuk dengan email penerima undangan yang sudah diverifikasi.');
  if(row.claimedUserId&&row.claimedUserId!==user.id)throw new ForbiddenException();
  if(row.candidate.application&&row.candidate.application.profile.userId!==user.id)throw new ForbiddenException('Undangan ini milik akun kandidat lain.');
  if(row.sessionId){await this.deliverMessage(row.id,user.id);return {invitationId:row.id,mode:row.mode,session:await this.sessions.state(user,row.sessionId)};}
  if(!screeningEnabled())throw new ServiceUnavailableException('Screening baru sedang dijeda.');
  const frozen=row.snapshot as unknown as FrozenInvitation;
  const bytes=await this.storage.getObjectBuffer(frozen.fileKey,CV_MAX_BYTES),checksum=fileChecksum(bytes);
  if(frozen.checksum&&frozen.checksum!==checksum)throw new ConflictException('Berkas CV berubah. Hubungi HR.');
  const extension=frozen.contentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||/\.docx$/i.test(frozen.fileKey)?'docx':frozen.contentType==='application/msword'||/\.doc$/i.test(frozen.fileKey)?'doc':'pdf';
  const copyKey='cvs/screening/'+user.id+'/'+checksum+'.'+extension;
  const submitted=row.candidate.application?.resumeVersion;
  const submittedVersion=submitted?.fileKey===frozen.fileKey&&submitted.resumeId?submitted:null;
  if(!submittedVersion)await this.storage.putObject(copyKey,bytes,frozen.contentType);
  try{
   const session=await this.db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${row.id} FOR UPDATE`);
    const current=await tx.screeningInvitation.findUniqueOrThrow({where:{id:row.id}});
    if(current.claimedUserId&&current.claimedUserId!==user.id)throw new ForbiddenException();
    if(current.sessionId)return tx.aiScreeningSession.findUniqueOrThrow({where:{id:current.sessionId}});
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "RecruitmentCandidate" WHERE id=${row.candidateId} FOR UPDATE`);
    const candidate=await tx.recruitmentCandidate.findUniqueOrThrow({where:{id:row.candidateId},select:{stage:true}});if(['HIRED','REJECTED','WITHDRAWN'].includes(candidate.stage))throw new ConflictException('Proses rekrutmen sudah ditutup.');
    if(current.status!=='INVITED'||current.expiresAt<=new Date())throw new ConflictException('Undangan tidak lagi aktif.');
    const profile=await tx.employeeProfile.upsert({where:{userId:user.id},create:{userId:user.id},update:{}});
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
    let version;
    if(submittedVersion){
     version=await tx.resumeVersion.findFirst({where:{id:submittedVersion.id,fileKey:frozen.fileKey,resume:{profileId:profile.id}}});
     if(!version||version.checksum&&version.checksum!==checksum)throw new ConflictException('Berkas CV yang dipakai saat melamar berubah.');
     if(!version.checksum)await tx.resumeVersion.update({where:{id:version.id},data:{checksum}});
    }else{
     const owned=await tx.resume.findFirst({where:{profileId:profile.id,deletedAt:null,fileKey:frozen.fileKey},orderBy:[{isPrimary:'desc'},{id:'asc'}]});
     // An invitation can retain its own file without adding a selectable CV to the library.
     const resume=owned??await tx.resume.findFirst({where:{profileId:profile.id,fileKey:copyKey}})
       ??await tx.resume.create({data:{profileId:profile.id,title:frozen.filename,fileKey:copyKey,deletedAt:new Date()}});
     version=await registerCvVersion(tx,resume.id,resume.fileKey!,checksum);
    }
    const created=await tx.aiScreeningSession.create({data:{jobId:frozen.jobId,profileId:profile.id,resumeId:version.resumeId,resumeVersionId:version.id,packageId:current.packageId}});
    await tx.screeningInvitation.update({where:{id:row.id},data:{sessionId:created.id,claimedUserId:user.id}});
    await tx.candidateActivity.create({data:{candidateId:row.candidateId,actorUserId:user.id,kind:'SCREENING_OPENED',detail:json({invitationId:row.id})}});
    return created;
   });
   await this.deliverMessage(row.id,user.id);
   await this.plans.request(session.id);
   return {invitationId:row.id,mode:row.mode,session:await this.sessions.state(user,session.id)};
  }finally{
   if(!submittedVersion){
    const referenced=await this.db.resumeVersion.count({where:{fileKey:copyKey}}).catch(()=>1);
    if(!referenced)await this.storage.delete(copyKey);
   }
  }
 }
 private async deliverMessage(id:string,recipientId:string){
  const recipients=await this.db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${id} FOR UPDATE`);
   const row=await tx.screeningInvitation.findUniqueOrThrow({where:{id},include:{candidate:true}});
   if(row.messageId)return;
   let senderId=row.createdById;
   if(!senderId||!await tx.companyMember.findUnique({where:{companyId_userId:{companyId:row.candidate.companyId,userId:senderId}}}))senderId=(await tx.companyMember.findFirst({where:{companyId:row.candidate.companyId,user:{isBanned:false,anonymizedAt:null}},orderBy:{createdAt:'asc'}}))?.userId??null;
   if(!senderId||senderId===recipientId)throw Error('SCREENING_SENDER_UNAVAILABLE');
   const [userAId,userBId]=[senderId,recipientId].sort(),frozen=row.snapshot as unknown as FrozenInvitation;
   const conversation=await tx.conversation.upsert({where:{userAId_userBId_jobPostId:{userAId,userBId,jobPostId:frozen.jobId}},create:{userAId,userBId,companyId:row.candidate.companyId,jobPostId:frozen.jobId,initiatedBy:senderId,isColdOutreach:true},update:{updatedAt:new Date()}});
   const body=`Kamu diundang mengikuti interview ${row.mode==='VOICE'?'suara':'teks'} bersama Tara untuk ${frozen.jobTitle}. Buka undangan: ${this.url(row)}\nUndangan berlaku sampai ${row.expiresAt.toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}.`;
   const message=await tx.chatMessage.create({data:{conversationId:conversation.id,senderId,body}});
   await tx.screeningInvitation.update({where:{id},data:{messageId:message.id,messageStatus:'SENT'}});
   return [senderId,recipientId];
  });
  if(recipients)this.live?.publish(recipients,'chat');
 }
 async deliver(id:string){
  const row=await this.db.screeningInvitation.findUnique({where:{id},include:inviteInclude});
  if(!row||row.status==='CANCELLED'||row.expiresAt<=new Date()&&!row.session?.startedAt)return;
  if(['HIRED','REJECTED','WITHDRAWN'].includes(row.candidate.stage)&&!row.session?.startedAt)return;
  if(!row.candidate.company||row.candidate.company.isBanned||row.candidate.company.anonymizedAt)return;
  const recipient=row.candidate.application?.profile.user??await this.db.user.findFirst({where:{email:{equals:row.recipientEmail,mode:'insensitive'},role:'EMPLOYEE',isBanned:false,anonymizedAt:null}});
  if(recipient)await this.deliverMessage(id,recipient.id);
  else await this.db.screeningInvitation.updateMany({where:{id,messageId:null},data:{messageStatus:'WAITING_ACCOUNT'}});
  if(['SENT','UNCERTAIN'].includes(row.emailStatus))return;
  if(row.emailStatus==='SENDING'){
   await this.db.screeningInvitation.updateMany({where:{id,emailStatus:'SENDING'},data:{emailStatus:'UNCERTAIN',error:'Status pengiriman email perlu diperiksa sebelum dikirim ulang.'}});return;
  }
  const claimed=await this.db.screeningInvitation.updateMany({where:{id,emailStatus:{in:['PENDING','FAILED']}},data:{emailStatus:'SENDING',emailAttemptAt:new Date(),error:null}});
  if(!claimed.count)return;
  const frozen=row.snapshot as unknown as FrozenInvitation,url=this.url(row);
  const {maxQuestions,questionSeconds}=publicConversationPolicy(newConversationPolicy());
  const answerTime=questionSeconds===60?'1 menit':`${questionSeconds} detik`;
  const timing=row.mode==='VOICE'?'Siapkan mikrofon dan tempat yang nyaman. Sesi maksimal 15 menit.'
   :`Kamu akan menjawab maksimal ${maxQuestions} pertanyaan, dengan waktu ${answerTime} per pertanyaan.`;
  const result=await this.mail.send(row.recipientEmail,'Undangan interview bersama Tara — '+frozen.jobTitle,`<h2>Interview bersama Tara</h2><p>Kamu diundang mengikuti interview ${row.mode==='VOICE'?'suara':'teks'} untuk posisi <strong>${escapeHtml(frozen.jobTitle)}</strong> di ${escapeHtml(frozen.companyName)}.</p><p>${timing}</p><p><a href="${escapeHtml(url)}">Buka undangan interview</a></p><p>Masuk menggunakan email penerima undangan yang sudah diverifikasi. Jika belum memiliki akun Talentio, daftar menggunakan email ini.</p>`);
  if(!result){await this.db.screeningInvitation.update({where:{id},data:{emailStatus:'UNCERTAIN',error:'Status pengiriman email perlu diperiksa sebelum dikirim ulang.'}});return;}
  await this.db.screeningInvitation.update({where:{id},data:{emailStatus:'SENT',emailSentAt:new Date(),error:null}});
 }
 async failure(id:string){await this.db.screeningInvitation.updateMany({where:{id,emailStatus:{notIn:['SENT','UNCERTAIN']}},data:{error:'Undangan tersimpan, tetapi pengiriman perlu diperiksa.'}});}
 async cancel(user:AuthUser,id:string){
  const row=await this.db.screeningInvitation.findUnique({where:{id},select:{candidateId:true}});if(!row)throw new NotFoundException();await this.candidates.owned(user,row.candidateId);
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${id} FOR UPDATE`);
   const current=await tx.screeningInvitation.findUniqueOrThrow({where:{id},include:{session:true}});
   if(current.sessionId)await tx.$queryRaw(Prisma.sql`SELECT id FROM "AiScreeningSession" WHERE id=${current.sessionId} FOR UPDATE`);
   const session=current.sessionId?await tx.aiScreeningSession.findUnique({where:{id:current.sessionId}}):null;
   if(session?.startedAt)throw new ConflictException('Sesi yang sudah dimulai tidak dapat dibatalkan.');
   await tx.screeningInvitation.update({where:{id},data:{status:'CANCELLED'}});
   if(session)await tx.aiScreeningSession.update({where:{id:session.id},data:{status:'CANCELLED'}});
   return {status:'CANCELLED'};
  });
 }
}
