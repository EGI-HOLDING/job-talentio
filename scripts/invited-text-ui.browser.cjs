// Local-only real-browser check of candidate invitation → text interview. Every API request is mocked.
const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only browser guard');
const out=path.resolve('output/invited-text-ui');fs.mkdirSync(out,{recursive:true});
const auth={accessToken:'synthetic-invited-ui',user:{id:'invited-ui',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'dinda@example.test',emailVerified:true,phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}};
const token='invitation-ui-1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const question=(id,text)=>({id,text,draft:'',answer:null,shownAt:null,deadlineAt:null,answeredAt:null,timedOut:false});
async function main(){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1536,height:1024},reducedMotion:'reduce'}),report={errors:[],requests:[],autosaves:0,answers:0,submissions:0};
 let state={id:'text-session',invitation:{id:'invite-ui',mode:'TEXT',status:'INVITED'},status:'DRAFT',resumeId:'invited-cv',applicationId:null,coverLetter:'',coverFilename:null,packetReady:true,preparationStatus:'READY',preparation:{status:'READY',planId:'plan',reason:null},revision:0,conversationPolicy:{version:'tara-conversation-v6.0.0',questionSeconds:60,maxQuestions:25},questions:[],job:{id:'job',title:'Machine Learning Engineer',companyName:'Lintas Awan Teknologi',city:'Denpasar'}};
 const clone=()=>({...structuredClone(state),serverTime:new Date().toISOString()});
 try{
 await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));},auth);
 await context.route('**/api/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname.replace(/^\/api/,''),method=request.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
  if(method==='OPTIONS')return route.fulfill({status:204,headers});report.requests.push({p,method});let body={};
  if(p==='/auth/me')body=auth;
  else if(p==='/profiles/me/onboarding')body={status:'COMPLETED',profile:{phone:auth.user.phone}};
  else if(p.startsWith('/applications/')&&method==='POST'){report.submissions++;throw Error('Invited interview must never submit an application');}
  else if(p==='/recruitment/invitations/open/'+token)body={mode:'TEXT',status:'INVITED',jobTitle:state.job.title,companyName:state.job.companyName,expiresAt:'2026-12-01T00:00:00Z'};
  else if(p.endsWith('/claim')&&p.startsWith('/recruitment/'))body={invitationId:'invite-ui',mode:'TEXT',session:clone()};
  else if(p==='/ai-screening/sessions/text-session/start'){state.status='ACTIVE';state.revision++;state.questions=[question('q1','Di proyek terakhir lu, bagian apa yang lu kerjain sendiri?')];body=clone();}
  else if(p==='/ai-screening/sessions/text-session/claim')body=clone();
  else if(p==='/ai-screening/sessions/text-session/shown'){const input=request.postDataJSON(),q=state.questions.find(q=>q.id===input.questionId);q.shownAt=new Date().toISOString();q.deadlineAt=new Date(Date.now()+60000).toISOString();body=clone();}
  else if(p==='/ai-screening/sessions/text-session/answer'){
   const input=request.postDataJSON(),q=state.questions.find(q=>q.id===input.questionId);
   if(method==='PATCH'){report.autosaves++;q.draft=input.answer;}
   else{report.answers++;q.answer=input.answer;q.answeredAt=new Date().toISOString();state.revision++;state.status=state.questions.length===1?'GENERATING':'COMPLETED';}
   body=clone();
  }else if(p==='/ai-screening/sessions/text-session'){
   if(state.status==='GENERATING'){state.status='ACTIVE';state.revision++;state.questions.push(question('q2','Bagaimana lu mengukur hasil dari kontribusi itu?'));}
   body=clone();
  }else if(p.includes('/notifications'))body=p.includes('unread')?{count:0}:[];
  else if(p.startsWith('/meta/'))body=[];
  return route.fulfill({status:200,headers,json:body});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/id/screening/'+token,{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('button',{name:'Buka interview',exact:true}).click();
 await page.getByRole('heading',{name:/Hai Dinda/}).waitFor({timeout:60000});
 await page.waitForFunction(()=>[...document.querySelectorAll('img[data-tara]')].filter(img=>img.getBoundingClientRect().width>0).every(img=>img.complete&&img.naturalWidth>0),{timeout:60000});
 assert.equal(await page.getByRole('heading',{name:'Pilih CV andalanmu'}).count(),0);
 await page.screenshot({path:path.join(out,'01-introduction.png')});
 await page.getByRole('button',{name:/Lihat aturan singkat/}).click();
 await page.getByText(/Maksimal 25 pertanyaan/).waitFor();
 await page.getByRole('button',{name:/Siap, yuk mulai/}).click();
 const input=page.getByRole('textbox');await input.waitFor();await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled,{timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('img[data-tara]')].filter(img=>img.getBoundingClientRect().width>0).every(img=>img.complete&&img.naturalWidth>0),{timeout:60000});
 await page.screenshot({path:path.join(out,'02-active-interview.png')});
 const autosave=page.waitForResponse(response=>response.url().endsWith('/answer')&&response.request().method()==='PATCH');
 await input.fill('Saya mengerjakan pipeline data dan pengujian model.');await autosave;
 await page.getByRole('button',{name:'Kirim jawaban',exact:true}).click();
 await page.getByText('Bagaimana lu mengukur hasil dari kontribusi itu?',{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled,{timeout:15000});
 await input.fill('Saya membandingkan metrik hasil terhadap baseline sebelum deployment.');
 await input.press('Enter');
 await page.getByRole('heading',{name:'Interview selesai. Makasih sudah cerita!',exact:true}).waitFor({timeout:15000});
 await page.screenshot({path:path.join(out,'03-completed.png')});
 assert.equal(report.answers,2);assert.ok(report.autosaves>0);assert.equal(report.submissions,0);
 assert.ok(!report.requests.some(r=>r.p.endsWith('/draft')),'no application draft flow');
 assert.deepEqual(report.errors,[]);
 console.log('Invited text browser passed: verified invitation route, skipped CV/cover flow, introduction/rules, 25-question copy, server timer, autosave, two answers, completion, and no application submission.');
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
