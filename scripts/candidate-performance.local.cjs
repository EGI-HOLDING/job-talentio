// Local-only fixtures and repeatable HTTP/browser measurements. Never accepts a remote database.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const repo = path.resolve(__dirname, '..'), req = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(req.resolve('@nestjs/config'))('dotenv');
const env = dotenv.parse(fs.readFileSync(path.join(repo, '.env')));
const url = new URL(env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '5434', 'Local DB only');
url.pathname = '/talentio_positions_local_20261103';
const {PrismaClient} = req('@prisma/client'), db = new PrismaClient({datasources:{db:{url:url.toString()}}});
const dir = path.join(repo,'node_modules/.cache/candidate-performance'); fs.mkdirSync(dir,{recursive:true});
const fixtureFile = path.join(dir,'fixtures.json'), prefix = 'candidate-perf-local';
const p95 = values => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
async function prepare() {
 if(fs.existsSync(fixtureFile))return console.log('Local performance fixtures already exist');
 await db.user.deleteMany({where:{id:{startsWith:prefix}}});await db.jobPost.deleteMany({where:{id:{startsWith:prefix}}});await db.company.deleteMany({where:{slug:prefix}});
 const all=await db.jobTitle.findMany({where:{matchingApproved:true,canonicalRoleId:null,archivedAt:null},include:{family:true}});
 const families=new Set(), roles=all.filter(r=>{if(!r.family||families.has(r.familyId))return false;families.add(r.familyId);return true;}).slice(0,6);
 assert.equal(roles.length,6);
 const company=await db.company.create({data:{name:'Local performance fixture',slug:prefix}});
 for(let i=0;i<60;i++)await db.jobPost.create({data:{id:prefix+'-job-'+i,companyId:company.id,title:roles[i%6].name,jobTitleId:roles[i%6].id,description:'Local performance fixture',status:'PUBLISHED',publishedAt:new Date()}});
 const fixtures=[];
 for(const [n,selected,processing] of [['ready',roles.slice(0,1),false],['five',roles.slice(0,5),false],['processing',roles.slice(0,1),true],['empty',[],false]]) {
  const ids=selected.map(r=>r.id),names=selected.map(r=>r.name);
  const user=await db.user.create({data:{id:prefix+'-'+n,email:prefix+'-'+n+'@example.test',fullName:'Local performance '+n,role:'EMPLOYEE',emailVerified:true,employeeProfile:{create:{desiredPositions:names,desiredPosition:names[0],matchingPreferencesReviewed:true,onboardingStatus:'COMPLETED',phone:'+62811999000'+fixtures.length,desiredRoles:{create:ids.map(jobTitleId=>({jobTitleId}))}}}},include:{employeeProfile:true}});
  const resume=await db.resume.create({data:{profileId:user.employeeProfile.id,title:'Performance CV',fileKey:'local-performance/cv.pdf',isPrimary:true,parseStatus:processing?'PROCESSING':'READY',parseGeneration:1}});
  const version=await db.resumeVersion.create({data:{resumeId:resume.id,fileKey:resume.fileKey,parseGeneration:1,parseStatus:processing?'PROCESSING':'READY',matchingData:{headline:names[0]||'',skills:[],experiences:[]},employeeEvidence:{create:{generation:1,parserVersion:'employee-cv-v3.1',status:processing?'PROCESSING':'READY',facts:{roles:selected.map(r=>({key:r.id,jobTitleId:r.id,title:r.name,source:'CV',confirmed:false})),skills:[],experiences:[],languages:[]}}}}});
  await db.resume.update({where:{id:resume.id},data:{currentVersionId:version.id}});
  const token=new (req('@nestjs/jwt').JwtService)({secret:env.JWT_SECRET}).sign({sub:user.id,tv:user.tokenVersion},{expiresIn:'12h'});
  fixtures.push({name:n,profileId:user.employeeProfile.id,selectedIds:ids,session:{accessToken:token,user:{id:user.id,email:user.email,fullName:user.fullName,role:'EMPLOYEE',phone:user.employeeProfile.phone,emailVerified:true,employeeOnboarding:{status:'COMPLETED',step:5}}}});
 }
 fs.writeFileSync(fixtureFile,JSON.stringify(fixtures)); console.log('Prepared 4 local profiles and 60 jobs');
}
async function http(label) {
 const fixtures=JSON.parse(fs.readFileSync(fixtureFile)),results=[];
 for(const f of fixtures){const times=[];let total,state;
  for(let i=0;i<12;i++){const start=performance.now();const r=await fetch('http://localhost:4000/api/jobs/recommended?page=1&limit=24',{headers:{Authorization:'Bearer '+f.session.accessToken,'X-Locale':'id'}});if(r.status===429){await new Promise(r=>setTimeout(r,2000));i--;continue;}assert.equal(r.status,200);const body=await r.json();times.push(performance.now()-start);total=body.total;state=body.state;}
  results.push({scenario:f.name,total,state,firstMs:Math.round(times[0]),warmP95Ms:Math.round(p95(times.slice(1)))});
 }
 fs.writeFileSync(path.join(dir,label+'-http.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}
async function cold(label){
 const fixtures=JSON.parse(fs.readFileSync(fixtureFile)).filter(f=>['ready','five'].includes(f.name)),result=[];
 for(const f of fixtures){const times=[];
  for(let i=0;i<10;i++){
   await db.employeeProfile.update({where:{id:f.profileId},data:{updatedAt:new Date(Date.now()+i)}});
   const start=performance.now(),r=await fetch('http://localhost:4000/api/jobs/recommended?page=1&limit=24',{headers:{Authorization:'Bearer '+f.session.accessToken}});
   if(r.status===429){await new Promise(r=>setTimeout(r,2000));i--;continue;}
   assert.equal(r.status,200);await r.json();times.push(performance.now()-start);
  }
  result.push({scenario:f.name,coldP95Ms:Math.round(p95(times)),samples:times.length});
 }
 fs.writeFileSync(path.join(dir,label+'-cold.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
async function browser(label) {
 const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_BROWSER_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
 const b=await chromium.launch({headless:true,executablePath:process.env.LINKEDIN_TEST_BROWSER||'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
 try{const c=await b.newContext({viewport:{width:1440,height:900}}),f=JSON.parse(fs.readFileSync(fixtureFile))[0];
 await c.addInitScript(session=>{localStorage.setItem('jt_session',JSON.stringify(session));localStorage.setItem('jt_token',session.accessToken);window.__lcp=0;new PerformanceObserver(list=>{window.__lcp=list.getEntries().at(-1).startTime;}).observe({type:'largest-contentful-paint',buffered:true});},f.session);
 const page=await c.newPage(),requests=[];page.on('request',r=>{if(r.url().includes(':4000/api/'))requests.push({url:new URL(r.url()).pathname+new URL(r.url()).search,at:Date.now()});});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const start=Date.now();await page.goto('http://localhost:3000/id/jobs?mode=for-you');await page.locator('[data-job-impression]').first().waitFor({timeout:60000});
 const initialMs=Date.now()-start,initialRequests=requests.length,initialRecommendationRequests=requests.filter(r=>r.url.startsWith('/api/jobs/recommended')).length;
 for(let i=0;i<5;i++)await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(1500);const focusRequests=requests.length-initialRequests,focusRecommendationRequests=requests.slice(initialRequests).filter(r=>r.url.startsWith('/api/jobs/recommended')).length,lcp=await page.evaluate(()=>window.__lcp);
 await page.locator('a[href="/id/jobs?mode=all"]').first().click();await page.waitForURL('**/jobs?mode=all');await page.locator('[data-job-impression]').first().waitFor();
 const revisit=Date.now();await page.locator('a[href="/id/jobs?mode=for-you"]').first().click();await page.waitForURL('**/jobs?mode=for-you');await page.locator('[data-job-impression]').first().waitFor();const revisitMs=Date.now()-revisit;
 const beforeIdle=requests.length;await page.waitForTimeout(61000);const idleRequests=requests.slice(beforeIdle);
 const result={initialMs,lcpMs:Math.round(lcp),initialRequests,initialRecommendationRequests,focusRequests,focusRecommendationRequests,revisitMs,idleRecommendationRequests:idleRequests.filter(r=>r.url.startsWith('/api/jobs/recommended')).length,errors,requests};
 fs.writeFileSync(path.join(dir,label+'-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,requests:undefined}));await c.close();
 }finally{await b.close();}
}
async function clean(){await db.user.deleteMany({where:{id:{startsWith:prefix}}});await db.jobPost.deleteMany({where:{id:{startsWith:prefix}}});await db.company.deleteMany({where:{slug:{startsWith:prefix}}});fs.rmSync(fixtureFile,{force:true});console.log('Local performance fixtures removed');}
async function stabilize(){
 for(let i=0;i<60;i++){
  const company=await db.company.upsert({where:{slug:prefix+'-'+i},create:{name:'Local performance fixture '+i,slug:prefix+'-'+i},update:{}});
  await db.jobPost.update({where:{id:prefix+'-job-'+i},data:{companyId:company.id,status:'PUBLISHED'}});
 }
 const fixtures=JSON.parse(fs.readFileSync(fixtureFile));
 for(const f of fixtures){
  const roles=await db.jobTitle.findMany({where:{id:{in:f.selectedIds}},select:{name:true}}),resume=await db.resume.findFirst({where:{profileId:f.profileId,isPrimary:true}});
  if(resume?.currentVersionId)await db.resumeVersion.update({where:{id:resume.currentVersionId},data:{matchingData:{headline:roles[0]?.name||'',roleTitles:roles.map(r=>r.name),skills:[],experiences:[]}}});
 }
 console.log('Stabilized 60 distinct-employer fixture jobs and matching CV role evidence');
}
async function verify(){
 const fixtures=JSON.parse(fs.readFileSync(fixtureFile)),f=fixtures.find(f=>f.name==='five'),one=fixtures.find(f=>f.name==='ready');
 const call=async(f,path,body)=>{const r=await fetch('http://localhost:4000/api'+path,{method:body?'PATCH':'GET',headers:{Authorization:'Bearer '+f.session.accessToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
 let application,job,old;
 try{
  await call(f,'/jobs/recommended?page=1&limit=24');
  await call(f,'/profiles/me',{desiredJobTitleIds:f.selectedIds.slice(0,2)});
  const result=await call(f,'/jobs/recommended?page=1&limit=24');
  const rows=await db.jobPost.findMany({where:{id:{in:result.items.map(i=>i.job.id)}},select:{jobTitleId:true}});
  assert.ok(rows.length>0&&rows.every(j=>f.selectedIds.slice(0,2).includes(j.jobTitleId)));
  const status=await call(f,'/profiles/me/matching-status');assert.equal(status.state,'READY');assert.ok(status.revision);
  const first=await call(one,'/jobs/recommended?page=1&limit=24');job=first.items.find(i=>i.job.id.startsWith(prefix)).job.id;
  old=await db.jobPost.findUniqueOrThrow({where:{id:job}});
  await db.jobPost.update({where:{id:job},data:{status:'DRAFT'}});
  assert.ok(!(await call(one,'/jobs/recommended?page=1&limit=24')).items.some(i=>i.job.id===job),'closed job cannot survive cache');
  await db.jobPost.update({where:{id:job},data:{status:old.status}});
  application=await db.application.create({data:{profileId:one.profileId,jobPostId:job}});
  assert.ok(!(await call(one,'/jobs/recommended?page=1&limit=24')).items.some(i=>i.job.id===job),'applied job cannot survive cache');
  await db.application.delete({where:{id:application.id}});application=null;
  const outside=await db.jobTitle.findFirstOrThrow({where:{matchingApproved:true,canonicalRoleId:null,id:{notIn:one.selectedIds}}});
  await db.jobPost.update({where:{id:job},data:{jobTitleId:outside.id}});
  assert.ok(!(await call(one,'/jobs/recommended?page=1&limit=24')).items.some(i=>i.job.id===job),'changed position cannot survive cache');
  console.log('PASS: immediate preference invalidation, five-position isolation, lightweight status, and closed/applied/remapped jobs excluded from cached ranking.');
 }finally{
  if(application)await db.application.delete({where:{id:application.id}});
  if(job&&old)await db.jobPost.update({where:{id:job},data:{status:old.status,jobTitleId:old.jobTitleId}});
  await call(f,'/profiles/me',{desiredJobTitleIds:f.selectedIds});
 }
}
(async()=>{try{const [action,label='measurement']=process.argv.slice(2);if(action==='prepare')await prepare();else if(action==='http')await http(label);else if(action==='cold')await cold(label);else if(action==='browser')await browser(label);else if(action==='verify')await verify();else if(action==='stabilize')await stabilize();else if(action==='clean')await clean();else throw Error('prepare | http <label> | cold <label> | browser <label> | verify | clean');}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
