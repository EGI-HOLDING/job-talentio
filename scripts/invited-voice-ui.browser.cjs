// Synthetic browser media + mocked API. No OpenAI calls, microphone capture or outbound invitations.
const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local browser only');
const alternative=process.env.TARA_BROWSER_ALTERNATIVE==='1';
const noTestAudio=process.env.TARA_BROWSER_SILENT_OPENING==='1';
const hardDeadline=process.env.TARA_BROWSER_HARD_DEADLINE;
assert.ok(!hardDeadline||['ack','timeout'].includes(hardDeadline));
const continuation=process.env.TARA_BROWSER_CONTINUATION==='1'||Boolean(hardDeadline);
const startupRollback=process.env.TARA_BROWSER_STARTUP_ROLLBACK==='1';
const strictAudioGesture=process.env.TARA_BROWSER_AUDIO_GESTURE==='1';
const out=path.resolve(process.env.TARA_BROWSER_OUT||(alternative?'output/invited-voice-ui-alternative':'output/invited-voice-ui-native'));fs.mkdirSync(out,{recursive:true});
const controlledQuestion=alternative?'Pernah ada proyek atau kegiatan yang berkaitan sama tanggung jawab utama posisi ini?':'Di proyek terakhir, bagian mana yang lu kerjakan sendiri?';
const auth={accessToken:'synthetic-voice-ui',user:{id:'voice-ui',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'dinda@example.test',emailVerified:true,phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}},token='voice-ui-token.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.TARA_PROBE_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}),context=await browser.newContext({viewport:{width:1672,height:941},permissions:['microphone'],reducedMotion:'reduce'}),report={errors:[],creates:0,ends:0,media:[],preparation:[]};let state=null,rejectProviderOnce=true,preparation='FAILED';
 let apiUnavailable=false,startupRevision=0;
 const microphoneReports=[];
 async function rejectStartup(route,headers,prior){
  if(startupRollback){
   const previousCount=report.creatingResponses??0;
   const connectionNumber=(prior?.connectionNumber??0)+1;
   state={...prior,id:'rejected-connection-'+connectionNumber,connectionNumber,status:'CREATING',
    startedAt:prior?.startedAt??new Date().toISOString(),serverNow:new Date().toISOString(),
    completion:{status:'IN_PROGRESS',revision:++startupRevision,evidenceRevision:prior?.completion?.evidenceRevision??0,canResume:false}};
   for(let attempt=0;attempt<60&&(report.creatingResponses??0)===previousCount;attempt++)
    await new Promise(resolve=>setTimeout(resolve,100));
   assert.ok((report.creatingResponses??0)>previousCount,'the browser polls the temporary reservation before it is released');
   await new Promise(resolve=>setTimeout(resolve,150));
   startupRevision++;
   state=prior?{...prior,completion:{...prior.completion,revision:startupRevision}}:null;
  }
  return route.fulfill({status:503,headers,json:{message:'Koneksi suara belum tersedia. Silakan coba lagi sebentar.'}});
 }
 try{
 await context.addInitScript(({auth,controlledQuestion,strictAudioGesture})=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));let audioAttempts=0; const play=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){if(!audioAttempts++){this.autoplay=false;return Promise.reject(new DOMException('synthetic speaker block','NotAllowedError'));} return play.call(this);};
 if(strictAudioGesture){
  let inClick=false;
  const NativeAudioContext=window.AudioContext;
  document.addEventListener('click',event=>{if(event.isTrusted){inClick=true;setTimeout(()=>{inClick=false;},0);}},true);
  window.AudioContext=class extends NativeAudioContext{
   createAnalyser(){window.mockVoiceMeter=this;this.voiceMeter=true;return super.createAnalyser();}
   get state(){return this.voiceMeter&&!this.gestureGranted&&super.state!=='closed'?'suspended':super.state;}
   resume(){
    if(this.voiceMeter&&!this.gestureGranted){
     if(!inClick)return new Promise(()=>{});
     this.gestureGranted=true;
    }
    return super.resume();
   }
  };
 }
 let mediaAttempts=0;navigator.mediaDevices.getUserMedia=async()=>{const errors=['NotAllowedError','NotFoundError','NotReadableError'];const failure=errors[mediaAttempts++];if(failure)throw new DOMException('synthetic microphone failure',failure);
 if(strictAudioGesture)await new Promise(resolve=>setTimeout(resolve,80));
 const ac=window.mockCandidateAudio?.context??new AudioContext(),osc=ac.createOscillator(),gain=ac.createGain(),destination=ac.createMediaStreamDestination();
 gain.gain.value=0;osc.connect(gain).connect(destination);osc.start();await ac.resume();
 destination.stream.getAudioTracks()[0].addEventListener('ended',()=>void ac.close());
 window.mockCandidateAudio={context:ac,gain,stream:destination.stream};return destination.stream;
 };class Peer{constructor(){window.mockVoicePeer=this;}connectionState='new';iceGatheringState='complete';localDescription=null;onconnectionstatechange=null;senders=[];addTrack(track){this.senders.push({track,replaceTrack:async()=>{}});}getSenders(){return this.senders;}
 createDataChannel(){const channel={readyState:'open',sent:[],onmessage:null,send(message){this.sent.push(JSON.parse(message));}};window.mockVoiceChannel=channel;return channel;}
 async createOffer(){return{type:'offer',sdp:'v=0 mocked browser voice offer'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();
 const ac=new AudioContext(),destination=ac.createMediaStreamDestination();
 window.mockRemoteAudio={context:ac,destination,play(){const osc=ac.createOscillator(),gain=ac.createGain();
  gain.gain.value=.06;osc.connect(gain).connect(destination);osc.start();osc.stop(ac.currentTime+1.3);}};
 const track=destination.stream.getAudioTracks()[0];
 this.ontrack?.({track,streams:[destination.stream]});
 setTimeout(()=>window.mockVoiceChannel.onmessage?.({data:JSON.stringify({type:'session.output_transcript.delta',delta:controlledQuestion})}),100);}close(){this.connectionState='closed';}addEventListener(){}}window.RTCPeerConnection=Peer;},{auth,controlledQuestion,strictAudioGesture});
 await context.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace(/^\/api/,''),method=req.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};if(method==='OPTIONS')return route.fulfill({status:204,headers});let body={};
 if(p==='/auth/me')body=auth;else if(p==='/profiles/me/onboarding')body={status:'COMPLETED',profile:{phone:auth.user.phone}};
 else if(p==='/recruitment/invitations/open/'+token)body={mode:'VOICE',status:'INVITED',jobTitle:'Machine Learning Engineer',companyName:'Lintas Awan Teknologi',expiresAt:'2026-12-01T00:00:00Z'};
 else if(p.startsWith('/recruitment/')&&p.endsWith('/claim'))body={mode:'VOICE',session:{id:'voice-session',job:{id:'job'}}};
 else if(p==='/ai-screening/sessions/voice-session'||p==='/ai-screening/sessions/voice-session/retry'){
  if(method==='POST')preparation='PROCESSING';
  body={packetReady:false,preparation:{status:preparation,planId:'synthetic-plan',reason:preparation==='FAILED'?'PREPARATION_FAILED':null},
   error:preparation==='PROCESSING'?null:'Gangguan persiapan sintetis.'};
  report.preparation.push(preparation);
  if(method==='POST')setTimeout(()=>{preparation='READY';},250);
 }
 else if(p==='/ai-screening/sessions/voice-session/voice'&&method==='POST'){
  report.creates++;assert.equal(req.postDataJSON().audioProtocol,'tara-live-direct-v1');
  if(rejectProviderOnce){rejectProviderOnce=false;return rejectStartup(route,headers,state);}
  const prior=state;
  const resumed=continuation&&prior?.completion?.status==='RESUMABLE';
  if(resumed&&startupRollback&&!report.resumeRejected){report.resumeRejected=true;return rejectStartup(route,headers,prior);}
  state={id:resumed?'voice-second':'voice',status:'ACTIVE',startedAt:prior?.startedAt??new Date().toISOString(),endedAt:null,serverNow:new Date().toISOString(),warningAt:null,closingAt:null,closeReason:null,transcriptComplete:false,error:null,transcript:prior?.transcript??[{id:'v1',speaker:'TARA',text:controlledQuestion,startMs:2000,endMs:4000},{id:'v2',speaker:'CANDIDATE',text:'Saya mengerjakan pipeline data dan evaluasi model.',startMs:5000,endMs:7000}]};
  Object.assign(state,{voiceMode:'NATIVE',audioProtocol:'tara-live-direct-v1',clockRunning:!!prior?.deadlineAt,deadlineAt:prior?.deadlineAt});
  if(continuation)Object.assign(state,{connectionId:state.id,connectionNumber:resumed?2:1,
   ...(resumed?{deadlineAt:new Date(Date.now()+prior.remainingVoiceMs).toISOString(),clockRunning:true,remainingVoiceMs:prior.remainingVoiceMs}:{}),
   completion:{status:'IN_PROGRESS',revision:startupRollback?++startupRevision:resumed?4:1,evidenceRevision:resumed?1:0,canResume:false}});
  body={...state,sdp:'v=0 mock answer'};
 }
 else if(p.endsWith('/voice/media')){
  const {event,sequence,connectionId,delayMs}=req.postDataJSON();report.media.push(event);assert.ok(sequence>0);
  if(event==='INPUT_ACTIVE'||event==='INPUT_QUIET')microphoneReports.push({event,delayMs});
  if(continuation)assert.equal(connectionId,state?.connectionId);
  if((event==='READY'||event==='AUDIBLE')&&!state.clockRunning){state.clockRunning=true;state.deadlineAt=new Date(Date.now()+900000).toISOString();}
  body={...state,serverNow:new Date().toISOString()};
 }
 else if(p.includes('/voice/playback'))throw Error('Retired audio clip endpoint requested'); else if(p.endsWith('/voice/end')){
  report.ends++;
  if(continuation)assert.equal(req.postDataJSON().connectionId,state.connectionId);
  state={...state,status:continuation?'CLOSING':'ENDED',closeReason:req.postDataJSON().reason??'CANDIDATE_ENDED',endedAt:continuation?null:new Date().toISOString(),serverNow:new Date().toISOString(),transcriptComplete:!continuation};
  body=state;
  if(continuation){
   if(report.ends===2)state.transcript=[...state.transcript,{id:'v3',speaker:'CANDIDATE',text:'Saya menguji data masukan menggunakan contoh riwayat interaksi.',startMs:12000,endMs:14000}];
   const ended=report.ends;
   setTimeout(()=>{ state={...state,status:'ENDED',endedAt:new Date().toISOString(),transcriptComplete:true,deadlineAt:undefined,remainingVoiceMs:ended===1?480000:210000,
    resumeUntil:ended===1?new Date(Date.now()+7*86400000).toISOString():undefined,
    completion:{status:ended===1?'RESUMABLE':'COMPLETE',revision:startupRollback?++startupRevision:ended===1?3:6,
     evidenceRevision:ended,canResume:ended===1}}; },1200);
  }
 }
 else if(p.includes('/voice')){
  if(apiUnavailable){const key=p.endsWith('/heartbeat')?'heartbeatFailures':'voiceStatusFailures';
   report[key]=(report[key]??0)+1;return route.fulfill({status:503,headers,json:{message:'Synthetic status failure'}});}
  body=state?{...state,serverNow:new Date().toISOString()}:null;
  if(method==='GET'&&p.endsWith('/voice')&&body?.status==='CREATING')report.creatingResponses=(report.creatingResponses??0)+1;
 }
 else if(p.includes('/notifications'))body=p.includes('unread')?{count:0}:[];else if(p.startsWith('/meta/'))body=[];
 return route.fulfill({status:200,headers,json:body});});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/id/screening/'+token,{waitUntil:'domcontentloaded',timeout:120000});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.getByRole('button',{name:'Buka interview',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Gangguan persiapan sintetis.'}).waitFor({timeout:60000});
 assert.equal(await page.getByRole('button',{name:'Tara menyiapkan interview…',exact:true}).count(),0,'FAILED has a recovery action');
 await page.getByRole('button',{name:'Coba pulihkan',exact:true}).click();
 await page.getByRole('button',{name:'Gabung interview',exact:true}).waitFor({timeout:60000});
 assert.equal(await page.getByRole('alert').filter({hasText:'Gangguan persiapan sintetis.'}).count(),0,'READY clears the preparation error');
 assert.ok(report.preparation.includes('PROCESSING'),'retry uses the preparation contract');
 assert.equal(report.creates,0,'preparation recovery does not start a voice connection');
 await page.screenshot({path:path.join(out,'01-prejoin.png')});
 await page.getByRole('button',{name:'Gabung interview',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Akses mikrofon belum diizinkan'}).waitFor();assert.equal(report.creates,0,'permission failure cannot start a paid call');
 await page.screenshot({path:path.join(out,'01a-microphone-permission.png')});
 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Mikrofon tidak ditemukan'}).waitFor();
 assert.equal(report.creates,0,'missing microphone cannot start a paid call');
 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Mikrofon belum bisa digunakan'}).waitFor();
 assert.equal(report.creates,0,'busy microphone cannot start a paid call');

 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Koneksi ke server terganggu'}).waitFor();assert.equal(report.creates,1);
 if(startupRollback)await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).waitFor({timeout:9000});
 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();await page.getByText('Terhubung',{exact:true}).waitFor({timeout:20000});await page.getByText(controlledQuestion,{exact:true}).waitFor();await page.waitForFunction(()=>[...document.images].filter(i=>i.offsetWidth).every(i=>i.complete&&i.naturalWidth));await page.screenshot({path:path.join(out,'02-meeting-desktop.png')});
 await page.waitForFunction(()=>!!document.querySelector('audio').srcObject);
 await page.getByRole('button',{name:'Aktifkan suara',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.querySelector('audio').srcObject.getAudioTracks()[0]===window.mockRemoteAudio.destination.stream.getAudioTracks()[0]),'WebRTC track goes straight to the media element');
 if(strictAudioGesture){
  report.meterPrimedWithJoin=await page.evaluate(()=>window.mockVoiceMeter?.gestureGranted===true);
  assert.ok(report.meterPrimedWithJoin,'the join click unlocks the observer before the asynchronous microphone permission returns');
  await page.evaluate(async()=>{window.mockVoiceMeter.gestureGranted=false;await window.mockVoiceMeter.suspend();});
 }
 await page.getByRole('button',{name:'Aktifkan suara',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('audio').paused&&!document.querySelector('audio').muted);
 assert.equal(report.creates,2,'speaker recovery uses the same connection');
 if(strictAudioGesture){
  report.meterResumedWithRecovery=await page.evaluate(()=>window.mockVoiceMeter?.gestureGranted===true);
  assert.ok(report.meterResumedWithRecovery,'the sound recovery click also resumes the passive observer');
 }
 for(let attempt=0;attempt<60&&!report.media.includes('INPUT_QUIET');attempt++)await page.waitForTimeout(40);
 assert.ok(report.media.includes('INPUT_QUIET'),'startup microphone observation runs alongside the speaker');
 if(noTestAudio){
  await page.getByRole('status').filter({hasText:'coba bilang “Halo” lewat mikrofon'}).waitFor({timeout:15000});
  assert.equal(report.ends,0,'missing audio telemetry does not terminate the media connection');
 }
 await page.evaluate(()=>window.mockRemoteAudio.play());
 await page.getByText('Sedang berbicara',{exact:true}).waitFor();
 if(noTestAudio)await page.getByRole('status').filter({hasText:'coba bilang “Halo” lewat mikrofon'}).waitFor({state:'hidden'});
 await page.getByText('Mendengarkan',{exact:true}).waitFor();
 assert.deepEqual(report.media.filter(e=>['READY','AUDIBLE','QUIET'].includes(e)).slice(0,3),['READY','AUDIBLE','QUIET']);
 if(continuation){
  apiUnavailable=true;
  for(let attempt=0;attempt<25&&!report.heartbeatFailures;attempt++)await page.waitForTimeout(400);
  assert.ok(report.heartbeatFailures&&report.voiceStatusFailures,'both status polling and heartbeat fail during the simulated API outage');
  const beforeOutageSpeech=report.media.length;
  await page.evaluate(()=>window.mockRemoteAudio.play());
  await page.getByText('Sedang berbicara',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.mockVoicePeer.connectionState==='connected'&&!document.querySelector('audio').paused&&
    window.mockVoicePeer.getSenders()[0].track.enabled),'status failures leave the healthy speaker and microphone active');
  assert.equal(await page.getByRole('alert').filter({hasText:/koneksi ke server/i}).count(),0,'status failures are not shown as voice disconnection');
  assert.equal(report.ends,0);
  apiUnavailable=false;
  await page.getByText('Mendengarkan',{exact:true}).waitFor();
  for(let attempt=0;attempt<80&&!report.media.slice(beforeOutageSpeech).includes('QUIET');attempt++)await page.waitForTimeout(50);
  assert.deepEqual(report.media.slice(beforeOutageSpeech).filter(event=>['AUDIBLE','QUIET','INTERRUPTED'].includes(event)),['AUDIBLE','QUIET']);
 }
 const beforeOverlap=report.media.length;
 const beforeOverlapInput=microphoneReports.length;
 await page.evaluate(()=>{
  const {context:mic,gain,stream}=window.mockCandidateAudio;
  const {context:remote,destination}=window.mockRemoteAudio;
  const start=mic.currentTime;
  window.mockOverlapInputAt=start;
  gain.gain.setValueAtTime(.08,start);
  gain.gain.setValueAtTime(0,start+.5);
  gain.gain.setValueAtTime(.08,start+1.25);
  gain.gain.setValueAtTime(0,start+1.8);
  const response=remote.createOscillator();
  response.connect(destination);
  response.start(remote.currentTime+.85);
  response.stop(remote.currentTime+2.45);
  window.mockInputRemainedLive=stream.getAudioTracks()[0].enabled&&window.mockVoicePeer.getSenders()[0].track===stream.getAudioTracks()[0];
 });
 await page.waitForFunction(()=>window.mockInputRemainedLive===true);
 await page.getByText('Sedang berbicara',{exact:true}).waitFor({timeout:2500});
 await page.waitForFunction(()=>window.mockCandidateAudio.context.currentTime>window.mockOverlapInputAt+1.6);
 assert.ok(await page.evaluate(()=>!document.querySelector('audio').paused&&!document.querySelector('audio').muted&&
  window.mockVoicePeer.getSenders()[0].track.enabled));
 await page.waitForFunction(()=>window.mockCandidateAudio.context.currentTime>window.mockOverlapInputAt+2.9);
 await page.getByText('Mendengarkan',{exact:true}).waitFor();
 for(let attempt=0;attempt<60&&report.media.slice(beforeOverlap).filter(e=>['AUDIBLE','QUIET','INTERRUPTED'].includes(e)).at(-1)!=='QUIET';attempt++)await page.waitForTimeout(40);
 const overlapPlayback=report.media.slice(beforeOverlap).filter(e=>['AUDIBLE','QUIET','INTERRUPTED'].includes(e));
 assert.equal(overlapPlayback[0],'AUDIBLE','speaker stays active as the candidate resumes');
 assert.equal(overlapPlayback.at(-1),'QUIET');
 assert.ok(!overlapPlayback.includes('INTERRUPTED'),'candidate microphone activity cannot stop speaker playback');
 const overlapInput=microphoneReports.slice(beforeOverlapInput);
 const stopped=overlapInput.slice(overlapInput.findLastIndex(row=>row.event==='INPUT_ACTIVE')+1).find(row=>row.event==='INPUT_QUIET');
 report.overlapMicStop=stopped;
 assert.ok(stopped?.delayMs>=700&&stopped.delayMs<2500,'mic quiet transition preserves when the last input was actually heard');
 assert.ok(!report.media.some(e=>e==='REPLAY'||e==='OUTPUT_DROPPED'));
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='disconnected';window.mockVoicePeer.onconnectionstatechange();});
 await page.getByText('Koneksi suara terputus',{exact:true}).waitFor();assert.equal(report.ends,0,'transient disconnect cannot end the interview');
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='connected';window.mockVoicePeer.onconnectionstatechange();});await page.getByText('Terhubung',{exact:true}).waitFor();
 assert.equal(report.creates,2);assert.equal(await page.getByText('15:01',{exact:true}).count(),0,'countdown cannot exceed 15 minutes');await page.getByRole('button',{name:'Nonaktifkan mikrofon',exact:true}).click();await page.getByRole('button',{name:'Aktifkan mikrofon',exact:true}).waitFor();await page.getByRole('button',{name:'Aktifkan mikrofon',exact:true}).click();
 await page.getByRole('button',{name:'Transkrip',exact:true}).click();await page.getByText('Saya mengerjakan pipeline data dan evaluasi model.',{exact:true}).waitFor({timeout:10000});await page.screenshot({path:path.join(out,'03-transcript.png')});await page.getByRole('button',{name:'Tutup transkrip',exact:true}).click();
 await page.getByRole('button',{name:'Pengaturan audio',exact:true}).click();await page.getByRole('heading',{name:'Pengaturan audio',exact:true}).waitFor();await page.getByRole('button',{name:'Selesai',exact:true}).click();
 if(hardDeadline){
  if(hardDeadline==='timeout')await page.evaluate(()=>{
   window.mockVoicePeer.connectionState='disconnected';window.mockVoicePeer.onconnectionstatechange();
  });
  // In the timeout case, network recovery is scheduled to outlast the deadline.
  state.deadlineAt=new Date(Date.now()+(hardDeadline==='timeout'?10500:5000)).toISOString();
  await page.waitForFunction(()=>/^00:0[1-5]$/.test(document.querySelector('header strong')?.textContent??''));
  apiUnavailable=true;
  await page.waitForFunction(()=>document.querySelector('header strong')?.textContent==='00:00'&&document.querySelector('audio').paused);
  report.deadlineMedia=await page.evaluate(()=>({peer:window.mockVoicePeer.connectionState,
   mic:window.mockVoicePeer.getSenders()[0].track.readyState,paused:document.querySelector('audio').paused,
   commands:window.mockVoiceChannel.sent}));
  assert.notEqual(report.deadlineMedia.peer,'closed','keep receiving final events while the provider acknowledges closure');
  assert.equal(report.deadlineMedia.mic,'ended','the time limit releases the microphone without waiting for the API');
  assert.equal(report.deadlineMedia.paused,true);
  assert.deepEqual(report.deadlineMedia.commands.map(row=>row.type),['session.close']);
  await page.getByRole('heading',{name:'Menyimpan percakapan',exact:true}).waitFor({timeout:2000});
  assert.equal(await page.locator('header strong').first().textContent(),'00:00');
  if(hardDeadline==='ack')await page.evaluate(()=>window.mockVoiceChannel.onmessage?.({data:JSON.stringify({type:'session.closed',reason:'close_requested'})}));
  await page.waitForFunction(()=>window.mockVoicePeer.connectionState==='closed',null,{timeout:hardDeadline==='ack'?2000:8000});
  assert.equal(report.ends,0,'the browser deadline must send no candidate-ended or disconnected API request');
  await page.getByRole('heading',{name:'Menyimpan percakapan',exact:true}).waitFor();
  state={...state,status:'ENDED',endedAt:new Date().toISOString(),closeReason:'TIME_LIMIT',transcriptComplete:true,
   deadlineAt:undefined,remainingVoiceMs:0,completion:{status:'COMPLETE',revision:4,evidenceRevision:1,canResume:false}};
  apiUnavailable=false;
  await page.getByRole('heading',{name:'Wawancara selesai',exact:true}).waitFor();
  await page.getByRole('button',{name:'Transkrip',exact:true}).click();
  await page.getByText('Saya mengerjakan pipeline data dan evaluasi model.',{exact:true}).waitFor();
  assert.deepEqual(report.errors,[]);
  report.deadlineCase=hardDeadline;
  console.log('Voice deadline browser passed: stopped local media, one provider close, retained transcript and reconciled server state. Paid calls: 0.');
  return;
 }
 for (const width of [390, 320]) {
  await page.setViewportSize({width, height:844});
  const controls = await page.locator('footer[class*="controls"] button').evaluateAll(buttons => buttons.map(button => {
   const rect = button.getBoundingClientRect();
   return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
  }));
  assert.equal(controls.length, 6);
  assert.ok(controls.every(control => control.left >= -1 && control.right <= width + 1), 'all call controls fit at ' + width + 'px');
  assert.ok(controls.every(control => Math.abs(control.height - 44) <= 1), 'call controls share a 44px height');
  assert.ok(Math.max(...controls.map(control => control.top)) - Math.min(...controls.map(control => control.top)) <= 2, 'call controls share a top edge');
  await page.screenshot({path:path.join(out,width===390?'04-meeting-mobile.png':'04-meeting-narrow.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Akhiri',exact:true}).click();await page.getByRole('button',{name:'Lanjut interview',exact:true}).click();assert.equal(report.ends,0);await page.getByRole('button',{name:'Akhiri',exact:true}).click();await page.getByRole('button',{name:continuation?'Jeda wawancara':'Akhiri interview',exact:true}).click();
 if(continuation){
  await page.getByRole('heading',{name:'Menyimpan percakapan',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.mockVoicePeer.connectionState==='connected'&&document.querySelector('audio').paused&&
    !window.mockVoicePeer.getSenders()[0].track.enabled),'pending closure leaves the provider transport open while the local conversation stops');
  await page.getByRole('button',{name:'Lanjutkan wawancara',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.mockVoicePeer.connectionState),'closed','confirmed closure releases the old connection');
  assert.equal(state.closeReason,'CANDIDATE_PAUSED');
  assert.equal(state.deadlineAt,undefined,'a paused invitation has no running countdown');
  assert.equal(state.remainingVoiceMs,480000);
  await page.screenshot({path:path.join(out,'05-resumable.png')});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Buka interview',exact:true}).click();
  await page.getByRole('button',{name:'Lanjutkan wawancara',exact:true}).click();
  for(let attempt=0;attempt<3;attempt++){
   await page.getByRole('alert').filter({hasText:/mikrofon/}).waitFor();
   await page.getByRole('button',{name:'Lanjutkan wawancara',exact:true}).click();
  }
  if(startupRollback){
   const retry=page.getByRole('button',{name:'Lanjutkan wawancara',exact:true});
   await retry.waitFor({timeout:12000});
   await page.getByRole('alert').filter({hasText:'Koneksi ke server terganggu'}).waitFor();
   assert.equal(report.creatingResponses,2);
   assert.equal(await page.locator('header strong').last().textContent(),'08:00');
   await retry.click();
  }
  const microphone=page.getByRole('button',{name:'Nonaktifkan mikrofon',exact:true});
  await microphone.and(page.locator('button:enabled')).waitFor();
  assert.equal(state.remainingVoiceMs,480000);
  assert.ok(Date.parse(state.deadlineAt)-Date.now()>470000,'reopening begins a new clock with the eight unused minutes');
  assert.equal(state.connectionNumber,2);
  await page.getByRole('button',{name:'Akhiri',exact:true}).click();
  await page.getByRole('button',{name:'Akhiri interview',exact:true}).click();
  await page.getByRole('heading',{name:'Wawancara selesai',exact:true}).waitFor();
  await page.getByRole('button',{name:'Transkrip',exact:true}).click();
  await page.getByText('Saya mengerjakan pipeline data dan evaluasi model.',{exact:true}).waitFor();
  await page.getByText('Saya menguji data masukan menggunakan contoh riwayat interaksi.',{exact:true}).waitFor();
  assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(out,'06-complete-after-resume.png')});
  console.log('Voice continuation browser passed: reload, cached unused time, connection fences and both transcripts. Paid calls: 0.');
  return;
 }
 await page.getByRole('heading',{name:'Terima kasih sudah berbagi',exact:true}).waitFor();assert.equal(report.ends,1);const frozen=await page.locator('header strong').last().textContent();await page.waitForTimeout(2100);assert.equal(await page.locator('header strong').last().textContent(),frozen,'ended timer stays frozen');await page.screenshot({path:path.join(out,'05-completed.png')});assert.deepEqual(report.errors,[]);
 await page.setViewportSize({width:1672,height:941});state=null;await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Buka interview',exact:true}).click();await page.getByRole('button',{name:'Gabung interview',exact:true}).click();
 for(let attempt=0;attempt<3;attempt++)await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();
 await page.getByText('Terhubung',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Aktifkan suara',exact:true}).waitFor();
 await page.getByRole('button',{name:'Aktifkan suara',exact:true}).click();
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='disconnected';window.mockVoicePeer.onconnectionstatechange();});
 await page.getByText('Koneksi suara terputus',{exact:true}).waitFor();
 await page.getByText('Interview berakhir karena koneksi mengalami kendala.',{exact:false}).waitFor({timeout:30000});assert.equal(state.closeReason,'CONNECTION_LOST');assert.equal(report.ends,2);assert.equal(await page.getByText('Kamu mengakhiri interview lebih awal.',{exact:false}).count(),0,'technical disconnect is not blamed on candidate');await page.screenshot({path:path.join(out,'06-disconnected.png')});
 console.log('Voice browser passed: invitation, prejoin, permission denial, missing and busy microphone without call creation, actionable server error and retry, media connection, meeting layout, live caption, mic toggle, transcript, audio settings, contained mobile viewport, confirmed early end and saved completion. Paid calls: 0.');
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
