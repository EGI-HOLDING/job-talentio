import { voiceEvidence,voiceOpportunities,type VoiceOpportunity } from './voice-evidence';
import { createVoiceRequest } from '../prompts/voice-session';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VoiceInterview } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import { ScreeningSessions } from '../screening-sessions.service';
import { ScreeningClient } from '../screening.client';
import { enqueueWork } from '../screening-packets.service';
import { json, hash, screeningModel, screeningEnabled } from '../screening.policy';
import type { CandidatePayload, EvaluationPayload, PackagePayload } from '../screening.schemas';
import { taraVoice } from '../prompts/shared/tara-voice';
import { taraHumor } from '../prompts/shared/tara-humor';
import { interviewBoundaries } from '../prompts/shared/interview-boundaries';
import { inputTrust } from '../prompts/shared/input-trust';
import { liveInterview, liveReasoning } from '../prompts/tasks/live-interview';
import { evaluateVoice } from '../prompts/tasks/evaluate-voice';
import { VOICE_VERSION, VOICE_EVALUATION_SCHEMA, voiceClock, voiceTurns } from './voice.policy';
import { judgementScore } from '../evidence-catalog';
import { VoiceProvider } from './voice.provider';

type Channel=ReturnType<VoiceProvider['attach']>;
type Live={providerId:string;greeting:string;greeted:boolean;channel:Channel;pending:Promise<void>;finishing:boolean;closed:boolean;taraText:string;candidateHeard:boolean;captureFailed?:boolean;closingRequested?:boolean;closingPromptPending?:boolean};
const terminal=['ENDED','FAILED','CREATE_UNCERTAIN'];
@Injectable()
export class VoiceService implements OnModuleInit,OnModuleDestroy {
 private owner=randomUUID();private active=new Map<string,Live>();private timer?:ReturnType<typeof setInterval>;private ticking=false;
 private logger=new Logger(VoiceService.name);
 constructor(private db:PrismaService,private config:ConfigService,private sessions:ScreeningSessions,private provider:VoiceProvider,private client:ScreeningClient){}
 async onModuleInit(){const exists=await this.db.$queryRaw<Array<{name:string|null}>>(Prisma.sql`SELECT to_regclass('public."VoiceInterview"')::text AS name`).catch(()=>[]);if(!exists[0]?.name)return;this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('Voice watchdog retry pending.')),1000);this.timer.unref();}
 async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await Promise.allSettled([...this.active.keys()].map(id=>this.finish(id,'SERVER_RESTART')));}
 private async owned(user:AuthUser,id:string){const row=await this.sessions.owned(user,id);if(row.invitation?.mode!=='VOICE')throw new ForbiddenException('Undangan ini bukan interview suara.');return row;}
 private safe(row:VoiceInterview){return{id:row.id,status:row.status,startedAt:row.startedAt,endedAt:row.endedAt,serverNow:new Date(),warningAt:row.warningAt,closingAt:row.closingAt,closeReason:row.closeReason,transcriptComplete:row.transcriptComplete,error:row.error};}
 async state(user:AuthUser,id:string){await this.owned(user,id);const row=await this.db.voiceInterview.findUnique({where:{sessionId:id}});return row?{...this.safe(row),transcript:voiceTurns(await this.db.voiceFragment.findMany({where:{voiceId:row.id},orderBy:{id:'asc'}}))}:null;}
 async create(user:AuthUser,id:string,clientId:string,sdp:string){
  await this.owned(user,id);if(!screeningEnabled()||!this.provider.configured)throw new ServiceUnavailableException('Interview suara sedang tidak tersedia.');
  const existing=await this.db.voiceInterview.findUnique({where:{sessionId:id}});if(existing)throw new ConflictException(terminal.includes(existing.status)?'Sesi ini sudah berakhir. Hasilnya tetap disimpan.':'Sesi sudah dimulai di tab lain.');
  await this.sessions.start(user,id,clientId,'VOICE');
  const session=await this.db.aiScreeningSession.findUniqueOrThrow({where:{id},include:{currentPlan:true,invitation:true,package:true}});
  if(session.status!=='ACTIVE'||!session.currentPlan?.payload)throw new ConflictException('Tara masih menyiapkan pertanyaan. Coba lagi sebentar.');
  const plan=session.currentPlan.payload as unknown as CandidatePayload;
  const snapshot=session.invitation!.snapshot as {jobTitle:string;companyName:string};
  const request=createVoiceRequest({model:this.config.get<string>('TARA_LIVE_MODEL')??'gpt-live-1',reasoningModel:this.config.get<string>('TARA_LIVE_REASONING_MODEL')??'gpt-6-luna',voice:this.config.get<string>('TARA_LIVE_VOICE')??'marin',job:session.package?.jobSnapshot,plan,jobTitle:snapshot.jobTitle,companyName:snapshot.companyName},sdp);
  const instructions=request.session.instructions;
  let row:VoiceInterview;
  try{row=await this.db.voiceInterview.create({data:{sessionId:id,owner:this.owner,leaseUntil:new Date(Date.now()+15_000),model:this.config.get<string>('TARA_LIVE_MODEL')??'gpt-live-1',promptVersion:VOICE_VERSION,promptSnapshot:json({instructions,reasoning:liveReasoning,evaluate:evaluateVoice,evaluationSchema:VOICE_EVALUATION_SCHEMA,evaluationModel:screeningModel()})}});}catch{throw new ConflictException('Interview sudah dimulai.');}
  let providerId:string|undefined;
  try{
   const response=await this.provider.create(request);
   providerId=response.session?.id;if(!providerId||!response.transport?.sdp)throw Error('VOICE_CREATE_INVALID');
   row=await this.db.voiceInterview.update({where:{id:row.id},data:{providerId,status:'CONNECTING'}});
   const channel=this.provider.attach(providerId,event=>this.accept(row.id,event),()=>{const active=this.active.get(row.id);if(active&&!active.closed){active.captureFailed=true;if(!active.finishing)this.requestFinish(row.id,'TRANSCRIPT_CONNECTION_LOST');}});
   const live:Live={providerId,greeting:request.session.input[0].content[0].text,greeted:false,channel,pending:Promise.resolve(),finishing:false,closed:false,taraText:'',candidateHeard:false};this.active.set(row.id,live);
   await channel.opened;
   await this.db.voiceInterview.update({where:{id:row.id},data:{status:'ACTIVE',leaseUntil:new Date(Date.now()+15_000)}});
   return {...this.safe(row),status:'ACTIVE',sdp:response.transport.sdp};
  }catch(error){
   if(!providerId&&error instanceof Error&&/^VOICE_PROVIDER_HTTP_/.test(error.message)){await this.db.voiceInterview.deleteMany({where:{id:row.id,providerId:null}});throw new ServiceUnavailableException('Koneksi suara belum tersedia. Silakan coba lagi sebentar.');}
   if(providerId){await this.provider.hangup(providerId).catch(()=>undefined);await this.finish(row.id,'CONNECTION_FAILED');}
   else{await this.db.voiceInterview.update({where:{id:row.id},data:{status:'CREATE_UNCERTAIN',endedAt:new Date(),error:'Pembuatan koneksi belum terkonfirmasi. Hubungi HR; sesi tidak otomatis dibuat ulang.'}});await this.finalize(row.id);}
   throw new ServiceUnavailableException('Koneksi interview belum berhasil. Hasil yang tersedia tetap tersimpan; hubungi HR untuk sesi baru.');
  }
 }
 private accept(id:string,event:Record<string,unknown>){
  const live=this.active.get(id);if(!live)return;
  live.pending=live.pending.then(async()=>{
   if(event.type==='error'){const code=String((event.error as {code?:string})?.code??'UNKNOWN');if((live.finishing||live.closingRequested)&&code==='context_injection_incomplete')return;await this.db.voiceInterview.updateMany({where:{id},data:{error:'Koneksi Tara mengalami kendala. Hasil yang tersedia tetap disimpan.'}});setTimeout(()=>this.requestFinish(id,'PROVIDER_ERROR'),0);return;}
   if(event.type==='session.output_audio.fixture.played'&&live.closingPromptPending){this.closingPrompt(live);return;}
   if(event.type==='session.started'&&!live.greeted){live.greeted=true;live.channel.send({type:'session.commentary.append',delegation_id:null,content:live.greeting});return;}
   if(event.type==='session.closed'){
    live.closed=true;const saved=await this.db.voiceInterview.findUnique({where:{id},select:{closeReason:true,error:true}});await this.db.voiceInterview.updateMany({where:{id},data:{usage:event.usage?json(event.usage):Prisma.DbNull,transcriptComplete:!live.captureFailed&&!saved?.error&&event.reason!=='connection_lost'&&!['SERVER_RESTART','TRANSCRIPT_STORAGE_FAILED','TRANSCRIPT_CONNECTION_LOST','CONNECTION_LOST'].includes(saved?.closeReason??'')}});
    if(!live.finishing)setTimeout(()=>this.requestFinish(id,event.reason==='connection_lost'?'CONNECTION_LOST':'PROVIDER_ENDED'),0);
    return;
   }
   if(event.type!=='session.input_transcript.delta'&&event.type!=='session.output_transcript.delta')return;
   const speaker=event.type==='session.input_transcript.delta'?'CANDIDATE':'TARA';
   if(typeof event.event_id!=='string'||typeof event.delta!=='string'||!event.delta||!Number.isInteger(event.start_ms)||!Number.isInteger(event.end_ms))throw Error('VOICE_TRANSCRIPT_INVALID');
   // Context appends use a zero-length timeline; they are not candidate answers.
   if(Number(event.end_ms)<=Number(event.start_ms))return;
   const saved=await this.db.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM "VoiceInterview" WHERE id=${id} FOR UPDATE`);const retained=await tx.voiceInterview.findUnique({where:{id},select:{sessionId:true}});if(!retained?.sessionId)return {count:0};return tx.voiceFragment.createMany({data:[{voiceId:id,eventId:String(event.event_id),speaker,text:String(event.delta),startMs:Number(event.start_ms),endMs:Number(event.end_ms)}],skipDuplicates:true});});if(!saved.count)return;
   if(speaker==='CANDIDATE')live.candidateHeard=true;
   else{live.taraText=(live.taraText+event.delta).slice(-500);if(live.candidateHeard&&/interview kita sudah selesai[.!]?/i.test(live.taraText)&&!live.finishing){const marked=await this.db.voiceInterview.updateMany({where:{id,status:'ACTIVE'},data:{status:'CLOSING',closingAt:new Date(),closeReason:'TARA_FINISHED'}});if(marked.count)live.channel.send({type:'session.input_audio.mute'});}}
  }).catch(async()=>{live.captureFailed=true;await this.db.voiceInterview.updateMany({where:{id},data:{error:'Sebagian transkrip belum tersimpan.',transcriptComplete:false}}).catch(()=>undefined);setTimeout(()=>this.requestFinish(id,'TRANSCRIPT_STORAGE_FAILED'),0);});
 }
 async heartbeat(user:AuthUser,id:string,clientId:string){await this.owned(user,id);const session=await this.db.aiScreeningSession.findUniqueOrThrow({where:{id}});if(session.leaseToken!==clientId)throw new ConflictException('Interview digunakan tab lain.');await this.db.voiceInterview.updateMany({where:{sessionId:id,status:{in:['CONNECTING','ACTIVE','CLOSING']}},data:{heartbeatAt:new Date()}});return this.state(user,id);}
 async end(user:AuthUser,id:string,clientId:string){await this.owned(user,id);const row=await this.db.aiScreeningSession.findUniqueOrThrow({where:{id}});const voice=await this.db.voiceInterview.findUnique({where:{sessionId:id}});if(voice&&terminal.includes(voice.status))return this.state(user,id);if(row.leaseToken!==clientId)throw new ConflictException('Interview digunakan tab lain.');if(voice&&!terminal.includes(voice.status))await this.finish(voice.id,'CANDIDATE_ENDED');return this.state(user,id);}
 async tick(now=new Date()){
  if(this.ticking)return;this.ticking=true;
  try{
   const rows=await this.db.voiceInterview.findMany({where:{status:{notIn:terminal}}});
   const present=new Set(rows.map(r=>r.id));for(const id of this.active.keys())if(!present.has(id))await this.finish(id,'SESSION_REMOVED');
   await Promise.allSettled(rows.map(async row=>{
    if(row.owner!==this.owner){if(row.leaseUntil<=now){const claimed=await this.db.voiceInterview.updateMany({where:{id:row.id,owner:row.owner,leaseUntil:{lte:now}},data:{owner:this.owner,leaseUntil:new Date(+now+15_000)}});if(claimed.count)await this.finish(row.id,'SERVER_RESTART');}return;}
    await this.db.voiceInterview.updateMany({where:{id:row.id,owner:this.owner},data:{leaseUntil:new Date(+now+15_000)}});
    if(!row.sessionId){await this.db.voiceFragment.deleteMany({where:{voiceId:row.id}});await this.db.voiceInterview.updateMany({where:{id:row.id},data:{promptSnapshot:{erased:true},transcriptComplete:false}});await this.finish(row.id,'ACCOUNT_ERASED');return;}
    const clock=voiceClock(row.startedAt,now),live=this.active.get(row.id);
    if(clock.hard){await this.finish(row.id,'TIME_LIMIT');return;}
    if(+now-+row.heartbeatAt>30_000){await this.finish(row.id,'CANDIDATE_DISCONNECTED');return;}
    if(!live){if(+now-+row.startedAt>35_000)await this.finish(row.id,'CONNECTION_FAILED');return;}
    if(row.status==='CLOSING'&&row.closingAt&&+now-+row.closingAt>=8000){await this.finish(row.id,row.closeReason??'TIME_LIMIT');return;}
    if(clock.closing&&!row.closingAt){
     const changed=await this.db.voiceInterview.updateMany({where:{id:row.id,closingAt:null},data:{closingAt:now,status:'CLOSING',closeReason:'TIME_LIMIT'}});
     if(changed.count){live.closingRequested=true;live.closingPromptPending=true;live.channel.send({type:'session.input_audio.mute'});live.channel.send({type:'session.output_audio.fixture.play',audio:Buffer.alloc(4800).toString('base64')});setTimeout(()=>{if(live.closingPromptPending&&!live.finishing)try{this.closingPrompt(live);}catch{this.requestFinish(row.id,'TIME_LIMIT');}},1200);}
    }else if(clock.warning&&!row.warningAt){const changed=await this.db.voiceInterview.updateMany({where:{id:row.id,warningAt:null},data:{warningAt:now}});if(changed.count)live.channel.send({type:'session.commentary.append',delegation_id:null,content:'Waktu interview sudah 10 menit. Sampaikan singkat: sisa 5 menit lagi ya. Lalu lanjutkan fokus pertanyaan yang paling relevan.'});}
   }));
   // Finalization is durable: a crash after closing can be recovered without starting another paid session.
   const stranded=await this.db.voiceInterview.findMany({where:{status:{in:terminal},session:{status:{not:'COMPLETED'}}},take:25});for(const row of stranded)await this.finalize(row.id);
  }finally{this.ticking=false;}
 }
 private closingPrompt(live:Live){live.closingPromptPending=false;live.channel.send({type:'session.input_audio.mute'});live.channel.send({type:'session.instructions.append',delegation_id:null,content:'Waktu server: menit 14. Jangan bertanya lagi. Ucapkan permisi, kita sudah dekat batas waktu, terima kasih sudah sharing. Tutup interview.'});live.channel.send({type:'session.commentary.append',delegation_id:null,content:'Permisi, kita udah dekat ke batas waktu ya. Terima kasih udah sharing. Interview kita sudah selesai.'});}
 private requestFinish(id:string,reason:string){void this.finish(id,reason).catch(()=>this.logger.warn('Voice closure will retry.'));}
 async finish(id:string,reason:string){
  const row=await this.db.voiceInterview.findUnique({where:{id}});if(!row){const removed=this.active.get(id);if(removed){await this.provider.hangup(removed.providerId);removed.channel.dispose();this.active.delete(id);}return;}
  const live=this.active.get(id);if(live?.finishing)return;if(live)live.finishing=true;
  if(terminal.includes(row.status)){if(live){if(!live.closed&&row.providerId)await this.provider.hangup(row.providerId);live.channel.dispose();this.active.delete(id);}return;}
  await this.db.voiceInterview.updateMany({where:{id,status:{notIn:terminal}},data:{status:'CLOSING',closeReason:row.closeReason??reason,closingAt:row.closingAt??new Date()}});
  try{
   if(live&&!live.closed){try{live.channel.send({type:'session.input_audio.mute'});live.channel.send({type:'session.close'});}catch{/* REST hangup fallback below. */}
    const until=Date.now()+2500;while(!live.closed&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
   }
   if(row.providerId&&!live?.closed)await this.provider.hangup(row.providerId);
   if(live)await live.pending;
   await this.db.voiceInterview.update({where:{id},data:{status:'ENDED',endedAt:new Date(),closeReason:row.closeReason??reason,...(!live?.closed?{transcriptComplete:false}:{} )}});
   await this.finalize(id);
  }catch{await this.db.voiceInterview.updateMany({where:{id},data:{error:'Penutupan koneksi sedang dicoba ulang.',leaseUntil:new Date(0)}});if(live)live.finishing=false;}
  finally{if((await this.db.voiceInterview.findUnique({where:{id}}))?.status==='ENDED'){live?.channel.dispose();this.active.delete(id);}}
 }
 private async finalize(id:string){
  const row=await this.db.voiceInterview.findUnique({where:{id}});if(!row?.sessionId)return;
  const sessionId=row.sessionId;
  await this.db.$transaction(async tx=>{
   const session=await tx.aiScreeningSession.findUnique({where:{id:sessionId},include:{invitation:true}});if(!session||!session.invitation)return;
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${session.invitation.id} FOR UPDATE`);
   if(!await tx.aiScreeningSession.findUnique({where:{id:sessionId}}))return;
   await tx.aiScreeningSession.update({where:{id:session.id},data:{status:'COMPLETED',completedAt:row.endedAt??new Date(),leaseToken:null,leaseExpiresAt:null}});
   await tx.screeningInvitation.update({where:{id:session.invitation.id},data:{status:'COMPLETED'}});
   await tx.aiScreeningEvaluation.upsert({where:{sessionId:session.id},create:{sessionId:session.id,status:'PENDING',promptVersion:VOICE_VERSION},update:{}});
   await enqueueWork(tx,'VOICE_EVALUATE',session.id);
  });
 }
 async evaluate(workId:string,sessionId:string){
  const voice=await this.db.voiceInterview.findUnique({where:{sessionId},include:{fragments:{orderBy:{id:'asc'}},session:{include:{currentPlan:true,invitation:true,package:true,evaluation:true}}}});
  if(!voice||!terminal.includes(voice.status)||!voice.session?.invitation||!voice.session.currentPlan)return;
  if(voice.session.evaluation?.status==='READY'||voice.session.evaluation?.status==='NEEDS_REVIEW')return;
  const plan=voice.session.currentPlan.payload as unknown as CandidatePayload,turns=voiceTurns(voice.fragments);
  const partial=!['TIME_LIMIT','TARA_FINISHED'].includes(voice.closeReason??'')||!voice.transcriptComplete||!turns.some(t=>t.speaker==='CANDIDATE');
  const prompt=voice.promptSnapshot as {evaluate:string;evaluationSchema:typeof VOICE_EVALUATION_SCHEMA;evaluationModel:string};
  type Judged={claimId:string;asked:boolean;opportunities?:VoiceOpportunity[];questionRef?:string|null;answerRefs?:string[];level:string;detail:string;reason:string};
  type Result={summary:string;claims:Judged[];strengths:string[];gaps:string[];interviewQuestions:string[]};
  const raw:Result=turns.some(t=>t.speaker==='CANDIDATE')?await this.client.run(workId,sessionId,'evaluate',{claims:plan.claims,transcript:turns,availableOpportunities:voiceOpportunities(turns),partial,closeReason:voice.closeReason},{instructions:prompt.evaluate,schema:prompt.evaluationSchema,name:'tara_voice_assessment',version:VOICE_VERSION,reasoning:'low',maxOutput:6500,model:prompt.evaluationModel}) as Result:{summary:'Belum ada jawaban kandidat yang dapat dinilai.',claims:plan.claims.map(c=>({claimId:c.id,asked:false,opportunities:[],level:'NONE',detail:'NONE',reason:'Belum ada kesempatan menjawab yang terekam.'})),strengths:[],gaps:[],interviewQuestions:[]};
  if(raw.claims.length!==plan.claims.length||new Set(raw.claims.map(c=>c.claimId)).size!==plan.claims.length)throw Error('VOICE_CLAIM_COVERAGE');
  const judged=raw.claims.map(c=>{
   const claim=plan.claims.find(p=>p.id===c.claimId);if(!claim)throw Error('VOICE_UNKNOWN_CLAIM');
   // A frozen v1 assessment retains its original schema. New sessions cite every relevant follow-up separately.
   const opportunities=c.opportunities??(c.questionRef?[{questionRef:c.questionRef,answerRefs:c.answerRefs??[]}]:[]);
   const answers=voiceEvidence(turns,opportunities);
   if(c.asked&&!opportunities.length||!c.asked&&(opportunities.length||c.level!=='NONE'||c.detail!=='NONE')||!answers.length&&(c.level!=='NONE'||c.detail!=='NONE'))throw Error('VOICE_INVALID_OPPORTUNITY');
   const score=c.asked?judgementScore(c.level,c.detail):null;
   return {claimId:claim.id,criterionId:claim.criterionId,cvQuote:claim.quote,status:!c.asked?'INSUFFICIENT':score!==null&&score>=3?'SUPPORTED':'INSUFFICIENT',score,reason:c.reason,evidence:answers.map(t=>({questionId:t.id,questionRef:t.questionRef,questionText:t.questionText,quote:t.text.slice(0,500)})),contradictions:[],asked:c.asked,questionRef:opportunities[0]?.questionRef??null};
  });
  const tested=judged.filter(c=>c.score!==null),score=tested.length?Math.round(tested.reduce((sum,c)=>sum+(c.score??0),0)/(tested.length*4)*1000)/10:null;
  const result={...raw,claims:judged,criteria:[],voice:{partial,closeReason:voice.closeReason,transcriptComplete:voice.transcriptComplete,durationSeconds:Math.max(0,Math.round(((voice.endedAt?.getTime()??Date.now())-+voice.startedAt)/1000)),testedClaims:tested.length,totalClaims:judged.length},summary:(partial?'Sesi parsial; hasil berdasarkan percakapan yang tersedia. ':'')+raw.summary};
  const frozen=voice.session.invitation.snapshot as {cvScore?:number};
  await this.db.aiScreeningEvaluation.update({where:{sessionId},data:{status:partial?'NEEDS_REVIEW':'READY',promptVersion:VOICE_VERSION,model:prompt.evaluationModel,inputHash:hash([VOICE_VERSION,turns,raw]),result:json(result),cvScore:frozen.cvScore??null,screeningScore:score,finalScore:null,error:null}});
  await enqueueWork(this.db,'PDF',sessionId,'PDF:'+sessionId+':'+VOICE_VERSION);
 }
}
