// Actual Next.js UI + local API/DB using disposable HR fixtures in isolated browsers.
// Only the connected-state response is simulated for preview UX. Backend sharing stays OFF.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '../apps/api/node_modules/@prisma/client';
import {JwtService} from '../apps/api/node_modules/@nestjs/jwt';
import {ConfigService} from '../apps/api/node_modules/@nestjs/config';
import {resolveJwtSecret} from '../apps/api/src/common/jwt-secret';
import {StorageService} from '../apps/api/src/storage/storage.service';

async function main(){
  process.loadEnvFile('.env');
  if(!['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error('Local DB only');
  const runtime=process.env.CODEX_BROWSER_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
  const {chromium}=require(require.resolve('playwright',{paths:[runtime]}));
  const db=new PrismaClient(),jwt=new JwtService(),storage=new StorageService(new ConfigService());
  const users:string[]=[],companies:string[]=[],tag='li-browser-'+randomUUID(),out=path.resolve('output/linkedin-audit/browser');fs.mkdirSync(out,{recursive:true});
  const report:any={method:'Actual Next.js pages, real local API/DB, disposable HR fixtures, isolated browser contexts; connected UI response simulated; no provider posting',cases:[],errors:[]};
  const browser=await chromium.launch({headless:true,executablePath:process.env.LINKEDIN_TEST_BROWSER || 'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  const call=(route:string,bearer:string,body?:unknown)=>fetch('http://127.0.0.1:4000/api'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let currentPage:any;let jobId:string|undefined,tokenA:string|undefined;
  try{
    const a=await db.user.create({data:{role:'RECRUITER',locale:'id',fullName:'UI Test HR Andi',email:tag+'-a@example.invalid'}}),b=await db.user.create({data:{role:'RECRUITER',locale:'id',fullName:'UI Test HR Budi',email:tag+'-b@example.invalid'}});users.push(a.id,b.id);
    const ca=await db.company.create({data:{name:'UI Test Company A',slug:tag+'-a',locale:'id',members:{create:{userId:a.id,role:'OWNER'}}}}),cb=await db.company.create({data:{name:'UI Test Company B',slug:tag+'-b',locale:'id',members:{create:{userId:b.id,role:'OWNER'}}}});companies.push(ca.id,cb.id);
    const job=await db.jobPost.create({data:{companyId:ca.id,title:'Frontend Developer',description:'Mengembangkan antarmuka web dan pengalaman pengguna bersama tim produk.',status:'DRAFT',publishedAt:new Date(),workMode:'REMOTE',locale:'id',currency:'USD'}});jobId=job.id;
    // A prior publication timestamp prevents Telegram/new-job announcement side effects.
    for(const [user,company] of [[a,ca],[b,cb]] as const){
      const token=jwt.sign({sub:user.id,tv:0},{secret:resolveJwtSecret(),expiresIn:'15m'});if(user.id===a.id)tokenA=token;
      const serverStatus=await (await call('/integrations/linkedin',token)).json() as any;
      assert.equal(serverStatus.sharingEnabled,false,'real provider must remain disabled');
      const session={accessToken:token,user:{id:user.id,email:user.email,fullName:user.fullName,role:'RECRUITER',locale:'id',emailVerified:false,memberships:[{companyId:company.id,role:'OWNER'}]}};
      const context=await browser.newContext();let connectedView=false;
      await context.addInitScript((value:any)=>{if(location.origin==='http://localhost:3000'){localStorage.setItem('jt_token',value.accessToken);localStorage.setItem('jt_session',JSON.stringify(value));}},session);
      await context.route('**/*',(route:any)=>{
        const url=new URL(route.request().url());
        if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
        if(connectedView&&url.pathname==='/api/integrations/linkedin'&&route.request().method()==='GET')return route.fulfill({json:{...serverStatus,enabled:true,sharingEnabled:true,connected:true,status:'CONNECTED',displayName:user.fullName,expiresAt:new Date(Date.now()+86400000).toISOString(),autoShareEnabled:false}});
        return route.continue();
      });
      const page=await context.newPage();currentPage=page;page.on('pageerror',(error:any)=>report.errors.push(error.message));
      const geometry=async(name:string)=>{
        const widths=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(widths.scroll<=widths.viewport+1,name+': horizontal overflow '+JSON.stringify(widths));report.cases.push({name,...widths,status:'passed'});
      };
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:900});await page.goto('http://localhost:3000/id/settings#integrations');await page.getByRole('heading',{name:'Berbagi profil LinkedIn'}).waitFor();await page.getByRole('button',{name:'Hubungkan LinkedIn',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Hubungkan LinkedIn',exact:true}).isEnabled(),false);await geometry('Actual settings '+user.fullName+' '+width);
        if(user.id===a.id&&width===390)await page.screenshot({path:path.join(out,'live-mobile-settings.png'),fullPage:true,animations:'disabled'});
      }
      if(user.id===b.id){await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+job.id+'?section=details');await page.getByRole('button',{name:/Coba lagi/}).waitFor();assert.equal(await page.getByRole('heading',{name:'Frontend Developer',exact:true}).count(),0);report.cases.push({name:'HR B cannot render HR A job workspace',status:'passed'});await context.close();continue;}
      await db.linkedInConnection.create({data:{userId:a.id,status:'CONNECTED',subject:'synthetic-ui',authorUrn:'urn:li:person:synthetic-ui',displayName:a.fullName,tokenCiphertext:'synthetic-ui-not-a-real-token',tokenKeyVersion:'synthetic',tokenExpiresAt:new Date(Date.now()+86400000),generation:1}});connectedView=true;
      for(const width of [390,1440]){
        await page.setViewportSize({width,height:900});await page.goto('http://localhost:3000/id/dashboard/recruiter/jobs/'+job.id+'?section=details&company='+ca.id+'&review=1');await page.getByRole('button',{name:'Simpan dan siapkan pratinjau posting'}).waitFor();await geometry('Actual editor review '+width);
        await page.getByRole('checkbox',{name:/Bagikan lowongan ini ke feed LinkedIn saya/}).check();await page.getByRole('button',{name:'Publikasikan',exact:true}).click();const preflight=page.getByRole('alert').filter({hasText:/Siapkan dan tinjau poster/});await preflight.waitFor({timeout:5000});await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='alert');await page.waitForFunction(()=>{const alert=document.querySelector('[role="alert"]');if(!alert)return false;const rect=alert.getBoundingClientRect(),header=document.querySelector('[data-job-editor] header')?.getBoundingClientRect(),footer=document.querySelector('[data-job-editor] footer')?.getBoundingClientRect();return rect.top>=(header?.bottom||0)&&rect.bottom<=(footer?.top||innerHeight)});if(width===390)await page.screenshot({path:path.join(out,'live-mobile-preview-required.png'),animations:'disabled'});assert.equal((await db.jobPost.findUniqueOrThrow({where:{id:job.id}})).status,'DRAFT','checked alone must not publish');report.cases.push({name:'Publish preflight message is focused and visible above sticky controls '+width,status:'passed'});
        await page.getByRole('button',{name:'Simpan dan siapkan pratinjau posting'}).click();await page.getByRole('img',{name:/Pratinjau poster lowongan/}).waitFor();const sharePanel=page.locator('[aria-labelledby="linkedin-share-title"][aria-busy="false"]');await sharePanel.waitFor();await sharePanel.evaluate((element:any)=>element.lastElementChild?.scrollIntoView({block:'end',behavior:'instant'}));await page.waitForFunction(()=>{const panel=document.querySelector('[aria-labelledby="linkedin-share-title"]'),footer=document.querySelector('[data-job-editor] footer');if(!panel||!footer)return false;const tail=panel.lastElementChild?.getBoundingClientRect(),footerBox=footer.getBoundingClientRect();return !!tail&&tail.bottom<=footerBox.top});await geometry('Actual editor approved poster '+width);await page.screenshot({path:path.join(out,width===390?'live-mobile-editor.png':'live-desktop-editor.png'),fullPage:true,animations:'disabled'});report.cases.push({name:'Approved poster details scroll clear of sticky footer '+width,status:'passed'});
      }
      await page.getByRole('button',{name:'Publikasikan',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'Publikasikan',exact:true}).click();await page.locator('[data-job-workspace]').waitFor();assert.equal((await db.jobPost.findUniqueOrThrow({where:{id:job.id}})).status,'PUBLISHED');const post=await db.linkedInSocialPost.findFirstOrThrow({where:{jobId:job.id,userId:a.id}});assert.equal(post.status,'FAILED');assert.equal(post.errorCode,'SERVICE_UNAVAILABLE');report.cases.push({name:'Actual editor approval/publish returns seamlessly to workspace; portal published, real provider stays off',status:'passed'});
      await context.close();
    }
    const adminContext=await browser.newContext();await adminContext.addInitScript(()=>{if(location.origin==='http://localhost:3001'){localStorage.setItem('jt_admin_token','isolated-visual-test');localStorage.setItem('jt_admin_identity',JSON.stringify({email:'visual@example.invalid',fullName:'Visual audit'}));}});
    const adminMetrics={posts:[],connections:[],oldestQueuedAt:null,expiring:0,failures:[],daily:[],operations:{available:false,configurationValid:true,day:'2026-10-26',resetAt:'2026-10-27T00:00:00.000Z',endpoints:['imageInitialize','imageUpload','imageRead','posts'].map(endpoint=>({endpoint,appLimit:100,memberLimit:20,used:null,requests:null,success:null,httpErrors:null,transportErrors:null,rateLimited:null,averageMs:null,latency:null}))},enabled:false,sharingEnabled:false,apiVersion:'2025-02',generatedAt:'2026-10-26T12:00:00.000Z'};
    await adminContext.route('**/*',(route:any)=>{const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();if(url.pathname.startsWith('/api/')){const body=url.pathname==='/api/auth/me'?{user:{id:'isolated-admin',email:'visual@example.invalid',fullName:'Visual audit',role:'SUPER_ADMIN'}}:url.pathname==='/api/admin/linkedin/metrics'?adminMetrics:url.pathname.includes('/catalog/i18n/summary')?{}:{total:0,items:[]};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});}return route.continue();});
    const adminPage=await adminContext.newPage();currentPage=adminPage;adminPage.on('pageerror',(error:any)=>report.errors.push(error.message));
    for(const width of [320,390,768,1440]){await adminPage.setViewportSize({width,height:900});await adminPage.goto('http://localhost:3001/linkedin');await adminPage.getByRole('heading',{name:'LinkedIn operations'}).waitFor();const sizes=await adminPage.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.viewport+1,'Admin LinkedIn '+width+': horizontal page overflow '+JSON.stringify(sizes));if(width===320){const table=adminPage.locator('table').first(),wrap=table.locator('xpath=..');const overflow=await wrap.evaluate((element:any)=>element.scrollWidth>element.clientWidth);assert.equal(overflow,true,'the metrics table should scroll inside its own container on mobile');await adminPage.screenshot({path:path.join(out,'admin-mobile.png'),fullPage:true,animations:'disabled'});}if(width===1440)await adminPage.screenshot({path:path.join(out,'admin-desktop.png'),fullPage:true,animations:'disabled'});report.cases.push({name:'Actual admin LinkedIn dashboard '+width,...sizes,status:'passed'});}
    await adminContext.close();
    assert.deepEqual(report.errors,[]);console.log('PASS live LinkedIn browser UI:',report.cases.length,'cases');
  }catch(error){report.failure=error instanceof Error?error.message:String(error);if(currentPage&&!currentPage.isClosed()){report.visibleText=await currentPage.locator('body').innerText();report.alerts=await currentPage.getByRole('alert').allTextContents();report.invalid=await currentPage.locator('[aria-invalid="true"]').count();}if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(out,'live-failure.png'),fullPage:true,animations:'disabled'}).catch(()=>undefined);throw error;}
  finally{
    fs.writeFileSync(path.join(out,'live-report.json'),JSON.stringify(report,null,2));await browser.close();
    if(jobId&&tokenA)await call('/jobs/'+jobId+'/status',tokenA,{status:'CLOSED'}).catch(()=>undefined);
    const previews=await db.linkedInPreview.findMany({where:{userId:{in:users}},select:{posterKey:true}});for(const preview of previews)await storage.delete(preview.posterKey);
    await db.company.deleteMany({where:{id:{in:companies}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Live browser audit failed');process.exitCode=1;});
