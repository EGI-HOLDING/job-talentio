'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { api,getSession,getToken } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useScreeningFocus } from './ApplicationPresentation';
import type { Preparation } from './TaraPreparation';
import { loadTaraTurnPlayback, taraTurnPlayback } from './tara-turn-playback';
import s from './VoiceInterview.module.css';
type Turn={id:string;speaker:string;text:string;startMs:number;endMs:number};
type LiveState={id:string;status:string;startedAt:string;endedAt:string|null;serverNow:string;warningAt:string|null;closingAt:string|null;closeReason:string|null;transcriptComplete:boolean;error:string|null;transcript?:Turn[];voiceMode?:string;clockRunning?:boolean;deadlineAt?:string};
type PreparationResponse={preparation?:Preparation;preparationStatus?:string;packetReady:boolean;error:string|null;recoveryRequired?:boolean};
const finished=(state:LiveState|null)=>Boolean(state&&['ENDED','FAILED','CREATE_UNCERTAIN'].includes(state.status));
const technicalClose=['AUDIO_UNAVAILABLE','CONNECTION_FAILED','CONNECTION_LOST','TRANSCRIPT_CONNECTION_LOST','CANDIDATE_DISCONNECTED','PROVIDER_ERROR','SERVER_RESTART'];
const time=(seconds:number)=>`${Math.floor(Math.max(0,seconds)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,seconds)%60).toString().padStart(2,'0')}`;
const audioUnavailable='Suara Tara belum terdengar. Periksa output audio dan volume, lalu aktifkan suara.';
async function checkAudio<T>(pending:Promise<T>,ms:number,message:string):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}
 finally{clearTimeout(timer);}
}
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
 const audioContext=useRef<AudioContext|null>(null),stopMeter=useRef<(()=>void)|null>(null);
 const playback=useRef<ReturnType<typeof taraTurnPlayback>|null>(null);
 const recoverAudio=useRef<()=>void>(()=>{}),volumeRef=useRef(1),audioDeadline=useRef(false);
 const [audioIssue,setAudioIssue]=useState('');
 const [captionEvent,setCaptionEvent]=useState('');
 const reportCaption=useRef<(eventId:string)=>void>(()=>{});
 const pc=useRef<RTCPeerConnection|null>(null),stream=useRef<MediaStream|null>(null),remoteSink=useRef<HTMLAudioElement|null>(null),clientId=useRef(''),offset=useRef(0),live=useRef(false),captionSpeaker=useRef(''),startLock=useRef(false),panel=useRef<HTMLDivElement>(null),endDialog=useRef<HTMLDialogElement>(null),settingsDialog=useRef<HTMLDialogElement>(null),helpDialog=useRef<HTMLDialogElement>(null);
 const name=getSession()?.user.fullName??'Kamu',initials=name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();
 const base='/ai-screening/sessions/'+sessionId,voice=base+'/voice';
 function cleanup(){if(disconnectTimer.current)clearTimeout(disconnectTimer.current);disconnectTimer.current=null;if(pc.current){pc.current.onconnectionstatechange=null;pc.current.ontrack=null;}live.current=false;recoverAudio.current=()=>{};reportCaption.current=()=>{};stopMeter.current?.();stopMeter.current=null;playback.current?.dispose();playback.current=null;if(audioContext.current){audioContext.current.onstatechange=null;void audioContext.current.close().catch(()=>undefined);}audioContext.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;pc.current?.close();pc.current=null;if(remoteSink.current){remoteSink.current.pause();remoteSink.current.srcObject=null;}setAudioIssue('');setConnected(false);setSpeaking(false);}
 function apply(value:LiveState|null){
  const prior=latest.current;
  if(prior&&(!value||prior.id===value.id&&!finished(value)&&
   (finished(prior)||Date.parse(value.serverNow)<Date.parse(prior.serverNow)||prior.clockRunning===true&&value.clockRunning===false)))return;
  latest.current=value;setState(value);
  if(value){if(value.error)setError(value.error);offset.current=Date.parse(value.serverNow)-Date.now();if(finished(value)){cleanup();setError(value.error??'');}}
 }
 useEffect(()=>{
  const version=++generation.current;
  startLock.current=false;latest.current=null;audioDeadline.current=false;setAudioIssue('');setCaption('');setCaptionEvent('');captionSpeaker.current='';
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
   if(readingVoice||finished(latest.current))return;
   readingVoice=true;
   void api<LiveState|null>(voice,{cacheMode:'no-store'}).then(value=>{
    if(version===generation.current)apply(value);
   }).catch(e=>{
    if(version===generation.current&&latest.current)setError(e instanceof Error?e.message:'Status sesi suara belum bisa diperiksa.');
   }).finally(()=>{readingVoice=false;});
  }
  refreshPreparation.current=loadPreparation;
  load();
  const timer=setInterval(load,2000);
  return()=>{generation.current++;clearInterval(timer);cleanup();};
 },[sessionId]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()+offset.current),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!state||finished(state))return;const version=generation.current;const timer=setInterval(()=>{if(!live.current)return;void api<LiveState>(voice+'/heartbeat',{method:'POST',body:JSON.stringify({clientId:clientId.current})}).then(value=>{if(version===generation.current)apply(value);}).catch(e=>{if(version===generation.current)setError(e.message);});},8000);return()=>clearInterval(timer);},[state?.id,state?.status,sessionId]);
 useEffect(()=>{const wasSilent=volumeRef.current===0;volumeRef.current=volume;if(!audioDeadline.current)playback.current?.setVolume(volume);if(wasSilent&&volume>0&&live.current)recoverAudio.current();},[volume]);
 useEffect(()=>{
  if(!connected||!captions||!captionEvent)return;
  const timer=setTimeout(()=>{if(document.visibilityState==='visible')reportCaption.current(captionEvent);},650);
  return()=>clearTimeout(timer);
 },[connected,captions,captionEvent]);
 useEffect(()=>{
  if(!state?.deadlineAt||finished(state))return;
  const timer=setTimeout(()=>{audioDeadline.current=true;playback.current?.setVolume(0);stream.current?.getAudioTracks().forEach(track=>{track.enabled=false;});},
   Math.max(0,Date.parse(state.deadlineAt)-Date.now()-offset.current));
  return()=>clearTimeout(timer);
 },[state?.deadlineAt,state?.status]);
 useEffect(()=>{if(confirmEnd)endDialog.current?.showModal();},[confirmEnd]);useEffect(()=>{if(settings)settingsDialog.current?.showModal();},[settings]);useEffect(()=>{if(help)helpDialog.current?.showModal();},[help]);
 useEffect(()=>{function leaving(){if(!live.current)return;void fetch((process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000')+'/api'+voice+'/end',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json',Authorization:'Bearer '+getToken()},body:JSON.stringify({clientId:clientId.current,reason:'CANDIDATE_LEFT'})});}function warn(e:BeforeUnloadEvent){if(live.current){e.preventDefault();e.returnValue='';}}window.addEventListener('pagehide',leaving);window.addEventListener('beforeunload',warn);return()=>{window.removeEventListener('pagehide',leaving);window.removeEventListener('beforeunload',warn);};},[sessionId]);
 async function start(){
  if(startLock.current||!ready)return;const version=generation.current,owner=clientId.current;let media:MediaStream|null=null,peer:RTCPeerConnection|null=null;startLock.current=true;setBusy(true);setError('');setJoiningStep('Mengaktifkan mikrofon\u2026');
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof AudioContext==='undefined')throw Error('Buka melalui HTTPS dan gunakan browser yang mendukung mikrofon.');
   const context=new AudioContext();
   audioContext.current=context;
   const resume=context.resume();
   void resume.catch(()=>undefined);
   media=await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true}:{echoCancellation:true,noiseSuppression:true}});if(version!==generation.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;setDevices((await navigator.mediaDevices.enumerateDevices().catch(()=>[])).filter(d=>d.kind==='audioinput'));if(version!==generation.current)return;setJoiningStep('Menghubungkan ke Tara\u2026');
   if(!remoteSink.current||!context.audioWorklet)throw Error('Browser ini belum mendukung pemutar suara Tara. Buka interview di browser yang sudah diperbarui.');
   const sink=remoteSink.current;
   const playbackError='Pemutar suara Tara belum siap. Periksa output audio, lalu coba gabung lagi.';
   await checkAudio(Promise.all([resume,loadTaraTurnPlayback(context)]),5000,playbackError);
   if(version!==generation.current)return;
   peer=new RTCPeerConnection();const connection=peer;pc.current=connection;media.getTracks().forEach(track=>connection.addTrack(track,media!));
   const current=()=>version===generation.current&&live.current&&pc.current===connection;
   let sequence=0,readyToReport=false,transportReady=false,activating=false;
   let remoteTrack:MediaStreamTrack|undefined;
   let sending=Promise.resolve();
   function report(event:'READY'|'AUDIBLE'|'QUIET'|'INTERRUPTED'|'TEXT_SHOWN'|'OUTPUT_DROPPED'|'REPLAY',at=performance.now(),transcriptEventId?:string){
    const next=++sequence;
    const request=sending.then(async()=>{
     if(!current())return;
     const state=await api<LiveState>(voice+'/media',{method:'POST',body:JSON.stringify({
      clientId:owner,event,sequence:next,delayMs:Math.min(2500,Math.max(0,Math.round(performance.now()-at))),transcriptEventId,
     }),signal:AbortSignal.timeout(4000)});
     if(current())apply(state);
    });
    sending=request.catch(()=>undefined);
    return request;
   }
   let droppedAt=-Infinity,playbackFailed=false;
   function createPlayer(){
    playbackFailed=false;
    const player=taraTurnPlayback(context,()=>{
     const at=performance.now();
     if(readyToReport&&at-droppedAt>=1200){droppedAt=at;void report('OUTPUT_DROPPED',at).catch(()=>undefined);}
    },()=>{
     playbackFailed=true;
     if(current())setAudioIssue(audioUnavailable);
    });
    playback.current=player;
    if(stream.current)player.setMicrophone(stream.current);
    if(remoteTrack)player.setRemote(remoteTrack);
    return player;
   }
   let playerOutput=createPlayer();
   await checkAudio(playerOutput.ready,4000,playbackError);
   if(version!==generation.current)return;
   if(playbackFailed||context.state!=='running')throw Error(playbackError);

   let openingTimer:ReturnType<typeof setTimeout>|undefined;
   const outputReady=()=>context.state==='running'&&remoteTrack?.readyState==='live'&&!sink.paused&&!audioDeadline.current;
   function expectSound(){
    clearTimeout(openingTimer);
    openingTimer=setTimeout(()=>{if(current())setAudioIssue(audioUnavailable);},7500);
   }
   async function activateAudio(replay=false){
    if(!current()||!transportReady||audioDeadline.current||activating)return;
    if(!remoteTrack){setAudioIssue(audioUnavailable);return;}
    if(volumeRef.current===0){setAudioIssue('Volume Tara sedang nol. Naikkan volume di Pengaturan audio.');return;}
    activating=true;
    try{
     const resumed=context.resume();
     void resumed.catch(()=>undefined);
     // Start the muted receiver immediately. Its play promise can wait for
     // the first RTP packet, which Tara may only send after READY.
     const receiving=sink.play();
     void receiving.catch(()=>{if(current())setAudioIssue(audioUnavailable);});
     if(playbackFailed){
      playerOutput.dispose();
      playerOutput=createPlayer();
     }
     await checkAudio(Promise.all([resumed,playerOutput.ready,sink.paused?receiving:undefined]),4000,audioUnavailable);
     if(!current()||audioDeadline.current)return;
     if(!outputReady()||playbackFailed)throw Error(audioUnavailable);
     playerOutput.setVolume(volumeRef.current);
     setAudioIssue('');
     if(!readyToReport){
      readyToReport=true;expectSound();
      try{await report('READY');}catch(error){readyToReport=false;throw error;}
     }else if(replay){
      expectSound();
      await report('REPLAY');
     }
    }catch{if(current())setAudioIssue(audioUnavailable);}
    finally{activating=false;}
   }
   recoverAudio.current=()=>void activateAudio(true);
   context.onstatechange=()=>{if(current()&&context.state!=='running')setAudioIssue(audioUnavailable);};
   reportCaption.current=eventId=>{if(readyToReport)void report('TEXT_SHOWN',performance.now(),eventId).catch(()=>undefined);};
   peer.ontrack=event=>{
    if(!current()||event.track.kind!=='audio'||remoteTrack===event.track)return;
    remoteTrack=event.track;
    sink.muted=true;
    sink.srcObject=new MediaStream([remoteTrack]);
    playerOutput.setRemote(remoteTrack);
    remoteTrack.addEventListener('ended',()=>{if(current()&&remoteTrack===event.track)setAudioIssue(audioUnavailable);},{once:true});
    if(transportReady)void activateAudio(readyToReport);
   };
   const sample=new Float32Array(playerOutput.analyser.fftSize);
   let heard=false,lastSound=0,consecutive=0;
   const meter=setInterval(()=>{
    if(!readyToReport)return;
    if(connection.connectionState!=='connected'||!outputReady()||volumeRef.current===0||remoteTrack?.muted||playbackFailed){
     if(heard){heard=false;setSpeaking(false);void report('INTERRUPTED').catch(()=>undefined);}
     consecutive=0;return;
    }
    playerOutput.analyser.getFloatTimeDomainData(sample);
    const rms=Math.sqrt(sample.reduce((sum,value)=>sum+value*value,0)/sample.length);
    const now=performance.now();
    if(rms*volumeRef.current>=0.0025){
     lastSound=now;
     if(++consecutive>=2&&!heard){
      heard=true;clearTimeout(openingTimer);setAudioIssue('');setSpeaking(true);
      void report('AUDIBLE',now-40).catch(()=>undefined);
     }
    }else{
     consecutive=0;
     if(heard&&now-lastSound>=500){heard=false;setSpeaking(false);void report('QUIET',lastSound+100).catch(()=>undefined);}
    }
   },40);
   stopMeter.current=()=>{clearInterval(meter);clearTimeout(openingTimer);};
   peer.onconnectionstatechange=()=>{
    if(version!==generation.current)return;
    const status=connection.connectionState;setConnected(status==='connected');
    if(status==='connected'){if(disconnectTimer.current){clearTimeout(disconnectTimer.current);void activateAudio();}disconnectTimer.current=null;setError('');return;}
    if(!live.current||!['failed','disconnected'].includes(status))return;
    setError('Koneksi terputus sementara. Sedang mencoba tersambung kembali; percakapan tetap tersimpan.');
    if(!disconnectTimer.current)disconnectTimer.current=setTimeout(()=>{
     disconnectTimer.current=null;if(version!==generation.current||!live.current||connection.connectionState==='connected')return;
     void api<LiveState>(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,reason:'CONNECTION_LOST'})}).then(value=>{if(version===generation.current)apply(value);}).catch(()=>{if(version===generation.current)setError('Koneksi belum pulih. Percakapan tetap tersimpan; server akan menutup sesi yang terputus.');}).finally(()=>{if(version===generation.current)cleanup();});
    },20_000);
   };
   const channel=peer.createDataChannel('live-events');
   channel.onmessage=message=>{try{
    const event=JSON.parse(message.data);
    if(event.type==='session.closed'){setConnected(false);return;}
    if(event.type==='session.output_transcript.delta'&&typeof event.delta==='string'){
     const continuing=captionSpeaker.current==='TARA';
     setCaption(previous=>((continuing?previous:'')+event.delta).slice(-600));
     if(typeof event.event_id==='string')setCaptionEvent(event.event_id);
     captionSpeaker.current='TARA';
    }else if(event.type==='session.input_transcript.delta')captionSpeaker.current='CANDIDATE';
   }catch{/* The server keeps the durable transcript. */}};
   await peer.setLocalDescription(await peer.createOffer());
   if(peer.iceGatheringState!=='complete')await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1500);connection.addEventListener('icegatheringstatechange',()=>{if(connection.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
   const response=await api<LiveState&{sdp:string}>(voice,{method:'POST',body:JSON.stringify({clientId:owner,sdp:peer.localDescription?.sdp})});if(version!==generation.current){await api(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,reason:'CONNECTION_FAILED'})}).catch(()=>undefined);media.getTracks().forEach(t=>t.stop());peer.close();return;}apply(response);live.current=true;
   await peer.setRemoteDescription({type:'answer',sdp:response.sdp});
   await waitForConnection(peer);
   if(current()){
    transportReady=true;expectSound();
    if(remoteTrack)void activateAudio();
   }
  }catch(e){if(version!==generation.current){media?.getTracks().forEach(t=>t.stop());peer?.close();return;}setError(microphoneError(e));if(live.current)await api(voice+'/end',{method:'POST',body:JSON.stringify({clientId:owner,reason:'CONNECTION_FAILED'})}).catch(()=>undefined);cleanup();}finally{if(version===generation.current){startLock.current=false;setBusy(false);}}
 }
 async function end(){if(busy)return;setBusy(true);setError('');try{apply(await api<LiveState>(voice+'/end',{method:'POST',body:JSON.stringify({clientId:clientId.current})}));setConfirmEnd(false);cleanup();}catch(e){setError(e instanceof Error?e.message:'Penutupan sedang dicoba ulang.');}finally{setBusy(false);}}
 async function changeDevice(id:string){const version=generation.current;setDeviceId(id);if(!live.current)return;try{const media=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:id},echoCancellation:true,noiseSuppression:true}});if(version!==generation.current){media.getTracks().forEach(t=>t.stop());return;}const track=media.getAudioTracks()[0];track.enabled=!muted;await pc.current?.getSenders().find(sender=>sender.track?.kind==='audio')?.replaceTrack(track);if(version!==generation.current){media.getTracks().forEach(t=>t.stop());return;}playback.current?.setMicrophone(media);stream.current?.getTracks().forEach(t=>t.stop());stream.current=media;}catch{setError('Mikrofon belum bisa diganti. Periksa izin browser.');}}
 function toggleMic(){const next=!muted;setMuted(next);stream.current?.getAudioTracks().forEach(track=>{track.enabled=!next;});}
 const ended=finished(state),started=Boolean(state),showPrejoin=!ended&&!connected,stranded=started&&!live.current&&!busy,remaining=state&&state.clockRunning!==false?Math.max(0,900-Math.floor(Math.max(0,(state.endedAt?Date.parse(state.endedAt):now)-Date.parse(state.startedAt))/1000)):900;
 const needsCv=preparation?.status==='WAITING_CV'||preparation?.reason==='CV_UNREADABLE';
 const needsHelp=preparation?.reason==='RECOVERY_REQUIRED';
 const preparationFailed=preparation?.status==='FAILED';
 const preparationMessage=needsCv?'CV undangan ini belum tersedia atau belum bisa dibaca. Hubungi HR untuk memperbarui berkasnya.':
  needsHelp?'Progresmu tersimpan. Periksa status atau hubungi HR jika interview masih belum bisa dimulai.':preparationError;
 return <div className={s.meeting} ref={panel}><audio ref={remoteSink} muted hidden aria-hidden="true"/><header className={s.header}><img src="/brand/talentio-logo-white.webp" alt="Talentio" className={s.logo}/><div className={s.heading}><h1>{uiCopy("Interview bersama Tara")}</h1><p>{jobTitle} &#xb7; {companyName}</p></div><span className={s.recording}><Icon name="transcript"/>{connected?'Transkripsi aktif':ended?'Transkrip tersimpan':'Transkripsi otomatis'}</span><span className={s.connection}><i className={connected?s.online:''}/>{connected?'Terhubung':ended?'Selesai':started?'Menghubungkan':'Siap bergabung'}</span><span className={s.clock}><Icon name="clock"/>Sisa <strong>{time(remaining)}</strong></span><button className={s.expand} type="button" aria-label={uiCopy("Layar penuh")} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void panel.current?.requestFullscreen();}}><Icon name="expand"/></button></header>
 <div className={s.content}><main className={`${s.stage} ${speaking?s.activeSpeaker:''}`}><div className={s.persona}><img src="/images/hr-onboarding/generated/tara-interviewer.webp" alt="Tara, asisten interview AI"/><div className={s.speaking}><span className={speaking?s.wave:s.waveIdle}>{[0,1,2,3,4].map(i=><i key={i} style={{animationDelay:`${i*110}ms`}}/>)}</span>{speaking?'Sedang berbicara':connected?'Mendengarkan':ended?'Interview selesai':'Tara'}</div></div>
 {showPrejoin&&<div className={s.prejoin} aria-busy={busy||checking}><h2>{busy?joiningStep:stranded?'Sesi interview sudah dimulai':started?'Koneksi suara terputus':'Siap ngobrol bersama Tara?'}</h2><p>{stranded?'Lanjutkan di tab yang masih terhubung. Jika tab itu sudah tertutup, kamu bisa mengakhiri sesi di bawah; percakapan yang tersedia tetap tersimpan untuk HR.':started&&!busy?'Periksa jaringan. Percakapan yang tersedia tetap tersimpan. Kamu bisa mengakhiri sesi melalui tombol Akhiri.':'Siapkan mikrofon dan tempat yang nyaman. Percakapan direkap untuk evaluasi HR. Sesi maksimal 15 menit.'}</p>
  {(error||!started&&preparationMessage)&&<div className={s.joinError} role="alert">{error||preparationMessage}</div>}
  {(!started||busy)&&(preparationFailed||needsCv||!preparation&&preparationError?
   <button type="button" disabled={checking} onClick={()=>void refreshPreparation.current(preparationFailed&&!needsHelp&&!needsCv)}>
    {checking?'Memeriksa status…':preparationFailed&&!needsHelp&&!needsCv?'Coba pulihkan':'Periksa status'}
   </button>:
   <button type="button" disabled={!ready||busy} onClick={()=>void start()}>
    {busy?joiningStep:!preparation?'Memuat sesi…':!ready?'Tara menyiapkan interview…':error?'Coba gabung lagi':'Gabung interview'}
   </button>)}
 </div>}
 {ended&&<div className={s.prejoin}><h2>{uiCopy("Terima kasih sudah berbagi")}</h2><p>{state?.closeReason==='CANDIDATE_ENDED'?'Kamu mengakhiri interview lebih awal. Hasil diberikan berdasarkan percakapan yang tersedia.':state?.closeReason==='AUDIO_UNAVAILABLE'?'Interview berakhir karena suara Tara tidak berhasil diputar. Percakapan yang tersedia disimpan untuk ditinjau tim HR.':technicalClose.includes(state?.closeReason??'')?'Interview berakhir karena koneksi mengalami kendala. Percakapan yang tersedia disimpan untuk ditinjau tim HR.':'Percakapan yang tersedia telah disimpan untuk ditinjau tim HR.'}</p><a href={localeUrl(locale,'/messages')}>{uiCopy("Kembali ke Pesan Talentio")}</a></div>}
 <div className={s.taraLabel}><span>▥</span> Tara <small>AI</small></div>{captions&&started&&!ended&&caption&&<div className={s.caption}><strong>Tara</strong><p>{caption.slice(-260)}</p></div>}<div className={s.self}><span className={s.initials}>{initials}</span><div>{name.split(' ')[0]} (Anda)<span aria-label={muted?'Mikrofon nonaktif':'Mikrofon aktif'}><Icon name={muted?"mic-off":"mic"}/></span></div></div>
 {state?.warningAt&&!ended&&<p className={s.notice}>{state.closingAt?'Tara sedang menutup interview. Terima kasih sudah berbagi.':'Sisa 5 menit lagi. Tara akan segera menyelesaikan interview.'}</p>}
 </main>{transcript&&<aside className={s.transcript}><header><h2>Transkrip</h2><button aria-label={uiCopy("Tutup transkrip")} onClick={()=>setTranscript(false)}>×</button></header><small>{uiCopy("Tersimpan otomatis")}</small><div>{state?.transcript?.length?state.transcript.map(turn=><article key={turn.id}><strong>{turn.speaker==='TARA'?'Tara':'Kamu'}</strong><time>{time(turn.startMs/1000)}</time><p>{turn.text}</p></article>):<p>Transkrip akan muncul saat percakapan dimulai.</p>}</div></aside>}</div>
 {error&&!showPrejoin&&<div className={s.error} role="alert">{error}</div>}
 {audioIssue&&started&&!ended&&<div className={s.error} role="alert">{audioIssue} <button type="button" onClick={()=>recoverAudio.current()}>{uiCopy("Aktifkan suara")}</button></div>}
 <footer className={s.controls}><div className={s.footerNote}><strong>{uiCopy("Interview suara")}</strong><span>{uiCopy("Percakapan ditranskripsikan untuk evaluasi")}</span></div><div className={s.tools}><div><button disabled={!connected} aria-pressed={muted} aria-label={muted?'Aktifkan mikrofon':'Nonaktifkan mikrofon'} className={muted?s.muted:''} onClick={toggleMic}><Icon name={muted?"mic-off":"mic"}/></button><span>Mikrofon</span></div><div><button aria-label="Subtitle" aria-pressed={captions} className={captions?s.selected:''} onClick={()=>setCaptions(v=>!v)}><Icon name="cc"/></button><span>Subtitle</span></div><div><button aria-label="Transkrip" aria-pressed={transcript} className={transcript?s.selected:''} onClick={()=>setTranscript(v=>!v)}><Icon name="transcript"/></button><span>Transkrip</span></div><div><button aria-label={uiCopy("Pengaturan audio")} onClick={()=>setSettings(true)}><Icon name="settings"/></button><span>Pengaturan</span></div></div><button type="button" className={s.end} disabled={!started||ended||busy} onClick={()=>setConfirmEnd(true)}><Icon name="end"/>Akhiri</button><button type="button" className={s.help} onClick={()=>setHelp(true)}><Icon name="help"/>Bantuan</button></footer>
 {confirmEnd&&<dialog className={s.dialog} ref={endDialog} onCancel={()=>setConfirmEnd(false)}><h2>Akhiri interview?</h2><p>Jika berakhir lebih awal, HR akan menerima hasil berdasarkan percakapan yang sudah tersedia beserta keterangannya.</p><div><button disabled={busy} onClick={()=>setConfirmEnd(false)}>{uiCopy("Lanjut interview")}</button><button className={s.end} disabled={busy} onClick={()=>void end()}>{busy?'Menyimpan\u2026':'Akhiri interview'}</button></div></dialog>}
 {settings&&<dialog className={s.dialog} ref={settingsDialog} onCancel={()=>setSettings(false)}><h2>{uiCopy("Pengaturan audio")}</h2><label>Mikrofon<select value={deviceId} onChange={e=>void changeDevice(e.target.value)}><option value="">{uiCopy("Mikrofon default")}</option>{devices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.label||'Mikrofon'}</option>)}</select></label><label>{uiCopy("Volume Tara")}<input type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><p>Gunakan headset untuk mengurangi gema. Izinkan akses mikrofon melalui pengaturan browser.</p><button onClick={()=>setSettings(false)}>Selesai</button></dialog>}
 {help&&<dialog className={s.dialog} ref={helpDialog} onCancel={()=>setHelp(false)}><h2>{uiCopy("Bantuan interview")}</h2><p>Tara mendengar dan menjawab langsung melalui suara. Kamu bisa meminta pertanyaannya diperjelas atau diulang.</p><p>Pastikan mikrofon diizinkan dan jaringan stabil. Jika koneksi terputus, percakapan yang tersimpan tetap dapat ditinjau HR. Hubungi HR melalui Pesan Talentio untuk sesi baru.</p><button onClick={()=>setHelp(false)}>Mengerti</button></dialog>}
 </div>;
}
