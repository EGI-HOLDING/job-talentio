import { createVoiceRequest } from '../prompts/voice-session';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VoiceInterview } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import { ScreeningSessions } from '../screening-sessions.service';
import { AiPending, ScreeningClient } from '../screening.client';
import { enqueueWork } from '../screening-packets.service';
import { json, hash, screeningEnabled } from '../screening.policy';
import type { CandidatePayload, PackagePayload } from '../screening.schemas';
import { VOICE_VERSION, voiceClock, voiceTurns, type Fragment } from './voice.policy';
import { VoiceProvider } from './voice.provider';
import { conversationTone, requireCurrentConversation } from '../conversation.policy';
import { currentTaraPrompt, type PromptRegistry } from '../prompts/registry';
import { taraAssessmentTopics, taraTopics, taraInterviewReport, TARA_SESSION_MS, validTaraDecision, type TaraProgress } from '../tara-interview';
import { TaraLiveTurns, taraVerbalStop, TARA_CLOSE_MS } from './voice-turns';
import { TaraPlayback } from './voice-playback';
import { frozenTakaInterview, liveTakaTurns } from '../taka-interview';
import { evaluateTakaInterview } from '../taka-evaluation';

type Channel=ReturnType<VoiceProvider['attach']>;
type Guided={turns:TaraLiveTurns;fragments:Fragment[];plan:CandidatePayload;rubric:PackagePayload;preset:PromptRegistry['follow-up'];lastCandidateAt?:number;lastSavedProgress?:string};
type Controlled={playback:TaraPlayback;startedAt?:number;listening:boolean};
type Live={providerId:string;channel:Channel;pending:Promise<void>;finishing:boolean;closed:boolean;captureFailed?:boolean;closingRequested?:boolean;guided:Guided;controlled:Controlled};
type PlaybackEvent='READY'|'AUDIO_PLAYED'|'TEXT_SHOWN'|'AUDIO_FAILED';
const terminal=['ENDED','FAILED','CREATE_UNCERTAIN'];
const VOICE_CLIENT_LEASE_MS=60_000;
@Injectable()
export class VoiceService implements OnModuleInit,OnModuleDestroy {
 private owner=randomUUID();private active=new Map<string,Live>();private timer?:ReturnType<typeof setInterval>;private ticking=false;
 private logger=new Logger(VoiceService.name);
 constructor(private db:PrismaService,private config:ConfigService,private sessions:ScreeningSessions,private provider:VoiceProvider,private client:ScreeningClient){}
 async onModuleInit(){const exists=await this.db.$queryRaw<Array<{name:string|null}>>(Prisma.sql`SELECT to_regclass('public."VoiceInterview"')::text AS name`).catch(()=>[]);if(!exists[0]?.name)return;this.timer=setInterval(()=>void this.tick().catch(()=>this.logger.warn('Voice watchdog retry pending.')),1000);this.timer.unref();}
 async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await Promise.allSettled([...this.active.keys()].map(id=>this.finish(id,'SERVER_RESTART')));}
 private async owned(user:AuthUser,id:string){const row=await this.sessions.owned(user,id);if(row.invitation?.mode!=='VOICE')throw new ForbiddenException('Undangan ini bukan interview suara.');return row;}
 private safe(row:VoiceInterview){
  const live=this.active.get(row.id), controlled=live?.controlled;
  const timed=!!controlled||typeof (row.taraInterview as unknown as TaraProgress|null)?.policyVersion==='string';
  return{id:row.id,status:row.status,startedAt:controlled?.startedAt?new Date(controlled.startedAt):row.startedAt,endedAt:row.endedAt,
   serverNow:new Date(),warningAt:row.warningAt,closingAt:row.closingAt,closeReason:row.closeReason,transcriptComplete:row.transcriptComplete,error:row.error,
   ...(timed?{controlledPlayback:true,clockRunning:!!controlled?.startedAt||terminal.includes(row.status),playback:controlled?.startedAt&&!live?.finishing?controlled.playback.status():null}:{})};
 }
 async state(user:AuthUser,id:string){await this.owned(user,id);const row=await this.db.voiceInterview.findUnique({where:{sessionId:id}});return row?{...this.safe(row),transcript:voiceTurns(await this.db.voiceFragment.findMany({where:{voiceId:row.id},orderBy:{id:'asc'}}))}:null;}
 async create(user:AuthUser,id:string,clientId:string,sdp:string){
  await this.owned(user,id);if(!screeningEnabled()||!this.provider.configured)throw new ServiceUnavailableException('Interview suara sedang tidak tersedia.');
  const existing=await this.db.voiceInterview.findUnique({where:{sessionId:id}});if(existing)throw new ConflictException(terminal.includes(existing.status)?'Sesi ini sudah berakhir. Hasilnya tetap disimpan.':'Sesi sudah dimulai di tab lain.');
  await this.sessions.claim(user,id,clientId);
  await this.sessions.start(user,id,clientId,'VOICE');
  const session=await this.db.aiScreeningSession.findUniqueOrThrow({where:{id},include:{currentPlan:true,invitation:true,package:true}});
  if(session.status!=='ACTIVE'||!session.currentPlan?.payload)throw new ConflictException('Tara masih menyiapkan pertanyaan. Coba lagi sebentar.');
  const lease=await this.db.aiScreeningSession.updateMany({where:{id,leaseToken:clientId,status:'ACTIVE'},data:{leaseExpiresAt:new Date(Date.now()+VOICE_CLIENT_LEASE_MS)}});
  if(!lease.count)throw new ConflictException('Interview digunakan tab lain.');
  const plan=session.currentPlan.payload as unknown as CandidatePayload;
  requireCurrentConversation(session.package?.conversationPolicy);
  const rubric=session.package?.payload as unknown as PackagePayload;
  const guide:Guided={turns:new TaraLiveTurns(taraTopics(plan,rubric,true),true),fragments:[],plan,rubric,
   preset:currentTaraPrompt(session.package!.promptSnapshot,'follow-up')};
  const model=this.config.get<string>('TARA_LIVE_MODEL')??'gpt-live-1';
  const request=createVoiceRequest({model,reasoningModel:this.config.get<string>('TARA_LIVE_REASONING_MODEL')??'gpt-6-luna',voice:this.config.get<string>('TARA_LIVE_VOICE')??'marin'},sdp);
  let row:VoiceInterview;
  try{row=await this.db.voiceInterview.create({data:{sessionId:id,owner:this.owner,leaseUntil:new Date(Date.now()+15_000),model,promptVersion:VOICE_VERSION,
   promptSnapshot:json({instructions:request.session.instructions,reasoning:request.session.delegation.responses.instructions}),taraInterview:json(guide.turns.progress)}});}catch{throw new ConflictException('Interview sudah dimulai.');}
  let providerId:string|undefined;
  const controlled:Controlled={playback:new TaraPlayback((question,signal)=>this.provider.render(question,signal)),listening:false};
  controlled.playback.offer(guide.turns.topics[0].question);
  try{
   const response=await this.provider.create(request);
   providerId=response.session?.id;if(!providerId||!response.transport?.sdp)throw Error('VOICE_CREATE_INVALID');
   row=await this.db.voiceInterview.update({where:{id:row.id},data:{providerId,status:'CONNECTING'}});
   const channel=this.provider.attach(providerId,event=>this.accept(row.id,event),()=>{const active=this.active.get(row.id);if(active&&!active.closed){active.captureFailed=true;if(!active.finishing)this.requestFinish(row.id,'TRANSCRIPT_CONNECTION_LOST');}});
   const live:Live={providerId,channel,pending:Promise.resolve(),finishing:false,closed:false,guided:guide,controlled};
   this.active.set(row.id,live);
   await channel.opened;
   await this.heartbeat(user,id,clientId);
   await this.db.voiceInterview.update({where:{id:row.id},data:{status:'ACTIVE',heartbeatAt:new Date(),leaseUntil:new Date(Date.now()+15_000)}});
   return {...this.safe(row),status:'ACTIVE',sdp:response.transport.sdp};
  }catch(error){
   controlled?.playback.clear();
   if(!providerId&&error instanceof Error&&/^VOICE_PROVIDER_HTTP_/.test(error.message)){await this.db.voiceInterview.deleteMany({where:{id:row.id,providerId:null}});throw new ServiceUnavailableException('Koneksi suara belum tersedia. Silakan coba lagi sebentar.');}
   if(providerId){await this.provider.hangup(providerId).catch(()=>undefined);await this.finish(row.id,'CONNECTION_FAILED');}
   else await this.finalize(row.id,{status:'CREATE_UNCERTAIN',endedAt:new Date(),error:'Pembuatan koneksi belum terkonfirmasi. Hubungi HR; sesi tidak otomatis dibuat ulang.'});
   throw new ServiceUnavailableException('Koneksi interview belum berhasil. Hasil yang tersedia tetap tersimpan; hubungi HR untuk sesi baru.');
  }
 }
 private accept(id:string,event:Record<string,unknown>){
  const live=this.active.get(id);if(!live)return;
  live.pending=live.pending.then(async()=>{
   if(event.type==='error'){const code=String((event.error as {code?:string})?.code??'UNKNOWN');if((live.finishing||live.closingRequested)&&code==='context_injection_incomplete')return;await this.db.voiceInterview.updateMany({where:{id},data:{error:'Koneksi Tara mengalami kendala. Hasil yang tersedia tetap disimpan.'}});setTimeout(()=>this.requestFinish(id,'PROVIDER_ERROR'),0);return;}
   if(event.type==='session.started'){
    if(!live.controlled.listening)live.channel.send({type:'session.input_audio.mute'});
    return;
   }
   if(event.type==='session.closed'){
    live.closed=true;live.controlled?.playback.clear();
    const providerDisconnect=event.reason==='connection_lost'?'CONNECTION_LOST':event.reason==='remote_hangup'?'CANDIDATE_DISCONNECTED':null;
    const saved=await this.db.voiceInterview.findUnique({where:{id},select:{closeReason:true,error:true}});
    const technicalClose=['SERVER_RESTART','TRANSCRIPT_STORAGE_FAILED','TRANSCRIPT_CONNECTION_LOST','CONNECTION_LOST','CANDIDATE_DISCONNECTED'];
    await this.db.voiceInterview.updateMany({where:{id},data:{usage:event.usage?json(event.usage):Prisma.DbNull,transcriptComplete:!live.captureFailed&&!saved?.error&&!providerDisconnect&&!technicalClose.includes(saved?.closeReason??'')}});
    if(!live.finishing)setTimeout(()=>this.requestFinish(id,providerDisconnect??'PROVIDER_ENDED'),0);
    return;
   }
   const {controlled,guided}=live;
   if(event.type!=='session.input_transcript.delta'||!controlled.listening||!controlled.startedAt||
    Date.now()>=controlled.startedAt+TARA_CLOSE_MS)return;
   if(typeof event.event_id!=='string'||typeof event.delta!=='string'||!event.delta||!Number.isInteger(event.start_ms)||!Number.isInteger(event.end_ms))throw Error('VOICE_TRANSCRIPT_INVALID');
   if(Number(event.end_ms)<=Number(event.start_ms))return;
   const observed=Math.max(0,Date.now()-controlled.startedAt);
   const fragments=await this.db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "VoiceInterview" WHERE id=${id} FOR UPDATE`);
    const retained=await tx.voiceInterview.findUnique({where:{id},select:{sessionId:true}});
    if(!retained?.sessionId)return [];
    return tx.voiceFragment.createManyAndReturn({data:[{voiceId:id,eventId:String(event.event_id),speaker:'CANDIDATE',
     text:String(event.delta),startMs:observed,endMs:observed+1}],skipDuplicates:true});
   });
   if(fragments.length){guided.fragments.push(...fragments);guided.lastCandidateAt=Date.now();}
  }).catch(async()=>{live.captureFailed=true;await this.db.voiceInterview.updateMany({where:{id},data:{error:'Sebagian transkrip belum tersimpan.',transcriptComplete:false}}).catch(()=>undefined);setTimeout(()=>this.requestFinish(id,'TRANSCRIPT_STORAGE_FAILED'),0);});
 }
 private async ownedPlayback(user:AuthUser,id:string,clientId:string){
  const session=await this.owned(user,id);
  if(session.leaseToken!==clientId||!session.leaseExpiresAt||+session.leaseExpiresAt<=Date.now())throw new ConflictException('Tab interview tidak aktif.');
  const row=await this.db.voiceInterview.findUnique({where:{sessionId:id}});
  const live=row?this.active.get(row.id):undefined;
  if(!row||!live?.controlled||live.closed||live.finishing)throw new NotFoundException('Pemutaran interview tidak tersedia.');
  return {row,live,controlled:live.controlled};
 }
 async clip(user:AuthUser,id:string,clientId:string,revision:number){
  const {controlled,live}=await this.ownedPlayback(user,id,clientId);
  const now=Date.now();
  if(!controlled.startedAt||(now>=controlled.startedAt+TARA_CLOSE_MS&&!live.closingRequested))throw new NotFoundException();
  const audio=controlled.playback.read(revision,now);
  if(!audio)throw new NotFoundException('Klip sudah berganti.');
  return audio;
 }
 async playback(user:AuthUser,id:string,clientId:string,event:PlaybackEvent,revision?:number){
  const {row,live,controlled}=await this.ownedPlayback(user,id,clientId);
  if(event==='READY'&&!controlled.startedAt)await controlled.playback.ready();
  const action=live.pending.then(async()=>{
   if(live.closed||live.finishing)return;
   const now=Date.now(), guide=live.guided!;
   if(event==='READY'){
    if(controlled.startedAt||row.status!=='ACTIVE')return;
    const changed=await this.db.voiceInterview.updateMany({where:{id:row.id,status:'ACTIVE',sessionId:id},data:{startedAt:new Date(now),heartbeatAt:new Date(now)}});
    if(!changed.count)return;
    controlled.startedAt=now;
    live.channel.send({type:'session.input_audio.mute'});
    guide.turns.issue(guide.turns.topics[0].question,now,true,0);
    return;
   }
   if(!controlled.startedAt||revision===undefined||now>=controlled.startedAt+TARA_SESSION_MS)return;
   const current=controlled.playback.status();
   if(!current||current.revision!==revision||
    current.kind==='QUESTION'&&(live.closingRequested||now>=controlled.startedAt+TARA_CLOSE_MS)||
    !controlled.playback.confirm(revision,event,now))return;
   if(event==='AUDIO_FAILED')return;
   if(current.kind==='SIGNOFF'){
    controlled.playback.delivered(event);
    setTimeout(()=>this.requestFinish(row.id,row.closeReason??'TARA_FINISHED'),0);
    return;
   }
   const at=Math.max(0,now-controlled.startedAt);
   const fragment=await this.db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "VoiceInterview" WHERE id=${row.id} FOR UPDATE`);
    const retained=await tx.voiceInterview.findUnique({where:{id:row.id},select:{sessionId:true,status:true}});
    if(retained?.sessionId!==id||retained.status!=='ACTIVE')return;
    const fragment=await tx.voiceFragment.create({data:{voiceId:row.id,eventId:'tara-playback:'+revision,speaker:'TARA',text:current.text,startMs:at,endMs:at+1}});
    guide.turns.delivered('v'+fragment.id,now,event==='AUDIO_PLAYED'?'AUDIO':'TEXT_FALLBACK');
    await tx.voiceInterview.update({where:{id:row.id},data:{taraInterview:json(guide.turns.progress)}});
    return fragment;
   });
   if(!fragment||live.closingRequested||live.finishing||controlled.playback.status()?.revision!==revision)return;
   guide.fragments.push(fragment);
   controlled.playback.delivered(event);
   controlled.listening=true;
   live.channel.send({type:'session.input_audio.unmute'});
  });
  live.pending=action.catch(()=>{this.requestFinish(row.id,'PROVIDER_ERROR');});
  await action;
  return this.state(user,id);
 }
 async heartbeat(user:AuthUser,id:string,clientId:string){
  await this.owned(user,id);
  const voice=await this.db.voiceInterview.findUnique({where:{sessionId:id}});
  if(voice&&terminal.includes(voice.status))return this.state(user,id);
  const renewed=await this.db.aiScreeningSession.updateMany({where:{id,leaseToken:clientId,status:'ACTIVE'},data:{leaseExpiresAt:new Date(Date.now()+VOICE_CLIENT_LEASE_MS)}});
  if(!renewed.count)throw new ConflictException('Interview digunakan tab lain.');
  await this.db.voiceInterview.updateMany({where:{sessionId:id,status:{in:['CONNECTING','ACTIVE','CLOSING']}},data:{heartbeatAt:new Date()}});
  return this.state(user,id);
 }
 async end(user:AuthUser,id:string,clientId:string,reason:'CANDIDATE_ENDED'|'CANDIDATE_LEFT'|'CONNECTION_FAILED'|'CONNECTION_LOST'='CANDIDATE_ENDED'){await this.owned(user,id);const row=await this.db.aiScreeningSession.findUniqueOrThrow({where:{id}});const voice=await this.db.voiceInterview.findUnique({where:{sessionId:id}});if(voice&&terminal.includes(voice.status))return this.state(user,id);if(row.leaseToken!==clientId)throw new ConflictException('Interview digunakan tab lain.');if(voice&&!terminal.includes(voice.status))await this.finish(voice.id,reason);return this.state(user,id);}
 async tick(now=new Date()){
  if(this.ticking)return;this.ticking=true;
  try{
   const rows=await this.db.voiceInterview.findMany({where:{status:{notIn:terminal}}});
   const present=new Set(rows.map(r=>r.id));for(const id of this.active.keys())if(!present.has(id))await this.finish(id,'SESSION_REMOVED');
   await Promise.allSettled(rows.map(async row=>{
    if(row.owner!==this.owner){if(row.leaseUntil<=now){const claimed=await this.db.voiceInterview.updateMany({where:{id:row.id,owner:row.owner,leaseUntil:{lte:now}},data:{owner:this.owner,leaseUntil:new Date(+now+15_000)}});if(claimed.count)await this.finish(row.id,'SERVER_RESTART');}return;}
    await this.db.voiceInterview.updateMany({where:{id:row.id,owner:this.owner},data:{leaseUntil:new Date(+now+15_000)}});
    if(!row.sessionId){await this.db.voiceFragment.deleteMany({where:{voiceId:row.id}});await this.db.voiceInterview.updateMany({where:{id:row.id},data:{promptSnapshot:{erased:true},taraInterview:Prisma.DbNull,transcriptComplete:false}});await this.finish(row.id,'ACCOUNT_ERASED');return;}
    const clock=voiceClock(row.startedAt,now),live=this.active.get(row.id);
    if(clock.hard){await this.finish(row.id,'TIME_LIMIT');return;}
    const starting=['CREATING','CONNECTING'].includes(row.status);
    if(+now-+row.heartbeatAt>(starting?60_000:30_000)){await this.finish(row.id,'CANDIDATE_DISCONNECTED');return;}
    if(!live){if(+now-+row.startedAt>(starting?60_000:35_000))await this.finish(row.id,'CONNECTION_FAILED');return;}
    if(live.controlled&&!live.controlled.startedAt){
     if(+now-+row.createdAt>=60_000)await this.finish(row.id,'CONNECTION_FAILED');
     return;
    }
    if(row.status==='CLOSING'&&row.closingAt&&+now-+row.closingAt>=22_000){await this.finish(row.id,row.closeReason??'TIME_LIMIT');return;}
    if(clock.closing&&!row.closingAt){
     await this.closeGuided(row,live,+now,'TIME_LIMIT');
     return;
    }
    if(clock.warning&&!row.warningAt)await this.db.voiceInterview.updateMany({where:{id:row.id,warningAt:null},data:{warningAt:now}});
    if(row.status==='ACTIVE'&&!clock.closing&&!live.finishing){
     const steering=live.pending.then(()=>this.guideTurn(row,live,+now));
     live.pending=steering.catch(()=>{this.requestFinish(row.id,'PROVIDER_ERROR');});
     await steering;
    }
   }));
   // Finalization is durable: a crash after closing can be recovered without starting another paid session.
   const stranded=await this.db.voiceInterview.findMany({where:{status:{in:terminal},session:{status:{not:'COMPLETED'}}},take:25});for(const row of stranded)await this.finalize(row.id);
  }finally{this.ticking=false;}
 }
 private async guideTurn(row:VoiceInterview,live:Live,now:number){
  const guide=live.guided!;
  const turns=voiceTurns(guide.fragments);
  const candidate=turns.filter(turn=>turn.speaker==='CANDIDATE').at(-1);
  if(candidate&&guide.lastCandidateAt&&now-guide.lastCandidateAt>=1800&&taraVerbalStop(candidate.text)){
   await this.closeGuided(row,live,now,'CANDIDATE_ENDED');
   return;
  }
  const next=guide.turns.tick(turns,now,+row.startedAt+TARA_CLOSE_MS,async(topic,question,answer,serial,source,previous,dialogue,ongoing)=>{
   const key='VOICE_TURN:'+row.id+':'+serial+':'+source;
   const work=await this.db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "VoiceInterview" WHERE id=${row.id} FOR UPDATE`);
    const retained=await tx.voiceInterview.findUnique({where:{id:row.id},select:{sessionId:true,status:true}});
    if(retained?.sessionId!==row.sessionId||retained?.status!=='ACTIVE')return;
    return tx.aiScreeningWork.upsert({where:{key},create:{key,kind:'VOICE_TURN',subjectId:row.sessionId!,status:'DONE'},update:{}});
   });
   if(!work||live.finishing)return;
   const chain:Array<{question:string;answer:string}>=[];let previousQuestion='';
   for(const turn of dialogue){
    if(turn.speaker==='TARA')previousQuestion=turn.text;
    else if(previousQuestion)chain.push({question:previousQuestion,answer:turn.text});
   }
   chain.push({question,answer});
   const input={topic,claim:guide.plan.claims.find(claim=>claim.id===topic.id),
    requirement:guide.rubric.criteria.find(criterion=>criterion.id===topic.criterionId)?.requirementRef,
    assessmentTopics:taraAssessmentTopics(guide.turns.progress,guide.turns.topics),ongoing,
    chain,tonePreference:conversationTone(turns.filter(turn=>turn.speaker==='CANDIDATE').map(turn=>({answer:turn.text})))};
   const until=Date.now()+7000;
   do{
    try{return validTaraDecision(await this.client.run(work.id,row.sessionId!,'follow-up',input,guide.preset,undefined,
     Math.max(1,until-Date.now())),answer,previous,guide.turns.topics);}
    catch(error){if(!(error instanceof AiPending))return;await new Promise(resolve=>setTimeout(resolve,400));}
   }while(!live.finishing&&Date.now()<until);
  }, Boolean(live.controlled.listening && !live.captureFailed && now - +row.heartbeatAt < 30_000));
  if(!next){
   const snapshot=hash(guide.turns.progress);
   if(snapshot!==guide.lastSavedProgress){
    await this.db.voiceInterview.updateMany({where:{id:row.id,status:'ACTIVE',owner:this.owner,sessionId:row.sessionId},data:{taraInterview:json(guide.turns.progress)}});
    guide.lastSavedProgress=snapshot;
   }
   return;
  }
  const saved=await this.db.voiceInterview.updateMany({where:{id:row.id,owner:this.owner,status:'ACTIVE',sessionId:row.sessionId},data:{taraInterview:json(guide.turns.progress)}});
  if(!saved.count||live.closed||live.finishing||live.closingRequested||Date.now()>=+row.startedAt+TARA_CLOSE_MS)return;
  if(next.question){
   guide.turns.issue(next.question,now,next.changedTopic,next.after);
   live.controlled.listening=false;
   live.channel.send({type:'session.input_audio.mute'});
   live.controlled.playback.offer(next.timeout&&!next.deliveryFailed?'Gue pindah topik dulu ya. '+next.question:next.question);
   return;
  }
  await this.closeGuided(row,live,now,'TARA_FINISHED');
 }
 private async closeGuided(row:VoiceInterview,live:Live,now:number,reason:'TARA_FINISHED'|'CANDIDATE_ENDED'|'TIME_LIMIT'){
  const changed=await this.db.voiceInterview.updateMany({where:{id:row.id,owner:this.owner,status:'ACTIVE'},data:{status:'CLOSING',closingAt:new Date(now),closeReason:reason}});
  if(changed.count){
   live.closingRequested=true;
   live.channel.send({type:'session.input_audio.mute'});
   live.controlled.listening=false;
   live.controlled.playback.offer('Makasih udah cerita. Interview kita selesai ya.','SIGNOFF');
  }
 }
 private requestFinish(id:string,reason:string){void this.finish(id,reason).catch(()=>this.logger.warn('Voice closure will retry.'));}
 async finish(id:string,reason:string){
  const row=await this.db.voiceInterview.findUnique({where:{id}});if(!row){const removed=this.active.get(id);if(removed){await this.provider.hangup(removed.providerId);removed.channel.dispose();this.active.delete(id);}return;}
  const live=this.active.get(id);if(live?.finishing)return;if(live){live.finishing=true;live.controlled?.playback.clear();}
  if(terminal.includes(row.status)){if(live){if(!live.closed&&row.providerId)await this.provider.hangup(row.providerId);live.channel.dispose();this.active.delete(id);}return;}
  await this.db.voiceInterview.updateMany({where:{id,status:{notIn:terminal}},data:{status:'CLOSING',closeReason:row.closeReason??reason,closingAt:row.closingAt??new Date()}});
  try{
   if(live&&!live.closed){try{live.channel.send({type:'session.input_audio.mute'});live.channel.send({type:'session.close'});}catch{/* REST hangup fallback below. */}
    const until=Date.now()+2500;while(!live.closed&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
   }
   if(row.providerId&&!live?.closed)await this.provider.hangup(row.providerId);
   if(live)await live.pending;
   const closeReason=row.closeReason??reason;
   const technical=!['TIME_LIMIT','TARA_FINISHED','CANDIDATE_ENDED'].includes(closeReason)||!live?.closed||!!live.captureFailed;
   const endedAt=new Date(live?.controlled?.startedAt?Math.min(Date.now(),live.controlled.startedAt+TARA_SESSION_MS):Date.now());
   const progress=row.sessionId&&closeReason!=='ACCOUNT_ERASED'?live?.guided?.turns.finish(voiceTurns(live.guided.fragments),technical,+endedAt,closeReason==='TIME_LIMIT'):undefined;
   await this.finalize(id,{status:'ENDED',endedAt,closeReason,...(!live?.closed?{transcriptComplete:false}:{}),...(progress?{taraInterview:json(progress)}:{})});
  }catch{await this.db.voiceInterview.updateMany({where:{id},data:{error:'Penutupan koneksi sedang dicoba ulang.',leaseUntil:new Date(0)}});if(live)live.finishing=false;}
  finally{if((await this.db.voiceInterview.findUnique({where:{id}}))?.status==='ENDED'){live?.channel.dispose();this.active.delete(id);}}
 }
 private async finalize(id:string,change?:Prisma.VoiceInterviewUpdateManyMutationInput){
  await this.db.$transaction(async tx=>{
   if(change){
    const {taraInterview,...lifecycle}=change;
    await tx.voiceInterview.updateMany({where:{id,status:{notIn:terminal}},data:lifecycle});
    if(taraInterview)await tx.voiceInterview.updateMany({where:{id,sessionId:{not:null},closeReason:{not:'ACCOUNT_ERASED'}},data:{taraInterview}});
   }
   const row=await tx.voiceInterview.findUnique({where:{id},select:{sessionId:true,endedAt:true}});if(!row?.sessionId)return;
   const session=await tx.aiScreeningSession.findUnique({where:{id:row.sessionId},include:{invitation:true}});if(!session||!session.invitation)return;
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "ScreeningInvitation" WHERE id=${session.invitation.id} FOR UPDATE`);
   if(!await tx.aiScreeningSession.findUnique({where:{id:session.id}}))return;
   await tx.aiScreeningSession.updateMany({where:{id:session.id,status:{not:'COMPLETED'}},data:{status:'COMPLETED',completedAt:row.endedAt??new Date(),leaseToken:null,leaseExpiresAt:null}});
   await tx.screeningInvitation.update({where:{id:session.invitation.id},data:{status:'COMPLETED'}});
   await tx.aiScreeningEvaluation.upsert({where:{sessionId:session.id},create:{sessionId:session.id,status:'PENDING',promptVersion:VOICE_VERSION},update:{}});
   await enqueueWork(tx,'VOICE_EVALUATE',session.id);
  });
 }
 async evaluate(workId:string,sessionId:string,owner?:string){
  const voice=await this.db.voiceInterview.findUnique({where:{sessionId},include:{fragments:{orderBy:{id:'asc'}},session:{include:{currentPlan:true,invitation:true,package:true,evaluation:true}}}});
  if(!voice||!terminal.includes(voice.status)||!voice.session?.invitation||!voice.session.currentPlan||!voice.session.package)return;
  if(voice.session.evaluation?.result)return;
  const plan=voice.session.currentPlan.payload as unknown as CandidatePayload,turns=voiceTurns(voice.fragments);
  const rubric=voice.session.package.payload as unknown as PackagePayload;
  const progress=voice.taraInterview as unknown as TaraProgress|null;
  const notes=progress?taraInterviewReport(progress,taraTopics(plan,rubric,Boolean(progress.policyVersion))):undefined;
  return evaluateTakaInterview(this.db,this.client,workId,voice.session,voice.session.invitation,
   frozenTakaInterview(voice.session.invitation.snapshot,(voice.session.package.promptSnapshot as unknown as PromptRegistry)?.takaInterview),
   plan,liveTakaTurns(turns,voice.startedAt,voice.transcriptComplete,notes),{
    owner,notes,rubric,
    interrupted:!['TIME_LIMIT','TARA_FINISHED','CANDIDATE_ENDED'].includes(voice.closeReason??'')||!voice.transcriptComplete,
    voice:{closeReason:voice.closeReason,transcriptComplete:voice.transcriptComplete,
     durationSeconds:Math.max(0,Math.round(((voice.endedAt?.getTime()??+voice.startedAt)-+voice.startedAt)/1000))},
   });
 }
}
