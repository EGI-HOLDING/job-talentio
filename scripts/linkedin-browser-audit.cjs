// Opt-in headless UI tests. Never attaches to a user browser or reuses its profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),api=createRequire(path.join(root,'apps/api/package.json'));
const runtime=process.env.CODEX_BROWSER_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(require.resolve('playwright',{paths:[root,runtime]}));
const executablePath=process.env.LINKEDIN_TEST_BROWSER || 'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const {startVisualHarness}=require('./linkedin-visual-audit.cjs');
const out=path.join(root,'output/linkedin-audit/browser');fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),method:'Isolated headless Chromium; actual React/CSS/dialogs; synthetic API in component cases',cases:[],screenshots:[],errors:[]};
async function main(){
  execFileSync(process.execPath,[path.join(path.dirname(api.resolve('tsx/package.json')),'dist/cli.mjs'),'--tsconfig',path.join(root,'apps/api/tsconfig.json'),path.join(root,'scripts/fixtures/linkedin-poster-fixture.ts')],{cwd:root,stdio:'pipe'});
  process.env.LINKEDIN_VISUAL_PORT='0';const server=await startVisualHarness(),base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  async function visit(scenario,width=390,locale='id',extra=''){
    await page.setViewportSize({width,height:900});await page.goto(base+'/case?scenario='+scenario+'&locale='+locale+extra);await page.locator('main h2, main h3').first().waitFor();
    await page.waitForFunction(()=>!!document.querySelector('[aria-busy="false"], [role="alert"]'));
  }
  async function geometry(name){
    const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('button,input,select,a[href]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]')).map(el=>({tag:el.tagName,text:(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,100),left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,height:el.getBoundingClientRect().height,type:el.getAttribute('type')}))}));
    assert.ok(value.scroll<=value.width+1,name+': horizontal overflow '+JSON.stringify(value));
    for(const control of value.controls){assert.ok(control.left>=-1&&control.right<=value.width+1,name+': control outside viewport '+JSON.stringify(control));if(control.tag==='BUTTON'||control.tag==='A')assert.ok(control.height>=43,name+': action target below 44px '+JSON.stringify(control));}
    report.cases.push({name,viewport:value.width,scrollWidth:value.scroll,controls:value.controls.length,status:'passed'});
  }
  async function shot(name){const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});report.screenshots.push(file);}
  try{
    for(const width of [320,390,768,1280,1440])for(const scenario of ['preview','settings','disabled','expired','unknown','failed','queued','publishing','published']){
      await visit(scenario,width);await geometry(scenario+' '+width);
      if(width===390&&['settings','unknown','disabled'].includes(scenario))await shot('mobile-'+scenario);
    }
    for(const locale of ['id','en','ru','uz'])for(const width of [320,1280]){
      await visit('settings',width,locale,'&long=1');await geometry('long settings '+locale+' '+width);
      await visit('preview',width,locale,'&long=1');await geometry('long preview '+locale+' '+width);
    }
    await visit('preview',1280,'id','&narrow=1');await geometry('narrow desktop container');await visit('settings',390,'ru','&long=1');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await geometry('settings 200% text size');
    await visit('preview',390);await page.getByRole('checkbox').check();await page.getByRole('img',{name:/Pratinjau poster/}).waitFor();await page.getByTestId('fixture-approval').getByText('Pratinjau disetujui untuk publikasi').waitFor();await geometry('automatically approved preview mobile');await shot('mobile-preview');
    await visit('preview',1280);await page.getByRole('button',{name:'Siapkan pratinjau posting'}).click();await page.getByRole('img',{name:/Pratinjau poster/}).waitFor();await geometry('approved preview desktop');await shot('desktop-preview');
    await visit('settings',390);await page.getByRole('checkbox').check();assert.equal(await page.getByRole('checkbox').isChecked(),true);await page.getByRole('button',{name:'Putuskan koneksi',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await geometry('disconnect dialog mobile');await shot('mobile-disconnect-dialog');
    const dialogButtons=dialog.getByRole('button');await dialogButtons.last().focus();await page.keyboard.press('Tab');assert.equal(await dialogButtons.first().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await dialogButtons.last().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.getByRole('button',{name:'Putuskan koneksi',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Putuskan koneksi',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Putuskan koneksi',exact:true}).click();await page.getByRole('button',{name:'Hubungkan LinkedIn',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').isChecked(),false);report.cases.push({name:'preference, disconnect confirmation, keyboard trap/Escape/restore and disconnect result',status:'passed'});
    await visit('unknown',390);assert.equal(await page.getByRole('button',{name:'Konfirmasi belum terbit'}).isEnabled(),false);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Konfirmasi belum terbit'}).click();await page.getByRole('dialog').waitFor();await geometry('UNKNOWN confirmation mobile');await page.getByRole('dialog').getByRole('button',{name:'Konfirmasi belum terbit'}).click();await page.getByRole('button',{name:'Tinjau dan coba bagikan lagi'}).waitFor();report.cases.push({name:'UNKNOWN explicit feed check and confirmed absent result',status:'passed'});
    await visit('prepare-failure',390);await page.getByRole('button',{name:'Siapkan pratinjau posting'}).click();await page.getByRole('alert').waitFor();await geometry('prepare failure mobile');await page.getByRole('button',{name:'Siapkan pratinjau posting'}).click();await page.getByRole('img',{name:/Pratinjau poster/}).waitFor();report.cases.push({name:'preview failure and recovery',status:'passed'});
    await visit('settings-error',390);await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await page.getByRole('button',{name:/Hubungkan ulang/}).waitFor();report.cases.push({name:'settings failure and retry',status:'passed'});
    assert.deepEqual(report.errors,[],'uncaught React/browser errors');
    console.log('PASS headless LinkedIn UI:',report.cases.length,'cases; screenshots:',report.screenshots.length);
  }catch(error){report.failure=error.message;await shot('failure');throw error;}
  finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
