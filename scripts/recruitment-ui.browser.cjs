// Actual browser interactions with synthetic API/file fixtures. Never calls OpenAI or production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.USERPROFILE||'C:/Users/egi_i','.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const out=path.resolve('output/recruitment-ui');fs.mkdirSync(out,{recursive:true});
const base=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';
async function samplePdf(){const {createRequire}=require('node:module'),req=createRequire(path.resolve('apps/api/package.json')),PDFDocument=req('pdfkit');return new Promise(resolve=>{const chunks=[],doc=new PDFDocument({margin:42});doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.fontSize(23).text('Dinda Pramesti').moveDown(.4).fontSize(13).text('Machine Learning Engineer').moveDown(1).fontSize(16).text('Ringkasan Profesional').moveDown(.4).fontSize(11).text('Machine Learning Engineer dengan pengalaman mengembangkan model dan layanan data.').moveDown(1).fontSize(16).text('Pengalaman').moveDown(.4).fontSize(11).text('Mengembangkan model machine learning dengan Python.\nMembantu tim melakukan deployment dan evaluasi model.').moveDown(1).fontSize(16).text('Keahlian').moveDown(.4).fontSize(11).text('Python, PyTorch, SQL');doc.addPage().fontSize(18).text('Proyek dan pendidikan').moveDown().fontSize(12).text('Proyek machine learning dan pendidikan kandidat.');doc.end();});}
const names=['Dinda Pramesti','Rizky Aditya','Nadya Putri','Fajar Saputra','Kevin Wijaya','Salsabila Rahma','Bima Pratama','Alya Maharani','Reza Firmansyah','Citra Lestari'];
const company={id:'co',name:'Lintas Awan Teknologi',logoUrl:'/brand/talentio-logo-4k.png',city:{name:'Kota Denpasar'}};
const auth={accessToken:'recruitment-ui-test-only',user:{id:'hr',fullName:'Nadia HR',role:'RECRUITER',email:'hr@example.test',emailVerified:true,recruiterOnboarding:{status:'COMPLETED'},memberships:[{companyId:'co',role:'OWNER'}]}};
const job={id:'job',title:'Machine Learning Engineer',description:'Mengembangkan model machine learning dan layanan data.',companyId:'co',company,city:{name:'Kota Denpasar'},workMode:'HYBRID',employmentType:'FULL_TIME',experienceLevel:'MIDDLE',status:'PUBLISHED',_count:{applications:500},jobSkills:[],jobLanguages:[],questions:[],benefits:[]};
let rows=Array.from({length:500},(_,i)=>({id:'candidate-'+i,companyId:'co',jobId:'job',applicationId:null,fullName:i<10?names[i]:'Kandidat '+(i+1),email:'candidate'+i+'@example.test',headline:'Machine Learning Engineer',filename:'CV '+(i<10?names[i]:'Kandidat '+(i+1))+'.pdf',contentType:'application/pdf',stage:i<320?'NEW':i<460?'INTERVIEW':'REJECTED',scoreStatus:'READY',cvScore:Math.round((96-i/20)*10)/10,createdAt:'2026-11-08T02:00:00Z',error:null,assignedTo:i>=320?{id:'hr',fullName:'Nadia HR'}:null}));
const poolRows=[{...rows[0],id:'pool-candidate',jobId:null,cvScore:null,scoreStatus:'EXTRACTED'}];
const report={checks:[],errors:[],writes:[]};
let importState=null,importReady=false;
let cvStatusReads=0;
const invitations=[];let followupBatch=null;const appointments=[];
function filtered(filter){return (filter.jobId?rows:poolRows).filter(r=>(!filter.q||r.fullName.toLowerCase().includes(filter.q.toLowerCase()))&&(!filter.stage||r.stage===filter.stage)&&(filter.phase==='review'?r.stage==='NEW':filter.phase==='progress'?['IN_REVIEW','INTERVIEW','OFFER'].includes(r.stage):filter.phase==='finished'?['HIRED','REJECTED','WITHDRAWN'].includes(r.stage):true));}
async function main(){
 const pdf=await samplePdf(),browser=await pw.chromium.launch({headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1586,height:992},reducedMotion:'reduce'});
 await context.addInitScript(auth=>{localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));localStorage.setItem('jt_country','ID');},auth);
 await context.route('https://private.test/**',async route=>{if(route.request().method()==='PUT')await new Promise(resolve=>setTimeout(resolve,800));return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,PUT,OPTIONS'},contentType:'application/pdf',body:pdf});});
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
  else if(p==='/recruitment/companies/co/cv-status'){
   cvStatusReads++;
   const phase=cvStatusReads===1?'DELAYED':'READY';
   Object.assign(rows[0],{scoreStatus:phase==='READY'?'READY':'PROCESSING',cvScore:phase==='READY'?96:null,cvProgress:{phase,updatedAt:new Date().toISOString()}});
   body=rows.filter(r=>url.searchParams.get('ids')?.split(',').includes(r.id)).map(({id,scoreStatus,cvScore,cvProgress,error})=>({id,scoreStatus,cvScore,cvProgress,error,revision:0}));
  }
  else if(p==='/recruitment/candidates/candidate-0/invitations'){
   if(method==='POST'){const input=request.postDataJSON();report.writes.push({invitation:input});invitations.push({id:'invite-1',mode:input.mode,status:'INVITED',recipientEmail:input.email,emailStatus:'SENT',messageStatus:'SENT',expiresAt:'2026-12-01T00:00:00Z',createdAt:new Date().toISOString(),session:null});body=invitations[0];}else body=invitations;
  }
  else if(p==='/recruitment/invitations/invite-1/retry-delivery'){const input=request.postDataJSON();report.writes.push({retryDelivery:input});invitations[0].emailStatus='SENT';body={status:'PENDING'};}
  else if(p==='/recruitment/invitations/invite-1/retry-evaluation'){report.writes.push({retryEvaluation:true});invitations[0].session.evaluation.status='PENDING';body={count:1};}
  else if(p==='/recruitment/invitations/invite-1/report')body={claims:[{id:'claim-api',statement:'Mengembangkan layanan API',quote:'Membantu tim membangun API.'},{id:'claim-team',statement:'Memimpin tim proyek',quote:'Memimpin tim proyek.'}],questions:[{id:'q-api',text:'Bagian API apa yang kamu kerjakan sendiri?',answer:'Saya membuat endpoint API dan pengujian sendiri.',timedOut:false}],evaluation:{status:'READY',score:75,result:{summary:'Kontribusi pribadi pada API dijelaskan.',strengths:['Tindakan pribadi pada API jelas.'],gaps:['Kepemimpinan belum diuji.'],claims:[{claimId:'claim-api',status:'SUPPORTED',score:3,asked:true,reason:'Jawaban menjelaskan kontribusi langsung.',evidence:[{questionId:'q-api',quote:'Saya membuat endpoint API dan pengujian sendiri.'}]},{claimId:'claim-team',status:'INSUFFICIENT',score:null,asked:false,reason:'Belum ada kesempatan membahas kepemimpinan.',evidence:[]}],interviewQuestions:['Bagaimana kamu membagi tugas tim?']}},pdfUrl:'https://private.test/report.pdf'};
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
  return route.fulfill({status:200,headers,json:body});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 Object.assign(rows[0],{scoreStatus:'PROCESSING',cvScore:null,cvProgress:{phase:'READING',updatedAt:new Date().toISOString()}});
 await page.goto(base+'/id/dashboard/recruiter/jobs/job?company=co',{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('button',{name:'Dinda Pramesti',exact:true}).waitFor({timeout:60000});
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.getByRole('link',{name:/Kanban/}).count(),0);report.checks.push('Kanban removed from job workspace');
 assert.equal(await page.getByRole('columnheader',{name:'Sumber',exact:true}).count(),0);report.checks.push('No guessed portal source');
 await page.screenshot({path:path.join(out,'01-candidates-desktop.png')});
 await page.getByRole('button',{name:'Dinda Pramesti',exact:true}).click();
 await page.getByRole('dialog',{name:'Dinda Pramesti'}).waitFor();
 const drawer=page.getByRole('dialog',{name:'Dinda Pramesti'});
 await drawer.getByText('Penilaian masih berjalan',{exact:true}).waitFor({timeout:15000});
 await drawer.getByText('96%',{exact:true}).waitFor({timeout:15000});
 assert.equal(cvStatusReads,2,'a shared status poll updates list and detail with no duplicate polling');
 report.checks.push('Taka delayed status and final score update in the open HR drawer without reload');
 await page.getByText('Python dan PyTorch sesuai kebutuhan lowongan.',{exact:true}).waitFor();
 const cvCanvas=page.locator('canvas[data-rendered="true"]');await cvCanvas.waitFor({timeout:60000});assert.ok(await cvCanvas.evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<p.length;i+=4)if(p[i]<100&&p[i+1]<100&&p[i+2]<100)ink++;return ink>100;}),'CV preview contains rendered text, not a blank frame');await page.getByRole('button',{name:'Halaman CV berikutnya',exact:true}).click();await page.getByText('Halaman 2 dari 2',{exact:true}).waitFor();await cvCanvas.waitFor();await page.getByRole('button',{name:'Halaman CV sebelumnya',exact:true}).click();await page.getByText('Halaman 1 dari 2',{exact:true}).waitFor();await cvCanvas.waitFor();report.checks.push('Private PDF CV is actually rendered with working multiple-page navigation');
 await page.screenshot({path:path.join(out,'02-candidate-drawer.png')});
 await page.getByRole('button',{name:'Undang screening',exact:true}).click();
 await page.getByRole('dialog',{name:'Undang screening bersama Tara'}).waitFor();
 await page.getByRole('textbox',{name:'Email kandidat'}).fill('dinda@example.test');
 await page.getByRole('button',{name:'Kirim undangan',exact:true}).click();
 await page.getByText('Undangan sedang disiapkan melalui email dan Pesan Talentio.',{exact:true}).waitFor();
 assert.equal(report.writes.find(w=>w.invitation)?.invitation.mode,'TEXT');report.checks.push('HR invitation uses public labels and requests both delivery channels');
 invitations[0].emailStatus='UNCERTAIN';await page.getByRole('button',{name:'Screening',exact:true}).click();const retryEmail=page.getByRole('button',{name:'Coba kirim lagi',exact:true});await retryEmail.waitFor();assert.equal(await retryEmail.isDisabled(),true);await page.getByRole('checkbox',{name:'Saya memahami kemungkinan email ganda.',exact:true}).check();await retryEmail.click();await page.getByText('Email terkirim',{exact:true}).waitFor();await page.getByText('Pesan Talentio terkirim',{exact:true}).waitFor();assert.equal(report.writes.find(w=>w.retryDelivery)?.retryDelivery.acknowledgePossibleDuplicate,true);
 invitations[0].status='COMPLETED';invitations[0].session={id:'text-result',status:'COMPLETED',completedAt:new Date().toISOString(),evaluation:{status:'READY',screeningScore:75,result:{summary:'Kontribusi pribadi pada API dijelaskan.'}}};await page.getByRole('button',{name:'CV & penilaian',exact:true}).click();await page.getByRole('button',{name:'Screening',exact:true}).click();await page.getByText('Mengembangkan layanan API',{exact:true}).waitFor();await page.getByText('Membantu tim membangun API.',{exact:true}).waitFor();await page.getByText('Saya membuat endpoint API dan pengujian sendiri.',{exact:true}).first().waitFor();await page.getByText('Belum diuji',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'08-screening-result.png')});
 invitations[0].session.evaluation.status='FAILED';await page.getByRole('button',{name:'CV & penilaian',exact:true}).click();await page.getByRole('button',{name:'Screening',exact:true}).click();await page.getByRole('button',{name:'Coba proses hasil lagi',exact:true}).click();await page.getByText('Hasil interview sedang diproses ulang.',{exact:true}).waitFor();assert.ok(report.writes.some(w=>w.retryEvaluation));report.checks.push('HR sees grounded claim results and full transcript, unasked claims stay unscored, uncertain email requires acknowledgement and failed results can be retried');

 await page.getByRole('button',{name:'Jadwal',exact:true}).click();await page.getByRole('button',{name:'Jadwalkan wawancara',exact:true}).click();await page.getByLabel('Tanggal dan waktu',{exact:true}).fill('2027-01-10T14:30');await page.getByLabel('Tautan meeting',{exact:true}).fill('https://meet.example.test/talentio');await page.getByLabel('Catatan internal',{exact:true}).fill('Catatan hanya untuk HR');await page.screenshot({path:path.join(out,'06-schedule-modal.png')});await page.getByRole('button',{name:'Simpan & kirim jadwal',exact:true}).click();await page.getByRole('link',{name:'Buka tautan meeting',exact:true}).waitFor();assert.ok(report.writes.some(w=>w.schedule?.meetingUrl==='https://meet.example.test/talentio'));
 await page.getByRole('button',{name:'Ubah jadwal',exact:true}).click();await page.getByLabel('Tanggal dan waktu',{exact:true}).fill('2027-01-11T15:30');await page.getByRole('button',{name:'Simpan & kirim jadwal',exact:true}).click();await page.getByRole('button',{name:'Ubah jadwal',exact:true}).waitFor();await page.getByRole('button',{name:'Batalkan',exact:true}).click();await page.getByRole('button',{name:'Batalkan jadwal',exact:true}).click();await page.getByText('Dibatalkan',{exact:true}).waitFor();report.checks.push('Imported candidate interview can be scheduled, rescheduled and cancelled through the drawer');
 await page.getByRole('button',{name:'CV & penilaian',exact:true}).click();
 await page.getByRole('button',{name:'Kandidat berikutnya',exact:true}).click();await page.getByRole('heading',{name:'Rizky Aditya',exact:true}).waitFor();
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});report.checks.push('Candidate drawer navigation and Escape');
 await page.getByRole('checkbox',{name:'Pilih kandidat di halaman ini',exact:true}).check();
 await page.getByRole('button',{name:'Pilih seluruh 500 hasil',exact:true}).click();
 await page.getByRole('button',{name:'Kirim pesan',exact:true}).click();await page.getByRole('dialog',{name:'Kirim pesan ke 500 kandidat',exact:true}).waitFor();await page.getByLabel('Subjek',{exact:true}).fill('Informasi tahap rekrutmen');await page.getByLabel('Isi pesan',{exact:true}).fill('Halo {{name}}, kami ingin berdiskusi mengenai pengalamanmu.');await page.screenshot({path:path.join(out,'07-bulk-message.png')});await page.getByRole('button',{name:'Kirim 500 pesan',exact:true}).click();await page.getByRole('heading',{name:'Status pengiriman pesan',exact:true}).waitFor();assert.equal(report.writes.find(w=>w.message)?.message.selection.expectedCount,500);await page.getByRole('button',{name:'Selesai',exact:true}).click();report.checks.push('Bulk message editor freezes all filtered recipients and queues email plus Talentio delivery');
 await page.getByRole('button',{name:'Masukkan ke proses',exact:true}).click();
 await page.getByRole('dialog',{name:'Masukkan kandidat ke proses?'}).waitFor();
 await page.screenshot({path:path.join(out,'03-bulk-dialog.png')});
 await page.getByRole('button',{name:'Batal',exact:true}).click();
 await page.getByRole('button',{name:'Hapus pilihan',exact:true}).click();
 await page.getByRole('checkbox',{name:'Pilih Dinda Pramesti',exact:true}).check();
 await page.getByRole('button',{name:'Masukkan ke proses',exact:true}).click();
 await page.getByRole('button',{name:'Masukkan 1 kandidat',exact:true}).click();
 await page.getByText('1 kandidat berhasil diperbarui.',{exact:true}).waitFor();
 assert.equal(report.writes.find(w=>w.action)?.action.stage,'IN_REVIEW');report.checks.push('Bulk confirmation persists a real mutation request');
 await page.getByRole('button',{name:/Dalam proses/}).click();
 await page.getByRole('columnheader',{name:'Jadwal berikutnya'}).waitFor();
 await page.screenshot({path:path.join(out,'04-in-progress.png')});
 await page.getByRole('button',{name:'Jadwalkan',exact:true}).first().click();await page.getByRole('button',{name:'Jadwalkan wawancara',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Kirim pesan',exact:true}).first().click();await page.getByRole('dialog',{name:'Kirim pesan ke 1 kandidat',exact:true}).waitFor();await page.getByRole('button',{name:'Tutup pesan',exact:true}).click();await page.getByRole('button',{name:'Tutup detail kandidat',exact:true}).click();report.checks.push('In-progress action opens schedule directly and drawer message action opens composer');
 await page.getByRole('button',{name:/Semua kandidat/}).click();
 await page.getByRole('searchbox',{name:'Cari kandidat'}).fill('Rizky');
 await page.getByRole('button',{name:'Rizky Aditya',exact:true}).waitFor();
 assert.equal(await page.locator('tbody tr').count(),1);report.checks.push('Search resets pagination and filters candidate table');
 await page.getByRole('searchbox',{name:'Cari kandidat'}).fill('');
 await page.getByRole('button',{name:'Upload CV',exact:true}).click();
 await page.getByRole('dialog',{name:'Upload CV kandidat'}).waitFor();
 await page.locator('input[type=file]').setInputFiles({name:'candidate.exe',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
 await page.getByRole('alert').filter({hasText:'candidate.exe'}).waitFor();
 await page.getByRole('button',{name:'Batal',exact:true}).click();report.checks.push('Invalid upload rejected before network request');
 await page.getByRole('button',{name:'Upload CV',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'new-candidate.pdf',mimeType:'application/pdf',buffer:pdf});
 await page.getByRole('button',{name:'Lanjut',exact:true}).click();
 await page.getByRole('complementary',{name:'Progres impor CV'}).waitFor();
 await page.getByRole('link',{name:'Detail lowongan',exact:true}).click();
 await page.getByRole('heading',{name:'Detail lowongan',exact:true}).waitFor();
 await page.waitForFunction(()=>Boolean(localStorage.getItem('candidate-imports:hr')));await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('complementary',{name:'Progres impor CV'}).waitFor();await page.getByRole('complementary',{name:'Progres impor CV'}).getByRole('button',{name:/Menilai CV/}).waitFor();importReady=true;
 await page.getByRole('complementary',{name:'Progres impor CV'}).getByRole('button',{name:/Impor CV selesai/}).waitFor({timeout:15000});
 report.checks.push('Processing progress restored after a full page reload');
 report.checks.push('Upload and scoring progress survive real SPA navigation');
 await page.getByRole('link',{name:/Kandidat\s*500/}).click();
 await page.getByRole('button',{name:'Dinda Pramesti',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(out,'05-candidates-mobile.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document horizontal overflow');
 report.checks.push('Mobile table scroll contained within page');
 await page.setViewportSize({width:1586,height:992});await page.goto(base+'/id/dashboard/recruiter/jobs/job?company=co',{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('button',{name:'Dinda Pramesti',exact:true}).waitFor();await page.getByRole('checkbox',{name:'Pilih Dinda Pramesti',exact:true}).check();await page.getByRole('button',{name:'Nilai ulang CV',exact:true}).click();await page.getByRole('dialog',{name:'Nilai ulang CV kandidat?',exact:true}).waitFor();await page.getByRole('button',{name:'Mulai penilaian ulang',exact:true}).click();await page.getByText('1 kandidat masuk antrean penilaian ulang.',{exact:true}).waitFor();assert.equal(report.writes.at(-1).action.kind,'rescore');report.checks.push('HR can confirm explicit bulk CV rescore against current job criteria');

 await page.goto(base+'/id/dashboard/recruiter?tab=pipeline&job=job&application=mock-native',{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('dialog',{name:'Kandidat 500',exact:true}).waitFor({timeout:60000});assert.ok(page.url().includes('/dashboard/recruiter/jobs/job'));assert.equal(await page.locator('[data-kanban-stage]').count(),0);await page.getByRole('button',{name:'Tutup detail kandidat',exact:true}).click();report.checks.push('Legacy pipeline link opens the selected application outside the first table page without rendering Kanban');
 await page.setViewportSize({width:1586,height:992});await page.goto(base+'/id/dashboard/recruiter?tab=jobs&company=co',{waitUntil:'domcontentloaded',timeout:120000});await page.getByRole('button',{name:'Kumpulan CV',exact:true}).click();await page.getByRole('heading',{name:'Kumpulan CV perusahaan',exact:true}).waitFor();await page.getByRole('checkbox',{name:'Pilih Dinda Pramesti',exact:true}).check();await page.getByRole('button',{name:'Tambahkan ke lowongan',exact:true}).click();await page.getByLabel('Lowongan tujuan').selectOption('job');await page.getByRole('button',{name:'Tambahkan & nilai CV',exact:true}).click();await page.getByText('1 kandidat ditambahkan ke lowongan untuk dinilai.',{exact:true}).waitFor();assert.equal(report.writes.at(-1).action.kind,'job');report.checks.push('Company CV pool assigns selected CV to a job for scoring');
 assert.deepEqual(report.errors,[]);
 await context.close();
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 console.log('Recruitment browser checks passed: '+report.checks.join('; '));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
