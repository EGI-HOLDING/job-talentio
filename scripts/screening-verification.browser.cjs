// Browser regression for a stale invitation tab and an account switch during verification refresh.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const runtime=process.env.CODEX_RUNTIME_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=createRequire(path.join(runtime,'playwright/package.json'))('playwright');
const origin=process.env.RECRUITMENT_WEB_URL||'http://127.0.0.1:3035';assert.match(origin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const out=process.env.AI_RELIABILITY_OUTPUT||path.join(root,'output/ai-reliability');fs.mkdirSync(out,{recursive:true});
const auth={accessToken:'verification-fixture',user:{id:'verify-candidate',role:'EMPLOYEE',fullName:'Dinda Pramesti',email:'dinda@synthetic.test',emailVerified:false,employeeOnboarding:{status:'COMPLETED',step:3}}};
async function main(){
 const browser=await chromium.launch({headless:true});const report={checks:[],errors:[],verificationRequests:0,claims:0};
 async function harness(){
  const context=await browser.newContext({viewport:{width:1536,height:960}});let verified=false,fail=false,gate;
  await context.addInitScript(auth=>{if(!sessionStorage.getItem('verification-seeded')){localStorage.setItem('jt_token',auth.accessToken);localStorage.setItem('jt_session',JSON.stringify(auth));sessionStorage.setItem('verification-seeded','1');}},auth);
  await context.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname.replace(/^\/api/,''),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   let body=[];
   if(p==='/auth/me'){
    body={...auth,user:{...auth.user,emailVerified:verified}};
    if(gate){const current=gate;gate=null;current.captured();await current.wait;}
    if(fail)return route.fulfill({status:503,headers,json:{message:'Status akun belum tersedia. Coba kembali.'}});
   }else if(p==='/auth/request-verification'){report.verificationRequests++;body={ok:true};}
   else if(p==='/recruitment/invitations/open/verification-fixture')body={mode:'TEXT',jobTitle:'Backend Developer',companyName:'Studio Uji',expiresAt:'2027-01-01T00:00:00Z',status:'SENT'};
   else if(p.endsWith('/claim')){report.claims++;return route.fulfill({status:503,headers,json:{message:'Synthetic claim stop; verification is already checked.'}});}
   else if(p.includes('unread'))body={count:0};
   return route.fulfill({status:200,headers,json:body});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(origin+'/id/screening/verification-fixture',{waitUntil:'domcontentloaded',timeout:120000});
  await page.getByRole('heading',{name:'Verifikasi email sebelum mulai',exact:true}).waitFor();
  return {context,page,verify(){verified=true;},fail(value){fail=value;},hold(){let captured,release;const seen=new Promise(resolve=>captured=resolve),wait=new Promise(resolve=>release=resolve);gate={captured,wait};return {seen,release};}};
 }
 try{
  const first=await harness(),page=first.page;
  await page.getByRole('button',{name:'Kirim email verifikasi',exact:true}).click();await page.getByRole('status').filter({hasText:'Email verifikasi sudah diminta.'}).waitFor();assert.equal(report.verificationRequests,1);
  await page.getByRole('button',{name:'Saya sudah verifikasi · Cek status',exact:true}).click();await page.getByRole('status').filter({hasText:'Status verifikasi belum terlihat.'}).waitFor();
  first.fail(true);await page.getByRole('button',{name:'Saya sudah verifikasi · Cek status',exact:true}).click();await page.getByRole('alert').filter({hasText:'Status akun belum tersedia.'}).waitFor();
  first.fail(false);first.verify();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Buka interview',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Verifikasi email sebelum mulai',exact:true}).count(),0);
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Buka interview',exact:true}).waitFor();
  assert.equal(report.claims,0,'verification refresh cannot create a screening session');
  report.checks.push('Verification request, unverified status, temporary refresh error, focus refresh after external verification, persisted verified state');
  await first.context.close();

  const second=await harness(),hold=second.hold();second.verify();
  await second.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await hold.seen;
  await second.page.evaluate(auth=>{const other={...auth,user:{...auth.user,id:'other-candidate',email:'other@synthetic.test',emailVerified:false}};localStorage.setItem('jt_session',JSON.stringify(other));window.dispatchEvent(new Event('jt-session-updated'));},auth);
  hold.release();await second.page.waitForTimeout(350);
  assert.equal(await second.page.getByRole('button',{name:'Buka interview',exact:true}).count(),0,'old verified account response cannot verify a newly selected account');
  const stored=await second.page.evaluate(()=>JSON.parse(localStorage.getItem('jt_session')).user);assert.equal(stored.id,'other-candidate');assert.equal(stored.emailVerified,false);
  report.checks.push('Account switch rejects late verification status from previous account');await second.context.close();
  assert.deepEqual(report.errors,[]);report.result='PASSED';console.log('Screening verification browser passed: '+report.checks.join('; '));
 }catch(e){report.result='FAILED';report.failure=e.message;throw e;}
 finally{fs.writeFileSync(path.join(out,'screening-verification-browser.json'),JSON.stringify(report,null,2));await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
