// Run one bounded scenario explicitly with synthetic audio. This does not contact the app database.
const assert=require('node:assert/strict');
const {readFileSync,mkdirSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createRequire}=require('node:module');
const scenario=process.argv[2];
assert.equal(process.env.TARA_PAID_AUDIO_PROBE,'1');
assert.ok(['transition','fallback'].includes(scenario));
const wav=readFileSync(process.env.TARA_SYNTHETIC_WAV);
assert.ok(wav.length<=2*1024*1024&&wav.toString('ascii',0,4)==='RIFF');
if(!process.env.OPENAI_API_KEY)process.loadEnvFile('.env');
assert.ok(process.env.OPENAI_API_KEY,'Provider key missing');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(resolve(runtime,'playwright/package.json'))('playwright');
const api=resolve('apps/api/dist/ai-screening');
const {VoiceProvider}=require(api+'/voice/voice.provider');
const {TaraPlayback}=require(api+'/voice/voice-playback');
const {TaraLiveTurns}=require(api+'/voice/voice-turns');
const {createVoiceRequest}=require(api+'/prompts/voice-session');
const {voiceTurns}=require(api+'/voice/voice.policy');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const first='Bagian mana yang lu kerjain di proyek itu?';
 const second='Gimana lu mengecek hasil kerja lu?';
 const signoff='Makasih udah cerita. Interview kita selesai ya.';
 const provider=new VoiceProvider({get:key=>process.env[key]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.TARA_PROBE_CHROME,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1024,height:760}});
 const abort=new AbortController();
 const report={scenario,questionsPlayed:0,textFallback:false,signoffPlayed:false,inputResumed:false,providerErrors:0,clipUsage:[]};
 const fragments=[];
 let providerId,channel,closed=false,liveUsage,startedAt,unmuted=0,muted=0;
 // Reserve at least 10 seconds for disconnect and provider hangup within the 90-second cap.
 const timer=setTimeout(()=>{abort.abort();void page.close().catch(()=>{});if(channel)try{channel.send({type:'session.close'});}catch{}},75000);
 async function until(check,label,limit=12000){
  const end=Date.now()+limit;
  while(!abort.signal.aborted&&Date.now()<end){const found=await check();if(found)return found;await pause(120);}
  throw Error(label);
 }
 const playback=new TaraPlayback(async(text,signal)=>{
  if(scenario==='fallback'&&text===second)throw Error('Synthetic clip failure');
  const clip=await provider.render(text,AbortSignal.any([signal,abort.signal]));
  report.clipUsage.push(clip.usage??null);
  return clip;
 });
 const scheduler=new TaraLiveTurns([first,second].map((question,index)=>({id:'topic-'+index,criterionId:'job',label:'Topic '+index,question,fields:['TASK','ACTION'],alternative:false})),true);
 async function playCurrent(){
  await playback.ready();
  const status=playback.status();
  assert.ok(status);
  if(status.state==='TEXT'){
   assert.equal(scenario,'fallback','The live provider must render the approved audio');
   assert.equal(status.text,second);
   await page.locator('#tara-question').evaluate((el,text)=>{el.textContent=text;},status.text);
   assert.ok(await page.getByText(status.text,{exact:true}).isVisible());
   assert.ok(playback.confirm(status.revision,'TEXT_SHOWN',Date.now()));
   playback.delivered('TEXT_SHOWN');
   report.textFallback=true;
  }else{
   const audio=playback.read(status.revision,Date.now());
   assert.ok(audio,'An approved WAV is required');
   const played=await page.evaluate(async(encoded)=>{
    const player=document.querySelector('audio');
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'audio/wav'}));
    try{
     const ended=new Promise((resolve,reject)=>{player.onended=resolve;player.onerror=()=>reject(Error('Audio playback failed'));});
     player.src=url;
     await player.play();await ended;
     return player.currentTime;
    }finally{player.removeAttribute('src');URL.revokeObjectURL(url);}
   },audio.toString('base64'));
   assert.ok(played>0.25);
   assert.ok(playback.confirm(status.revision,'AUDIO_PLAYED',Date.now()));
   playback.delivered('AUDIO_PLAYED');
   if(status.kind==='QUESTION')report.questionsPlayed++;else report.signoffPlayed=true;
  }
  if(status.kind==='QUESTION'){
   const id=fragments.length+1,now=Date.now(),time=now-startedAt;
   fragments.push({id,speaker:'TARA',text:status.text,startMs:time,endMs:time+1});
   scheduler.delivered('v'+id,now,status.state==='TEXT'?'TEXT_FALLBACK':'AUDIO');
  }
 }
 try{
  await page.route('http://localhost/tara-controlled-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><audio></audio><p id="tara-question"></p>'}));
  await page.goto('http://localhost/tara-controlled-probe');
  const sdp=await page.evaluate(async bytes=>{
   const ac=new AudioContext(),dest=ac.createMediaStreamDestination(),source=ac.createBufferSource();
   source.buffer=await ac.decodeAudioData(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)).buffer);
   source.loop=true;source.connect(dest);source.start();await ac.resume();
   const track=dest.stream.getAudioTracks()[0];track.enabled=false;
   const pc=new RTCPeerConnection();pc.addTrack(track,dest.stream);pc.createDataChannel('live-events');
   pc.ontrack=()=>{window.discardedTrack=true;};
   window.taraProbe={pc,track};
   await pc.setLocalDescription(await pc.createOffer());
   for(let i=0;i<20&&pc.iceGatheringState!=='complete';i++)await new Promise(resolve=>setTimeout(resolve,100));
   return pc.localDescription.sdp;
  },wav.toString('base64'));
  playback.offer(first);
  const created=await provider.create(createVoiceRequest({model:'gpt-live-1',reasoningModel:'gpt-6-luna',voice:'marin'},sdp));
  providerId=created.session.id;
  channel=provider.attach(providerId,event=>{
   if(event.type==='session.started')channel.send({type:'session.input_audio.mute'});
   if(event.type==='session.input_audio.muted')muted++;
   if(event.type==='session.input_audio.unmuted')unmuted++;
   if(event.type==='session.closed'){closed=true;liveUsage=event.usage;}
   if(event.type==='error')report.providerErrors++;
   if(event.type==='session.input_transcript.delta'&&event.end_ms>event.start_ms&&startedAt&&unmuted>=muted){
    const t=Date.now()-startedAt;
    fragments.push({id:fragments.length+1,speaker:'CANDIDATE',text:event.delta,startMs:t,endMs:t+1});
   }
  },()=>{});
  await channel.opened;
  await page.evaluate(async sdp=>{await window.taraProbe.pc.setRemoteDescription({type:'answer',sdp});},created.transport.sdp);
  await until(()=>page.evaluate(()=>window.taraProbe.pc.connectionState==='connected'&&window.discardedTrack),'WebRTC tracks not established');
  await until(()=>muted>0,'Initial mute not confirmed');
  startedAt=Date.now();
  scheduler.issue(first,startedAt,true,0);
  await playCurrent();
  channel.send({type:'session.input_audio.unmute'});
  await page.evaluate(()=>{window.taraProbe.track.enabled=true;});
  await until(()=>unmuted>=muted&&fragments.filter(turn=>turn.speaker==='CANDIDATE').map(turn=>turn.text).join('').length>35,'Candidate audio not transcribed');
  const forced=startedAt+181000;
  const next=scheduler.tick(voiceTurns(fragments),forced,startedAt+840000,async()=>undefined);
  assert.equal(next?.question,second);
  channel.send({type:'session.input_audio.mute'});
  await until(()=>muted>=2,'Transition mute not confirmed');
  const before=fragments.length;
  scheduler.issue(second,forced,true,next.after);
  playback.offer(second);
  await playCurrent();
  channel.send({type:'session.input_audio.unmute'});
  await until(()=>unmuted>=2&&fragments.slice(before).some(turn=>turn.speaker==='CANDIDATE'),'Candidate audio not restored');
  report.inputResumed=true;
  if(scenario==='fallback'){
   channel.send({type:'session.input_audio.mute'});
   playback.offer(signoff,'SIGNOFF');
   await playCurrent();
  }
  assert.equal(report.providerErrors,0);
  assert.equal(report.questionsPlayed,scenario==='transition'?2:1);
  assert.equal(report.textFallback,scenario==='fallback');
  assert.equal(report.signoffPlayed,scenario==='fallback');
  assert.ok(await page.locator('audio').evaluate(player=>player.srcObject===null));
 }finally{
  clearTimeout(timer);playback.clear();
  if(channel){try{channel.send({type:'session.close'});const until=Date.now()+1500;while(!closed&&Date.now()<until)await pause(100);}catch{}channel.dispose();}
  abort.abort();
  if(providerId&&!closed)await provider.hangup(providerId).catch(()=>{});
  await browser.close();
  const output=resolve('output/tara-timed-voice');
  mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,scenario+'.json'),JSON.stringify({...report,closed,liveUsage},null,2));
  console.log(JSON.stringify({scenario,questionsPlayed:report.questionsPlayed,textFallback:report.textFallback,signoffPlayed:report.signoffPlayed,inputResumed:report.inputResumed,providerErrors:report.providerErrors,closed}));
 }
 assert.ok(closed,'Provider closure and usage were not acknowledged');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
