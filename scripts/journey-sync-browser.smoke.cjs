// Isolated headless contexts. Only auxiliary shell/catalog routes are fixtures;
// chat, status, interviews, notifications and authentication use real HTTP/JWT/DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function run(input) {
  const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_BROWSER_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
  const browser=await chromium.launch({headless:true,executablePath:process.env.LINKEDIN_TEST_BROWSER||'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  const out=path.resolve('node_modules/.cache/journey-sync-browser');fs.mkdirSync(out,{recursive:true});
  const errors=[],report=[];
  async function waitFor(read,message) {for(let n=0;n<80;n++){if(await read())return;await new Promise(r=>setTimeout(r,100));}assert.ok(await read(),message);}
  try {
    for(const fixture of input.fixtures) {
      const {locale,job}=fixture;
      const contexts=[];
      async function context(account) {
        const value=await browser.newContext({viewport:{width:1440,height:1000},locale,serviceWorkers:'block'});contexts.push(value);
        const user={...account,locale,memberships:account.role==='RECRUITER'?[{companyId:input.company.id,role:account.id===input.owner.id?'OWNER':'RECRUITER'}]:[]};
        await value.addInitScript(session=>{localStorage.setItem('jt_session',JSON.stringify(session));localStorage.setItem('jt_token',session.accessToken);},{accessToken:input.tokens[account.id],user});
        await value.route(input.base+'/api/**',async route=>{
          const pathname=new URL(route.request().url()).pathname;
          const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:3089','Access-Control-Allow-Headers':'authorization,content-type,x-locale,idempotency-key','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};
          if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
          let data;
          if(pathname==='/api/profiles/me/onboarding'||pathname==='/api/recruiter-onboarding')data={status:'NOT_REQUIRED'};
          else if(pathname==='/api/companies/mine')data=account.role==='RECRUITER'?[{companyId:input.company.id,company:input.company}]:[];
          else if(pathname.startsWith('/api/meta/'))data=[];
          else if(pathname==='/api/jobs/'+job.id)data={...job,company:input.company,_count:{applications:1}};
          else if(pathname.startsWith('/api/profiles/candidates/'))data={id:'fixture-profile',user:input.employee,skills:[],headline:'Frontend developer'};
          else return route.continue();
          return route.fulfill({status:200,headers,json:data});
        });
        const page=await value.newPage();page.on('pageerror',error=>errors.push(error.message));return page;
      }
      try {
        const candidate=await context(input.employee),hr=await context(input.recruiter);
        await candidate.goto('http://127.0.0.1:3089/'+locale+'/dashboard/employee?tab=applications');
        const candidateRow=candidate.locator('tbody tr').filter({hasText:job.title});await candidateRow.waitFor();
        const preview=await candidate.context().newPage();preview.on('pageerror',error=>errors.push(error.message));
        await preview.goto('http://127.0.0.1:3089/'+locale+'/jobs/'+job.id);await preview.locator('span[class*=applied]').waitFor();
        await hr.goto('http://127.0.0.1:3089/'+locale+'/dashboard/recruiter/jobs/'+job.id+'?section=applicants&company='+input.company.id);
        await hr.getByRole('button',{name:input.employee.fullName,exact:true}).click();
        const dialog=hr.getByRole('dialog');await dialog.waitFor();
        const add=dialog.locator('button[class*=addKanban]');await add.click();
        const stage=dialog.locator('select').first();await stage.waitFor();
        for(const status of ['IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED']) {
          const expected = await stage.locator('option[value="'+status+'"]').innerText();
          await stage.selectOption(status);
          if(['HIRED','REJECTED'].includes(status)) {
            const confirm=hr.locator('.confirm-modal');await confirm.waitFor();await confirm.locator('button').last().click();
          }
          await candidate.bringToFront();
          await waitFor(async()=>{
            const text=await candidateRow.locator('td').nth(1).innerText();
            // Enum display is localized; compare against the HR's selected visible option.
            return text.trim()===expected.trim();
          },locale+': employee stage updates after '+status);
          await preview.bringToFront();
          await waitFor(async()=>(await preview.locator('span[class*=applied]').innerText()).includes(expected),locale+': job preview stage updates after '+status);
          if(status==='INTERVIEW') {
            assert.ok((await candidateRow.innerText()).includes(locale==='id'?'menunggu jadwal':locale==='en'?'awaiting schedule':locale==='ru'?'ожидается расписание':'vaqt belgilanmoqda'),locale+': distinguish interview stage from a scheduled interview');
            const form=dialog.locator('form');await form.locator('input[name=scheduledAt]').fill('2030-01-02T10:00');
            await form.locator('select[name=durationMins]').selectOption('45');await form.locator('input[name=meetingUrl]').fill('https://example.test/browser-'+locale);
            await form.locator('textarea[name=note]').fill('Browser interview '+locale);await form.locator('button').click();
            await candidateRow.getByRole('button').first().click();
            await candidate.getByRole('dialog').getByText('Browser interview '+locale,{exact:true}).waitFor();
            await candidate.getByRole('dialog').locator('a[href="https://example.test/browser-'+locale+'"]').waitFor();
            await candidate.keyboard.press('Escape');
          }
        }
        await hr.goto('http://127.0.0.1:3089/'+locale+'/messages?peer='+input.employee.id+'&job='+job.id+'&role=RECRUITER');
        const chatInput=hr.locator('#workspace-message');await chatInput.waitFor();await chatInput.fill('HR live '+locale);await chatInput.press('Enter');
        await hr.getByRole('log').getByText('HR live '+locale,{exact:true}).waitFor();
        await candidateRow.getByRole('button').first().click();
        const chatLink=candidate.getByRole('dialog').locator('a[href*="/messages?"]');await chatLink.click();
        await candidate.getByRole('log').getByText('HR live '+locale,{exact:true}).waitFor();
        await candidate.locator('#workspace-message').fill('Employee reply '+locale);await candidate.locator('#workspace-message').press('Enter');
        await hr.getByRole('log').getByText('Employee reply '+locale,{exact:true}).waitFor();
        // Disconnect transport temporarily; polling/focus must still catch up.
        await candidate.context().setOffline(true);
        await hr.locator('#workspace-message').fill('After reconnect '+locale);await hr.locator('#workspace-message').press('Enter');
        await hr.getByRole('log').getByText('After reconnect '+locale,{exact:true}).waitFor();
        await candidate.context().setOffline(false);await candidate.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await candidate.getByRole('log').getByText('After reconnect '+locale,{exact:true}).waitFor();
        await candidate.setViewportSize({width:390,height:844});
        const size=await candidate.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(size.width<=size.viewport+1,locale+': no mobile horizontal overflow');
        await candidate.screenshot({path:path.join(out,locale+'-employee-chat.png'),fullPage:true});
        await hr.request.post(input.base+'/api/applications/'+fixture.applicationId+'/status',{headers:{Authorization:'Bearer '+input.tokens[input.recruiter.id]},data:{status:'IN_REVIEW'}});
        await hr.goto('http://127.0.0.1:3089/'+locale+'/dashboard/recruiter/jobs/'+job.id+'?section=kanban&company='+input.company.id);
        await hr.getByRole('button',{name:input.employee.fullName,exact:true}).click();
        const hrStage=hr.getByRole('dialog').locator('select').first();await hrStage.waitFor();
        await candidate.setViewportSize({width:1440,height:1000});await candidate.goto('http://127.0.0.1:3089/'+locale+'/dashboard/employee?tab=applications');
        await candidateRow.getByRole('button').first().click();await candidate.getByRole('dialog').locator('button[class*=danger]').click();
        await candidate.locator('.confirm-modal').locator('button').last().click();
        await hr.bringToFront();await waitFor(async()=>(await hrStage.inputValue())==='WITHDRAWN',locale+': HR sees employee withdrawal without reload');assert.equal(await hrStage.isDisabled(),true);
        await hr.screenshot({path:path.join(out,locale+'-recruiter-withdrawal.png'),fullPage:true});
        report.push({locale,stages:5,jobPreview:true,interview:true,bidirectionalChat:true,reconnect:true,withdrawal:true,mobile:true});
      } catch (error) {
        errors.push(error.stack||error.message);
        for(const [index,value] of contexts.entries())for(const page of value.pages())await page.screenshot({path:path.join(out,locale+'-failure-'+index+'.png'),fullPage:true}).catch(()=>{});
        throw error;
      } finally {for(const value of contexts)await value.close();}
    }
    assert.deepEqual(errors,[],'Browser runtime errors');
    console.log('PASS isolated browser journey: '+JSON.stringify(report));
  } finally {fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({cases:report,errors},null,2));await browser.close();}
};
