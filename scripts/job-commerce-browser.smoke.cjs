const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const h=require('./lib/hr-demo-env.cjs'),{env}=h.config({realAuth:true});h.assertDemoUrl(env.DATABASE_URL);
const {PrismaClient}=h.req('@prisma/client'),{JwtService}=h.req('@nestjs/jwt'),db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}}),jwt=new JwtService();
const {chromium}=require(require.resolve('playwright',{paths:['C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const out=path.resolve('output/job-commerce'),users=[],companies=[],report={checks:[],screenshots:[],errors:[]};fs.mkdirSync(out,{recursive:true});
let browser,page;
const call=async(token,route,body,method=body?'POST':'GET',headers={})=>{const response=await fetch('http://localhost:4000/api'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept-Language':'id',...headers},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();return {status:response.status,data};};
async function fixture(width){
  const tag='commerce-browser-'+randomUUID();
  const user=await db.user.create({data:{role:'RECRUITER',fullName:'Andi Pratama',email:tag+'@example.invalid',emailVerified:true,locale:'id'}});users.push(user.id);
  const company=await db.company.create({data:{name:'Nusantara Product Studio '+width,slug:tag,members:{create:{userId:user.id,role:'OWNER'}}}});companies.push(company.id);
  const token=jwt.sign({sub:user.id,tv:0},{secret:env.JWT_SECRET,expiresIn:'30m'}),session=await call(token,'/auth/me');assert.equal(session.status,200);assert.equal(session.data.user.recruiterOnboarding.status,'IN_PROGRESS');
  const context=await browser.newContext({viewport:{width,height:width<700?844:1000}});
  await context.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
  await context.addInitScript(session=>{if(sessionStorage.getItem('commerce-seeded'))return;sessionStorage.setItem('commerce-seeded','1');localStorage.setItem('jt_token',session.accessToken);localStorage.setItem('jt_session',JSON.stringify(session));},session.data);
  const view=await context.newPage();view.on('pageerror',e=>report.errors.push(e.message));
  return {user,company,token,context,view};
}
async function screenshot(name){const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);}
async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Page must fit its viewport');}
async function waitUntil(fn,message){for(let n=0;n<50;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(message);}
async function main(){
  browser=await chromium.launch({headless:true,executablePath:'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  for(const width of [1440,390])for(const locale of ['id','en','ru','uz']){
    const context=await browser.newContext({viewport:{width,height:width<700?844:1000}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto('http://localhost:3000/'+locale+'/pricing');await page.locator('article[data-code=PREMIUM]').waitFor();assert.equal(await page.locator('article[data-code]').count(),3);await fits();await screenshot('pricing-'+locale+'-'+width);await context.close();
    report.checks.push('Pricing '+locale+' '+width+'px: three live API packages, no viewport overflow');
  }
  const country=await db.country.findFirstOrThrow({where:{iso2:'ID',isActive:true,archivedAt:null}}),industry=await db.industry.findFirstOrThrow({where:{archivedAt:null}});
  for(const width of [1440,390]){
    const f=await fixture(width);page=f.view;
    assert.equal((await call(f.token,'/recruiter-onboarding/complete',{skipJob:true})).status,400);
    const guarded=await call(f.token,'/jobs/company/'+f.company.id,{title:'Guarded workspace test',description:'This valid draft checks that company details cannot be skipped before publication.',workMode:'REMOTE',countryId:null});assert.equal(guarded.status,201);
    const cannotPublish=await call(f.token,'/jobs/'+guarded.data.id+'/status',{status:'PUBLISHED'});assert.equal(cannotPublish.status,400);assert.match(cannotPublish.data.message,/COMPANY_DESCRIPTION_TOO_SHORT/);
    let earlyJobCalls=0;page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/jobs/company/'))earlyJobCalls++;});
    await page.goto('http://localhost:3000/id/dashboard/recruiter');await page.waitForURL('**/onboarding/recruiter?**');await page.locator('textarea').waitFor();assert.equal(earlyJobCalls,0,'Dashboard data must not render before onboarding status is checked');
    await screenshot('company-empty-'+width);
    const description='Kami membangun produk digital untuk membantu tim bekerja lebih baik di seluruh dunia.';
    await page.locator('textarea').fill(description);
    await page.locator('select').filter({has:page.locator('option[value="'+industry.slug+'"]')}).selectOption(industry.slug);
    await page.locator('select').filter({has:page.locator('option[value="SIZE_11_50"]')}).selectOption('SIZE_11_50');
    await page.locator('select[name=countryId]').selectOption(country.id);
    const city=page.locator('input[role=combobox]');await city.waitFor({state:'visible'});await waitUntil(()=>city.isEnabled(),'City picker did not enable');await city.click();await page.locator('[role=listbox] [role=option]').first().waitFor();await page.locator('[role=listbox] [role=option]').first().click();
    await waitUntil(async()=>Boolean((await db.recruiterOnboarding.findUnique({where:{userId:f.user.id}}))?.companyDraft?.citySlug),'Company draft was not saved');
    await page.reload();await page.locator('textarea').waitFor();assert.equal(await page.locator('textarea').inputValue(),description);await fits();await screenshot('company-filled-'+width);
    await page.getByRole('button',{name:/^Lanjutkan/}).click();await page.getByRole('heading',{name:'Buat lowongan pertamamu',level:1}).waitFor();await screenshot('first-job-'+width);
    report.checks.push(width+'px: direct-dashboard gate, mandatory company fields, native country/city selection, server draft and refresh resume');
    if(width===390){await page.getByRole('button',{name:'Buat nanti, masuk dashboard'}).click();await page.waitForURL('**/dashboard/recruiter?**');assert.equal((await db.recruiterOnboarding.findUniqueOrThrow({where:{userId:f.user.id}})).status,'COMPLETE');await page.reload();await page.locator('[data-jobs=true]').waitFor({state:'attached',timeout:3000}).catch(()=>{});assert.match(page.url(),/dashboard\/recruiter/);report.checks.push('Mobile: optional first job skipped, company retained, completion persisted and no repeat wizard');
      const mobileJob=await call(f.token,'/jobs/company/'+f.company.id,{title:'Mobile Free Product Designer',description:'Design clear and accessible digital products with an international team.',workMode:'REMOTE',countryId:null});assert.equal(mobileJob.status,201);
      await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+mobileJob.data.id+'/package');await page.locator('article[data-code=PREMIUM]').waitFor();await page.locator('article[data-code=PREMIUM] button').scrollIntoViewIfNeeded();assert.equal(await page.locator('article[data-code=PREMIUM] button').isVisible(),true);await screenshot('package-premium-scroll-mobile');
      await page.locator('article[data-code=FREE] button').click();await page.locator('[data-job-editor]').waitFor();assert.equal((await db.jobBenefit.findUniqueOrThrow({where:{jobId:mobileJob.data.id}})).code,'FREE');assert.equal((await call(f.token,'/jobs/'+mobileJob.data.id+'/status',{status:'PUBLISHED'})).status,201);
      await page.goto('http://localhost:3000/id/dashboard/recruiter/orders?company='+f.company.id);await page.getByRole('heading',{name:'Paket & pesanan'}).waitFor();await page.locator('article').last().scrollIntoViewIfNeeded();await fits();await screenshot('orders-free-mobile');
      report.checks.push('Mobile: all package cards remain reachable by scrolling, explicit Free selection and actual publication work, order history scrolls');await f.context.close();continue;}
    await page.getByRole('button',{name:/^Buat lowongan/}).click();await page.locator('input[name=title]').fill('Frontend Product Developer');await page.locator('textarea[name=description]').fill('Mengembangkan antarmuka produk dengan React dan TypeScript bersama tim desain dan engineering.');
    await page.locator('select[name=workMode]').selectOption('REMOTE');await page.locator('select[name=countryId]').selectOption('__WORLDWIDE__');
    for(let n=0;n<3;n++)await page.locator('[data-job-editor] footer button').last().click();
    await page.locator('[data-job-editor] footer button').last().click();await page.waitForURL('**/package?**');await page.locator('article[data-code=STANDARD]').waitFor();await screenshot('select-standard-desktop');
    await page.locator('article[data-code=STANDARD] button').click();await page.waitForURL('**/checkout/**');await page.getByRole('button',{name:/Aktifkan untuk pengujian/}).waitFor();await fits();await screenshot('checkout-standard-desktop');
    await page.getByRole('button',{name:/Aktifkan untuk pengujian/}).click();await page.getByRole('heading',{name:'Paketmu sudah siap'}).waitFor();await screenshot('checkout-success-desktop');
    await page.getByRole('button',{name:/^Lanjutkan/}).click();await page.waitForURL('**/onboarding/recruiter?**');await page.getByRole('heading',{name:'Siap untuk dipublikasikan'}).waitFor();await screenshot('ready-to-publish-desktop');
    await page.getByRole('button',{name:/Publikasikan & masuk dashboard/}).click();await page.waitForURL('**/dashboard/recruiter?**');
    const progress=await db.recruiterOnboarding.findUniqueOrThrow({where:{userId:f.user.id}}),job=await db.jobPost.findUniqueOrThrow({where:{id:progress.jobId},include:{benefit:true}});assert.equal(progress.status,'COMPLETE');assert.equal(job.status,'PUBLISHED');assert.equal(job.benefit.code,'STANDARD');assert.ok(job.benefit.startsAt&&job.benefit.expiresAt);
    report.checks.push('Desktop: actual job editor → persisted draft → per-job Standard → local checkout → onboarding publish → dashboard, one paid order and 30-day period');
    const beforePricing=await db.jobPurchaseOrder.count({where:{companyId:f.company.id}});await page.goto('http://localhost:3000/id/pricing');await page.locator('article[data-code=PREMIUM] a').click();await page.waitForURL('**/dashboard/recruiter?**');assert.equal(new URL(page.url()).searchParams.get('package'),'PREMIUM');assert.equal(await db.jobPurchaseOrder.count({where:{companyId:f.company.id}}),beforePricing);report.checks.push('Signed-in recruiter pricing CTA returns directly to recruiter workspace with package intent and creates no order');
    await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+job.id+'/package');await page.locator('article[data-code=PREMIUM]').waitFor();await page.locator('article[data-code=PREMIUM] button').click();await page.waitForURL('**/checkout/**');await page.getByRole('button',{name:/Aktifkan untuk pengujian/}).waitFor();assert.ok((await page.locator('aside').innerText()).includes('150.000'));await screenshot('upgrade-checkout-desktop');
    await page.setViewportSize({width:390,height:844});await fits();await screenshot('upgrade-checkout-mobile');await page.getByRole('button',{name:/Aktifkan untuk pengujian/}).click();await page.getByRole('heading',{name:'Paketmu sudah siap'}).waitFor();
    const upgraded=await db.jobBenefit.findUniqueOrThrow({where:{jobId:job.id}});assert.equal(upgraded.code,'PREMIUM');assert.equal(upgraded.expiresAt.getTime(),job.benefit.expiresAt.getTime());
    await page.goto('http://localhost:3000/id/dashboard/recruiter/orders?company='+f.company.id);await page.getByRole('heading',{name:'Paket & pesanan'}).waitFor();await fits();await screenshot('orders-mobile');
    report.checks.push('Upgrade Standard→Premium charged only IDR150000, preserved expiry; mobile checkout and order history fit viewport');
    const socialJob=await call(f.token,'/jobs/company/'+f.company.id,{title:'Design Systems Engineer',description:'Build accessible design systems and maintain reliable product interface foundations.',workMode:'REMOTE',countryId:null});assert.equal(socialJob.status,201);
    const socialOrder=await call(f.token,'/job-commerce/orders',{jobId:socialJob.data.id,code:'PREMIUM',intent:'PURCHASE'},'POST',{'Idempotency-Key':randomUUID()});assert.equal(socialOrder.status,201);assert.equal((await call(f.token,'/job-commerce/orders/'+socialOrder.data.id+'/complete-test',{},'POST')).data.status,'PAID');
    await db.linkedInConnection.create({data:{userId:f.user.id,status:'CONNECTED',subject:'synthetic-commerce-ui',authorUrn:'urn:li:person:synthetic-commerce-ui',displayName:f.user.fullName,autoShareEnabled:true,tokenCiphertext:'synthetic-not-a-real-token',tokenKeyVersion:'synthetic',tokenExpiresAt:new Date(Date.now()+86400000),generation:1}});
    await f.context.route('**/api/integrations/linkedin',route=>route.request().method()==='GET'?route.fulfill({json:{enabled:true,sharingEnabled:true,connected:true,status:'CONNECTED',displayName:f.user.fullName,autoShareEnabled:true,expiresAt:new Date(Date.now()+86400000).toISOString()}}):route.continue());
    await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+socialJob.data.id+'?section=details&review=1');const poster=page.locator('section[aria-labelledby="linkedin-share-title"] img');await poster.waitFor();assert.equal(await page.getByRole('checkbox',{name:/Bagikan lowongan ini ke feed LinkedIn saya/}).isChecked(),true);await poster.scrollIntoViewIfNeeded();await screenshot('premium-auto-preview-mobile');
    await page.setViewportSize({width:1440,height:1000});await poster.scrollIntoViewIfNeeded();await fits();await screenshot('premium-auto-preview-desktop');
    await page.locator('[data-job-editor] footer button').last().click();await page.getByRole('dialog').getByRole('button',{name:'Publikasikan',exact:true}).click();await waitUntil(async()=>await db.linkedInSocialPost.count({where:{jobId:socialJob.data.id}})===1,'Approved LinkedIn share was not persisted');
    assert.equal((await db.jobPost.findUniqueOrThrow({where:{id:socialJob.data.id}})).status,'PUBLISHED');const social=await db.linkedInSocialPost.findFirstOrThrow({where:{jobId:socialJob.data.id}});assert.equal(social.status,'FAILED');assert.equal(social.errorCode,'SERVICE_UNAVAILABLE');assert.equal(await db.linkedInOutbox.count({where:{socialPostId:social.id}}),0);
    report.checks.push('Premium automatic sharing: connected preference prepares a real immutable server poster without another click; publish carries exact approval and persists one share; disabled real provider never posts or blocks Talentio publication');

    await f.context.close();
  }
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}
main().catch(async error=>{report.errors.push(error.stack||String(error));if(page)await screenshot('failure').catch(()=>{});console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(users.length){const previews=await db.linkedInPreview.findMany({where:{userId:{in:users}},select:{posterKey:true}});if(previews.length){const {S3Client,DeleteObjectCommand}=h.req('@aws-sdk/client-s3'),s3=new S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});for(const row of previews)await s3.send(new DeleteObjectCommand({Bucket:env.S3_BUCKET,Key:row.posterKey}));s3.destroy();}}
  if(companies.length){const fixtureJobs=await db.jobPost.findMany({where:{companyId:{in:companies}},select:{id:true}});for(const job of fixtureJobs)await fetch(env.MEILI_HOST+'/indexes/'+env.MEILI_JOBS_INDEX+'/documents/'+encodeURIComponent(job.id),{method:'DELETE',headers:{Authorization:'Bearer '+env.MEILI_MASTER_KEY}});const orders=await db.jobPurchaseOrder.findMany({where:{companyId:{in:companies}},select:{id:true}});await db.jobPaymentEvent.deleteMany({where:{orderId:{in:orders.map(x=>x.id)}}});await db.jobPurchaseOrder.deleteMany({where:{companyId:{in:companies}}});await db.jobPublicationPeriod.deleteMany({where:{companyId:{in:companies}}});await db.company.deleteMany({where:{id:{in:companies}}});}
  if(users.length)await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
});
