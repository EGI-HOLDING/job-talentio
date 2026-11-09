// Resume the real final HR onboarding scene, select files, publish, navigate and finish background uploads.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only guard');
const out=path.resolve('output/recruitment-onboarding');fs.mkdirSync(out,{recursive:true});
async function main(){
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'}),report={errors:[],events:[],publish:0,metadata:0,uploadStarted:0,uploadCompleted:0};
 const company={id:'onboarding-co',name:'Studio Onboarding',slug:'studio-onboarding',description:'Perusahaan pengujian onboarding.',city:{name:'Kota Jakarta',slug:'jakarta',province:{country:{id:'ID'}}}},membership={companyId:'onboarding-co',role:'OWNER',company};
 const auth={accessToken:'onboarding-fixture',user:{id:'onboarding-hr',fullName:'Nadia Onboarding',role:'RECRUITER',email:'onboarding@example.test',emailVerified:true,recruiterOnboarding:{status:'IN_PROGRESS',step:2},memberships:[membership]}};
 let completed=false,scoreReady=false,files=[],resumeSession={id:'onboarding-session',companyId:company.id,company,phase:'JOB',revision:5,jobId:null,order:{id:'free-order',code:'FREE',status:'PAID',amount:0,currency:'IDR'},draft:{title:'API Engineer',description:'Membangun API untuk produk digital.',positionEntryMode:'MANUAL',responsibilities:['Membangun API'],kpis:['Layanan andal'],skills:[],languages:[],benefits:[],workMode:'ONSITE',employmentType:'FULL_TIME',currency:'IDR',salaryPeriod:'MONTHLY',countryId:'ID',citySlug:'jakarta'}};
 const job={id:'onboarding-job',companyId:company.id,company,title:'API Engineer',description:'Membangun API.',status:'PUBLISHED',createdAt:new Date().toISOString(),_count:{applications:0,views:0}};
 let releaseUploads;const gate=new Promise(resolve=>releaseUploads=resolve);
 try{
 await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));sessionStorage.setItem('talentio:hr-assistant:'+auth.user.id+':onboarding-session','cv-upload');},auth);
 await context.route('https://onboarding-upload.test/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT,OPTIONS','access-control-allow-headers':'*'}});report.uploadStarted++;await gate;return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},body:''});});
 await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname.replace(/^\/api/,''),method=req.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};if(method==='OPTIONS')return route.fulfill({status:204,headers});let body=[];
 if(p==='/auth/me')body={...auth,user:{...auth.user,recruiterOnboarding:{status:completed?'COMPLETE':'IN_PROGRESS',step:completed?3:2}}};
 else if(p==='/recruiter-onboarding')body={status:completed?'COMPLETE':'IN_PROGRESS',step:2,revision:3,flowVersion:2,phase:'JOB',companyId:company.id,creationSessionId:resumeSession.id,memberships:[membership]};
 else if(p==='/meta/industry-groups')body={groups:[]};
 else if(p==='/companies/mine')body=[membership];else if(p==='/companies/'+company.id)body=company;
 else if(p==='/job-commerce/catalog')body={version:1,hrFlowV2:true,enabled:true,testMode:true,paymentAvailable:false,packages:[{code:'FREE',amount:0,currency:'IDR',version:1,settings:{durationDays:30,boostDays:0,featuredDays:0,conversions:false,reports:false,prioritySupport:false},linkedin:false,instagram:'NONE'}]};
 else if(p==='/hr-flow/sessions/'+resumeSession.id&&method==='PATCH'){const input=req.postDataJSON();resumeSession={...resumeSession,revision:resumeSession.revision+1,draft:input.draft};body=resumeSession;}
 else if(p==='/hr-flow/sessions/'+resumeSession.id)body=resumeSession;
 else if(p==='/hr-flow/sessions/'+resumeSession.id+'/publish'){report.publish++;report.events.push('publish');body={jobId:job.id};}
 else if(p==='/recruitment/imports'&&method==='POST'){report.metadata++;const input=req.postDataJSON();assert.equal(input.jobId,job.id);assert.deepEqual(input.files.map(file=>file.filename),['Kandidat-A.pdf','Kandidat-B.pdf','Kandidat-C.pdf','Kandidat-D.pdf']);files=input.files.map((f,i)=>({...f,id:'onboarding-cv-'+i,status:'UPLOADING'}));report.events.push('register-import');body={id:'onboarding-import',files};}
 else if(/^\/recruitment\/candidates\/onboarding-cv-\d+\/upload-url$/.test(p))body={status:'UPLOADING',uploadUrl:'https://onboarding-upload.test/'+p.split('/')[3]};
 else if(/^\/recruitment\/candidates\/onboarding-cv-\d+\/upload-complete$/.test(p)){report.uploadCompleted++;report.events.push('upload-complete');body={scoreStatus:'PENDING'};}
 else if(p==='/recruitment/imports/onboarding-import')body={id:'onboarding-import',files:files.map(f=>({...f,scoreStatus:scoreReady?'READY':'PROCESSING'}))};
 else if(p==='/recruiter-onboarding/complete'){completed=true;report.events.push('onboarding-complete');body={status:'COMPLETE'};}
 else if(p==='/jobs/company/'+company.id)body=[job];else if(p.startsWith('/applications/jobs/'))body={items:[],total:0};else if(p.includes('/unread'))body={count:0};
 return route.fulfill({status:200,headers,json:body});});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/id/onboarding/recruiter',{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('heading',{name:'Upload CV kandidat',exact:true}).waitFor({timeout:60000});
 const cv = name => ({name:'Kandidat-'+name+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic-'+name)});
 const picker = page.locator('input[type=file]');
 const drop = page.getByRole('button',{name:/Tarik CV ke sini/});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Tarik CV ke sini')&&!button.disabled));
 assert.equal(await drop.evaluate(el=>getComputedStyle(el).cursor),'pointer');
 await page.screenshot({path:path.join(out,'00-upload-empty.png')});
 const chooser = page.waitForEvent('filechooser');
 await drop.click();
 await (await chooser).setFiles(['A','B','C'].map(cv));
 const filesList = page.getByRole('list',{name:'CV yang dipilih'});
 await page.getByText('3 CV dipilih',{exact:true}).waitFor();
 await picker.setInputFiles(cv('D'));
 await page.getByText('4 CV dipilih',{exact:true}).waitFor();
 assert.deepEqual(await filesList.locator('li > span').allTextContents(),['A','B','C','D'].map(name=>cv(name).name));
 const transfer = await page.evaluateHandle(()=>{
   const data = new DataTransfer();
   data.items.add(new File(['%PDF-1.4 synthetic-E'],'Kandidat-E.pdf',{type:'application/pdf'}));
   data.items.add(new File(['bad'],'Kandidat.txt',{type:'text/plain'}));
   return data;
 });
 await drop.dispatchEvent('dragover',{dataTransfer:transfer});
 await page.getByRole('button',{name:/Lepas untuk menambahkan CV/}).waitFor();
 await page.getByRole('button',{name:/Lepas untuk menambahkan CV/}).dispatchEvent('drop',{dataTransfer:transfer});
 await page.getByRole('alert').filter({hasText:'Kandidat.txt'}).waitFor();
 await page.getByText('5 CV dipilih',{exact:true}).waitFor();
 await filesList.getByRole('button',{name:'Hapus Kandidat-E.pdf'}).click();
 await page.getByText('4 CV dipilih',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'01-selected-cvs.png')});
 await page.getByRole('button',{name:'Lanjut',exact:true}).click();await page.waitForURL(/\/dashboard\/recruiter/,{timeout:60000});await page.getByRole('complementary',{name:'Progres impor CV'}).waitFor();assert.equal(report.publish,1);assert.equal(report.metadata,1);assert.equal(report.uploadCompleted,0,'dashboard navigation does not await file transfer');assert.ok(report.events.includes('onboarding-complete'));await page.screenshot({path:path.join(out,'02-dashboard-during-upload.png')});
 releaseUploads();await page.waitForFunction(()=>document.querySelector('[aria-label="Progres impor CV"]')?.textContent.includes('Menilai CV'),{timeout:20000});assert.equal(report.uploadCompleted,4);scoreReady=true;await page.getByRole('complementary',{name:'Progres impor CV'}).getByRole('button',{name:/Impor CV selesai/}).waitFor({timeout:15000});assert.deepEqual(report.errors,[]);
 console.log('HR onboarding passed: actual final assistant scene, four selected CVs across repeated picks and mixed drag-and-drop, one publication, job-scoped import, onboarding completion and dashboard navigation while PUT transfers remain blocked, then uploads and scoring finish. Paid calls: 0.');
 }finally{releaseUploads();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
