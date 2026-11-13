// Synthetic browser media + mocked API. No OpenAI calls, microphone capture or outbound invitations.
const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local browser only');
const alternative=process.env.TARA_BROWSER_ALTERNATIVE==='1';
const out=path.resolve(process.env.TARA_BROWSER_OUT||(alternative?'output/invited-voice-ui-alternative':'output/invited-voice-ui-native'));fs.mkdirSync(out,{recursive:true});
const controlledQuestion=alternative?'Pernah ada proyek atau kegiatan yang berkaitan sama tanggung jawab utama posisi ini?':'Di proyek terakhir, bagian mana yang lu kerjakan sendiri?';
const auth={accessToken:'synthetic-voice-ui',user:{id:'voice-ui',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'dinda@example.test',emailVerified:true,phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}},token='voice-ui-token.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.TARA_PROBE_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']}),context=await browser.newContext({viewport:{width:1672,height:941},permissions:['microphone'],reducedMotion:'reduce'}),report={errors:[],creates:0,ends:0,media:[],preparation:[]};let state=null,rejectProviderOnce=true,preparation='FAILED';
 try{
 await context.addInitScript(({auth,controlledQuestion})=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));let audioAttempts=0; const play=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){if(!audioAttempts++)return Promise.reject(new DOMException('synthetic speaker block','NotAllowedError')); return play.call(this);};let mediaAttempts=0;navigator.mediaDevices.getUserMedia=async()=>{const errors=['NotAllowedError','NotFoundError','NotReadableError'];const failure=errors[mediaAttempts++];if(failure)throw new DOMException('synthetic microphone failure',failure);
 const ac=window.mockCandidateAudio?.context??new AudioContext(),osc=ac.createOscillator(),gain=ac.createGain(),destination=ac.createMediaStreamDestination();
 gain.gain.value=0;osc.connect(gain).connect(destination);osc.start();await ac.resume();
 destination.stream.getAudioTracks()[0].addEventListener('ended',()=>void ac.close());
 window.mockCandidateAudio={context:ac,gain,stream:destination.stream};return destination.stream;
 };class Peer{constructor(){window.mockVoicePeer=this;}connectionState='new';iceGatheringState='complete';localDescription=null;onconnectionstatechange=null;senders=[];addTrack(track){this.senders.push({track,replaceTrack:async()=>{}});}getSenders(){return this.senders;}createDataChannel(){const channel={onmessage:null};window.mockVoiceChannel=channel;return channel;}async createOffer(){return{type:'offer',sdp:'v=0 mocked browser voice offer'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();
 const ac=new AudioContext(),osc=ac.createOscillator(),destination=ac.createMediaStreamDestination();
 osc.connect(destination);osc.start();window.mockRemoteAudio={context:ac,destination};
 const track=destination.stream.getAudioTracks()[0];
 this.ontrack?.({track,streams:[destination.stream]});
 setTimeout(()=>osc.stop(),2600);
 setTimeout(()=>window.mockVoiceChannel.onmessage?.({data:JSON.stringify({type:'session.output_transcript.delta',delta:controlledQuestion})}),100);}close(){this.connectionState='closed';}addEventListener(){}}window.RTCPeerConnection=Peer;},{auth,controlledQuestion});
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
 else if(p==='/ai-screening/sessions/voice-session/voice'&&method==='POST'){report.creates++;if(rejectProviderOnce){rejectProviderOnce=false;return route.fulfill({status:503,headers,json:{message:'Koneksi suara belum tersedia. Silakan coba lagi sebentar.'}});}state={id:'voice',status:'ACTIVE',startedAt:new Date().toISOString(),endedAt:null,serverNow:new Date().toISOString(),warningAt:null,closingAt:null,closeReason:null,transcriptComplete:false,error:null,transcript:[{id:'v1',speaker:'TARA',text:controlledQuestion,startMs:2000,endMs:4000},{id:'v2',speaker:'CANDIDATE',text:'Saya mengerjakan pipeline data dan evaluasi model.',startMs:5000,endMs:7000}]};Object.assign(state,{voiceMode:'NATIVE',clockRunning:false});body={...state,sdp:'v=0 mock answer'};}
 else if(p.endsWith('/voice/media')){
  const {event,sequence}=req.postDataJSON();report.media.push(event);assert.ok(sequence>0);
  if(event==='AUDIBLE'){state.clockRunning=true;state.deadlineAt=new Date(Date.now()+900000).toISOString();}
  body={...state,serverNow:new Date().toISOString()};
 }
 else if(p.includes('/voice/playback'))throw Error('Retired audio clip endpoint requested'); else if(p.endsWith('/voice/end')){report.ends++;state={...state,status:'ENDED',closeReason:req.postDataJSON().reason??'CANDIDATE_ENDED',endedAt:new Date().toISOString(),serverNow:new Date().toISOString(),transcriptComplete:true};body=state;}
 else if(p.includes('/voice'))body=state?{...state,serverNow:new Date().toISOString()}:null;
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
 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();await page.getByText('Terhubung',{exact:true}).waitFor({timeout:20000});await page.getByText(controlledQuestion,{exact:true}).waitFor();await page.waitForFunction(()=>[...document.images].filter(i=>i.offsetWidth).every(i=>i.complete&&i.naturalWidth));await page.screenshot({path:path.join(out,'02-meeting-desktop.png')});
 await page.waitForFunction(()=>!!document.querySelector('audio').srcObject); await page.getByRole('button',{name:'Aktifkan suara',exact:true}).click();
 await page.getByText('Sedang berbicara',{exact:true}).waitFor();
 await page.getByText('Mendengarkan',{exact:true}).waitFor();
 assert.deepEqual(report.media.slice(0,3),['READY','AUDIBLE','QUIET']);
 // Feed real AudioWorklet inputs into the app with synthetic speech markers.
 const beforeOverlap=report.media.length;
 await page.evaluate(()=>{
  const {context:mic,gain,stream}=window.mockCandidateAudio;
  const {context:remote,destination}=window.mockRemoteAudio;
  gain.gain.setValueAtTime(.08,mic.currentTime);
  gain.gain.setValueAtTime(0,mic.currentTime+.6);
  gain.gain.setValueAtTime(.08,mic.currentTime+1.55);
  gain.gain.setValueAtTime(0,mic.currentTime+2.3);
  const early=remote.createOscillator();early.connect(destination);early.start(remote.currentTime+.8);early.stop(remote.currentTime+3);
  const clear=remote.createOscillator();clear.connect(destination);clear.start(remote.currentTime+4.5);clear.stop(remote.currentTime+5.5);
  window.mockInputRemainedLive=stream.getAudioTracks()[0].enabled&&window.mockVoicePeer.getSenders()[0].track===stream.getAudioTracks()[0];
 });
 await page.waitForFunction(()=>window.mockInputRemainedLive===true);
 await page.getByText('Sedang berbicara',{exact:true}).waitFor({timeout:6500});
 await page.getByText('Mendengarkan',{exact:true}).waitFor();
 for(let attempt=0;attempt<25&&!report.media.slice(beforeOverlap).includes('QUIET');attempt++)await page.waitForTimeout(40);
 assert.deepEqual(report.media.slice(beforeOverlap).filter(e=>e!=='TEXT_SHOWN'),['OUTPUT_DROPPED','AUDIBLE','QUIET']);
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='disconnected';window.mockVoicePeer.onconnectionstatechange();});
 await page.getByText('Koneksi suara terputus',{exact:true}).waitFor();assert.equal(report.ends,0,'transient disconnect cannot end the interview');
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='connected';window.mockVoicePeer.onconnectionstatechange();});await page.getByText('Terhubung',{exact:true}).waitFor();
 assert.equal(report.creates,2);assert.equal(await page.getByText('15:01',{exact:true}).count(),0,'countdown cannot exceed 15 minutes');await page.getByRole('button',{name:'Nonaktifkan mikrofon',exact:true}).click();await page.getByRole('button',{name:'Aktifkan mikrofon',exact:true}).waitFor();await page.getByRole('button',{name:'Aktifkan mikrofon',exact:true}).click();
 await page.getByRole('button',{name:'Transkrip',exact:true}).click();await page.getByText('Saya mengerjakan pipeline data dan evaluasi model.',{exact:true}).waitFor({timeout:10000});await page.screenshot({path:path.join(out,'03-transcript.png')});await page.getByRole('button',{name:'Tutup transkrip',exact:true}).click();
 await page.getByRole('button',{name:'Pengaturan audio',exact:true}).click();await page.getByRole('heading',{name:'Pengaturan audio',exact:true}).waitFor();await page.getByRole('button',{name:'Selesai',exact:true}).click();
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
 await page.getByRole('button',{name:'Akhiri',exact:true}).click();await page.getByRole('button',{name:'Lanjut interview',exact:true}).click();assert.equal(report.ends,0);await page.getByRole('button',{name:'Akhiri',exact:true}).click();await page.getByRole('button',{name:'Akhiri interview',exact:true}).click();await page.getByRole('heading',{name:'Terima kasih sudah berbagi',exact:true}).waitFor();assert.equal(report.ends,1);const frozen=await page.locator('header strong').last().textContent();await page.waitForTimeout(2100);assert.equal(await page.locator('header strong').last().textContent(),frozen,'ended timer stays frozen');await page.screenshot({path:path.join(out,'05-completed.png')});assert.deepEqual(report.errors,[]);
 await page.setViewportSize({width:1672,height:941});state=null;await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Buka interview',exact:true}).click();await page.getByRole('button',{name:'Gabung interview',exact:true}).click();
 for(let attempt=0;attempt<3;attempt++)await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();
 await page.getByText('Terhubung',{exact:true}).waitFor();
 await page.evaluate(()=>{window.mockVoicePeer.connectionState='disconnected';window.mockVoicePeer.onconnectionstatechange();});
 await page.getByText('Interview berakhir karena koneksi mengalami kendala.',{exact:false}).waitFor({timeout:30000});assert.equal(state.closeReason,'CONNECTION_LOST');assert.equal(report.ends,2);assert.equal(await page.getByText('Kamu mengakhiri interview lebih awal.',{exact:false}).count(),0,'technical disconnect is not blamed on candidate');await page.screenshot({path:path.join(out,'06-disconnected.png')});
 console.log('Voice browser passed: invitation, prejoin, permission denial, missing and busy microphone without call creation, actionable server error and retry, media connection, meeting layout, live caption, mic toggle, transcript, audio settings, contained mobile viewport, confirmed early end and saved completion. Paid calls: 0.');
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
