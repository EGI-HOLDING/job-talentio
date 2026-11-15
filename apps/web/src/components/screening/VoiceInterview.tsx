'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { api,getSession,getToken } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useScreeningFocus } from './ApplicationPresentation';
import type { Preparation } from './TaraPreparation';
import { observeVoiceAudio, type AudioActivity } from './observe-voice-audio';
import s from './VoiceInterview.module.css';
type Turn={id:string;speaker:string;text:string;startMs:number;endMs:number};
type LiveState={id:string;status:string;startedAt:string;endedAt:string|null;serverNow:string;warningAt:string|null;closingAt:string|null;closeReason:string|null;transcriptComplete:boolean;error:string|null;transcript?:Turn[];voiceMode?:string;audioProtocol?:string;clockRunning?:boolean;deadlineAt?:string;connectionId?:string;connectionNumber?:number;remainingVoiceMs?:number;resumeUntil?:string;
 completion?:{status:'IN_PROGRESS'|'ASSESSING'|'RESUMABLE'|'REVIEW_REQUIRED'|'INTERRUPTED'|'COMPLETE';evidenceRevision:number;revision?:number;canResume:boolean;reason?:string}};
type PreparationResponse={preparation?:Preparation;preparationStatus?:string;packetReady:boolean;error:string|null;recoveryRequired?:boolean};
const finished=(state:LiveState|null)=>Boolean(state&&['ENDED','FAILED','CREATE_UNCERTAIN'].includes(state.status));
const terminalInterview=(state:LiveState|null)=>finished(state)&&(!state?.completion||['COMPLETE','INTERRUPTED'].includes(state.completion.status));
const technicalClose=['AUDIO_UNAVAILABLE','CONNECTION_FAILED','CONNECTION_LOST','TRANSCRIPT_CONNECTION_LOST','CANDIDATE_DISCONNECTED','PROVIDER_ERROR','SERVER_RESTART'];
const time=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
const audioUnavailable='Suara Tara belum terdengar. Periksa output audio dan volume, lalu aktifkan suara.';
const taraHasNotSpoken='Kalau Tara belum menyapa, coba bilang “Halo” lewat mikrofon.';
const closeConfirmationMs=6000;
type MediaSignal='READY'|'PLAYBACK_READY'|'AUDIBLE'|'QUIET'|'INTERRUPTED'|'INPUT_ACTIVE'|'INPUT_QUIET'|'MEDIA_LOST'|'PLAYER_BLOCKED'|'MEDIA_RESTORED';
function Icon({name}:{name:string}){
 if(name==='clock')return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
 return <span aria-hidden="true" className={s.controlIcon} data-icon={name}/>;
}
function microphoneError(error:unknown){
 const name=error instanceof Error?error.name:'';
 if(name==='NotAllowedError'||name==='PermissionDeniedError')return 'Akses mikrofon belum diizinkan. Klik ikon izin di bilah alamat browser, izinkan mikrofon, lalu coba gabung lagi.';
 if(name==='NotFoundError')return 'Mikrofon tidak ditemukan. Sambungkan mikrofon atau headset, lalu coba gabung lagi.';
 if(name==='NotReadableError')return 'Mikrofon belum bisa digunakan. Periksa sambungan atau aplikasi lain yang sedang memakai mikrofon, lalu coba lagi.';
 if(name==='OverconstrainedError')return 'Mikrofon yang dipilih tidak tersedia. Pilih mikrofon default melalui Pengaturan, lalu coba lagi.';
 return error instanceof Error?error.message:'Interview belum berhasil dimulai. Silakan coba lagi.';
}
async function waitForConnection(peer:RTCPeerConnection){
 if(peer.connectionState==='connected')return;
 await new Promise<void>((resolve,reject)=>{
  const done=(error?:Error)=>{clearTimeout(timer);peer.removeEventListener('connectionstatechange',changed);error?reject(error):resolve();};
  const changed=()=>{if(peer.connectionState==='connected')done();else if(['failed','closed'].includes(peer.connectionState))done(Error('Koneksi suara belum berhasil. Periksa jaringan dan coba kembali.'));};
  const timer=setTimeout(()=>done(Error('Koneksi suara terlalu lama. Periksa jaringan atau VPN, lalu hubungi HR jika masih terkendala.')),20_000);
  peer.addEventListener('connectionstatechange',changed);changed();
 });
}
export function VoiceInterview({sessionId,jobTitle,companyName}:{sessionId:string;jobTitle:string;companyName:string}){
 const uiCopy=useHrCopy();
 useScreeningFocus(true);const {locale}=useI18n();
 const [state,setState]=useState<LiveState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[connected,setConnected]=useState(false),[muted,setMuted]=useState(false),[captions,setCaptions]=useState(true),[transcript,setTranscript]=useState(false),[settings,setSettings]=useState(false),[confirmEnd,setConfirmEnd]=useState(false),[help,setHelp]=useState(false),[speaking,setSpeaking]=useState(false),[caption,setCaption]=useState(''),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[deviceId,setDeviceId]=useState(''),[volume,setVolume]=useState(1),[now,setNow]=useState(Date.now());
 const [preparation,setPreparation]=useState<Preparation|null>(null);
 const [preparationError,setPreparationError]=useState('');
 const [checking,setChecking]=useState(false);
 const refreshPreparation=useRef<(retry?:boolean)=>Promise<void>>(async()=>{});
 const ready=preparation?.status==='READY';
 const [joiningStep,setJoiningStep]=useState('Menghubungkan\u2026');
 const generation=useRef(0),disconnectTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const latest=useRef<LiveState|null>(null);
 const stopMeter=useRef<(()=>void)|null>(null);
 const recoverAudio=useRef<()=>void>(()=>{}),volumeRef=useRef(1),audioStopped=useRef(false);
 const providerEvents=useRef<RTCDataChannel|null>(null);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [localClosure,setLocalClosure]=useState<'DEADLINE'|'UNCONFIRMED'|'PROVIDER_CLOSED'|null>(null);
 const [audioIssue,setAudioIssue]=useState('');
 const [openingHint,setOpeningHint]=useState(false);
 const pc=useRef<RTCPeerConnection|null>(null),stream=useRef<MediaStream|null>(null),remoteSink=useRef<HTMLAudioElement|null>(null),clientId=useRef(''),offset=useRef(0),live=useRef(false),captionSpeaker=useRef(''),startLock=useRef(false),reportReady=useRef<()=>void>(()=>{}),panel=useRef<HTMLDivElement>(null),endDialog=useRef<HTMLDialogElement>(null),settingsDialog=useRef<HTMLDialogElement>(null),helpDialog=useRef<HTMLDialogElement>(null);
 const name=getSession()?.user.fullName??'Kamu',initials=name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();
 const base='/ai-screening/sessions/'+sessionId,voice=base+'/voice';
 function stopLocalAudio(){
  stopMeter.current?.();stopMeter.current=null;
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  remoteSink.current?.pause();
 }
 function cleanup(){
  if(disconnectTimer.current)clearTimeout(disconnectTimer.current);
  if(closeTimer.current)clearTimeout(closeTimer.current);
  disconnectTimer.current=null;closeTimer.current=null;
  if(pc.current){pc.current.onconnectionstatechange=null;pc.current.ontrack=null;}
  live.current=false;recoverAudio.current=()=>{};reportReady.current=()=>{};
  stopLocalAudio();
  providerEvents.current=null;pc.current?.close();pc.current=null;
  if(remoteSink.current)remoteSink.current.srcObject=null;
  setAudioIssue('');setOpeningHint(false);setConnected(false);setSpeaking(false);
 }
 function apply(value:LiveState|null){
  const prior=latest.current;
  const revision=value?.completion?.revision??0,priorRevision=prior?.completion?.revision??0;
  const olderConnection=(value?.connectionNumber??0)<(prior?.connectionNumber??0);
  // A rejected reservation can restore an earlier connection on a newer session revision.
  const rolledBack=prior?.status==='CREATING'&&(!value||olderConnection&&revision>priorRevision&&finished(value));
  if(prior&&value&&(!rolledBack&&olderConnection||
   (value.completion?.evidenceRevision??0)<(prior.completion?.evidenceRevision??0)||
   revision<priorRevision||
   Date.parse(value.serverNow)<Date.parse(prior.serverNow)))return;
  if(prior&&(!value&&!rolledBack||value&&prior.id===value.id&&!finished(value)&&
   (finished(prior)||Date.parse(value.serverNow)<Date.parse(prior.serverNow)||prior.clockRunning===true&&value.clockRunning===false)))return;
  const next=value&&prior&&!value.transcript?{...value,transcript:prior.transcript}:value;
  latest.current=next;setState(next);
  if(value){
   if(value.error&&!startLock.current)setError(value.error);
   offset.current=Date.parse(value.serverNow)-Date.now();
   if(value.status==='CLOSING'&&prior?.status!=='CLOSING'){
    remoteSink.current?.pause();
    stream.current?.getAudioTracks().forEach(track=>{track.enabled=false;});
   }
   if(finished(value)&&(!finished(prior)||prior?.id!==value.id)){cleanup();if(!rolledBack||value.error)setError(value.error??'');}
  }
 }
 useEffect(()=>{
  const version=++generation.current;
  startLock.current=false;latest.current=null;audioStopped.current=false;setLocalClosure(null);
  setAudioIssue('');setCaption('');captionSpeaker.current='';
  setBusy(false);setState(null);setPreparation(null);setPreparationError('');setChecking(false);setError('');
  const storageKey='voice-client:'+sessionId;
  clientId.current=sessionStorage.getItem(storageKey)??crypto.randomUUID();
  sessionStorage.setItem(storageKey,clientId.current);
  let pending:Promise<void>|null=null,readingVoice=false;
  async function loadPreparation(retry=false){
   if(retry){
    await pending;
    if(version!==generation.current||pending)return;
   }else if(pending)return pending;
   pending=(async()=>{
    if(retry)setChecking(true);
    try{
     const row=await api<PreparationResponse>(retry?base+'/retry':base,retry?{method:'POST',body:'{}'}:{cacheMode:'no-store'});
     if(version!==generation.current)return;
     const next=row.preparation??{status:row.packetReady?'READY':row.preparationStatus==='FAILED'?'FAILED':'PROCESSING',planId:null,
      reason:row.recoveryRequired?'RECOVERY_REQUIRED':null};
     setPreparation(next);
     setPreparationError(next.status==='FAILED'?(row.error??'Tara belum bisa menyiapkan interview.'): '');
    }catch(e){
     if(version===generation.current)setPreparationError(e instanceof Error?e.message:'Status interview belum bisa diperiksa.');
    }finally{if(version===generation.current&&retry)setChecking(false);}
   })().finally(()=>{pending=null;});
   return pending;
  }
  function load(){
   if(!latest.current)void loadPreparation();
   if(readingVoice||terminalInterview(latest.current))return;
   readingVoice=true;
   void api<LiveState|null>(voice,{cacheMode:'no-store'}).then(value=>{
    if(version===generation.current)apply(value);
   }).catch(e=>{
    if(version===generation.current&&latest.current&&!audioStopped.current&&pc.current?.connectionState!=='connected')
     setError(e instanceof Error?e.message:'Status sesi suara belum bisa diperiksa.');
   }).finally(()=>{readingVoice=false;});
  }
  refreshPreparation.current=loadPreparation;
  load();
  const timer=setInterval(load,2000);
  return()=>{generation.current++;clearInterval(timer);cleanup();};
 },[sessionId]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()+offset.current),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!state||finished(state))return;
  const version=generation.current,connectionId=state.connectionId;
  const timer=setInterval(()=>{
   if(!live.current||audioStopped.current)return;
   reportReady.current();
   void api<LiveState>(voice+'/heartbeat',{method:'POST',body:JSON.stringify({
    clientId:clientId.current,connectionId,connected:pc.current?.connectionState==='connected',
   })}).then(value=>{if(version===generation.current)apply(value);}).catch(()=>undefined);
  },8000);
  return()=>clearInterval(timer);
 },[state?.id,state?.status,sessionId]);
 useEffect(()=>{volumeRef.current=volume;if(remoteSink.current&&!audioStopped.current)remoteSink.current.volume=volume;},[volume]);
 useEffect(()=>{
  if(!state?.deadlineAt||finished(state))return;
  const timer=setTimeout(()=>{
   if(latest.current?.id!==state.id||finished(latest.current)||audioStopped.current)return;
   audioStopped.current=true;
   if(disconnectTimer.current)clearTimeout(disconnectTimer.current);
   disconnectTimer.current=null;
   stopLocalAudio();
   setLocalClosure('DEADLINE');setConfirmEnd(false);setSettings(false);setConnected(false);setSpeaking(false);
   if(!pc.current)return;
   // Keep the data channel alive for the terminal receipt while local audio is stopped.
   closeTimer.current=setTimeout(()=>{cleanup();setLocalClosure('UNCONFIRMED');},closeConfirmationMs);
   const events=providerEvents.current;
   if(state.completion&&events?.readyState==='open'){
    try{events.send(JSON.stringify({type:'session.close'}));}catch{/* The server also requests closure. */}
   }
  },Math.max(0,Date.parse(state.deadlineAt)-Date.now()-offset.current));
  return()=>clearTimeout(timer);
 },[state?.id,state?.deadlineAt,state?.status,Boolean(state?.completion)]);
 useEffect(()=>{if(confirmEnd)endDialog.current?.showModal();},[confirmEnd]);useEffect(()=>{if(settings)settingsDialog.current?.showModal();},[settings]);useEffect(()=>{if(help)helpDialog.current?.showModal();},[help]);
 useEffect(()=>{function leaving(){if(!live.current||audioStopped.current)return;void fetch((process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000')+'/api'+voice+'/end',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',Authorization:'Bearer '+getToken()},body:JSON.stringify({clientId:clientId.current,connectionId:latest.current?.connectionId,reason:'CANDIDATE_LEFT'})}).catch(()=>undefined);}function warn(e:BeforeUnloadEvent){if(live.current&&!audioStopped.current){e.preventDefault();e.returnValue='';}}window.addEventListener('pagehide',leaving);window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('pagehide',leaving);window.removeEventListener('beforeunload',warn);};},[sessionId]);
 async function start(){
  if(startLock.current||!ready&&!latest.current?.completion?.canResume)return;
   const version=generation.current,owner=clientId.current,attemptKey=crypto.randomUUID();
  audioStopped.current=false;setLocalClosure(null);
  let media:MediaStream|null=null,peer:RTCPeerConnection|null=null,connectionId:string|undefined;
  startLock.current=true;setBusy(true);setError('');setCaption('');captionSpeaker.current='';setJoiningStep('Mengaktifkan mikrofon\u2026');
  try{
   if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined')
    throw Error('Buka melalui HTTPS dan gunakan browser yang mendukung mikrofon.');
   const sink=remoteSink.current;
   if (!sink) throw Error(audioUnavailable);
   const current=()=>version===generation.current&&live.current&&peer!==null&&pc.current===peer;
   let openingTimer:ReturnType<typeof setTimeout>|undefined;
   let audioStartCheck:ReturnType<typeof setTimeout>|undefined;
   // Resume the passive meter while the browser still has the join gesture.
   const audioObserver=observeVoiceAudio(sink,()=>stream.current,()=>current()&&peer?.connectionState==='connected',()=>true,observeActivity);
   stopMeter.current=()=>{audioObserver?.stop();clearTimeout(openingTimer);clearTimeout(audioStartCheck);};
   media=await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true}:{echoCancellation:true,noiseSuppression:true}});
   if(version!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
   stream.current=media;
   media.getAudioTracks().forEach(track=>{track.enabled=!muted;});
   void navigator.mediaDevices.enumerateDevices().then(list=>{
    if(version===generation.current)setDevices(list.filter(device=>device.kind==='audioinput'));
   }).catch(()=>undefined);
   setJoiningStep('Menghubungkan ke Tara\u2026');
   peer=new RTCPeerConnection();
   const connection=peer;
   pc.current=connection;
   media.getTracks().forEach(track=>connection.addTrack(track,media!));
   let sequence=0;
   let readyToReport=false;
   let playbackReadySent=false;
   let remoteTrack:MediaStreamTrack|undefined;
   let spokenText='';
   let taraHasSpoken=false;
   let sending=Promise.resolve();

   function report(event:MediaSignal,at=performance.now()){
    const next=++sequence;
    const request=sending.then(async()=>{
     if(!current()||audioStopped.current)return;
     const value=await api<LiveState>(voice+'/media',{method:'POST',body:JSON.stringify({
      clientId:owner,connectionId,event,sequence:next,delayMs:Math.min(2500,Math.max(0,Math.round(performance.now()-at))),
     }),signal:AbortSignal.timeout(4000)});
     if(current())apply(value);
    });
    sending=request.catch(()=>undefined);
    return request;
   }
   function ready(){
    if(!current()||readyToReport||connection.connectionState!=='connected')return;
    readyToReport=true;
    void report('READY').catch(()=>{readyToReport=false;});
   }
   reportReady.current=ready;
    function playbackReady(){
     if(!current()||audioStopped.current||sink?.paused||playbackReadySent)return;
    playbackReadySent=true;
    void report('PLAYBACK_READY').catch(()=>{playbackReadySent=false;});
   }
   const activateAudio=()=>{
    if(!current()||audioStopped.current||latest.current?.status==='CLOSING')return;
    if(!sink.srcObject){setAudioIssue(audioUnavailable);return;}
    const playing=sink.play();
    // A live track may not resolve play() until the first packets arrive.
    playbackReady();
    void playing.then(()=>{
     if(!current()||audioStopped.current)return;
     setAudioIssue('');
     playbackReady();
     clearTimeout(audioStartCheck);
     audioStartCheck=setTimeout(()=>{
      if(current()&&connection.connectionState==='connected'&&remoteTrack?.readyState==='live'&&!sink.paused&&
          sink.readyState<HTMLMediaElement.HAVE_CURRENT_DATA&&!taraHasSpoken)
       void sink.play().catch(()=>{if(current())setAudioIssue(audioUnavailable);});
     },1500);
     }).catch(()=>{if(current()&&!audioStopped.current){playbackReadySent=false;void report('PLAYER_BLOCKED').catch(()=>undefined);setAudioIssue(audioUnavailable);}});
   };
   recoverAudio.current=()=>{audioObserver?.resume();activateAudio();};
   peer.ontrack=event=>{
    if(!current()||audioStopped.current||event.track.kind!=='audio'||remoteTrack===event.track)return;
    const track=event.track;
    remoteTrack=track;
    sink.srcObject=new MediaStream([track]);
    sink.volume=volumeRef.current;
    track.addEventListener('ended',()=>{if(current()&&remoteTrack===track)setAudioIssue(audioUnavailable);},{once:true});
    activateAudio();
   };
   function observeActivity(activity: AudioActivity){
    if(!current())return;
    if(activity.source==='candidate'){
     void report(activity.active?'INPUT_ACTIVE':'INPUT_QUIET',activity.at).catch(()=>undefined);
     return;
    }
    setSpeaking(activity.active);
    if(activity.active){
     taraHasSpoken=true;
     clearTimeout(openingTimer);
     setAudioIssue('');
     setOpeningHint(false);
    }
    void report(activity.active?'AUDIBLE':activity.interrupted?'INTERRUPTED':'QUIET',activity.at).catch(()=>undefined);
   }
   peer.onconnectionstatechange=()=>{
    if(version!==generation.current||audioStopped.current)return;
    const status=connection.connectionState;setConnected(status==='connected');
     if(status==='connected'){if(disconnectTimer.current){clearTimeout(disconnectTimer.current);void activateAudio();void report('MEDIA_RESTORED').catch(()=>undefined);}disconnectTimer.current=null;ready();setError('');return;}
    if(!live.current||latest.current?.status==='CLOSING'||!['failed','disconnected'].includes(status))return;
     void report('MEDIA_LOST').catch(()=>undefined);
    setError('Koneksi terputus sementara. Sedang mencoba tersambung kembali; percakapan tetap tersimpan.');
    if(!disconnectTimer.current)disconnectTimer.current=setTimeout(()=>{
     disconnectTimer.current=null;if(version!==generation.current||!live.current||audioStopped.current||connection.connectionState==='connected')return;
     void api<LiveState>(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,connectionId,reason:'CONNECTION_LOST'})}).then(value=>{if(version===generation.current)apply(value);}).catch(()=>{if(version===generation.current)setError('Koneksi belum pulih. Percakapan tetap tersimpan; server akan menutup sesi yang terputus.');}).finally(()=>{if(version===generation.current&&pc.current===connection)cleanup();});
     },12_000);
   };
   const channel=peer.createDataChannel('live-events');
   providerEvents.current=channel;
   channel.onmessage=message=>{if(!current())return;try{
    const event=JSON.parse(message.data);
    if(event.type==='session.closed'){
     audioStopped.current=true;
     setLocalClosure(previous=>previous??'PROVIDER_CLOSED');
     setConfirmEnd(false);setSettings(false);
     cleanup();
     return;
    }
    if(event.type==='session.output_transcript.delta'&&typeof event.delta==='string'){
     const continuing=captionSpeaker.current==='TARA';
     spokenText=((continuing?spokenText:'')+event.delta).slice(-600);
     setCaption(spokenText);
     captionSpeaker.current='TARA';
    }else if(event.type==='session.input_transcript.delta')captionSpeaker.current='CANDIDATE';
   }catch{/* The server keeps the durable transcript. */}};
   await peer.setLocalDescription(await peer.createOffer());
   if(peer.iceGatheringState!=='complete')await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1500);connection.addEventListener('icegatheringstatechange',()=>{if(connection.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
    const response=await api<LiveState&{sdp:string}>(voice,{method:'POST',body:JSON.stringify({clientId:owner,sdp:peer.localDescription?.sdp,audioProtocol:TARA_LIVE_AUDIO_PROTOCOL,attemptKey})});
   connectionId=response.connectionId;
   if(version!==generation.current){await api(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,connectionId,reason:'CONNECTION_FAILED'})}).catch(()=>undefined);media.getTracks().forEach(t=>t.stop());peer.close();return;}live.current=true;apply(response);
   if(response.audioProtocol!==TARA_LIVE_AUDIO_PROTOCOL)throw Error('Muat ulang halaman setelah API Tara diperbarui.');
   await peer.setRemoteDescription({type:'answer',sdp:response.sdp});
   await waitForConnection(peer);
   if(current()){
    ready();
     openingTimer=setTimeout(()=>{
     if(!current()||taraHasSpoken)return;
     if(!remoteTrack||sink.paused)setAudioIssue(audioUnavailable);
     else setOpeningHint(true);
    },10000);
   }
  }catch(e){if(version!==generation.current){media?.getTracks().forEach(t=>t.stop());peer?.close();return;}if(audioStopped.current)return;setError(microphoneError(e));if(live.current)await api(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,connectionId,reason:'CONNECTION_FAILED'})}).catch(()=>undefined);cleanup();}finally{if(version===generation.current){startLock.current=false;setBusy(false);}}
 }
 async function end(reason:'CANDIDATE_ENDED'|'CANDIDATE_PAUSED'='CANDIDATE_ENDED'){if(busy||audioStopped.current||latest.current?.status==='CLOSING')return;setBusy(true);setError('');try{apply(await api<LiveState>(voice+'/end',{method:'POST',body:JSON.stringify({clientId:clientId.current,connectionId:latest.current?.connectionId,reason})}));setConfirmEnd(false);}catch(e){setError(e instanceof Error?e.message:'Penutupan sedang dicoba ulang.');}finally{setBusy(false);}}
 async function changeDevice(id:string){
  const version=generation.current,peer=pc.current;
  const active=()=>version===generation.current&&pc.current===peer&&live.current&&!audioStopped.current&&latest.current?.status!=='CLOSING';
  setDeviceId(id);
  if(!peer||!active())return;
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:id},echoCancellation:true,noiseSuppression:true}});
   const track=media.getAudioTracks()[0],sender=peer.getSenders().find(row=>row.track?.kind==='audio');
   if(!active()||!sender){media.getTracks().forEach(row=>row.stop());return;}
   track.enabled=!muted;
   await sender.replaceTrack(track).catch(error=>{track.stop();throw error;});
   if(!active()){track.stop();return;}
   stream.current?.getTracks().forEach(row=>row.stop());
   stream.current=media;
  }catch{if(active())setError('Mikrofon belum bisa diganti. Periksa izin browser.');}
 }
 function toggleMic(){if(audioStopped.current||latest.current?.status==='CLOSING')return;const next=!muted;setMuted(next);stream.current?.getAudioTracks().forEach(track=>{track.enabled=!next;});}
 const ended=finished(state),closing=!ended&&(state?.status==='CLOSING'||localClosure!==null);
 const started=Boolean(state),showPrejoin=!ended&&!closing&&!connected,stranded=started&&!live.current&&!busy;
   const completion=state?.completion,canResume=completion?.canResume&&(!state?.resumeUntil||Date.parse(state.resumeUntil)>now)&&
    (state?.remainingVoiceMs!==undefined||!state?.deadlineAt||Date.parse(state.deadlineAt)>now);
   const reachedDeadline=localClosure==='DEADLINE'||localClosure==='UNCONFIRMED';
   const remaining=(reachedDeadline&&!ended)||completion?.reason==='TIME_LIMIT'?0:ended&&state?.remainingVoiceMs!==undefined?Math.floor(state.remainingVoiceMs/1000):state?.deadlineAt?Math.max(0,Math.ceil((Date.parse(state.deadlineAt)-(terminalInterview(state)&&state.endedAt?Date.parse(state.endedAt):now))/1000)):
  state&&state.clockRunning!==false?Math.max(0,900-Math.floor(Math.max(0,(state.endedAt?Date.parse(state.endedAt):now)-Date.parse(state.startedAt))/1000)):900;
 const needsCv=preparation?.status==='WAITING_CV'||preparation?.reason==='CV_UNREADABLE';
 const needsHelp=preparation?.reason==='RECOVERY_REQUIRED';
 const preparationFailed=preparation?.status==='FAILED';
 const preparationMessage=needsCv?'CV undangan ini belum tersedia atau belum bisa dibaca. Hubungi HR untuk memperbarui berkasnya.':
  needsHelp?'Progresmu tersimpan. Periksa status atau hubungi HR jika interview masih belum bisa dimulai.':preparationError;
 return <div className={s.meeting} ref={panel}><audio ref={remoteSink} hidden aria-hidden="true"/><header className={s.header}><img src="/brand/talentio-logo-white.webp" alt="Talentio" className={s.logo}/><div className={s.heading}><h1>{uiCopy("Interview bersama Tara")}</h1><p>{jobTitle} &#xb7; {companyName}</p></div><span className={s.recording}><Icon name="transcript"/>{connected?'Transkripsi aktif':ended?'Transkrip tersimpan':'Transkripsi otomatis'}</span><span className={s.connection}><i className={connected?s.online:''}/>{connected?'Terhubung':ended?'Selesai':started?'Menghubungkan':'Siap bergabung'}</span><span className={s.clock}><Icon name="clock"/>Sisa <strong>{time(remaining)}</strong></span><button className={s.expand} type="button" aria-label={uiCopy("Layar penuh")} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void panel.current?.requestFullscreen();}}><Icon name="expand"/></button></header>
 <div className={s.content}><main className={`${s.stage} ${speaking?s.activeSpeaker:''}`}><div className={s.persona}><img src="/images/hr-onboarding/generated/tara-interviewer.webp" alt="Tara, asisten interview AI"/><div className={s.speaking}><span className={speaking?s.wave:s.waveIdle}>{[0,1,2,3,4].map(i=><i key={i} style={{animationDelay:`${i*110}ms`}}/>)}</span>{speaking?'Sedang berbicara':connected?'Mendengarkan':ended?'Interview selesai':'Tara'}</div></div>
 {showPrejoin&&<div className={s.prejoin} aria-busy={busy||checking}><h2>{busy?joiningStep:stranded?'Sesi interview sudah dimulai':started?'Koneksi suara terputus':'Siap ngobrol bersama Tara?'}</h2><p>{stranded?'Lanjutkan di tab yang masih terhubung. Jika tab itu sudah tertutup, kamu bisa mengakhiri sesi di bawah; percakapan yang tersedia tetap tersimpan untuk HR.':started&&!busy?'Periksa jaringan. Percakapan yang tersedia tetap tersimpan. Kamu bisa mengakhiri sesi melalui tombol Akhiri.':'Siapkan mikrofon dan tempat yang nyaman. Percakapan direkap untuk evaluasi HR. Sesi maksimal 15 menit.'}</p>
  {(error||!started&&preparationMessage)&&<div className={s.joinError} role="alert">{error||preparationMessage}</div>}
  {(!started||busy)&&(preparationFailed||needsCv||!preparation&&preparationError?
   <button type="button" disabled={checking} onClick={()=>void refreshPreparation.current(preparationFailed&&!needsHelp&&!needsCv)}>
    {checking?'Memeriksa status\u2026':preparationFailed&&!needsHelp&&!needsCv?'Coba pulihkan':'Periksa status'}
   </button>:
   <button type="button" disabled={!ready||busy} onClick={()=>void start()}>
    {busy?joiningStep:!preparation?'Memuat sesi\u2026':!ready?'Tara menyiapkan interview\u2026':error?'Coba gabung lagi':'Gabung interview'}
   </button>)}
 </div>}
 {closing&&<div className={s.prejoin} role="status"><h2>Menyimpan percakapan</h2><p>{localClosure==='UNCONFIRMED'?'Jatah waktu habis. Status penyimpanan sedang diperiksa.':'Tara sedang menyelesaikan koneksi suara.'}</p></div>}
 {ended&&completion&&<div className={s.prejoin} aria-busy={busy||completion.status==='ASSESSING'}>
  <h2>{canResume?'Lanjutkan wawancara':completion.status==='COMPLETE'?'Wawancara selesai':completion.status==='INTERRUPTED'?'Wawancara terhenti':
   completion.status==='REVIEW_REQUIRED'?'Penilaian perlu ditinjau':'Tara memeriksa bagian yang sudah dijawab'}</h2>
   <p>{canResume?'Jawabanmu tersimpan. Lanjutkan sekarang atau buka undangan ini lagi untuk meneruskan bagian yang tersisa.':
   completion.status==='INTERRUPTED'?'Percakapan yang tersimpan tersedia untuk HR.':'Jawabanmu telah tersimpan.'}</p>
  {canResume&&<><button type="button" disabled={busy} onClick={()=>void start()}>{busy?joiningStep:'Lanjutkan wawancara'}</button>
   {error&&<div className={s.joinError} role="alert">{error}</div>}</>}
  {(terminalInterview(state)||completion.status==='REVIEW_REQUIRED')&&<a href={localeUrl(locale,'/messages')}>{uiCopy("Kembali ke Pesan Talentio")}</a>}
 </div>}
 {ended&&!completion&&<div className={s.prejoin}><h2>{uiCopy("Terima kasih sudah berbagi")}</h2><p>{state?.closeReason==='CANDIDATE_ENDED'?'Kamu mengakhiri interview lebih awal. Hasil diberikan berdasarkan percakapan yang tersedia.':state?.closeReason==='AUDIO_UNAVAILABLE'?'Interview berakhir karena suara Tara tidak berhasil diputar. Percakapan yang tersedia disimpan untuk ditinjau tim HR.':technicalClose.includes(state?.closeReason??'')?'Interview berakhir karena koneksi mengalami kendala. Percakapan yang tersedia disimpan untuk ditinjau tim HR.':'Percakapan yang tersedia telah disimpan untuk ditinjau tim HR.'}</p><a href={localeUrl(locale,'/messages')}>{uiCopy("Kembali ke Pesan Talentio")}</a></div>}
 <div className={s.taraLabel}><span>▥</span> Tara <small>AI</small></div>{captions&&started&&!ended&&caption&&<div className={s.caption}><strong>Tara</strong><p>{caption.slice(-260)}</p></div>}<div className={s.self}><span className={s.initials}>{initials}</span><div>{name.split(' ')[0]} (Anda)<span aria-label={muted?'Mikrofon nonaktif':'Mikrofon aktif'}><Icon name={muted?"mic-off":"mic"}/></span></div></div>
 {state?.warningAt&&!ended&&<p className={s.notice}>{remaining<=60?'Sisa waktu kurang dari satu menit.':'Sisa waktu kurang dari lima menit.'}</p>}
 </main>{transcript&&<aside className={s.transcript}><header><h2>Transkrip</h2><button aria-label={uiCopy("Tutup transkrip")} onClick={()=>setTranscript(false)}>×</button></header><small>{uiCopy("Tersimpan otomatis")}</small><div>{state?.transcript?.length?state.transcript.map(turn=><article key={turn.id}><strong>{turn.speaker==='TARA'?'Tara':'Kamu'}</strong><time>{time(turn.startMs/1000)}</time><p>{turn.text}</p></article>):<p>Transkrip akan muncul saat percakapan dimulai.</p>}</div></aside>}</div>
 {error&&!showPrejoin&&!(ended&&canResume)&&<div className={s.error} role="alert">{error}</div>}
 {audioIssue&&started&&!ended&&<div className={s.error} role="alert">{audioIssue} <button type="button" onClick={()=>recoverAudio.current()}>{uiCopy("Aktifkan suara")}</button></div>}
 {openingHint&&!audioIssue&&connected&&<div className={s.error} role="status">{uiCopy(taraHasNotSpoken)}</div>}
 <footer className={s.controls}><div className={s.footerNote}><strong>{uiCopy("Interview suara")}</strong><span>{uiCopy("Percakapan ditranskripsikan untuk evaluasi")}</span></div><div className={s.tools}><div><button disabled={!connected} aria-pressed={muted} aria-label={muted?'Aktifkan mikrofon':'Nonaktifkan mikrofon'} className={muted?s.muted:''} onClick={toggleMic}><Icon name={muted?"mic-off":"mic"}/></button><span>Mikrofon</span></div><div><button aria-label="Subtitle" aria-pressed={captions} className={captions?s.selected:''} onClick={()=>setCaptions(v=>!v)}><Icon name="cc"/></button><span>Subtitle</span></div><div><button aria-label="Transkrip" aria-pressed={transcript} className={transcript?s.selected:''} onClick={()=>setTranscript(v=>!v)}><Icon name="transcript"/></button><span>Transkrip</span></div><div><button aria-label={uiCopy("Pengaturan audio")} onClick={()=>setSettings(true)}><Icon name="settings"/></button><span>Pengaturan</span></div></div><button type="button" className={s.end} disabled={!started||ended||busy} onClick={()=>setConfirmEnd(true)}><Icon name="end"/>Akhiri</button><button type="button" className={s.help} onClick={()=>setHelp(true)}><Icon name="help"/>Bantuan</button></footer>
 {confirmEnd&&<dialog className={s.dialog} ref={endDialog} onCancel={()=>setConfirmEnd(false)}><h2>Akhiri interview?</h2><p>{completion?'Jika masih ada topik tersisa, jeda untuk melanjutkan lewat undangan yang sama.':'Jika berakhir lebih awal, HR akan menerima hasil berdasarkan percakapan yang sudah tersedia beserta keterangannya.'}</p><div><button disabled={busy} onClick={()=>setConfirmEnd(false)}>{uiCopy("Lanjut interview")}</button>{completion&&remaining>=15&&<button disabled={busy} onClick={()=>void end('CANDIDATE_PAUSED')}>{uiCopy("Jeda wawancara")}</button>}<button className={s.end} disabled={busy} onClick={()=>void end()}>{busy?'Menyimpan\u2026':'Akhiri interview'}</button></div></dialog>}
 {settings&&<dialog className={s.dialog} ref={settingsDialog} onCancel={()=>setSettings(false)}><h2>{uiCopy("Pengaturan audio")}</h2><label>Mikrofon<select value={deviceId} onChange={e=>void changeDevice(e.target.value)}><option value="">{uiCopy("Mikrofon default")}</option>{devices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.label||'Mikrofon'}</option>)}</select></label><label>{uiCopy("Volume Tara")}<input type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><p>Gunakan headset untuk mengurangi gema. Izinkan akses mikrofon melalui pengaturan browser.</p><button onClick={()=>setSettings(false)}>Selesai</button></dialog>}
 {help&&<dialog className={s.dialog} ref={helpDialog} onCancel={()=>setHelp(false)}><h2>{uiCopy("Bantuan interview")}</h2><p>Tara mendengar dan menjawab langsung melalui suara. Kamu bisa meminta pertanyaannya diperjelas atau diulang.</p><p>Pastikan mikrofon diizinkan dan jaringan stabil. Jika suara terputus, buka kembali undangan untuk memeriksa apakah wawancara bisa dilanjutkan. Percakapan yang tersimpan tetap tersedia untuk HR.</p><button onClick={()=>setHelp(false)}>Mengerti</button></dialog>}
 </div>;
}
