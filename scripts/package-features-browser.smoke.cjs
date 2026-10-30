// Actual local UI + HTTP + disposable records in the isolated HR demo database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const h=require('./lib/hr-demo-env.cjs'),c=h.config();h.assertDemoUrl(c.databaseUrl);
const {PrismaClient}=h.req('@prisma/client'),{JwtService}=h.req('@nestjs/jwt'),db=new PrismaClient({datasources:{db:{url:c.databaseUrl}}}),jwt=new JwtService();
const {chromium}=require(require.resolve('playwright',{paths:['C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const out=path.resolve('output/package-readiness-20261028/features-browser');fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[]},users=[],companies=[],jobs=[];let browser,page;
const token=u=>jwt.sign({sub:u.id,tv:u.tokenVersion},{secret:c.env.JWT_SECRET,expiresIn:'30m'});
async function api(bearer,route,body,method=body?'POST':'GET',extra={}){const r=await fetch('http://localhost:4000/api'+route,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});const raw=await r.text();return {status:r.status,data:raw?JSON.parse(raw):null};}
async function ok(bearer,route,body,method,extra){const result=await api(bearer,route,body,method,extra);assert.ok(result.status>=200&&result.status<300,route+': '+JSON.stringify(result));return result.data;}
async function seed(ctx,bearer,admin=false){const session=await ok(bearer,'/auth/me');await ctx.addInitScript(({session,admin})=>{const key=admin?'jt_admin_token':'jt_token';localStorage.setItem(key,session.accessToken);localStorage.setItem(admin?'jt_admin_identity':'jt_session',JSON.stringify(admin?{email:session.user.email,fullName:session.user.fullName}:session));},{session,admin});}
async function fits(name){const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,classes:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,overflow:getComputedStyle(e).overflowX,text:e.textContent?.slice(0,70)})).filter(e=>e.right>innerWidth+1&&e.width>0).slice(0,35)}));if(geometry.scroll>geometry.width+1)fs.writeFileSync(path.join(out,'overflow.json'),JSON.stringify({name,...geometry},null,2));assert.ok(geometry.scroll<=geometry.width+1,name+': viewport overflow');assert.doesNotMatch(await page.locator('body').innerText(),/NaN|Infinity/);}
async function delayReply(target,url,send,change){let release,arrived;const gate=new Promise(r=>release=r),started=new Promise(r=>arrived=r);await target.route(url,async route=>{arrived();await gate;await route.continue();});try{await send();await started;await change();const response=target.waitForResponse(url);release();assert.equal((await response).status(),201);}finally{release();await target.unroute(url);}}
async function main(){
  const tag='package-features-'+randomUUID();
  const hr=await db.user.create({data:{fullName:'Package features HR '+tag,role:'RECRUITER',recruiterOnboarding:{create:{status:'NOT_REQUIRED'}}}});users.push(hr.id);
  const employeePhoneSuffix=String(1_000_000+Math.floor(Math.random()*9_000_000));
  const employee=await db.user.create({data:{fullName:'Package features employee '+tag,role:'EMPLOYEE',employeeProfile:{create:{onboardingStatus:'COMPLETED',phone:'+99890'+employeePhoneSuffix}}}});users.push(employee.id);
  const company=await db.company.create({data:{name:'Package features verified company',slug:tag,members:{create:{userId:hr.id,role:'OWNER'}}}});companies.push(company.id);const bearer=token(hr),employeeToken=token(employee);
  for(const code of ['FREE','STANDARD','PREMIUM']){
    const descriptions={FREE:'Design accessible customer interfaces and collaborate with product designers to deliver web experiences.',STANDARD:'Maintain automated quality checks, investigate software defects and coordinate test coverage with engineers.',PREMIUM:'Plan international warehouse operations, optimize shipping routes and manage inventory schedules for suppliers.'};
    const job=await ok(bearer,'/jobs/company/'+company.id,{title:code+' Verification Role Русский Indonesia',description:descriptions[code],workMode:'REMOTE',countryId:null});jobs.push(job.id);
    const order=await ok(bearer,'/job-commerce/orders',{jobId:job.id,code,intent:'PURCHASE'},'POST',{'Idempotency-Key':randomUUID()});
    if(code!=='FREE')await ok(bearer,'/job-commerce/orders/'+order.id+'/complete-test',{});
    await ok(bearer,'/jobs/'+job.id+'/status',{status:'PUBLISHED'});
    const visitor=randomUUID();let session;
    for(const kind of ['IMPRESSION','DETAIL_VIEW','APPLY_CLICK','APPLY_START']){const event=await ok(null,'/hr-events',{jobId:job.id,visitor,kind,source:'direct'},'POST',{'User-Agent':'Talentio package verification'});session=event.session;await ok(null,'/hr-events',{jobId:job.id,visitor,kind,source:'direct'},'POST',{'User-Agent':'Talentio package verification'});}
    await ok(null,'/hr-events',{jobId:job.id,visitor:randomUUID(),kind:'DETAIL_VIEW'},'POST',{'User-Agent':'Talentio package verification'});
    assert.equal((await ok(bearer,'/hr-events',{jobId:job.id,visitor:randomUUID(),kind:'DETAIL_VIEW'},'POST',{'User-Agent':'Talentio package verification'})).ignored,true);
    assert.equal((await ok(null,'/hr-events',{jobId:job.id,visitor:randomUUID(),kind:'DETAIL_VIEW'},'POST',{'User-Agent':'Synthetic crawler'})).ignored,true);
    const application=await ok(employeeToken,'/applications/jobs/'+job.id,{funnelSession:session});
    await ok(bearer,'/applications/'+application.id+'/kanban',{});await ok(bearer,'/applications/'+application.id+'/status',{status:'IN_REVIEW'});
    const stats=await ok(bearer,'/hr-reports?companyId='+company.id+'&jobId='+job.id);
    assert.equal(stats.views,2);assert.equal(stats.events.IMPRESSION,1);assert.equal(stats.events.APPLY_CLICK,1);assert.equal(stats.totalApplications,1);
    assert.equal(stats.capabilities.conversions,code!=='FREE');assert.equal(stats.capabilities.reports,code==='PREMIUM');
    if(code!=='FREE'){assert.equal(stats.conversionSessions,2);assert.equal(stats.conversion.APPLICATION_SUBMITTED,1);}
    const csv=await fetch('http://localhost:4000/api/hr-reports/csv?companyId='+company.id+'&jobId='+job.id,{headers:{Authorization:'Bearer '+bearer}});
    assert.equal(csv.status,code==='PREMIUM'?200:403);if(code==='PREMIUM'){const csvBody=await csv.text();assert.match(csvBody,/Русский Indonesia/);assert.match(csv.headers.get('cache-control'),/no-store/);}
    const boost=await api(bearer,'/benefits/jobs/'+job.id+'/boost',{},'POST',{'Idempotency-Key':randomUUID()});assert.equal(boost.status,code==='FREE'?409:201);if(code==='FREE')assert.match(boost.data.message,/No boost allowance/);
    const state=await ok(bearer,'/benefits/jobs/'+job.id);assert.equal(Boolean(state.activeBoost),code!=='FREE');
    report.checks.push(code+': real package activation/publication, event dedup/HR+bot exclusion, attributed application/kanban, exact metrics, CSV entitlement and boost');
  }
  assert.ok((await ok(null,'/benefits/featured')).some(item=>item.id===company.id));
  assert.equal((await ok(bearer,'/benefits/companies/'+company.id)).prioritySupport,true);
  const sample=await db.jobPurchaseOrder.findFirstOrThrow({where:{companyId:company.id,code:'STANDARD'}});const {id:oldId,createdAt:oldCreated,updatedAt:oldUpdated,...historyTemplate}=sample;
  await db.jobPurchaseOrder.createMany({data:Array.from({length:25},(_,i)=>({...historyTemplate,id:'browser-history-'+randomUUID(),status:'CANCELLED',provider:null,providerReference:null,paidAt:null,fulfilledAt:null,jobTitle:'Older history '+i,createdAt:new Date('2020-01-01T00:00:00Z')}))});
  assert.equal((await api(bearer,'/job-commerce/orders/history?companyId='+company.id+'&page=0')).status,400);
  assert.equal((await api(employeeToken,'/job-commerce/orders/history?companyId='+company.id)).status,403);
  browser=await chromium.launch({headless:true,executablePath:'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  const publicContext=await browser.newContext({viewport:{width:390,height:900}});page=await publicContext.newPage();await page.goto('http://localhost:3000/id');const featured=page.getByRole('heading',{name:'Perusahaan unggulan',exact:true}).locator('..').getByRole('link',{name:company.name,exact:true});await featured.waitFor();await featured.scrollIntoViewIfNeeded();await fits('public featured company');await featured.click();await page.waitForURL('**/companies/'+company.slug);report.checks.push('Featured benefit appears on the real public homepage and links to the correct company');await publicContext.close();
  for(const width of [1440,390,320])for(const locale of ['id','en','ru','uz']){
    if(process.argv.includes('--quick') && (width!==320 || locale!=='uz'))continue;
    const ctx=await browser.newContext({viewport:{width,height:900},timezoneId:locale==='en'&&width===1440?'America/Los_Angeles':'UTC'});await seed(ctx,bearer);page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto('http://localhost:3000/'+locale+'/dashboard/recruiter?tab=analytics&company='+company.id);
    await page.locator('input[type=date]').first().waitFor();await page.locator('table tbody tr').first().waitFor();await fits(locale+' analytics '+width);
    if(locale==='en'&&width===1440){const day=new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date());assert.ok(await page.locator('[role=img]').evaluateAll((elements,day)=>elements.filter(e=>e.getAttribute('aria-label')?.startsWith(day+':')).length,day)>=2,'UTC chart days must not shift in a Los Angeles browser');report.checks.push('Analytics UTC day labels remain correct in America/Los_Angeles browser timezone');}
    await page.locator('input[type=date]').first().fill('2020-01-01');await page.locator('table tbody tr').first().waitFor();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:/CSV/}).click();const file=await download;assert.equal(file.suggestedFilename(),'recruitment-report.csv');
    if(locale==='id')await page.screenshot({path:path.join(out,'analytics-'+width+'.png'),fullPage:true});
    await page.goto('http://localhost:3000/'+locale+'/dashboard/recruiter/orders?company='+company.id);await page.locator('article').last().waitFor();await fits(locale+' orders '+width);
    await page.locator('footer nav button').filter({hasText:/^2$/}).click();await page.getByRole('heading',{name:/Older history/}).first().waitFor();assert.equal(await page.locator('footer nav button[aria-current=page]').innerText(),'2');
    report.checks.push(locale+' '+width+'px: actual analytics/report/date/export and all-package order UI');await ctx.close();
  }
  const context=await browser.newContext({viewport:{width:320,height:900}});await seed(context,bearer);page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://localhost:3000/en/dashboard/recruiter?tab=jobs&company='+company.id);await page.getByRole('button',{name:'HR support',exact:true}).click();
  const title='Priority audit '+ 'Q'.repeat(130)+' '+tag.slice(-8);await page.locator('input[name=title]').fill(title);await page.locator('textarea[name=body]').fill('Priority support must reach the administrator and retain every reply.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('heading',{name:title}).waitFor();await fits('mobile support long subject');
  const ticket=await db.supportTicket.findFirstOrThrow({where:{companyId:company.id,title}});assert.equal(ticket.priority,true);
  const secondTitle='Other thread '+tag;await ok(bearer,'/hr-support',{companyId:company.id,title:secondTitle,body:'A second thread verifies navigation while a reply is pending.'},'POST',{'Idempotency-Key':randomUUID()});
  const admin=await db.user.findUniqueOrThrow({where:{email:c.credentials.accounts.admin}}),adminContext=await browser.newContext({viewport:{width:1440,height:900}});await seed(adminContext,token(admin),true);const hrPage=page;page=await adminContext.newPage();
  await page.goto('http://localhost:3001/support');await page.getByRole('button',{name:new RegExp(title)}).click();await page.locator('textarea[name=body]').fill('Verified administrator response to the priority request.');
  await delayReply(page,'**/api/hr-support/'+ticket.id+'/replies',()=>page.getByRole('button',{name:'Send reply',exact:true}).click(),async()=>{await page.getByRole('button',{name:new RegExp(secondTitle)}).click();await page.getByRole('heading',{name:secondTitle}).waitFor();assert.equal(await page.locator('textarea[name=body]').inputValue(),'','a different ticket must not inherit the previous reply text');});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Send reply'&&!e.disabled));assert.equal(await page.getByRole('heading',{name:secondTitle}).count(),1,'late reply must not reopen the previous admin thread');
  await page.getByRole('button',{name:new RegExp(title)}).click();await page.locator('p').filter({hasText:'Verified administrator response to the priority request.'}).waitFor();await fits('admin priority queue');
  const assigned=page.waitForResponse(response=>response.url().endsWith('/hr-support/'+ticket.id+'/assign-self')&&response.request().method()==='POST');await page.getByRole('button',{name:'Assign to me',exact:true}).click();assert.equal((await assigned).status(),201);assert.equal((await db.supportTicket.findUniqueOrThrow({where:{id:ticket.id}})).assignedToId,admin.id);
  await page.getByRole('combobox').selectOption('RESOLVED');await page.waitForFunction(()=>document.querySelector('select')?.value==='RESOLVED');
  assert.equal((await db.supportTicket.findUniqueOrThrow({where:{id:ticket.id}})).status,'RESOLVED');await page.screenshot({path:path.join(out,'admin-support.png'),fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});await fits('admin support long subject '+width);await page.screenshot({path:path.join(out,'admin-support-'+width+'.png'),fullPage:true});}
  page=hrPage;await page.reload();await page.getByRole('button',{name:'HR support',exact:true}).click();await page.getByRole('checkbox',{name:'Include resolved requests'}).check();await page.getByRole('button',{name:new RegExp(title)}).click();await page.locator('p').filter({hasText:'Verified administrator response to the priority request.'}).waitFor();
  await page.locator('textarea[name=body]').fill('Reply submitted before navigating to a new request.');
  await delayReply(page,'**/api/hr-support/'+ticket.id+'/replies',()=>page.getByRole('button',{name:'Send',exact:true}).click(),async()=>{await page.getByRole('button',{name:'New request',exact:true}).click();assert.equal(await page.locator('textarea[name=body]').inputValue(),'');});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Send'&&!e.disabled));assert.equal(await page.locator('input[name=title]').count(),1,'late reply must not reopen the previous HR thread');
  report.checks.push('Mobile HR creates priority ticket → real admin queue/reply/resolve → HR sees resolved thread and reply');
  report.checks.push('Delayed real replies preserve the newly selected admin/HR thread and never reopen the old conversation');
  const pendingJob=await ok(bearer,'/jobs/company/'+company.id,{title:'Network Recovery Auditor',description:'Review transaction recovery behavior, document system reliability incidents and improve service resilience.',workMode:'REMOTE',countryId:null});jobs.push(pendingJob.id);
  const pendingOrder=await ok(bearer,'/job-commerce/orders',{jobId:pendingJob.id,code:'STANDARD',intent:'PURCHASE'},'POST',{'Idempotency-Key':randomUUID()});
  let reads=0,failSeen;const failureSeen=new Promise(r=>failSeen=r);await page.route('**/api/job-commerce/orders/'+pendingOrder.id,async route=>{if(route.request().method()==='GET'&&++reads===2){await route.fulfill({status:503,json:{message:'Injected temporary polling outage'}});failSeen();}else await route.continue();});
  await page.goto('http://localhost:3000/en/checkout/'+pendingOrder.id);await page.getByRole('button',{name:/Activate for testing/}).waitFor();let failureTimer;try{await Promise.race([failureSeen,new Promise((_,reject)=>{failureTimer=setTimeout(()=>reject(Error('Expected failed status poll did not occur')),20000);})]);}finally{clearTimeout(failureTimer);}
  await ok(bearer,'/job-commerce/orders/'+pendingOrder.id+'/complete-test',{});await page.getByRole('heading',{name:'Your package is ready'}).waitFor({timeout:15000});assert.ok(reads>=3);assert.equal(await db.jobPaymentEvent.count({where:{orderId:pendingOrder.id}}),1);
  report.checks.push('Real checkout recovers automatically after a failed status poll, observes verified settlement and renders success without refresh');
  const lifecycle=jobs[1],beforeLifecycle=await db.jobBenefit.findUniqueOrThrow({where:{jobId:lifecycle}});
  for(const status of ['PAUSED','PUBLISHED','CLOSED','PUBLISHED','CLOSED'])await ok(bearer,'/jobs/'+lifecycle+'/status',{status});
  const afterLifecycle=await db.jobBenefit.findUniqueOrThrow({where:{jobId:lifecycle}});assert.equal(afterLifecycle.expiresAt.getTime(),beforeLifecycle.expiresAt.getTime());
  const copy=await ok(bearer,'/jobs/'+lifecycle+'/duplicate',{});jobs.push(copy.id);assert.equal(copy.status,'DRAFT');assert.equal(await db.jobBenefit.count({where:{jobId:copy.id}}),0);
  assert.equal((await api(bearer,'/jobs/'+copy.id+'/status',{status:'PUBLISHED'})).status,409);
  report.checks.push('Pause/resume/close/reopen preserve the original expiry; duplication makes a fresh draft with no paid benefit and requires package selection');
  await context.close();await adminContext.close();assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}
main().catch(async e=>{report.errors.push(e.stack||String(e));console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  for(const id of jobs)await fetch(c.env.MEILI_HOST+'/indexes/'+c.env.MEILI_JOBS_INDEX+'/documents/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+c.env.MEILI_MASTER_KEY}}).catch(()=>{});
  const orders=await db.jobPurchaseOrder.findMany({where:{companyId:{in:companies}},select:{id:true}});await db.jobPaymentEvent.deleteMany({where:{orderId:{in:orders.map(x=>x.id)}}});await db.jobPurchaseOrder.deleteMany({where:{companyId:{in:companies}}});await db.jobPublicationPeriod.deleteMany({where:{companyId:{in:companies}}});await db.company.deleteMany({where:{id:{in:companies}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
});
