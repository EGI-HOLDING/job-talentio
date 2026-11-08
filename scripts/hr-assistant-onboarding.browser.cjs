// Real browser checks of the local UI with an isolated in-memory API fixture.
// Does not connect to a database or publish/upload anything.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let pw;
try { pw = require('playwright'); }
catch { pw = require(path.join(process.env.USERPROFILE || 'C:/Users/egi_i', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const scenes = ['taka-intro','cv-sources','cv-ranking','tara-intro','chat-demo','voice-demo','cv-upload'];
const out = path.resolve('output/hr-assistant');
fs.mkdirSync(out, { recursive: true });
const base = process.env.HR_ASSISTANT_WEB_URL || 'http://127.0.0.1:3000';
const report = { checks: [], screenshots: [], errors: [], requests: [] };
const key = 'talentio:hr-assistant:hr-assistant-local:assistant-session';
const company = {id:'assistant-company',name:'Talentio Local',description:'Perusahaan lokal untuk pengujian onboarding.',profileSource:'MANUAL',size:'SIZE_11_50',industryGroups:[{code:'TECHNOLOGY'}],city:{slug:'jakarta',name:'Jakarta',province:{country:{id:'id',name:'Indonesia'}}}};
const auth = {accessToken:'local-only-ui-fixture',user:{id:'hr-assistant-local',fullName:'HR Lokal',role:'RECRUITER',email:'local@example.test',emailVerified:true,locale:'id',recruiterOnboarding:{status:'IN_PROGRESS',step:2}}};
const progress = {userId:auth.user.id,status:'IN_PROGRESS',step:2,flowVersion:2,phase:'JOB',revision:0,companyId:company.id,creationSessionId:'assistant-session',jobId:null,memberships:[{companyId:company.id,role:'OWNER',company}]};
const initialDraft = {title:'Backend Engineer',description:'Mengembangkan layanan backend dan integrasi perusahaan.',positionEntryMode:'MANUAL',jobTitleId:null,seniorityLevelCode:null,responsibilities:[],kpis:[],specificExpectations:'',countryId:null,citySlug:'',workMode:'REMOTE',employmentType:'FULL_TIME',salaryMin:null,salaryMax:null,currency:'IDR',salaryPeriod:'MONTHLY',skills:[],languages:[],benefits:[]};
const packageSettings = {durationDays:30,boostDays:0,featuredDays:0,reports:false,prioritySupport:false};

async function fixture(browser, options = {}) {
  const context = await browser.newContext({viewport:{width:1672,height:941},reducedMotion:options.motion ? 'no-preference' : 'reduce'});
  const currentAuth = structuredClone(auth), currentProgress = structuredClone(progress);
  let failSave = false;
  const session = {id:'assistant-session',companyId:company.id,company,phase:'JOB',revision:0,draft:structuredClone(initialDraft),jobId:null,order:{id:'assistant-order',code:'FREE',status:'PAID',amount:0,currency:'IDR'}};
  await context.addInitScript(({auth,key,scene}) => {
    if(!sessionStorage.getItem('assistant-fixture-initialized')) {
      localStorage.setItem('jt_token',auth.accessToken); localStorage.setItem('jt_session',JSON.stringify(auth));
      sessionStorage.setItem('assistant-fixture-initialized','1');
      if(scene)sessionStorage.setItem(key,scene);
    }
    window.__assistantMediaCalls=0;
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__assistantMediaCalls++;return Promise.reject(Error('Unexpected media request'));};
  }, {auth,key,scene:options.scene});
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), routePath = url.pathname.replace(/^\/api/,'');
    const method = request.method();
    const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
    if(method === 'OPTIONS')return route.fulfill({status:204,headers});
    report.requests.push({route:routePath,method});
    if(/\/publish$|\/recruiter-onboarding\/complete$|\/hr-flow\/(documents|logos)$/.test(routePath))throw Error('Forbidden side effect: '+routePath);
    let body = [];
    if(routePath === '/recruiter-onboarding')body=currentProgress;
    else if(routePath.startsWith('/hr-flow/sessions/')) {
      if(method==='PATCH') {
        if(failSave){failSave=false;return route.fulfill({status:503,headers,json:{message:'LOCAL_SAVE_FAILURE'}});}
        const input=request.postDataJSON(); Object.assign(session.draft,input.draft||{}); session.revision++;
      }
      body=session;
    }
    else if(routePath === '/job-commerce/catalog')body={hrFlowV2:true,paymentAvailable:false,testMode:false,packages:[{code:'FREE',amount:0,currency:'IDR',settings:packageSettings}]};
    else if(routePath === '/companies/mine')body=progress.memberships;
    else if(routePath === '/meta/industry-groups')body={groups:[{code:'TECHNOLOGY',name:'Technology',nameId:'Teknologi'}]};
    else if(routePath === '/meta/seniority-levels')body={levels:[]};
    else if(routePath === '/meta/countries')body=[{id:'id',name:'Indonesia',code:'ID',currencyCode:'IDR'}];
    else if(routePath === '/auth/me')body=currentAuth;
    else if(routePath === '/hr-support')body={items:[],total:0};
    else if(/unread/.test(routePath))body={count:0};
    return route.fulfill({status:200,headers,json:body});
  });
  const page = await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base+'/id/onboarding/recruiter', {waitUntil:'domcontentloaded',timeout:120000});
  return {context,page,session,failNextSave(){failSave=true;}, async switchUser(id) {
    currentAuth.user.id=id;currentProgress.userId=id;
    await page.evaluate(auth=>localStorage.setItem('jt_session',JSON.stringify(auth)),currentAuth);
  }, switchSession(id) {session.id=id;currentProgress.creationSessionId=id;}};
}

