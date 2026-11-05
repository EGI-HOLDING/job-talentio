const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin='http://localhost:3012';fs.mkdirSync('tmp/tara-hr',{recursive:true});
const profile={id:'p',headline:null,user:{id:'u',fullName:'Kandidat Contoh'},city:{name:'Jakarta'}};
const evidence=[{kind:'ROLE',label:'Graphic Designer',status:'UNKNOWN',required:false,evidenceRefs:[]},{kind:'SKILL',label:'Illustrator',status:'UNKNOWN',code:'LEVEL_UNCONFIRMED',minimumLevel:'ADVANCED',required:true,evidenceRefs:['skill']},{kind:'EXPERIENCE',label:'5',status:'UNKNOWN',required:true,evidenceRefs:[]}];
const match={rankingVersion:'hr-evidence-v2',state:'READY',requirementGroup:'INCOMPLETE',evidence,sources:[{ref:'skill',line:3,text:'Tools: Illustrator',confirmed:false}]};
const tara={status:'READY',version:2,cvScore:60,screeningScore:25,finalScore:42.5,rank:1,pdfReady:true,summary:'Penjelasan masih umum.',assessedClaims:2};
let state='NEW',legacy=false,assessmentRequests=0;
const item=()=>({id:'app',jobPostId:'job',status:state,kanbanEnteredAt:state==='NEW'?null:'2026-11-05',canAddToKanban:state==='NEW',createdAt:'2026-11-04T20:46:00Z',hasResumeFile:true,profile,matchBreakdown:match,tara:legacy?{...tara,status:'LEGACY'}:tara,coverLetter:'Saya tertarik dengan posisi ini.',answers:[],interviews:state==='INTERVIEW'?[{id:'int',scheduledAt:'2026-11-10T08:00:00Z',durationMins:60,status:'SCHEDULED',meetingUrl:'https://example.com/interview',note:'Diskusikan portofolio.',location:'Online'}]:[]});
const assessment={...tara,result:{summary:'Klaim pertama masih umum. Klaim kedua belum dijawab.',strengths:[],gaps:['Konfirmasikan proses pemeriksaan artwork.'],interviewQuestions:['Bagaimana kamu memeriksa file sebelum dicetak?'],criteria:[],claims:[{claimId:'c1',score:2,status:'INSUFFICIENT',reason:'Ada gambaran peran namun proses belum jelas.',evidence:[{questionId:'q1',quote:'Saya menyiapkan desain.'}],contradictions:[]},{claimId:'c2',score:0,status:'INSUFFICIENT',reason:'Tidak ada jawaban tersimpan.',evidence:[],contradictions:[]}]},plan:{claims:[{id:'c1',quote:'Menyiapkan artwork.'},{id:'c2',quote:'Mengelola file produksi.'}]},rubric:{criteria:[]},questions:[{id:'q1',question:'Bagaimana prosesmu menyiapkan artwork?',answer:'Saya menyiapkan desain.',timedOut:false},{id:'q2',question:'Bagaimana kamu mengelola file produksi?',answer:'',timedOut:true}],coverFilename:null,revisions:[]};
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
const context=await browser.newContext({viewport:{width:1536,height:1024}}),page=await context.newPage(),errors=[];
await context.addInitScript(()=>{const session={accessToken:'synthetic',user:{id:'hr',role:'RECRUITER',fullName:'HR Contoh'}};localStorage.setItem('jt_token',session.accessToken);localStorage.setItem('jt_session',JSON.stringify(session));});
await context.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;let body=[];const headers={'access-control-allow-origin':'*','access-control-allow-methods':'*','access-control-allow-headers':'*'};
if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
if(p==='/api/jobs/job')body={id:'job',title:'Graphic Designer',companyId:'co',company:{id:'co',name:'Perusahaan Contoh'},status:'PUBLISHED',jobSkills:[],jobLanguages:[],benefits:[],questions:[],_count:{applications:1}};
else if(p.endsWith('/companies/mine'))body=[{companyId:'co',role:'OWNER',company:{id:'co',name:'Perusahaan Contoh'}}];
else if(p.includes('/ai-screening/applications/app/assessment')){assessmentRequests++;body=assessment;}
else if(p.endsWith('/offer-packets'))body={packets:[]};
else if(p.includes('/applicants/app'))body=item();
else if(p.includes('/applications/jobs/job/search'))body={items:[item()],total:1,page:1,taraGroups:[{id:'g',version:2,count:1}]};
else if(p.includes('/benefits'))body={};
await route.fulfill({json:body,headers});});page.on('pageerror',e=>errors.push(e.message));
async function open(){await page.goto(origin+'/id/dashboard/recruiter/jobs/job?company=co&application=app');await page.getByRole('dialog').waitFor();await page.getByRole('heading',{name:'Penilaian klaim CV',exact:true}).waitFor();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});}
await open();const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('heading',{name:'Kandidat Contoh'}).count(),1);assert.ok(await dialog.getByText('Minimal 5 tahun',{exact:true}).isVisible());assert.ok(await dialog.getByText('0/4',{exact:true}).count());
await page.screenshot({path:'tmp/tara-hr/desktop-top.png'});await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:'tmp/tara-hr/desktop-bottom.png'});assert.ok(await dialog.getByRole('button',{name:'Mulai tinjau',exact:true}).isVisible());
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/tara-hr/mobile-bottom.png'});await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:'tmp/tara-hr/mobile-top.png'});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
state='INTERVIEW';await open();await dialog.getByRole('button',{name:/Jadwalkan wawancara berikutnya|Schedule next interview|Jadwalkan/i}).click();await page.screenshot({path:'tmp/tara-hr/interview.png'});assert.ok(await dialog.locator('input[type=datetime-local]').isVisible());
const beforeLegacy=assessmentRequests;legacy=true;state='NEW';await page.goto(origin+'/id/dashboard/recruiter/jobs/job?company=co&application=app');await page.getByRole('dialog').getByRole('heading',{name:'Kecocokan dengan persyaratan lowongan',exact:true}).waitFor();await page.waitForTimeout(500);assert.equal(assessmentRequests,beforeLegacy);assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Screening Tara',exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('HR detail: grouped requirements, numeric zero, identity, sticky actions, responsive overflow and interview scheduling passed.');await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
