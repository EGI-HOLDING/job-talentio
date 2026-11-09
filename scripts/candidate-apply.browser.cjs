const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const {chromium}=createRequire('C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only browser guard');
const out=path.resolve('output/candidate-apply');fs.mkdirSync(out,{recursive:true});
const auth={accessToken:'synthetic-apply-only',user:{id:'apply-candidate',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'apply@synthetic.test',emailVerified:true,phone:'+6281234567890',employeeOnboarding:{status:'COMPLETED',step:3}}};
const job={id:'candidate-apply-job',title:'Product Designer',description:'Mendesain produk digital dan melakukan riset pengguna.',companyId:'apply-company',company:{id:'apply-company',name:'Studio Nusantara',slug:'studio-nusantara',description:'Perusahaan teknologi dan desain.',_count:{jobs:1},city:{name:'Jakarta'}},status:'PUBLISHED',publishedAt:'2026-11-01T00:00:00Z',createdAt:'2026-11-01T00:00:00Z',city:{name:'Jakarta'},workMode:'REMOTE',employmentType:'FULL_TIME',experienceLevel:'MIDDLE',jobSkills:[],jobLanguages:[],questions:[],benefits:[]};
async function main(){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),report={errors:[],submissions:[],screeningRequests:0};let applied=false,release,attempts=0;
 try{
  await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));localStorage.setItem('jt_country','ID');},auth);
  await context.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname.replace(/^\/api/,''),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});let body=[];
   if(p.includes('ai-screening')){report.screeningRequests++;return route.fulfill({status:500,headers,json:{message:'Application must not start Tara'}});}
   if(p==='/auth/me')body=auth;
   else if(p==='/profiles/me/onboarding')body={status:'COMPLETED',profile:{phone:auth.user.phone}};
   else if(p==='/jobs/'+job.id)body=job;
   else if(p==='/profiles/me')body={id:'profile',resumes:[{id:'resume-1',title:'CV Product Designer',format:'pdf',hasFile:true,isPrimary:true,updatedAt:'2026-11-02T00:00:00Z'},{id:'resume-2',title:'CV UI-UX General',format:'pdf',hasFile:true,isPrimary:false,updatedAt:'2026-10-21T00:00:00Z'}]};
   else if(p==='/applications/mine/jobs/'+job.id)body={applied,application:applied?{id:'application-applied',status:'NEW',createdAt:new Date().toISOString(),resumeTitle:'CV UI-UX General',hasResumeFile:true}:null};
   else if(p==='/applications/jobs/'+job.id){attempts++;report.submissions.push(req.postDataJSON());await new Promise(resolve=>release=resolve);if(attempts===1)return route.fulfill({status:503,headers,json:{message:'Gangguan sementara. Silakan coba lagi.'}});applied=true;return route.fulfill({status:503,headers,json:{message:'Synthetic response lost after server commit'}});}
   else if(p.endsWith('/following'))body={following:false};
   else if(/unread/.test(p))body={count:0};
   return route.fulfill({status:200,headers,json:body});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/id/jobs/'+job.id,{waitUntil:'domcontentloaded',timeout:120000});
  await page.getByRole('button',{name:/Lamar sekarang/i}).first().click();const dialog=page.getByRole('dialog',{name:'Pilih CV untuk melamar',exact:true});await dialog.waitFor();
  await dialog.getByRole('radio',{name:/CV UI-UX General/}).check();await page.screenshot({path:path.join(out,'01-cv-popup.png')});
  await dialog.getByRole('button',{name:'Lamar dengan CV ini',exact:true}).click();for(let i=0;i<80&&!release;i++)await new Promise(r=>setTimeout(r,25));assert.equal(report.submissions.length,1);assert.equal(await dialog.getByRole('radio').first().isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);release();release=null;await dialog.getByRole('alert').waitFor();
  await dialog.getByRole('button',{name:'Lamar dengan CV ini',exact:true}).click();for(let i=0;i<80&&!release;i++)await new Promise(r=>setTimeout(r,25));release();await dialog.waitFor({state:'detached'});
  assert.equal(report.submissions.length,2);assert.deepEqual(report.submissions,[{resumeId:'resume-2'},{resumeId:'resume-2'}]);assert.equal(report.screeningRequests,0);assert.deepEqual(report.errors,[]);
  assert.ok(page.url().includes('/jobs/'+job.id));await page.screenshot({path:path.join(out,'02-applied.png')});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Candidate apply browser passed: approved CV popup, selection, locked pending state, retryable error, lost-success response reconciliation, CV-only payload and no Tara/application steps.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
