const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const h=require('./lib/hr-demo-env.cjs'),c=h.config({realAuth:true});h.assertDemoUrl(c.databaseUrl);
const {PrismaClient}=h.req('@prisma/client'),{JwtService}=h.req('@nestjs/jwt'),db=new PrismaClient({datasources:{db:{url:c.databaseUrl}}}),jwt=new JwtService();
const {chromium}=require(require.resolve('playwright',{paths:['C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const out=path.resolve('output/recommendation-cleanup'),report={checks:[],errors:[]};fs.mkdirSync(out,{recursive:true});let browser,page,userId,companyId;
async function main(){
  const response=await fetch('http://localhost:4000/api/job-commerce/catalog');assert.equal(response.status,200);const catalog=await response.json();
  assert.deepEqual(catalog.packages.map(p=>p.amount),[0,149000,299000]);assert.ok(catalog.packages.every(p=>!Object.hasOwn(p,'recommendations')));
  browser=await chromium.launch({headless:true,executablePath:'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  const labels={id:['Basic','Berbasis AI','AI lebih canggih','Segera hadir'],en:['Basic','AI-powered','Advanced AI','Coming soon'],ru:['Базовые','На базе ИИ','Продвинутый ИИ','Скоро'],uz:['Asosiy','AI asosida','Ilg‘or AI','Tez orada']};
  for(const width of [1440,390])for(const locale of Object.keys(labels)){
    const context=await browser.newContext({viewport:{width,height:width<700?844:1000}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    await page.goto('http://localhost:3000/'+locale+'/pricing');await page.locator('article[data-code=PREMIUM]').waitFor();
    for(const [i,code] of ['FREE','STANDARD','PREMIUM'].entries()){
      const card=await page.locator('article[data-code='+code+']').innerText();assert.ok(card.includes(labels[locale][i]));if(i)assert.ok(card.includes(labels[locale][3]));
      assert.doesNotMatch(card,/\b(?:10|30|100)\s+(?:kandidat|candidates|кандидатов|nomzod)\b/i);
    }
    await page.locator('details summary').click();const comparison=await page.locator('details table').innerText();for(const label of labels[locale])assert.ok(comparison.includes(label));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(out,'pricing-'+locale+'-'+width+'.png'),fullPage:true});
    report.checks.push(locale+' '+width+'px: planned AI labels on cards/comparison, no candidate quotas, no overflow');await context.close();
  }
  const tag='recommendation-cleanup-'+randomUUID(),user=await db.user.create({data:{role:'RECRUITER',fullName:'Cleanup verification HR',recruiterOnboarding:{create:{status:'NOT_REQUIRED'}}}});userId=user.id;
  const company=await db.company.create({data:{name:'Cleanup verification company',slug:tag,members:{create:{userId,role:'OWNER'}}}});companyId=company.id;
  const job=await db.jobPost.create({data:{companyId,title:'Cleanup navigation verification',description:'An isolated draft checks navigation cleanup without publishing a job.',workMode:'REMOTE'}});
  const token=jwt.sign({sub:userId,tv:user.tokenVersion},{secret:c.env.JWT_SECRET,expiresIn:'10m'}),context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(({token,user,companyId})=>{if(sessionStorage.getItem('cleanup-seeded'))return;sessionStorage.setItem('cleanup-seeded','1');localStorage.setItem('jt_token',token);localStorage.setItem('jt_session',JSON.stringify({accessToken:token,user:{id:user.id,fullName:user.fullName,role:'RECRUITER',memberships:[{companyId,role:'OWNER'}],recruiterOnboarding:{status:'NOT_REQUIRED',step:1}}}));},{token,user:{id:user.id,fullName:user.fullName},companyId});
  page=await context.newPage();let recommendationsCalls=0;page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/recommended-candidates'))recommendationsCalls++;});
  await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+job.id+'?section=recommendations');await page.locator('[data-job-workspace]').waitFor();
  const nav=page.locator('[data-job-workspace] nav');assert.equal(await nav.locator('a').count(),3);assert.equal(await nav.locator('a[href*="section=recommendations"]').count(),0);assert.equal(recommendationsCalls,0);
  await nav.screenshot({path:path.join(out,'workspace-navigation.png')});report.checks.push('Removed workspace tab stays absent; an old section URL falls back safely without calling recommendations');await context.close();
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report,null,2));
}
main().catch(async e=>{report.errors.push(e.stack||String(e));console.error(e);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(companyId)await db.company.deleteMany({where:{id:companyId}});if(userId)await db.user.deleteMany({where:{id:userId}});await db.$disconnect();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));});
