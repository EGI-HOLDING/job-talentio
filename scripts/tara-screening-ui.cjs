// Browser exercise against a local Next server; every API is synthetic and intercepted.
const {createRequire}=require('node:module');const path=require('node:path');const assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.TARA_UI_ORIGIN||'http://localhost:3012';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only UI guard');
async function main(){const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 const session={accessToken:'synthetic-only',user:{id:'ui-fixture',role:'EMPLOYEE',fullName:'Alya Putri',phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}};
 let state={id:'s1',status:'DRAFT',resumeId:'cv1',applicationId:null,coverLetter:'',coverFilename:null,packetReady:true,preparationStatus:'READY',revision:0,questions:[],job:{id:'job',title:'Customer Service',companyName:'PT Nusa Karya',city:'Jakarta'}};
 await page.addInitScript(session=>{localStorage.setItem('jt_token',session.accessToken);localStorage.setItem('jt_session',JSON.stringify(session));},session);
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;let body={};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'*'}});return;}
  if(p.endsWith('/profiles/me/onboarding'))body={status:'COMPLETED',profile:{phone:'+6281234567890'}};
  else if(p.endsWith('/profiles/me'))body={resumes:[{id:'cv1',title:'CV_Alya_Putri.pdf',hasFile:true,isPrimary:true}]};
  else if(p.endsWith('/capabilities'))body={enabled:true};
  else if(p.includes('/ai-screening/')){
   if(p.endsWith('/start'))state={...state,status:'ACTIVE',revision:1,questions:[{id:'q1',text:'Di CV kamu menyebut membantu pelanggan. Bagian apa yang kamu kerjakan sendiri?',answer:null,draft:'',shownAt:null,deadlineAt:null}]};
   else if(p.endsWith('/shown'))state={...state,questions:state.questions.map(q=>({...q,shownAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+60000).toISOString()}))};
   else if(p.endsWith('/answer')&&route.request().method()==='PATCH'){const input=route.request().postDataJSON();state={...state,questions:state.questions.map(q=>q.id===input.questionId?{...q,draft:input.answer}:q)};}
   else if(p.endsWith('/answer')&&route.request().method()==='POST'){
    const input=route.request().postDataJSON();state={...state,status:state.questions.length===1?'GENERATING':'COMPLETED',revision:state.revision+1,questions:state.questions.map(q=>q.id===input.questionId?{...q,answer:input.answer}:q)};
   }else if(state.status==='GENERATING'&&route.request().method()==='GET')state={...state,status:'ACTIVE',questions:[...state.questions,{id:'q2',text:'Tadi kamu menyebut membantu pelanggan. Bagaimana urutan tindakanmu?',answer:null,draft:'',shownAt:null,deadlineAt:null}]};
   body={...state,serverTime:new Date().toISOString()};
  }else if(p.endsWith('/submit')){state={...state,status:'SUBMITTED',applicationId:'app'};body={id:'app'};}
  else if(p.includes('/notifications')||p.includes('/companies/mine'))body=[];
  else if(p.includes('/download'))body={url:'about:blank'};
  await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
 });
 page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/id/apply/job');
 await page.getByRole('heading',{name:'Pilih CV andalanmu'}).waitFor();assert.equal(await page.locator('img[data-tara]').count(),0);
 await page.screenshot({path:'tmp/tara-screening/ui-cv.png',fullPage:true});
 await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('heading',{name:'Ceritakan sedikit tentang dirimu'}).waitFor();assert.equal(await page.locator('img[data-tara]').count(),0);
 await page.getByRole('button',{name:'Lanjut →',exact:true}).click();await page.getByRole('heading',{name:'Hai Alya, aku Tara!'}).waitFor();assert.equal(await page.locator('img[data-tara]').count(),1);
 await page.screenshot({path:'tmp/tara-screening/ui-intro.png',fullPage:true});
 await page.getByRole('button',{name:'Lihat aturan singkat →'}).click();await page.getByRole('button',{name:'Siap, yuk mulai! →'}).click();await page.getByRole('heading',{name:'Ngobrol bersama Tara'}).waitFor();
 await page.locator('#tara-answer').fill('Saya membantu pelanggan.');await page.waitForTimeout(850);await page.screenshot({path:'tmp/tara-screening/ui-chat.png',fullPage:true});
 const deadlineBefore=state.questions[0].deadlineAt;
 await page.reload();await page.locator('#tara-answer').waitFor();assert.match(await page.getByRole('timer').innerText(),/00:|01:/);assert.equal(state.questions[0].deadlineAt,deadlineBefore);assert.equal(await page.locator('#tara-answer').inputValue(),'Saya membantu pelanggan.');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/tara-screening/ui-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile has no horizontal overflow');
 await page.locator('#tara-answer').fill('Saya membantu pelanggan.');await page.getByRole('button',{name:'Kirim ↗',exact:true}).click();await page.getByText('Tadi kamu menyebut membantu pelanggan. Bagaimana urutan tindakanmu?',{exact:true}).waitFor();await page.locator('#tara-answer').fill('Saya mencatat permintaan, lalu menindaklanjutinya.');await page.getByRole('button',{name:'Kirim ↗',exact:true}).click();await page.getByRole('heading',{name:'Yeay, lamaranmu sudah terkirim!'}).waitFor();
 assert.deepEqual(errors,[]);console.log('Tara browser: six pages, mascot visibility, resume, mobile layout and successful submission passed.');
 }finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
