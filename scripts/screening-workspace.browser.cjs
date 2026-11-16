// Actual browser interactions with synthetic API/file fixtures. Never calls OpenAI or production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.USERPROFILE||'C:/Users/egi_i','.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const out=path.resolve(process.env.RECRUITMENT_BROWSER_OUT||'output/screening-workspace');fs.mkdirSync(out,{recursive:true});
const base=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';
const takaCoverage={version:'taka-interview-evidence-v1',state:'PARTIAL',plannedClaims:4,assessedClaims:2,openScopeClaims:1,interrupted:true};
async function samplePdf(){const {createRequire}=require('node:module'),req=createRequire(path.resolve('apps/api/package.json')),PDFDocument=req('pdfkit');return new Promise(resolve=>{const chunks=[],doc=new PDFDocument({margin:42});doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.fontSize(23).text('Dinda Pramesti').moveDown(.4).fontSize(13).text('Machine Learning Engineer').moveDown(1).fontSize(16).text('Ringkasan Profesional').moveDown(.4).fontSize(11).text('Machine Learning Engineer dengan pengalaman mengembangkan model dan layanan data.').moveDown(1).fontSize(16).text('Pengalaman').moveDown(.4).fontSize(11).text('Mengembangkan model machine learning dengan Python.\nMembantu tim melakukan deployment dan evaluasi model.').moveDown(1).fontSize(16).text('Keahlian').moveDown(.4).fontSize(11).text('Python, PyTorch, SQL');doc.addPage().fontSize(18).text('Proyek dan pendidikan').moveDown().fontSize(12).text('Proyek machine learning dan pendidikan kandidat.');doc.end();});}
const names=['Dinda Pramesti','Rizky Aditya','Nadya Putri','Fajar Saputra','Kevin Wijaya','Salsabila Rahma','Bima Pratama','Alya Maharani','Reza Firmansyah','Citra Lestari'];
const company={id:'co',name:'Lintas Awan Teknologi',logoUrl:'/brand/talentio-logo-4k.png',city:{name:'Kota Denpasar'}};
const auth={accessToken:'recruitment-ui-test-only',user:{id:'hr',fullName:'Nadia HR',role:'RECRUITER',email:'hr@example.test',emailVerified:true,recruiterOnboarding:{status:'COMPLETED'},memberships:[{companyId:'co',role:'OWNER'}]}};
const job={id:'job',title:'Machine Learning Engineer',description:'Mengembangkan model machine learning dan layanan data.',companyId:'co',company,city:{name:'Kota Denpasar'},workMode:'HYBRID',employmentType:'FULL_TIME',experienceLevel:'MIDDLE',status:'PUBLISHED',_count:{applications:500},jobSkills:[],jobLanguages:[],questions:[],benefits:[]};
let rows=Array.from({length:500},(_,i)=>({id:'candidate-'+i,companyId:'co',jobId:'job',applicationId:null,fullName:i<10?names[i]:'Kandidat '+(i+1),email:'candidate'+i+'@example.test',headline:'Machine Learning Engineer',filename:'CV '+(i<10?names[i]:'Kandidat '+(i+1))+'.pdf',contentType:'application/pdf',stage:i<320?'NEW':i<460?'INTERVIEW':'REJECTED',scoreStatus:'READY',cvScore:Math.round((96-i/20)*10)/10,createdAt:'2026-11-08T02:00:00Z',error:null,assignedTo:i>=320?{id:'hr',fullName:'Nadia HR'}:null}));
const poolRows=[{...rows[0],id:'pool-candidate',jobId:null,cvScore:null,scoreStatus:'EXTRACTED'}];
const report={checks:[],errors:[],writes:[]};
let importState=null,importReady=false;
let invitationReads=0,reportSignature=1;const invitations=[];let followupBatch=null;const appointments=[];
function filtered(filter){return (filter.jobId?rows:poolRows).filter(r=>(!filter.q||r.fullName.toLowerCase().includes(filter.q.toLowerCase()))&&(!filter.stage||r.stage===filter.stage)&&(filter.phase==='review'?r.stage==='NEW':filter.phase==='progress'?['IN_REVIEW','INTERVIEW','OFFER'].includes(r.stage):filter.phase==='finished'?['HIRED','REJECTED','WITHDRAWN'].includes(r.stage):true));}
async function main(){
 const pdf=await samplePdf(),browser=await pw.chromium.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1586,height:992},reducedMotion:'reduce'});
 await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));localStorage.setItem('jt_country','ID');},auth);
 await context.route('https://private.test/**',async route=>{
  const request=route.request(),url=new URL(request.url()),isReport=url.pathname==='/report.pdf';
  if(request.method()==='PUT')await new Promise(resolve=>setTimeout(resolve,800));
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'};
  if(isReport&&url.searchParams.get('signature')!==String(reportSignature))return route.fulfill({status:403,headers,body:'Expired signature'});
  if(isReport&&reportSignature===2)headers['content-disposition']='attachment; filename="Ringkasan-screening.pdf"';
  return route.fulfill({status:200,headers,contentType:'application/pdf',body:isReport?fs.readFileSync('output/pdf/screening-design-fixture.pdf'):pdf});
 });
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname.replace(/^\/api/,''),method=request.method();
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
  if(method==='OPTIONS')return route.fulfill({status:204,headers});
  let body=[];
  if(p==='/auth/me')body=auth;
  else if(p==='/recruiter-onboarding')body={status:'COMPLETED',step:4,companyId:'co'};
  else if(p==='/companies/mine')body=[{companyId:'co',role:'OWNER',company}];
  else if(p==='/jobs/job')body=job;
  else if(p==='/jobs/company/co')body=[job];
  else if(p==='/companies/co')body=company;
  else if(p==='/recruitment/jobs/job/applications/mock-native/candidate')body={...rows[499],applicationId:'mock-native'};
  else if(p==='/recruitment/companies/co/jobs')body=[{id:job.id,title:job.title}];
  else if(p==='/recruitment/imports'&&method==='POST'){const input=request.postDataJSON();importState={id:'import-1',files:input.files.map((f,i)=>({id:'uploaded-'+i,clientId:f.clientId,name:f.filename,scoreStatus:'PENDING',status:'UPLOADING'}))};body=importState;}
  else if(p==='/recruitment/imports/import-1')body={...importState,files:importState.files.map(f=>({...f,scoreStatus:importReady?'READY':'PROCESSING'}))};
  else if(/^\/recruitment\/candidates\/uploaded-\d+\/upload-url$/.test(p))body={uploadUrl:'https://private.test/upload',status:'UPLOADING'};
  else if(/^\/recruitment\/candidates\/uploaded-\d+\/upload-complete$/.test(p))body={scoreStatus:'PENDING'};
  else if(p==='/recruitment/companies/co/members')body=[{user:{id:'hr',fullName:'Nadia HR'}}];
  else if(p==='/recruitment/candidates/candidate-0/invitations'){
   if(method==='GET')invitationReads++;if(method==='POST'){const input=request.postDataJSON();report.writes.push({invitation:input});invitations.push({id:'invite-1',mode:input.mode,status:'INVITED',recipientEmail:input.email,emailStatus:'SENT',messageStatus:'SENT',expiresAt:'2026-12-01T00:00:00Z',createdAt:new Date().toISOString(),session:null});body=invitations[0];}else body=invitations;
  }
  else if(p==='/recruitment/invitations/invite-1/retry-delivery'){const input=request.postDataJSON();report.writes.push({retryDelivery:input});invitations[0].emailStatus='SENT';body={status:'PENDING'};}
  else if(p==='/recruitment/invitations/invite-1/retry-evaluation'){report.writes.push({retryEvaluation:true});invitations[0].session.evaluation.status='PENDING';body={count:1};}
  else if(/^\/recruitment\/invitations\/[^/]+\/report$/.test(p)){
    const id=p.split('/')[3];if(id==='invite-older')await new Promise(r=>setTimeout(r,500));
    if(id.startsWith('invite-role-')){
      const invitation=invitations.find(row=>row.id===id);
      const evaluation=invitation.session.evaluation;
      const question={id:'role-question',text:'Gimana cara lu memvalidasi model?',answer:'Saya pisahkan data uji berdasarkan tanggal sebelum menjalankan evaluasi.',
        shownAt:'2026-11-09T09:43:00Z',answeredAt:'2026-11-09T09:43:20Z',timedOut:false};
      return route.fulfill({status:200,headers,json:{invitation,pdfStatus:'READY',claims:[],voice:null,questions:[question],
        evaluation:{status:evaluation.status,finalScore:evaluation.finalScore,result:evaluation.result},pdfUrl:'https://private.test/report.pdf?signature='+reportSignature}});
    }
    body={invitation:invitations.find(i=>i.id===id),pdfStatus:'READY',claims:[{id:'forecast',statement:'Mengembangkan model forecasting',quote:'Mengembangkan model forecasting untuk analisis data.'},{id:'lead',statement:'Memimpin tim proyek',quote:'Memimpin tim proyek.'}],voice:{startedAt:'2026-11-09T09:43:00Z',endedAt:'2026-11-09T09:46:49Z',closeReason:'CONNECTION_LOST',transcriptComplete:false,transcript:[{id:'v1',speaker:'TARA',text:'Bagian mana yang kamu kerjakan sendiri?',startMs:92000},{id:'v2',speaker:'CANDIDATE',text:'Saya lebih banyak membantu di bagian EDA.',startMs:103000},{id:'v3',speaker:'TARA',text:'Apa metrik keberhasilan proyek tersebut?',startMs:126000}]},questions:[],evaluation:{status:'NEEDS_REVIEW',score:id==='invite-older'?50:37.5,result:{summary:id==='invite-older'?'Ringkasan sesi sebelumnya.':'Kontribusi pada EDA disebutkan; langkah dan hasil perlu didalami.',voice:{testedClaims:4,totalClaims:6,partial:true,durationSeconds:229,transcriptComplete:false},strengths:['Kontribusi EDA dijelaskan.'],gaps:['Perlu memperjelas langkah pribadi.'],claims:[{claimId:'forecast',score:2,status:'INSUFFICIENT',asked:true,reason:'Langkah dan hasil belum dijelaskan.',evidence:[{questionId:'v2',questionRef:'v1',questionText:'Bagian mana yang kamu kerjakan sendiri?',quote:'Saya lebih banyak membantu di bagian EDA.'}]},{claimId:'lead',score:null,status:'INSUFFICIENT',asked:false,reason:'Belum diuji.',evidence:[]}],interviewQuestions:['Langkah EDA apa yang dilakukan sendiri?']}},pdfUrl:'https://private.test/report.pdf?signature='+reportSignature};
    if(id==='invite-1')body.evaluation.result.taraInterview={version:'tara-conversation-v7.0.0',topics:[
      {topicId:'forecast',label:'Python',alternative:false,outcome:'CONCRETE_EXAMPLE',questionRefs:['v1'],answerRefs:['v2'],quote:'Saya lebih banyak membantu di bagian EDA.'},
      {topicId:'lead',label:'Project leadership',alternative:false,outcome:'NOT_ASKED',questionRefs:[],answerRefs:[]},
    ]};
  }
  else if(p==='/recruitment/messages'&&method==='POST'){const input=request.postDataJSON();report.writes.push({message:input});const count=input.selection.ids?.length??input.selection.expectedCount;followupBatch={id:'message-batch',count,emailCounts:{PENDING:count},messageCounts:{PENDING:count},messages:[]};body=followupBatch;}
  else if(p==='/recruitment/message-batches/message-batch')body={...followupBatch,emailCounts:{SENT:followupBatch.count},messageCounts:{SENT:followupBatch.count}};
  else if(p==='/recruitment/candidates/candidate-0/messages')body=[];
  else if(p==='/recruitment/candidates/candidate-0/interviews'){if(method==='POST'){const input=request.postDataJSON();report.writes.push({schedule:input});const item={...input,id:'calendar-ui',revision:1,status:'SCHEDULED',nativeOnly:false};appointments.push(item);rows[0].stage='INTERVIEW';rows[0].interviews=appointments;body=item;}else body=appointments;}
  else if(p==='/recruitment/candidates/candidate-0/interviews/calendar-ui'){const input=request.postDataJSON();report.writes.push({scheduleUpdate:input});Object.assign(appointments[0],input,{revision:appointments[0].revision+1});rows[0].interviews=appointments.filter(i=>i.status==='SCHEDULED');body=appointments[0];}
  else if(p==='/recruitment/candidates'&&method==='GET'){
   const filter=Object.fromEntries(url.searchParams),list=filtered(filter),page=Number(filter.page||1),limit=Number(filter.limit||10);
   body={items:list.slice((page-1)*limit,page*limit),total:list.length,page,limit,counts:{all:filter.jobId?rows.length:poolRows.length,review:rows.filter(r=>r.stage==='NEW').length,progress:rows.filter(r=>['IN_REVIEW','INTERVIEW','OFFER'].includes(r.stage)).length,finished:40},hasMoreToImport:false};
  }else if(p==='/recruitment/candidates/bulk'){
   const input=request.postDataJSON();report.writes.push(input);const chosen='ids'in input.selection?[...rows,...poolRows].filter(r=>input.selection.ids.includes(r.id)):filtered(input.selection.filter).filter(r=>!input.selection.excludedIds.includes(r.id));
   for(const row of chosen){if(input.action.kind==='move')row.stage=input.action.stage;else if(input.action.kind==='rescore'){row.scoreStatus='PENDING';row.cvScore=null;}else row.assignedTo={id:'hr',fullName:'Nadia HR'};}body={count:chosen.length};
  }else if(/^\/recruitment\/candidates\/candidate-\d+\/cv$/.test(p))body={url:'https://private.test/cv.pdf'};
  else if(/^\/recruitment\/candidates\/candidate-\d+$/.test(p)){
   const row=rows.find(r=>r.id===p.split('/').at(-1));body={...row,cvResult:{summary:'Pengalaman membangun dan mengevaluasi model machine learning.',criteria:[{criterionId:'skills',level:4,reason:'Python dan PyTorch sesuai kebutuhan lowongan.',evidence:['Mengembangkan model machine learning dengan Python.']}],limitations:['Kontribusi pada deployment perlu didalami.']},activities:[{id:'activity-1',kind:'CV_ANALYZED',createdAt:'2026-11-08T02:00:00Z'}]};
  }else if(/unread/.test(p))body={count:0};
  if(/^\/recruitment\/invitations\/[^/]+\/report$/.test(p)){
   const names=['Mengembangkan model forecasting','Mengevaluasi hasil model','Mengolah data curah hujan','Memimpin proyek lintas tim','Membangun pipeline produksi','Merancang asisten klaim kesehatan'];
   body.claims=names.map((statement,i)=>({id:i===0?'forecast':'claim-'+i,statement,quote:statement+' untuk analisis data.'}));
   const first=body.evaluation.result.claims[0];body.evaluation.result.claims=names.map((_,i)=>i===0?first:{claimId:'claim-'+i,status:'INSUFFICIENT',score:i===3||i===4?null:i===1?0:2,asked:i!==3&&i!==4,reason:i===3||i===4?'Belum sempat diuji.':'Perlu memperjelas kontribusi pribadi.',evidence:[]});
   body.evaluation.result.strengths=['Kontribusi forecasting terbatas pada EDA.','Memahami pemeriksaan kelengkapan data.'];body.evaluation.result.gaps=['Langkah kerja dan tanggung jawab pribadi.','Validasi hasil dan metrik proyek.'];body.evaluation.result.interviewQuestions=['Langkah EDA apa yang kamu lakukan sendiri?','Bagaimana kamu mengevaluasi hasil forecasting?','Bagaimana validasi rekomendasi asisten klaim dilakukan?'];
   if(p.split('/')[3]==='invite-1'){
    body.evaluation.score=87.5;body.claims=body.claims.slice(0,4);body.evaluation.result.interviewAssessment=takaCoverage;
    body.evaluation.result.claims=body.evaluation.result.claims.slice(0,4).map((claim,index)=>({...claim,
     score:[4,3,null,null][index],status:index<2?'SUPPORTED':'INSUFFICIENT',asked:index<2,
     assessment:{state:index<2?'ASSESSED':'NOT_ASKED',basis:index<2?'DIRECT':undefined,questionRefs:index===0?['v1']:[],askedFields:[],openFields:index===0?['RESULT']:[]}
    }));
   }
   body.voice.transcript=[{id:'intro',speaker:'TARA',text:'Hai, gue Tara. Ceritain dulu proyek forecasting yang pernah lu kerjakan.',startMs:8000},{id:'intro-answer',speaker:'CANDIDATE',text:'Saya ikut membantu proyek forecasting. Bagian yang saya kerjakan lebih banyak di EDA.',startMs:25000},{id:'data',speaker:'TARA',text:'Oke, kita fokus ke bagian lu. Data apa yang lu periksa waktu itu?',startMs:49000},{id:'data-answer',speaker:'CANDIDATE',text:'Ada data curah hujan. Saya melihat periode dataset dan mengecek kelengkapannya.',startMs:65000},...body.voice.transcript,{id:'follow-answer',speaker:'CANDIDATE',text:'Detail langkahnya sudah agak lupa, tapi saya ikut pemeriksaan data awal.',startMs:148000},{id:'last',speaker:'TARA',text:'Kalau proyek lain, kontribusi apa yang paling lu ingat dan bisa lu jelaskan langkahnya?',startMs:199000}];
  }
  return route.fulfill({status:200,headers,json:body});
 });
 invitations.push({id:'invite-1',mode:'VOICE',status:'COMPLETED',recipientEmail:rows[0].email,emailStatus:'SENT',messageStatus:'SENT',createdAt:'2026-11-09T09:00:00Z',expiresAt:'2026-12-01T00:00:00Z',session:{id:'voice',status:'COMPLETED',startedAt:'2026-11-09T09:43:00Z',completedAt:'2026-11-09T09:46:49Z',evaluation:{status:'NEEDS_REVIEW',screeningScore:37.5,result:{summary:'Kontribusi pada EDA disebutkan.',voice:{testedClaims:4,totalClaims:6,partial:true,durationSeconds:229,transcriptComplete:false}}}}},{id:'invite-active',mode:'TEXT',status:'INVITED',recipientEmail:rows[0].email,emailStatus:'SENT',messageStatus:'SENT',createdAt:'2026-11-09T08:00:00Z',expiresAt:'2026-12-01T00:00:00Z',session:null},{id:'invite-older',mode:'VOICE',status:'COMPLETED',recipientEmail:rows[0].email,emailStatus:'SENT',messageStatus:'SENT',createdAt:'2026-11-08T08:00:00Z',expiresAt:'2026-12-01T00:00:00Z',session:{id:'older',status:'COMPLETED',completedAt:'2026-11-08T08:04:00Z',evaluation:{status:'READY',screeningScore:50,result:{summary:'Ringkasan sesi sebelumnya.'}}}});
 invitations[0].session.evaluation.screeningScore=87.5;
 invitations[0].session.evaluation.result.interviewAssessment=takaCoverage;
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base+'/id/dashboard/recruiter/jobs/job?company=co',{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('link',{name:'Dinda Pramesti',exact:true}).waitFor({timeout:60000});
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.getByRole('link',{name:/Kanban/}).count(),0);report.checks.push('Kanban removed from job workspace');
 assert.equal(await page.getByRole('columnheader',{name:'Sumber',exact:true}).count(),0);report.checks.push('No guessed portal source');
 await page.screenshot({path:path.join(out,'01-candidates-desktop.png')});
 const detail=page.locator('[data-candidate-review]');
 const screening=()=>page.getByRole('navigation',{name:'Detail kandidat'}).getByRole('link',{name:page.viewportSize().width<=680?'Screening':'Screening Tara',exact:true});
 const candidateRoute=()=>base+'/id/dashboard/recruiter/candidates/candidate-0';
 const screenshot=async name=>{
  await page.locator('main').evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:path.join(out,name),style:'nextjs-portal{display:none}'});
 };
 await page.getByRole('link',{name:'Dinda Pramesti',exact:true}).click();
 await detail.getByRole('heading',{name:'Dinda Pramesti',exact:true}).waitFor();
 await screening().click();
 await detail.getByText('87,5/100',{exact:true}).waitFor();
 await detail.getByText('2 dari 4 klaim dinilai',{exact:true}).waitFor();
 await detail.getByText('Hasil parsial',{exact:true}).waitFor();
 const reads=invitationReads;invitations[1].status='STARTED';
 await page.getByText(/Sedang berlangsung/).first().waitFor({timeout:15000});
 assert.ok(invitationReads>reads,'sent waiting invitation is refreshed');
 report.checks.push('Active invitation updates and a partial claim score carries 2/4 coverage on the full page');

 await page.getByRole('link',{name:'Buka hasil wawancara'}).click();
 await page.getByRole('heading',{name:'Laporan wawancara Taka'}).waitFor();
 await page.getByText('Belum dibahas · Hasil',{exact:true}).waitFor();
 assert.equal(await page.getByText('Belum dibahas',{exact:true}).count(),2);
 await screenshot('01-overview.png');
 await page.getByRole('tab',{name:'Ringkasan'}).click();
 const notes=page.getByRole('region',{name:'Catatan wawancara Tara',exact:true});
 await notes.getByText('Belum sempat ditanya',{exact:true}).waitFor();
 await notes.getByRole('button',{name:'Lihat konteks percakapan',exact:true}).click();
 await page.locator('[data-turn="v2"][data-highlight="true"]').waitFor();
 await page.getByRole('tab',{name:'Nilai per kriteria'}).click();
 await page.getByRole('button',{name:'Buka transkrip · 01:43',exact:true}).click();
 await page.locator('[data-turn="v2"][data-highlight="true"]').waitFor();
 await page.getByLabel('Cari dalam transkrip',{exact:true}).fill('metrik');
 assert.equal(await page.locator('[data-turn]').count(),1);
 await page.getByLabel('Cari dalam transkrip',{exact:true}).fill('');
 await page.getByLabel('Pembicara',{exact:true}).selectOption('CANDIDATE');
 assert.equal(await page.locator('[data-turn]').count(),4);
 await page.getByLabel('Pembicara',{exact:true}).selectOption('all');
 const exportPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Unduh transkrip',exact:true}).click();
 const exported=fs.readFileSync(await (await exportPromise).path(),'utf8');
 assert.ok(exported.includes('Saya lebih banyak membantu di bagian EDA.'));
 assert.ok(exported.includes('Transkrip tidak lengkap.'));
 await screenshot('02-conversation.png');
 report.checks.push('Tara notes and claim evidence open exact turns, with transcript search, speaker filter and incomplete export');

 reportSignature=2;
 assert.equal(await page.evaluate(async()=> (await fetch('https://private.test/report.pdf?signature=1')).status),403);
 const refreshedPdf=page.waitForEvent('download',{timeout:15000});
 await page.getByRole('button',{name:'Unduh PDF',exact:true}).click();
 const renewed=await refreshedPdf;
 assert.ok(renewed.suggestedFilename().endsWith('.pdf'));
 assert.equal(fs.readFileSync(await renewed.path()).subarray(0,5).toString(),'%PDF-');
 report.checks.push('The full report renews the signed PDF URL before download');

 await page.getByRole('link',{name:'Kembali ke kandidat'}).click();
 const older=page.locator('a[href*="/reports/interviews/invite-older"]');
 await older.click();
 await page.getByRole('link',{name:'Kembali ke kandidat'}).click();
 await page.getByRole('link',{name:'Buka hasil wawancara'}).click();
 await page.getByRole('tab',{name:'Ringkasan'}).click();
 await page.getByText('Kontribusi pada EDA disebutkan; langkah dan hasil perlu didalami.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Ringkasan sesi sebelumnya.',{exact:true}).count(),0);
 report.checks.push('A slower historical report does not replace the selected interview');

 for (const width of [390, 320]) {
  await page.setViewportSize({width,height:844});
  assert.ok(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal page overflow at '+width+'px');
  await screenshot(width===390?'04-mobile.png':'04-mobile-narrow.png');
 }
 await page.setViewportSize({width:1586,height:992});
 await page.getByRole('link',{name:'Kembali ke kandidat'}).click();
 await page.getByRole('link',{name:'Kandidat berikutnya',exact:true}).click();
 await page.getByRole('heading',{name:'Rizky Aditya',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Buka hasil wawancara'}).count(),0);
 await page.getByRole('link',{name:'Kandidat sebelumnya',exact:true}).click();
 await page.getByRole('link',{name:'Buka hasil wawancara'}).waitFor();
 report.checks.push('Candidate navigation keeps histories scoped to the candidate');

 rows[0].stage='REJECTED';
 await page.goto(candidateRoute()+'?tab=screening',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Undang screening',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Undang screening',exact:true}).isDisabled(),true);
 report.checks.push('Closed candidates cannot be invited');
 const roleSessions=[true,false].map(complete=>{
   const assessment={version:'taka-role-evidence-v2',rubricRevision:'b5e2569fabc',state:complete?'COMPLETE':'INCOMPLETE',score:complete?85.3:null,
     missing:complete?[]:['COVERAGE'],components:{cv:80,competency:complete?87.5:null,explanation:complete?87.5:null},
     contributions:{cv:24,competency:complete?52.5:null,explanation:complete?8.75:null},weights:{cv:30,competency:60,explanation:10},
     coverage:{assessed:complete?2:1,total:2,interrupted:!complete},...(complete?{}:{partial:{competency:100,explanation:100}}),
     criteria:[{criterionId:'validate',name:'Validasi model',level:4,clarity:4,
       reason:'Pemisahan data mengikuti waktu pengamatan.',state:'ASSESSED',questionRefs:['question:role-question'],
       evidence:[{questionId:'answer:role-question',questionRef:'question:role-question',quote:'Saya pisahkan data uji berdasarkan tanggal sebelum menjalankan evaluasi.'}]},
       {criterionId:'document',name:'Dokumentasikan evaluasi',level:complete?3:null,clarity:complete?3:null,
        reason:complete?'Kandidat menjelaskan dokumentasi.':'Penilaian kompetensi perlu ditinjau.',state:complete?'ASSESSED':'ASSESSMENT_UNAVAILABLE',evidence:[],questionRefs:[]}]};
   const id='invite-role-'+(complete?'full':'partial');
   return {...invitations[0],id,mode:'TEXT',session:{...invitations[0].session,id,evaluation:{status:complete?'READY':'NEEDS_REVIEW',
     screeningScore:complete?87.5:null,finalScore:assessment.score,result:{summary:assessment.coverage.assessed+' dari 2 kompetensi inti dinilai.',roleAssessment:assessment}}}};
 });
 invitations.unshift(...roleSessions);
 await page.goto(candidateRoute()+'/reports/interviews/invite-role-full',{waitUntil:'domcontentloaded'});
 await page.getByText('85,3/100',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Buka transkrip/}).click();
 await page.locator('[data-turn="answer:role-question"][data-highlight="true"]').waitFor();
 await page.getByRole('tab',{name:'Ringkasan'}).click();
 await page.getByText(/87,5 \/ 100.*52,5 poin/).first().waitFor();
 await screenshot('06-role-score.png');
 await page.goto(candidateRoute()+'/reports/interviews/invite-role-partial',{waitUntil:'domcontentloaded'});
 await page.getByText('Penilaian perlu ditinjau',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Ringkasan'}).click();
 await page.getByText('Sebagian kompetensi belum memiliki bukti atau kesempatan menjawab yang cukup.',{exact:true}).waitFor();
 await page.getByText(/100 \/ 100 kompetensi \(parsial\)/).waitFor();
 assert.equal(await page.getByText('100/100',{exact:true}).count(),0);
 await screenshot('07-role-incomplete.png');
 report.checks.push('Complete and partial role assessments preserve score components, evidence, and coverage in separate reports');
 assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);
 console.log('Screening workspace checks passed: '+report.checks.join('; '));
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