async function sceneReady(page, id) {
  await page.locator(`[data-hr-assistant][data-scene="${id}"]`).waitFor({timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-hr-assistant] img, [data-hr-assistant-header] img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('[data-hr-assistant] img, [data-hr-assistant-header] img')].map(i=>i.decode().catch(()=>{}))));
  await page.evaluate(()=>document.fonts.ready);
}
async function screenshot(page, name) {
  const filename=path.join(out,name+'.png'); await page.screenshot({path:filename}); report.screenshots.push(filename);
  if(page.viewportSize().width<=1000) {
    const content=page.locator('[data-scene-content]');
    const full=path.join(out,name+'-content.png');
    await content.screenshot({path:full});
  }
}
async function fits(page) {
  const bad=await page.locator('[data-hr-assistant] button, [data-hr-assistant-header] button').evaluateAll(buttons=>buttons.filter(el=>{
    const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right > innerWidth+1);
  }).map(el=>el.textContent));
  assert.deepEqual(bad,[],'navigation/control overflow');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow');
  const outside=await page.locator('[data-scene-content] h1, [data-scene-content] p, [data-scene-content] img').evaluateAll(elements=>elements.filter(el=>{
    const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left < -1);
  }).map(el=>el.textContent||el.getAttribute('alt')||el.getAttribute('src')));
  assert.deepEqual(outside,[],'scene content must stay within the viewport horizontally');
  const portals=page.locator('[data-hr-assistant][data-scene="cv-sources"] img[alt="glints"]');
  if(await portals.count()) {
    assert.equal(await page.locator('[data-hr-assistant] img[src*="/logo-"]').count(),6);
    const overlaps=await page.locator('[data-hr-assistant] img[src*="/logo-"]').evaluateAll(images=>{
      const boxes=images.map(i=>i.getBoundingClientRect());
      return boxes.some((a,i)=>boxes.some((b,j)=>i!==j&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
    });
    assert.equal(overlaps,false,'portal logos must have distinct positions');
  }
  if(page.viewportSize().width>1000){
    const clipped=await page.locator('[data-scene-content] p, [data-scene-content] h1').evaluateAll(elements=>elements.filter(el=>{
      const r=el.getBoundingClientRect(),stage=el.closest('[data-hr-assistant]').querySelector('[class*=stage]').getBoundingClientRect();
      return r.width>0&&(r.bottom>stage.bottom+1||r.right>innerWidth+1||r.left<0);
    }).map(el=>el.textContent));
    assert.deepEqual(clipped,[],'story text must not be clipped by the footer');
  }
}

(async()=>{
  let browser;
  try {
    browser=await pw.chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const f=await fixture(browser), {page}=f;
    await page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Publikasikan lowongan',exact:true}).count(),0);
    await page.locator('input[name=title]').fill('Backend Engineer Lokal');
    await page.getByRole('button',{name:'Lanjut',exact:true}).click();
    await sceneReady(page,scenes[0]);
    assert.equal(f.session.draft.title,'Backend Engineer Lokal');
    report.checks.push('Lanjut saves the validated job draft and opens the story without publication');
    for(let i=0;i<scenes.length;i++) {
      await sceneReady(page,scenes[i]); await fits(page); await screenshot(page,`${i+1}-${scenes[i]}-desktop`);
      assert.equal(await page.locator('[data-hr-assistant-nav]').count(),1);
      if(i<scenes.length-1)await page.getByRole('button',{name:'Lanjut',exact:true}).click();
    }
    assert.equal(await page.getByRole('button',{name:'Lanjut',exact:true}).count(),0);
    assert.equal(await page.locator('input[type=file]').count(),0);
    assert.equal(await page.locator('[data-hr-assistant]').getByText(/Terunggah|Mengunggah|Menunggu|CV_Nadia|Upload sedang/).count(),0);
    assert.equal(await page.getByRole('button',{name:'Pilih file',exact:true}).getAttribute('aria-disabled'),'true');
    await page.getByRole('button',{name:'Pilih file',exact:true}).evaluate(button=>button.click());
    assert.ok(await page.getByLabel('Area upload CV belum aktif').evaluate(el=>{
      const data=new DataTransfer();data.items.add(new File(['local fixture'],'cv.pdf',{type:'application/pdf'}));
      const event=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data});el.dispatchEvent(event);return event.defaultPrevented;
    }));
    assert.equal(await page.evaluate(()=>window.__assistantMediaCalls),0);
    await page.getByRole('button',{name:'Kembali',exact:true}).click(); await sceneReady(page,'voice-demo');
    await page.getByRole('button',{name:'Lanjut',exact:true}).click(); await sceneReady(page,'cv-upload');
    await page.reload(); await sceneReady(page,'cv-upload');
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),'cv-upload');
    report.checks.push('All seven scenes, forward/back, upload inert, no file input/status/media, reload resumes upload');
    await page.getByRole('button',{name:'Bantuan HR',exact:true}).click();
    await page.getByRole('dialog',{name:'Bantuan HR'}).waitFor();
    await page.getByRole('button',{name:'Tutup bantuan',exact:true}).click();
    assert.equal(await page.getByRole('dialog',{name:'Bantuan HR'}).count(),0);
    report.checks.push('HR help opens/closes in a modal without leaving the story');
    for(const width of [768,390]) {
      await page.setViewportSize({width,height:width===390?844:1024});
      for(let i=6;i>=0;i--) {
        await sceneReady(page,scenes[i]);await fits(page);await screenshot(page,`${i+1}-${scenes[i]}-${width}`);
        if(i>0)await page.getByRole('button',{name:'Kembali',exact:true}).click();
      }
      if(width===768){for(let i=0;i<6;i++){await page.getByRole('button',{name:'Lanjut',exact:true}).click();await sceneReady(page,scenes[i+1]);}}
    }
    report.checks.push('All seven scenes fit tablet 768 and mobile 390 widths');
    await page.evaluate(()=>sessionStorage.setItem('talentio:hr-assistant:hr-assistant-local:assistant-session','cv-upload'));
    await page.goto(base+'/id/dashboard/recruiter'); await page.waitForURL(/onboarding\/recruiter/, {timeout:60000});await sceneReady(page,'cv-upload');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jt_session')).user.recruiterOnboarding.status),'IN_PROGRESS');
    report.checks.push('Direct dashboard visit is gated back to the unfinished onboarding');
    await f.context.close();

    const failed=await fixture(browser);await failed.page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
    failed.failNextSave();await failed.page.locator('input[name=title]').fill('Backend Engineer Perubahan');
    await failed.page.getByRole('button',{name:'Lanjut',exact:true}).click();
    await failed.page.getByRole('alert').filter({hasText:'LOCAL_SAVE_FAILURE'}).waitFor();
    assert.equal(await failed.page.locator('[data-hr-assistant]').count(),0);
    await failed.page.getByRole('button',{name:'Lanjut',exact:true}).click();await sceneReady(failed.page,'taka-intro');
    await failed.switchUser('another-hr');
    await failed.page.reload();await failed.page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
    assert.equal(await failed.page.locator('[data-hr-assistant]').count(),0);
    report.checks.push('Failed save keeps the job form, retry works, and progress is isolated by user');
    await failed.page.getByRole('button',{name:'Lanjut',exact:true}).click();await sceneReady(failed.page,'taka-intro');
    failed.switchSession('another-creation-session');
    await failed.page.goto(base+'/id/onboarding/recruiter?creationSession=another-creation-session');
    await failed.page.getByRole('heading',{name:'Buat lowongan',exact:true}).waitFor();
    assert.equal(await failed.page.locator('[data-hr-assistant]').count(),0);
    report.checks.push('A different creation session starts with its own job form');
    await failed.context.close();

    const motion=await fixture(browser,{scene:'taka-intro',motion:true});await sceneReady(motion.page,'taka-intro');
    await motion.page.getByRole('button',{name:'Lanjut',exact:true}).evaluate(button=>{button.click();button.click();button.click();});
    await motion.page.waitForTimeout(450);await sceneReady(motion.page,'cv-sources');
    await motion.page.waitForTimeout(1300);assert.equal(await motion.page.locator('[data-hr-assistant]').getAttribute('data-scene'),'cv-sources');
    report.checks.push('Animated navigation locks repeated clicks and advances exactly one scene');
    await motion.context.close();
    assert.deepEqual(report.errors,[]);report.ok=true;
  } catch(error){report.ok=false;report.failure=error.stack;throw error;}
  finally {fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,checks:report.checks,errors:report.errors,failure:report.failure},null,2));await browser?.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
