// Resume the real final HR onboarding scene, select files, publish, navigate and finish background uploads.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Local-only guard');
const out=path.resolve(process.env.ONBOARDING_OUTPUT_DIR||'output/recruitment-onboarding');fs.mkdirSync(out,{recursive:true});
async function main(scenario){
 const assessment=scenario.startsWith('assessment-'),dashboard=scenario==='assessment-dashboard'||scenario.startsWith('assessment-template');
 const template=scenario.startsWith('assessment-template');
 const lite=scenario==='assessment-template-lite';
 const templateCode=lite?'LITE':scenario==='assessment-template-standard'?'STANDARD':'FREE';
 const templateAmount=lite?49000:templateCode==='STANDARD'?149000:0;
 const catalogV2=lite||process.env.ONBOARDING_CATALOG_V2==='true';
 const tiers=catalogV2?[['LITE',49000,1,3],['STANDARD',149000,3,14],['PREMIUM',299000,7,30]]:
   [['FREE',0,0,0],...(templateAmount?[['STANDARD',149000,3,7]]:[])];
 const packages=tiers.map(([code,amount,boostDays,featuredDays])=>({code,amount,currency:'IDR',version:catalogV2?2:1,
   settings:{durationDays:30,boostDays,featuredDays,conversions:false,reports:false,prioritySupport:false},linkedin:false,instagram:'NONE'}));
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})}),context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'});
 const report={scenario,errors:[],events:[],publish:0,metadata:0,complete:0,uploadStarted:0,uploadCompleted:0,publishKeys:[],importKeys:[],aiRequests:[]};
 const company={id:'onboarding-co',name:'Studio Onboarding',slug:'studio-onboarding',description:'Perusahaan pengujian onboarding.',city:{name:'Kota Jakarta',slug:'jakarta',province:{country:{id:'ID'}}}},membership={companyId:'onboarding-co',role:'OWNER',company};
 const auth={accessToken:'onboarding-fixture',user:{id:'onboarding-hr',fullName:'Nadia Onboarding',role:'RECRUITER',email:'onboarding@example.test',emailVerified:true,recruiterOnboarding:{status:'IN_PROGRESS',step:2},memberships:[membership]}};
 let completed=false,scoreReady=false,files=[],resumeSession={id:'onboarding-session',companyId:company.id,company,phase:'JOB',revision:5,jobId:null,order:{id:'free-order',code:'FREE',status:'PAID',amount:0,currency:'IDR'},draft:{title:'API Engineer',description:'Membangun API untuk produk digital.',positionEntryMode:'MANUAL',responsibilities:['Membangun API'],kpis:['Layanan andal'],skills:[],languages:[],benefits:[],workMode:'ONSITE',employmentType:'FULL_TIME',currency:'IDR',salaryPeriod:'MONTHLY',countryId:'ID',citySlug:'jakarta'}};
 if(assessment) {
   report.assessmentWrites=[];
   report.purchaseOrders=0;
   resumeSession.draft.jobContentAiLanguage='id';
 }
 if(dashboard){completed=true;auth.user.recruiterOnboarding={status:'COMPLETE',step:3};}
 if(template){
   Object.assign(resumeSession,{phase:'CHECKOUT',templateId:'synthetic-template',order:null});
   resumeSession.draft._selectedPackageCode=templateCode;
 }
 const job={id:'onboarding-job',companyId:company.id,company,title:'API Engineer',description:'Membangun API.',status:'PUBLISHED',createdAt:new Date().toISOString(),_count:{applications:0,views:0}};
 let releaseUploads;const gate=new Promise(resolve=>releaseUploads=resolve);
 try{
 await context.addInitScript(({auth,initialScene})=>{
   if (sessionStorage.getItem('onboarding-fixture-seeded')) return;
   localStorage.setItem('jt_token',auth.accessToken);
   localStorage.setItem('jt_session',JSON.stringify(auth));
   sessionStorage.setItem('talentio:hr-assistant:'+auth.user.id+':onboarding-session',initialScene);
   sessionStorage.setItem('onboarding-fixture-seeded','1');
 },{auth,initialScene:['navigation','validation','ai-drafting','assessment-onboarding'].includes(scenario)?'taka-intro':'cv-upload'});
 await context.route('https://onboarding-upload.test/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT,OPTIONS','access-control-allow-headers':'*'}});report.uploadStarted++;await gate;return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},body:''});});
 await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname.replace(/^\/api/,''),method=req.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};if(method==='OPTIONS')return route.fulfill({status:204,headers});let body=[];
 if(p==='/auth/me')body={...auth,user:{...auth.user,recruiterOnboarding:{status:completed?'COMPLETE':'IN_PROGRESS',step:completed?3:2}}};
 else if(p==='/recruiter-onboarding')body={status:completed?'COMPLETE':'IN_PROGRESS',step:2,revision:3,flowVersion:2,phase:'JOB',companyId:company.id,creationSessionId:resumeSession.id,memberships:[membership]};
 else if(p==='/meta/industry-groups')body={groups:[]};
 else if(p==='/meta/seniority-levels')body={levels:[]};
 else if(p==='/meta/countries')body=[{id:'ID',name:'Indonesia',currencyCode:'IDR'}];
 else if(p==='/meta/cities')body=[company.city];
 else if(p==='/job-content-ai/generate'){
   const input=req.postDataJSON();report.aiRequests.push(input);
   assert.equal(input.companyId,company.id);assert.equal(input.job.title,'API Engineer');
   assert.ok(Array.isArray(input.job.responsibilities)&&Array.isArray(input.job.skills));
   const attempt=report.aiRequests.filter(r=>r.target===input.target).length;
   await new Promise(resolve=>setTimeout(resolve,250));
   if(input.target==='responsibilities'&&attempt===1)return route.fulfill({status:503,headers,json:{message:'Saran AI belum tersedia. Coba lagi.'}});
   if(input.target==='skills'&&attempt===1)body={target:'kpis',suggestion:{items:['Respons salah bagian']},promptVersion:'synthetic'};
   else if(input.outputLanguage==='en')body={target:input.target,promptVersion:'synthetic',suggestion:input.target==='description'
     ?{description:'Design reliable TypeScript APIs and support the needs of the company’s digital products.'}
     :input.target==='skills'?{items:[{name:'TypeScript',isRequired:true,minLevel:'INTERMEDIATE'}]}
     :{items:input.target==='responsibilities'?['Develop API services.','Write integration tests.']:['Maintain service reliability.','Complete testing before release.']}};
   else body={target:input.target,promptVersion:'synthetic',suggestion:input.target==='description'?{description:'Mengembangkan API TypeScript yang andal serta mendukung kebutuhan produk digital perusahaan.'}:input.target==='skills'?{items:[{name:'TypeScript',isRequired:true,minLevel:'INTERMEDIATE'}]}:{items:input.target==='responsibilities'?['Mengembangkan layanan API.','Menulis pengujian integrasi.']:['Menjaga tingkat keberhasilan layanan.','Menyelesaikan pengujian sebelum rilis.']}};
 }
 else if(p==='/companies/mine')body=[membership];else if(p==='/companies/'+company.id)body=company;
 else if(p==='/job-commerce/catalog')body={version:catalogV2?2:1,hrFlowV2:true,assessmentLanguageSelection:assessment,enabled:true,testMode:true,paymentAvailable:false,packages};
 else if(p==='/hr-flow/sessions/'+resumeSession.id&&method==='PATCH'){
   const input=req.postDataJSON();
   if(assessment&&input.assessmentLanguage){
     assert.equal(input.revision,resumeSession.revision);
     report.assessmentWrites.push(input.assessmentLanguage);
     await new Promise(resolve=>setTimeout(resolve,200));
     if(scenario==='assessment-onboarding'&&report.assessmentWrites.length===1)return route.fulfill({status:503,headers,json:{message:'Temporary save failure'}});
     report.events.push('language');
   }
   resumeSession={...resumeSession,revision:resumeSession.revision+1,
     ...(input.draft?{draft:input.draft}:{}),...(input.assessmentLanguage?{assessmentLanguage:input.assessmentLanguage}:{})};body=resumeSession;
 }
 else if(p==='/hr-flow/sessions/'+resumeSession.id)body=resumeSession;
 else if(template&&p==='/job-commerce/orders'&&method==='POST'){
   report.purchaseOrders++;
   assert.equal(report.events[0],'language');
   report.events.push('order');
   const code=req.postDataJSON().code;
   assert.equal(code,templateCode);
   resumeSession={...resumeSession,revision:resumeSession.revision+1,phase:templateAmount?'CHECKOUT':'JOB',order:{id:'template-order',code,status:templateAmount?'PENDING':'PAID',amount:templateAmount,currency:'IDR'}};
   body=resumeSession.order;
 }
 else if(template&&p==='/job-commerce/orders/template-order/complete-test'){
   report.events.push('payment');
   resumeSession={...resumeSession,phase:'JOB',revision:resumeSession.revision+1,order:{...resumeSession.order,status:'PAID'}};
   body=resumeSession.order;
 }
 else if(template&&p==='/hr-flow/sessions/'+resumeSession.id+'/publish-template'){
   assert.equal(resumeSession.order.status,'PAID');
   assert.ok(resumeSession.assessmentLanguage);
   report.publish++;
   report.events.push('publish');
   resumeSession={...resumeSession,phase:'PUBLISHED',jobId:job.id};
   body={jobId:job.id};
 }
 else if(p==='/hr-flow/sessions/'+resumeSession.id+'/publish'){
   report.publish++;
   report.publishKeys.push(req.headers()['idempotency-key']);
   if(assessment){assert.ok(resumeSession.assessmentLanguage);assert.equal(req.postDataJSON().revision,resumeSession.revision);}
   if(scenario==='upload'&&report.publish===1)return route.fulfill({status:503,headers,json:{message:'Publikasi belum terkonfirmasi.'}});
   report.events.push('publish');body={jobId:job.id};
 }
 else if(p==='/recruitment/imports'&&method==='POST'){
   report.metadata++;
   const input=req.postDataJSON();
   report.importKeys.push(input.requestKey);
   assert.equal(input.jobId,job.id);
   assert.deepEqual(input.files.map(file=>file.filename),['Kandidat-A.pdf','Kandidat-B.pdf','Kandidat-C.pdf','Kandidat-D.pdf']);
   if(scenario==='upload'&&report.metadata===1)return route.fulfill({status:503,headers,json:{message:'Impor belum terkonfirmasi.'}});
   files=input.files.map((f,i)=>({...f,id:'onboarding-cv-'+i,status:'UPLOADING'}));
   report.events.push('register-import');body={id:'onboarding-import',files};
 }
 else if(/^\/recruitment\/candidates\/onboarding-cv-\d+\/upload-url$/.test(p))body={status:'UPLOADING',uploadUrl:'https://onboarding-upload.test/'+p.split('/')[3]};
 else if(/^\/recruitment\/candidates\/onboarding-cv-\d+\/upload-complete$/.test(p)){report.uploadCompleted++;report.events.push('upload-complete');body={scoreStatus:'PENDING'};}
 else if(p==='/recruitment/imports/onboarding-import')body={id:'onboarding-import',files:files.map(f=>({...f,scoreStatus:scoreReady?'READY':'PROCESSING'}))};
 else if(p==='/recruiter-onboarding/complete'){
   report.complete++;
   if(scenario==='upload'&&report.complete===1)return route.fulfill({status:503,headers,json:{message:'Dashboard belum siap.'}});
   completed=true;report.events.push('onboarding-complete');body={status:'COMPLETE'};
 }
 else if(p==='/jobs/company/'+company.id)body=[job];else if(p.startsWith('/applications/jobs/'))body={items:[],total:0};else if(p.includes('/unread'))body={count:0};
 return route.fulfill({status:200,headers,json:body});});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+(dashboard?'/en/dashboard/recruiter?creationSession='+resumeSession.id:'/id/onboarding/recruiter'),{waitUntil:'domcontentloaded',timeout:120000});
 const cv = name => ({name:'Kandidat-'+name+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic-'+name)});
 const picker = page.locator('input[type=file]');
 const story = page.locator('[data-hr-assistant]');
 const back = story.getByRole('button',{name:'Kembali',exact:true});
 const upload = story.getByRole('button',{name:'Upload',exact:true});
 const skip = story.getByRole('button',{name:'Lewati',exact:true});
 const next = story.getByRole('button',{name:'Lanjut',exact:true});
 const filesList = page.getByRole('list',{name:'CV yang dipilih'});
 const scene = id => page.locator('[data-hr-assistant][data-scene="'+id+'"]');
 async function reachUpload(){
   for (const id of ['cv-sources','cv-ranking','tara-intro','chat-demo','voice-demo','cv-upload']) {
     await next.click();
     await scene(id).waitFor();
   }
 }
 if(assessment){
   const dialog=page.getByRole('dialog',{name:dashboard?'Interview and assessment language':'Bahasa wawancara dan penilaian',exact:true});
   const language=dialog.getByRole('combobox');
   const formAction=page.locator('button[form="hr-job-form"]');
   if(template){
     if(lite)await page.getByText(/IDR\s?49,000/u).first().waitFor({timeout:20000});
     await page.getByRole('button',{name:templateAmount?/continue to payment/i:/confirm free package/i}).click();
   }else if(scenario==='assessment-onboarding'){
     await scene('taka-intro').waitFor({timeout:40000});
     await back.click();
     await formAction.click();
   }else if(scenario==='assessment-resume'){
     await scene('cv-upload').waitFor({timeout:40000});
     await skip.click();
   }else await formAction.click({timeout:40000});
   await dialog.waitFor();
   const publish=dialog.getByRole('button',{name:dashboard?/publish job|continue to payment/i:/^Lanjut$|^Publikasikan lowongan$/u});
   assert.equal(await language.evaluate(el=>el===document.activeElement),true);
   assert.equal(await publish.isDisabled(),true);
   assert.ok((await language.locator('option').allTextContents()).slice(1).join(',')==='Bahasa Indonesia,English');
   assert.equal(report.publish,0);
   const choice=dashboard?'id':'en';
   await language.selectOption(choice);
   if(scenario==='assessment-onboarding'){
     await page.keyboard.press('Escape');
     await dialog.waitFor({state:'hidden'});
     assert.equal(report.assessmentWrites.length,0);
     assert.equal(await formAction.evaluate(el=>el===document.activeElement),true);
     await formAction.click();
     await dialog.waitFor();
     assert.equal(await language.inputValue(),'');
     await language.selectOption('en');
     for(const [name,width,height] of [['desktop',1440,960],['tablet',768,1024],['mobile',390,844]]){
       await page.setViewportSize({width,height});
       const bounds=await dialog.boundingBox();
       assert.ok(bounds&&bounds.x>=12&&bounds.x+bounds.width<=width-12);
       await page.screenshot({path:path.join(out,'dialog-'+name+'.png')});
     }
     await publish.click();
     await dialog.getByRole('alert').waitFor();
     assert.equal(await language.inputValue(),'en');
     assert.equal(report.publish,0);
   }
   await publish.evaluate(button=>{button.click();button.click();});
   await dialog.waitFor({state:'hidden'});
   assert.equal(resumeSession.assessmentLanguage,choice);
   if(scenario==='assessment-onboarding'){
     await scene('taka-intro').waitFor();assert.equal(report.publish,0);
     await page.reload({waitUntil:'domcontentloaded'});
     await scene('taka-intro').waitFor();
     await reachUpload();await skip.click();
   }
   await page.waitForURL(/dashboard\/recruiter/u);
   assert.equal(report.publish,1);
   assert.equal(resumeSession.draft.jobContentAiLanguage,'id');
   assert.equal(report.purchaseOrders,template?1:0);
   assert.equal(report.assessmentWrites.length,scenario==='assessment-onboarding'?2:1);
   assert.deepEqual(report.errors,[]);
   return;
 }
 if(scenario==='ai-drafting'){
   await scene('taka-intro').waitFor({timeout:60000});await back.click();
   await page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
   const description=page.locator('textarea[name="description"]'),original=await description.inputValue();
   const ai=label=>page.getByRole('button',{name:'Buat dengan AI: '+label,exact:true});
   const dialog=page.getByRole('dialog',{name:/Tinjau hasil AI/});
   const languageDialog=page.getByRole('dialog',{name:'Pilih bahasa AI'});
   const language=languageDialog.getByRole('combobox',{name:'Bahasa hasil'});
   const generate=languageDialog.getByRole('button',{name:'Buat saran',exact:true});
   await ai('Deskripsi posisi').click();await languageDialog.waitFor();
   assert.equal(report.aiRequests.length,0,'the first icon only opens the language picker');
   assert.equal(await generate.isDisabled(),true);
   assert.equal(await language.evaluate(el=>el===document.activeElement),true);
   assert.deepEqual(await language.locator('option').allTextContents(),['Pilih bahasa','Bahasa Indonesia','English']);
   await language.selectOption('id');
   await page.keyboard.press('Escape');await languageDialog.waitFor({state:'hidden'});
   assert.equal(report.aiRequests.length,0,'dismissing the picker sends no request');
   assert.equal(await ai('Deskripsi posisi').evaluate(el=>el===document.activeElement),true);
   await ai('Deskripsi posisi').click();await languageDialog.waitFor();
   assert.equal(await language.inputValue(),'','dismissed choices are not saved');
   await page.setViewportSize({width:390,height:844});
   const mobileBounds=await languageDialog.boundingBox();
   assert.ok(mobileBounds&&mobileBounds.x>=12&&mobileBounds.x+mobileBounds.width<=378);
   await page.screenshot({path:path.join(out,'bahasa-ai-mobile.png')});
   await page.setViewportSize({width:1440,height:960});
   await language.selectOption('en');
    assert.equal(await generate.isEnabled(),true);
   await page.screenshot({path:path.join(out,'bahasa-ai-desktop.png')});
   const savedLanguage=page.waitForResponse(response=>response.request().method()==='PATCH'&&
     response.url().endsWith('/hr-flow/sessions/'+resumeSession.id)&&response.request().postDataJSON().draft?.jobContentAiLanguage==='en');
   await generate.evaluate(el=>{el.click();el.click();});
   await dialog.waitFor();assert.equal(report.aiRequests.length,1,'double click cannot send two AI requests');
   assert.equal(report.aiRequests[0].locale,'id');assert.equal(report.aiRequests[0].outputLanguage,'en');
   assert.equal(report.publish,0,'the language modal never submits the job form');
   assert.equal(await description.inputValue(),original,'preview never silently overwrites draft');
   await dialog.getByRole('button',{name:'Batal',exact:true}).click();assert.equal(await description.inputValue(),original);
   await savedLanguage;
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:/Bahasa AI.*English/}).waitFor();
   await ai('Deskripsi posisi').click();await dialog.waitFor();
   assert.equal(await dialog.getByRole('button',{name:'Batal',exact:true}).evaluate(el=>el===document.activeElement),true);
   await dialog.getByRole('button',{name:'Terapkan',exact:true}).click();assert.match(await description.inputValue(),/Design reliable TypeScript APIs/);
    await ai('Tanggung jawab utama').click();await page.getByRole('alert').filter({hasText:'Koneksi ke server terganggu.'}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'Tanggung jawab utama 1',exact:true}).inputValue(),'Membangun API','failed AI preserves existing rows');
   await ai('Tanggung jawab utama').click();await dialog.waitFor();await dialog.getByRole('button',{name:'Terapkan',exact:true}).click();
   assert.equal(await page.getByRole('textbox',{name:'Tanggung jawab utama 2',exact:true}).inputValue(),'Write integration tests.');
   await ai('KPI posisi').click();await dialog.waitFor();await dialog.getByRole('button',{name:'Terapkan',exact:true}).click();
   assert.equal(await page.getByRole('textbox',{name:'KPI posisi 2',exact:true}).inputValue(),'Complete testing before release.');
   await ai('Keahlian').click();await page.getByRole('alert').filter({hasText:'Hasil AI tidak sesuai dengan bagian yang dipilih.'}).waitFor();
   await ai('Keahlian').click();await dialog.waitFor();await dialog.getByRole('button',{name:'Terapkan',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Keahlian 1',exact:true}).inputValue(),'TypeScript');
    assert.equal(await page.getByRole('combobox',{name:'Kebutuhan Keahlian 1',exact:true}).inputValue(),'REQUIRED');
   assert.equal(report.aiRequests.length,7);assert.ok(report.aiRequests.every(request=>request.outputLanguage==='en'));
   await page.getByRole('button',{name:/Bahasa AI.*English/}).click();
   const change=page.getByRole('dialog',{name:'Ubah bahasa AI'});await change.waitFor();
   await change.getByRole('combobox',{name:'Bahasa hasil'}).selectOption('id');
   await change.getByRole('button',{name:'Simpan bahasa',exact:true}).click();
   assert.equal(report.aiRequests.length,7,'changing the language does not generate content');
   await ai('Deskripsi posisi').click();await dialog.waitFor();
   assert.equal(report.aiRequests.at(-1).outputLanguage,'id');
   await dialog.getByRole('button',{name:'Batal',exact:true}).click();
   await page.locator('button[form="hr-job-form"]').click();await scene('taka-intro').waitFor();
   assert.match(resumeSession.draft.description,/TypeScript APIs/);assert.equal(resumeSession.draft.responsibilities.length,2);assert.equal(resumeSession.draft.kpis.length,2);assert.equal(resumeSession.draft.skills[0].name,'TypeScript');
   assert.equal(resumeSession.draft.jobContentAiLanguage,'id');
   assert.equal(report.aiRequests.length,8);assert.equal(report.publish,0);assert.equal(report.metadata,0);assert.deepEqual(report.errors,[]);
   return;
 }
 if(scenario==='validation'){
   await scene('taka-intro').waitFor({timeout:60000});await back.click();
   await page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
   const description=page.locator('textarea[name="description"]');
   await page.getByRole('button',{name:'Tambah benefit',exact:true}).click();
   const lookup=page.getByPlaceholder('Cari atau tambahkan benefit',{exact:true});
   await lookup.fill('Benefit audit manual');
   await page.getByText(/Tidak ada yang cocok.*Benefit audit manual/).waitFor();
   await lookup.press('Enter');
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   await dialog.getByRole('button',{name:'Tambah benefit',exact:true}).click();
   await page.getByRole('button',{name:'Hapus benefit Benefit audit manual',exact:true}).waitFor();
   await description.fill(' '.repeat(30));
   await page.locator('button[form="hr-job-form"]').click();
   await page.getByRole('alert').filter({hasText:'Deskripsi posisi: minimal 20 karakter.'}).first().waitFor();
   await page.waitForFunction(()=>document.activeElement?.getAttribute('name')==='description');
   await description.fill('Membangun layanan digital dengan pengalaman yang relevan.');
   await page.locator('button[form="hr-job-form"]').click();
   await scene('taka-intro').waitFor();
   assert.deepEqual(resumeSession.draft.benefits,[{name:'Benefit audit manual',isNew:true}]);
   assert.equal(report.publish,0);assert.deepEqual(report.errors,[]);
   return;
 }
 if(scenario==='navigation'){
   const formHeading=page.getByRole('heading',{name:'Buat lowongan',exact:true});
   const formNext=page.locator('button[form="hr-job-form"]');
   const draftTitle=page.locator('input[name="title"]');
   const packageBadge=page.getByText('Free | Paket dikonfirmasi',{exact:true});
   await scene('taka-intro').waitFor({timeout:60000});
   await back.click();
   await formHeading.waitFor();
   assert.equal(await draftTitle.inputValue(),'API Engineer');
   await packageBadge.waitFor();
   await page.reload({waitUntil:'domcontentloaded'});
   await formHeading.waitFor();
   assert.equal(await draftTitle.inputValue(),'API Engineer');
   await packageBadge.waitFor();
   await draftTitle.fill('API Engineer Talentio');
   await formNext.click();
   await scene('taka-intro').waitFor();
   await reachUpload();
   await page.waitForFunction(()=>Boolean(document.querySelector('[data-scene="cv-upload"] button[data-dragging]:not(:disabled)')));
   await picker.setInputFiles(cv('A'));
   await back.click();
   await scene('voice-demo').waitFor();
   await next.click();
   await filesList.getByText('Kandidat-A.pdf').waitFor();
   for (const id of ['voice-demo','chat-demo','tara-intro','cv-ranking','cv-sources','taka-intro']) {
     await back.click();
     await scene(id).waitFor();
   }
   await back.click();
   await formHeading.waitFor();
   assert.equal(await draftTitle.inputValue(),'API Engineer Talentio');
   await packageBadge.waitFor();
   await formNext.click();
   await scene('taka-intro').waitFor();
   await reachUpload();
   await filesList.getByText('Kandidat-A.pdf').waitFor();
   assert.equal(report.publish,0);
   assert.equal(report.metadata,0);
   assert.deepEqual(report.errors,[]);
   return;
 }
 await scene('cv-upload').waitFor({timeout:60000});
 assert.equal(await upload.isDisabled(),true);
 assert.equal(await skip.isEnabled(),true);
 if(scenario==='skip-empty'||scenario==='skip-selected'){
   if(scenario==='skip-selected'){
     await picker.setInputFiles(cv('A'));
     await filesList.getByText('Kandidat-A.pdf').waitFor();
     await page.setViewportSize({width:320,height:760});
     const buttons=await story.locator('footer > button').evaluateAll(items=>items.map(item=>{
       const {left,right,width,height}=item.getBoundingClientRect();
       return {left,right,width,height};
     }));
     assert.equal(buttons.length,3);
     buttons.forEach(({left,right,width,height},index)=>{
       assert.ok(left>=0&&right<=320&&width>=44&&height>=44,JSON.stringify(buttons));
       if(index>0)assert.ok(buttons[index-1].right<=left,JSON.stringify(buttons));
     });
     await page.screenshot({path:path.join(out,'03-footer-mobile.png')});
     const dialog=page.getByRole('dialog',{name:'Lewati upload CV?'});
     const cancel=dialog.getByRole('button',{name:'Batal',exact:true});
     await skip.click();
     await dialog.waitFor();
     assert.equal(await cancel.evaluate(button=>button===document.activeElement),true);
     await page.keyboard.press('Escape');
     await dialog.waitFor({state:'hidden'});
     assert.equal(await skip.evaluate(button=>button===document.activeElement),true);
     await skip.click();
     await cancel.click();
     await filesList.getByText('Kandidat-A.pdf').waitFor();
     assert.equal(report.publish,0);
     assert.equal(report.metadata,0);
     await skip.click();
     await page.screenshot({path:path.join(out,'04-skip-warning-mobile.png')});
     await dialog.getByRole('button',{name:'Lanjut',exact:true}).click();
   }else{
     await skip.click();
   }
   await page.waitForURL(/\/dashboard\/recruiter/,{timeout:60000});
   assert.equal(report.publish,1);
   assert.equal(report.complete,1);
   assert.equal(report.metadata,0);
   assert.equal(report.uploadStarted,0);
   assert.deepEqual(report.errors,[]);
   return;
 }
 const drop = page.getByRole('button',{name:/Tarik CV ke sini/});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Tarik CV ke sini')&&!button.disabled));
 assert.equal(await drop.evaluate(el=>getComputedStyle(el).cursor),'pointer');
 await page.screenshot({path:path.join(out,'00-upload-empty.png')});
 const chooser = page.waitForEvent('filechooser');
 await drop.click();
 await (await chooser).setFiles(['A','B','C'].map(cv));
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
 assert.equal(report.metadata,0,'selecting files must not start an import');
 for(const attempts of [[1,0,0],[2,1,0],[2,2,1]]){
   const unavailable=page.waitForResponse(response=>response.status()===503&&response.request().method()==='POST');
   await upload.click();
   await unavailable;
   await page.getByRole('alert').filter({hasText:'Koneksi ke server terganggu. Silakan coba lagi.'}).waitFor();
   assert.deepEqual([report.publish,report.metadata,report.complete],attempts);
   assert.equal(await skip.isDisabled(),true);
   assert.equal(await back.isDisabled(),true);
   assert.equal(await filesList.locator('li').count(),4);
   assert.equal(await page.getByRole('complementary',{name:'Progres impor CV'}).count(),0);
 }
 await upload.click();
 await page.waitForURL(/\/dashboard\/recruiter/,{timeout:60000});
 await page.getByRole('complementary',{name:'Progres impor CV'}).waitFor();
 assert.equal(report.publish,2);
 assert.equal(report.metadata,2);
 assert.equal(report.complete,2);
 assert.ok(report.publishKeys[0]);
 assert.ok(report.importKeys[0]);
 assert.equal(new Set(report.publishKeys).size,1);
 assert.equal(new Set(report.importKeys).size,1);
 assert.deepEqual(report.events,['publish','register-import','onboarding-complete']);
 assert.equal(report.uploadCompleted,0,'dashboard navigation does not await file transfer');
 await page.screenshot({path:path.join(out,'02-dashboard-during-upload.png')});
 releaseUploads();await page.waitForFunction(()=>document.querySelector('[aria-label="Progres impor CV"]')?.textContent.includes('Menilai CV'),{timeout:20000});assert.equal(report.uploadCompleted,4);scoreReady=true;await page.getByRole('complementary',{name:'Progres impor CV'}).getByRole('button',{name:/Impor CV selesai/}).waitFor({timeout:15000});assert.deepEqual(report.errors,[]);
 }finally{releaseUploads();fs.writeFileSync(path.join(out,'report-'+scenario+'.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
}
async function run(){
 for(const scenario of (process.env.ONBOARDING_SCENARIO?[process.env.ONBOARDING_SCENARIO]:['validation','navigation','skip-empty','skip-selected','upload','ai-drafting','assessment-onboarding','assessment-resume','assessment-dashboard','assessment-template-free','assessment-template-standard','assessment-template-lite'])){
   await main(scenario);
   console.log('HR onboarding passed: '+scenario);
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
