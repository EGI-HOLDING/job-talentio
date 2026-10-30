// Visual verification uses the actual local web app with synthetic API fixtures only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:['C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const origin=process.env.BOOST_PREVIEW_ORIGIN||'http://127.0.0.1:3199';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Local preview only');
const out=path.resolve('output/employee-boost');fs.mkdirSync(out,{recursive:true});
const jobs=Array.from({length:30},(_,i)=>({id:'fixture-'+i,title:i===0?'Senior Fullstack Engineer untuk Platform Operasional Bisnis dan Integrasi Enterprise':'Software Engineer '+(i+1),description:'Bangun produk digital bersama tim lintas fungsi. Posisi ini berfokus pada kualitas, aksesibilitas, dan kolaborasi.',contentLocale:'id',company:{id:'company-'+i,name:i===0?'Nusarintis Digital Teknologi dan Platform Operasional Bisnis Indonesia':'Nusarintis Digital',slug:'fixture-company',logoUrl:null},city:{slug:'bandung',name:'Kota Bandung'},country:{name:'Indonesia'},currency:'IDR',salaryMin:12000000,salaryMax:18000000,salaryPeriod:'MONTHLY',workMode:'HYBRID',employmentType:'FULL_TIME',experienceLevel:'MIDDLE',jobSkills:[],jobLanguages:[],benefits:[],promotion:{active:i%3===1,boostActive:i%3===1,revalidateAt:null},isPromoted:i%3===1,placement:'ORGANIC'}));
const profile={id:'fixture-profile',headline:'Software Engineer',desiredPosition:'Software Engineer',skills:[],experiences:[],languages:[],resumes:[]};
const session={accessToken:'local-fixture-only',user:{id:'fixture-employee',role:'EMPLOYEE',fullName:'Kandidat Contoh',locale:'id',emailVerified:true,memberships:[],employeeOnboarding:{status:'COMPLETED'}}};
async function main(){
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});const checks=[];
 try{
 const context=await browser.newContext();await context.addInitScript(session=>{localStorage.setItem('jt_session',JSON.stringify(session));localStorage.setItem('jt_token',session.accessToken);},session);
 let revision='r1'; const recommendationRequests=[];
 await context.route('**/api/**',async route=>{
   const u=new URL(route.request().url()),p=u.pathname.replace(/^\/api/,'');let data={};
   if(p==='/profiles/me')data=profile;
   else if(p==='/auth/me')data=session;
   else if(p==='/profiles/me/onboarding')data={status:'COMPLETED',profile:{phone:'+6281234567890'}};
   else if(p==='/jobs/recommended'){recommendationRequests.push(u.searchParams.get('page')||'array');const page=Number(u.searchParams.get('page')||1),limit=Number(u.searchParams.get('limit')||24),items=jobs.slice((page-1)*limit,page*limit).map(job=>({job}));data=u.searchParams.has('page')?{items,page,limit,total:30,totalPages:Math.ceil(30/limit),mode:'PERSONALIZED',rankingRevision:revision}:items;}
   else if(p==='/jobs')data={items:jobs.slice(0,Number(u.searchParams.get('limit')||12)),page:1,limit:Number(u.searchParams.get('limit')||12),total:30,totalPages:3,facets:{cities:[],categories:[],jobTitles:[],companies:[],industries:[],skills:[],languages:[],experienceLevels:{}}};
   else if(p.startsWith('/jobs/fixture-'))data=jobs.find(job=>job.id===p.split('/')[2]);
   else if(p.startsWith('/meta/'))data=p==='/meta/platform-stats'?{jobs:30,companies:3,locations:10}:[];
   else if(p==='/companies'||p==='/news')data={items:[]};
   else if(p.includes('/following'))data={following:false};
   else if(p.includes('/mine/jobs/'))data={applied:false,application:null};
   else if(p.includes('saved-jobs')||p.includes('notifications'))data=[];
   else if(p==='/hr-events')data={ignored:true};
   await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 await context.route('**/socket.io/**',r=>r.abort());
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const labels={id:'Dipromosikan',en:'Promoted',ru:'Продвигается',uz:'Targ‘ib qilinmoqda'};
 for(const locale of ['id','uz','en','ru'])for(const width of [390,768,1200,1440,1920]){
   await page.setViewportSize({width,height:960});
   await page.goto(origin+'/'+locale+'/jobs?mode=all',{waitUntil:'networkidle'});
   await page.getByRole('heading',{name:jobs[0].title,exact:true}).waitFor();
   const badge=page.getByRole('button',{name:labels[locale],exact:true}).first();await badge.waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,locale+' '+width+' overflow');
   assert.equal(await page.locator('a button').count(),0,'promotion controls must not be nested in links');
   await page.screenshot({path:path.join(out,locale+'-'+width+'-list.png')});
   await badge.click();await page.getByRole('tooltip').waitFor();
   const box=await page.getByRole('tooltip').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
   if(width===390||width===1440)await page.screenshot({path:path.join(out,locale+'-'+width+'-popover.png')});
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);assert.equal(await badge.evaluate(el=>el===document.activeElement),true);
   checks.push({locale,width,overflow:false,nestedControls:false,popover:true});
 }
 for(const locale of ['id','uz','en','ru'])for(const width of [390,1440]){
   await page.setViewportSize({width,height:960});
   await page.goto(origin+'/'+locale+'/jobs?mode=all&job='+jobs[1].id,{waitUntil:'networkidle'});
   await page.locator('[class*=previewCompanyHeading]').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'preview '+locale+' '+width);
   await page.screenshot({path:path.join(out,locale+'-'+width+'-preview.png')});
   await page.goto(origin+'/'+locale+'/jobs/'+jobs[1].id,{waitUntil:'networkidle'});
   await page.getByRole('button',{name:labels[locale],exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'detail '+locale+' '+width);
   await page.screenshot({path:path.join(out,locale+'-'+width+'-detail.png')});
 }
 await page.setViewportSize({width:1440,height:960});
 await page.goto(origin+'/id/jobs?mode=for-you',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:jobs[0].title,exact:true}).waitFor();await page.screenshot({path:path.join(out,'id-personalized.png')});
 revision='r2'; const reset=page.waitForResponse(r=>r.url().includes('/jobs/recommended?page=1&limit=24')); await page.locator('button.pagination-page').filter({hasText:/^2$/}).click(); await reset; await page.getByRole('heading',{name:jobs[0].title,exact:true}).waitFor(); assert.deepEqual(recommendationRequests.slice(-2),['2','1'],'changed ranking restarts page one');
 await page.getByRole('link',{name:jobs[1].title,exact:true}).click();await page.locator('[class*=previewCompanyHeading]').waitFor();
 await page.screenshot({path:path.join(out,'id-preview.png')});
 await page.goto(origin+'/id/jobs/'+jobs[1].id,{waitUntil:'networkidle'});await page.getByRole('heading',{name:jobs[1].title,exact:true}).waitFor();
 await page.getByRole('button',{name:labels.id,exact:true}).waitFor();await page.screenshot({path:path.join(out,'id-detail.png')});
 await page.goto(origin+'/id',{waitUntil:'networkidle'});await page.getByRole('button',{name:labels.id,exact:true}).first().waitFor();await page.screenshot({path:path.join(out,'id-home.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'visual-report.json'),JSON.stringify({checks,errors,fixturesOnly:true},null,2));
 console.log(JSON.stringify({visualChecks:checks.length,screenshots:fs.readdirSync(out).filter(f=>f.endsWith('.png')).length,errors}));
 await context.close();
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
