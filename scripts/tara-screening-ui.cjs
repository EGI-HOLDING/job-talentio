// Local browser checks: all API traffic is intercepted; no provider requests.
const {createRequire}=require('node:module');
const path=require('node:path'), fs=require('node:fs'), assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.TARA_UI_ORIGIN||'http://localhost:3012';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only UI guard');
fs.mkdirSync('tmp/tara-screening',{recursive:true});
const session={accessToken:'synthetic-only',user:{id:'ui-fixture',role:'EMPLOYEE',fullName:'Alya Putri',phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function harness(browser,id,ready=false){
 const context=await browser.newContext({viewport:{width:1536,height:1024}}),page=await context.newPage(),errors=[];
 let state={id,status:'DRAFT',resumeId:'cv1',applicationId:null,coverLetter:'',coverFilename:null,packetReady:ready,preparationStatus:ready?'READY':'PENDING',preparation:{status:ready?'READY':'PROCESSING',planId:'p1',reason:null},revision:0,questions:[],job:{id:'job',title:'Customer Service',companyName:'PT Nusa Karya',city:'Jakarta'}};
 const counts={start:0,shown:0,submit:0,retry:0}, control={offline:false,holdGet:null};
 await context.addInitScript(session=>{localStorage.setItem('jt_token',session.accessToken);localStorage.setItem('jt_session',JSON.stringify(session));},session);
 await context.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname,m=route.request().method();let body={};
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'*'};
  if(m==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(control.offline&&p.includes('/ai-screening/sessions/')&&m==='GET'){await route.abort();return;}
  if(p.endsWith('/profiles/me/onboarding'))body={status:'COMPLETED',profile:{phone:'+6281234567890'}};
  else if(p.endsWith('/profiles/me'))body={resumes:[{id:'cv1',title:'CV_Alya_Putri.pdf',hasFile:true,isPrimary:true},{id:'cv2',title:'CV revisi.pdf',hasFile:true}]};
  else if(p.endsWith('/capabilities'))body={enabled:true};
  else if(p.endsWith('/submit')){counts.submit++;state={...state,status:'SUBMITTED',applicationId:'app'};body={id:'app'};}
  else if(p.includes('/ai-screening/')){
   if(p.endsWith('/start')){counts.start++;if(state.packetReady&&state.status==='DRAFT')state={...state,status:'ACTIVE',revision:state.revision+1,questions:[{id:'q1',text:'Di CV kamu menyebut membantu pelanggan. Bagian apa yang kamu kerjakan sendiri?',answer:null,draft:'',shownAt:null,deadlineAt:null}]};}
   else if(p.endsWith('/shown')){counts.shown++;state={...state,questions:state.questions.map(q=>q.answer===null&&!q.shownAt?{...q,shownAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+60000).toISOString()}:q)};}
   else if(p.endsWith('/retry')){counts.retry++;state={...state,error:null,preparation:{...state.preparation,status:'PROCESSING',reason:null}};}
   else if(p.endsWith('/answer')){const input=route.request().postDataJSON();state={...state,questions:state.questions.map(q=>q.id===input.questionId?{...q,draft:input.answer,...(m==='POST'?{answer:input.answer}:{})}:q),...(m==='POST'?{status:state.questions.length===1?'GENERATING':'COMPLETED',revision:state.revision+1}:{})};}
   else if(m==='PATCH'){const input=route.request().postDataJSON();if(input.resumeId&&input.resumeId!==state.resumeId)state={...state,resumeId:input.resumeId,packetReady:false,preparation:{status:'PROCESSING',planId:'p2',reason:null}};state={...state,...(input.coverLetter!==undefined?{coverLetter:input.coverLetter}:{}),revision:state.revision+1};}
   body=JSON.parse(JSON.stringify({...state,serverTime:new Date().toISOString()}));
   if(m==='GET'&&control.holdGet){const held=control.holdGet;control.holdGet=null;held.captured();await held.release;}
  }
  else if(p.includes('/notifications')||p.includes('/companies/mine'))body=[];
  else if(p.includes('/download'))body={url:'about:blank'};
  await route.fulfill({json:body,headers}).catch(()=>{});
 });
 page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.goto(origin+'/id/apply/job');await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.getByRole('heading',{name:'Pilih CV andalanmu'}).waitFor();};
 const rules=async()=>{await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('heading',{name:'Ceritakan sedikit tentang dirimu'}).waitFor();await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('heading',{name:'Hai Alya, aku Tara!'}).waitFor();await page.getByRole('button',{name:'Lihat aturan singkat →'}).click();};
 return {context,page,errors,counts,control,open,rules,get state(){return state;},set state(next){state=next;},ready(){state={...state,packetReady:true,preparationStatus:'READY',preparation:{...state.preparation,status:'READY',reason:null}};}};
}
async function main(){const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const h=await harness(browser,'waiting'),{page}=h;await h.open();assert.equal(await page.locator('[data-tara]').count(),0);
 await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.locator('[data-preparation="PROCESSING"]').waitFor();await page.screenshot({path:'tmp/tara-screening/cover-letter.png',fullPage:true});
 assert.ok(await page.locator('[data-tara="runner"]').count());
 await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('button',{name:'Lihat aturan singkat →'}).click();
 assert.ok(await page.getByRole('button',{name:'Siap, yuk mulai! →'}).isEnabled());await page.screenshot({path:'tmp/tara-screening/rules.png',fullPage:true});
 await page.getByRole('button',{name:'Siap, yuk mulai! →'}).dblclick();await page.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).waitFor();
 assert.equal(await page.locator('.nav-wrap').count(),0);assert.equal(await page.getByText('PT Nusa Karya',{exact:false}).count(),0);assert.equal(await page.getByRole('timer').count(),0);assert.equal(h.counts.shown,0);assert.equal(h.counts.start,1);
 await page.screenshot({path:'tmp/tara-screening/waiting-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/tara-screening/waiting-mobile.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).waitFor();assert.equal(h.counts.shown,0);
 const other=await h.context.newPage();await other.addInitScript(()=>sessionStorage.setItem('tara-start-intent:waiting','true'));await other.goto(origin+'/id/apply/job');await other.getByRole('heading',{name:'Biar ngobrolnya nyaman'}).waitFor();assert.equal(await other.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).count(),0);assert.equal(h.counts.start,1);await other.close();
 h.ready();await page.locator('#tara-answer:enabled').waitFor();assert.equal(h.counts.start,2);assert.equal(h.state.questions.length,1);
 await page.locator('#tara-answer').fill('Saya membantu pelanggan.');await delay(850);const deadline=h.state.questions[0].deadlineAt;
 await page.reload();await page.locator('#tara-answer:enabled').waitFor();assert.equal(h.state.questions[0].deadlineAt,deadline);assert.equal(await page.locator('#tara-answer').inputValue(),'Saya membantu pelanggan.');
 await page.setViewportSize({width:1536,height:1024});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.locator('#tara-answer').focus();await page.keyboard.press('Tab');assert.ok(await page.getByRole('button',{name:'Kirim ↗',exact:true}).evaluate(el=>el===document.activeElement));await page.getByRole('button',{name:'Kirim ↗',exact:true}).click();await page.getByTestId('tara-thinking').waitFor();
 assert.ok(await page.locator('#tara-answer').isDisabled());assert.equal(await page.getByRole('timer').count(),0);assert.ok(await page.getByText('Saya membantu pelanggan.',{exact:true}).isVisible());
 await page.screenshot({path:'tmp/tara-screening/thinking-desktop.png',fullPage:true});
 h.control.offline=true;await page.getByText('Koneksi terputus sebentar. Progresmu tersimpan, ya.').waitFor();assert.ok(await page.getByTestId('tara-thinking').isVisible());h.control.offline=false;
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-tara="runner"]').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/tara-screening/thinking-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const composer=await page.locator('#tara-answer').boundingBox();assert.ok(composer.y+composer.height<=844);
 await page.setViewportSize({width:390,height:430});await delay(200);const keyboardComposer=await page.locator('#tara-answer').boundingBox();assert.ok(keyboardComposer.y+keyboardComposer.height<=430,'composer stays inside reduced visual viewport');await page.setViewportSize({width:390,height:844});
 h.state={...h.state,questions:[...h.state.questions,...Array.from({length:12},(_,i)=>({id:'history'+i,text:'Pertanyaan sebelumnya '+i+' '+('Ceritakan pengalamanmu. '.repeat(5)),answer:'Saya menceritakan kontribusi pribadi secara ringkas.',draft:'',shownAt:new Date().toISOString(),deadlineAt:new Date().toISOString()}))]};await page.getByText('Pertanyaan sebelumnya 11',{exact:false}).waitFor();await delay(400);await page.getByRole('log').evaluate(el=>el.scrollTop=0);await delay(100);

 h.state={...h.state,status:'ACTIVE',revision:h.state.revision+1,questions:[...h.state.questions,{id:'q2',text:'Bagaimana urutan tindakanmu saat itu?',answer:null,draft:'',shownAt:null,deadlineAt:null}]};
 await page.getByText('Bagaimana urutan tindakanmu saat itu?',{exact:true}).waitFor();assert.equal(await page.getByRole('log').evaluate(el=>el.scrollTop),0,'new question does not interrupt reading older messages');assert.equal(h.state.questions.at(-1).shownAt,null,'unseen question does not start timer');await page.getByRole('log').evaluate(el=>el.scrollTop=el.scrollHeight);await page.locator('#tara-answer:enabled').waitFor();await page.locator('#tara-answer').fill('Saya mencatat permintaan, lalu menindaklanjutinya.');await page.getByRole('button',{name:'Kirim ↗',exact:true}).click();await page.getByRole('heading',{name:'Yeay, lamaranmu sudah terkirim!'}).waitFor();assert.equal(h.counts.submit,1);assert.ok(await page.locator('.nav-wrap').count());assert.deepEqual(h.errors,[]);await h.context.close();
 const r=await harness(browser,'ready',true);await r.open();await r.rules();await r.page.getByText('Tara sudah siap ngobrol!').waitFor();assert.equal(r.counts.start,0);await r.page.getByRole('button',{name:'Siap, yuk mulai! →'}).click();await r.page.locator('#tara-answer:enabled').waitFor();assert.equal(r.counts.start,1);assert.equal(await r.page.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).count(),0);assert.deepEqual(r.errors,[]);await r.context.close();
 const f=await harness(browser,'failure');await f.open();await f.rules();await f.page.getByRole('button',{name:'Siap, yuk mulai! →'}).click();await f.page.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).waitFor();
 f.state={...f.state,preparation:{...f.state.preparation,status:'FAILED',reason:'PREPARATION_FAILED'}};await f.page.getByRole('button',{name:'Coba lagi',exact:true}).click();assert.equal(f.counts.retry,1);await f.page.getByRole('heading',{name:'Tara lagi menyiapkan obrolanmu'}).waitFor();
 f.state={...f.state,preparation:{...f.state.preparation,status:'FAILED',reason:'RECOVERY_REQUIRED'}};await f.page.getByText('Obrolanmu perlu disambungkan kembali').waitFor();assert.equal(await f.page.getByRole('button',{name:'Coba lagi',exact:true}).count(),0);
 f.state={...f.state,preparation:{...f.state.preparation,status:'FAILED',reason:'CV_UNREADABLE'}};await f.page.getByRole('button',{name:'Ganti CV'}).click();await f.page.getByRole('heading',{name:'Pilih CV andalanmu'}).waitFor();assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('tara-start-intent:failure')),null);assert.ok(await f.page.locator('.nav-wrap').count());
 let releaseOld;let capturedOld;const captured=new Promise(resolve=>capturedOld=resolve);f.control.holdGet={captured:capturedOld,release:new Promise(resolve=>releaseOld=resolve)};await captured;
 await f.page.getByLabel('CV revisi.pdf').check();releaseOld();await delay(300);assert.ok(await f.page.getByLabel('CV revisi.pdf').isChecked());assert.equal(f.state.resumeId,'cv2');assert.equal(f.state.preparation.planId,'p2');await f.page.getByRole('button',{name:'Lanjut →',exact:true}).click();await f.page.locator('[data-preparation="PROCESSING"]').waitFor();assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('Tara waiting UX: ready/pending start, duplicate click, refresh/resume, timers, thinking, offline recovery, preparation failures, CV replacement, reduced motion, fullscreen and responsive layout passed. No live AI.');
 }finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
