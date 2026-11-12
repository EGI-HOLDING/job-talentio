// Synthetic browser media + mocked API. No OpenAI calls, microphone capture or outbound invitations.
const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local browser only');
const timed=process.env.TARA_BROWSER_TIMED_INTERVIEW==='1';
const alternative=process.env.TARA_BROWSER_ALTERNATIVE==='1';
const out=path.resolve(alternative?'output/invited-voice-ui-alternative':timed?'output/invited-voice-ui-v8':'output/invited-voice-ui');fs.mkdirSync(out,{recursive:true});
const controlledQuestion=alternative?'Pernah ada proyek atau kegiatan yang berkaitan sama tanggung jawab utama posisi ini?':'Di proyek terakhir, bagian mana yang lu kerjakan sendiri?';
const alternateQuestion='Apa yang lu lakukan untuk mengecek hasil model?';
function fixtureWave(){
 const data=Buffer.alloc(48000);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
 data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);
 data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);return data;
}
const auth={accessToken:'synthetic-voice-ui',user:{id:'voice-ui',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'dinda@example.test',emailVerified:true,phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}},token='voice-ui-token.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
async function main(){
 const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']}),context=await browser.newContext({viewport:{width:1672,height:941},permissions:['microphone'],reducedMotion:'reduce'}),report={errors:[],creates:0,ends:0,playback:[],preparation:[]};let state=null,rejectProviderOnce=true,preparation='FAILED';
 try{
 await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));const getMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let mediaAttempts=0;navigator.mediaDevices.getUserMedia=async options=>{const errors=['NotAllowedError','NotFoundError','NotReadableError'];const failure=errors[mediaAttempts++];if(failure)throw new DOMException('synthetic microphone failure',failure);return getMedia(options);};class Peer{constructor(){window.mockVoicePeer=this;}connectionState='new';iceGatheringState='complete';localDescription=null;onconnectionstatechange=null;senders=[];addTrack(track){this.senders.push({track,replaceTrack:async()=>{}});}getSenders(){return this.senders;}createDataChannel(){const channel={onmessage:null};window.mockVoiceChannel=channel;return channel;}async createOffer(){return{type:'offer',sdp:'v=0 mocked browser voice offer'};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();setTimeout(()=>window.mockVoiceChannel.onmessage?.({data:JSON.stringify({type:'session.output_transcript.delta',delta:'Di proyek terakhir, bagian mana yang lu kerjakan sendiri?'})}),100);}close(){this.connectionState='closed';}addEventListener(){}}window.RTCPeerConnection=Peer;},auth);
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
 else if(p==='/ai-screening/sessions/voice-session/voice'&&method==='POST'){report.creates++;if(rejectProviderOnce){rejectProviderOnce=false;return route.fulfill({status:503,headers,json:{message:'Koneksi suara belum tersedia. Silakan coba lagi sebentar.'}});}state={id:'voice',status:'ACTIVE',startedAt:new Date().toISOString(),endedAt:null,serverNow:new Date().toISOString(),warningAt:null,closingAt:null,closeReason:null,transcriptComplete:false,error:null,transcript:[{id:'v1',speaker:'TARA',text:controlledQuestion,startMs:2000,endMs:4000},{id:'v2',speaker:'CANDIDATE',text:'Saya mengerjakan pipeline data dan evaluasi model.',startMs:5000,endMs:7000}]};if(timed)Object.assign(state,{controlledPlayback:true,clockRunning:false,playback:null});body={...state,sdp:'v=0 mock answer'};}
 else if(p.endsWith('/voice/playback')&&timed){
  const {event,revision}=req.postDataJSON();report.playback.push(event);
  if(event==='READY'){state.clockRunning=true;state.playback={revision:1,text:controlledQuestion,kind:'QUESTION',state:'AUDIO'};}
  if(event==='AUDIO_PLAYED'&&revision===1)state.playback={revision:2,text:alternateQuestion,kind:'QUESTION',state:'AUDIO'};
  if(event==='AUDIO_FAILED'&&revision===2)state.playback.state='TEXT';
  if(event==='TEXT_SHOWN'&&revision===2)state.playback.state='TEXT_SHOWN';
  body={...state,serverNow:new Date().toISOString()};
 }
 else if(p.endsWith('/voice/playback/1')&&timed){assert.ok(req.headers()['x-tara-client']);return route.fulfill({status:200,headers,contentType:'audio/wav',body:fixtureWave()});}
 else if(p.endsWith('/voice/playback/2')&&timed)return route.fulfill({status:502,headers,json:{message:'Klip tidak tersedia'}});
 else if(p.endsWith('/voice/end')){report.ends++;state={...state,status:'ENDED',closeReason:req.postDataJSON().reason??'CANDIDATE_ENDED',endedAt:new Date().toISOString(),serverNow:new Date().toISOString(),transcriptComplete:true};body=state;}
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
 await page.getByRole('alert').filter({hasText:'Koneksi suara belum tersedia'}).waitFor();assert.equal(report.creates,1);
 await page.getByRole('button',{name:'Coba gabung lagi',exact:true}).click();await page.getByText('Terhubung',{exact:true}).waitFor({timeout:20000});await page.getByText(controlledQuestion,{exact:true}).waitFor();await page.waitForFunction(()=>[...document.images].filter(i=>i.offsetWidth).every(i=>i.complete&&i.naturalWidth));await page.screenshot({path:path.join(out,'02-meeting-desktop.png')});
 if(timed){
  await page.evaluate(()=>{
   window.mockVoicePeer.ontrack?.({streams:[new MediaStream()]});
   window.mockVoiceChannel.onmessage?.({data:JSON.stringify({type:'session.output_transcript.delta',delta:'Pertanyaan liar yang tidak boleh muncul'})});
  });
  await page.getByText(alternateQuestion,{exact:true}).waitFor();
  await page.locator('[data-tara-playback="TEXT_SHOWN"]').waitFor();
  assert.equal(await page.getByText('Pertanyaan liar yang tidak boleh muncul').count(),0);
  assert.ok(await page.locator('audio').evaluate(audio=>audio.srcObject===null));
  assert.deepEqual(report.playback.slice(0,4),['READY','AUDIO_PLAYED','AUDIO_FAILED','TEXT_SHOWN']);
 }
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
