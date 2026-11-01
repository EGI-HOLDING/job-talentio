// Real components in isolated headless browsers. All API traffic uses fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_BROWSER_NODE_MODULES||'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const req=createRequire(path.resolve('apps/api/package.json')),PDFDocument=req('pdfkit');
const origin=process.env.CV_TEST_WEB_ORIGIN||'http://127.0.0.1:3060';
const out=path.resolve('node_modules/.cache/cv-source-browser');fs.mkdirSync(out,{recursive:true});
const country={id:'country',name:'Indonesia',nameId:'Indonesia',iso2:'ID',phoneCode:'62',currencyCode:'IDR',slug:'indonesia'};
const cvTitle='CV Kandidat Platform Engineering dan Integrasi Enterprise dengan Nama Berkas Panjang.pdf';
const cvs=[{id:'cv-a',title:cvTitle,isPrimary:true,hasFile:true,format:'pdf',parseStatus:'READY',updatedAt:'2026-10-30T00:00:00Z'}, {id:'cv-b',title:'Backend Developer.pdf',isPrimary:false,hasFile:true,format:'pdf',parseStatus:'PENDING'}, {id:'cv-failed',title:'CV scanned.pdf',isPrimary:false,hasFile:true,format:'pdf',parseStatus:'FAILED'}];
const employee={id:'employee',fullName:'Kandidat Contoh',role:'EMPLOYEE',email:'fixture@example.test',locale:'id',memberships:[],employeeOnboarding:{status:'COMPLETED',step:5}};
const hr={id:'hr',fullName:'HR Contoh',role:'RECRUITER',locale:'id',memberships:[{companyId:'company',role:'OWNER'}],recruiterOnboarding:{status:'COMPLETE'}};
const job={id:'job',companyId:'company',title:'Frontend Developer',status:'PUBLISHED',publishedAt:'2026-10-30T00:00:00Z'};
const profile={id:'candidate',user:employee,phone:'+6281234567890',city:null,residenceCountry:country,residenceCountryId:'country',preferredCountries:[country],desiredPositions:['Frontend Developer'],desiredPosition:'Frontend Developer',desiredSalaryMin:null,desiredSalaryCurrency:'IDR',desiredSalaryPeriod:'MONTHLY',salaryNegotiable:true,visibility:'TO_REGISTERED_RECRUITERS',headline:'Frontend Developer',skills:[{id:'skill',level:'INTERMEDIATE',skill:{name:'React',slug:'react'}}],experiences:[],educations:[],languages:[{id:'lang',level:'B2',language:{code:'en',name:'English'}}],certifications:[{id:'cert',name:'Cloud Developer Certification',issuer:'Fixture Institute'}],resumes:cvs,cvSource:{status:'READY',versionId:'v-a'}};
const labels={id:{upload:'Unggah CV',view:'Lihat CV'},en:{upload:'Upload CV',view:'View CV'},ru:{upload:'Загрузить резюме',view:'Посмотреть резюме'},uz:{upload:'CV yuklash',view:'CVni ko‘rish'}};
async function pdf(){return new Promise(resolve=>{const doc=new PDFDocument(),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.fontSize(22).text('CV Candidate Fixture');doc.fontSize(12).text('Frontend Developer\nReact and accessible product interfaces.');doc.end();});}
async function main(){const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});const errors=[],checks=[],bytes=await pdf();
  async function context(role,locale,onboarding=false){const user={...(role==='hr'?hr:employee),locale,...(onboarding?{employeeOnboarding:{status:'IN_PROGRESS',step:5}}:{})};const session={accessToken:'fixture-only',user};const context=await browser.newContext({viewport:{width:1440,height:1000},locale,serviceWorkers:'block'});
    await context.addInitScript(({session,origin})=>{if(location.origin!==origin)return;localStorage.setItem('jt_session',JSON.stringify(session));localStorage.setItem('jt_token',session.accessToken);},{session,origin});
    const requests=[];let scenario='full';
    await context.route('**/socket.io/**',route=>route.abort());
    await context.route('http://cv.fixture/**',route=>route.fulfill({status:200,contentType:'application/pdf',body:bytes}));
    await context.route('**/api/**',async route=>{const url=new URL(route.request().url()),p=url.pathname.replace(/^\/api/,'');requests.push({path:p,method:route.request().method()});let data={};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'}});
      if(scenario==='error'&&p==='/profiles/me')return route.fulfill({status:503,json:{message:'Fixture temporary failure'},headers:{'Access-Control-Allow-Origin':'*'}});
      if(p==='/auth/me')data=session;
      else if(p==='/profiles/me')data=scenario==='empty'?{...profile,resumes:[],cvSource:{status:'NONE',versionId:null}}:profile;
      else if(p==='/profiles/me/onboarding')data={status:onboarding?'IN_PROGRESS':'COMPLETED',step:5,draft:{},profile:{...profile,user:employee,resumes:onboarding?[]:cvs}};
      else if(p==='/profiles/me/onboarding/complete'){data={status:'COMPLETED'};session.user.employeeOnboarding={status:'COMPLETED',step:5};}
      else if(p==='/profiles/me/resumes/upload')data={...cvs[0],id:'uploaded',parseStatus:'PENDING'};
      else if(p==='/profiles/me/database-cv-permission')data={databaseCvEnabled:true,databaseResumeId:'cv-a'};
      else if(p==='/companies/mine')data=role==='hr'?[{companyId:'company',role:'OWNER',company:{id:'company',name:'Fixture Company'}}]:[];
      else if(p==='/jobs/company/company')data=[job];
      else if(p==='/profiles/candidates/candidate')data={id:'candidate',user:employee,headline:'Frontend Developer',city:null,residenceCountry:country,skills:profile.skills,languages:profile.languages,certifications:profile.certifications,cvSource:{versionId:'submitted-a',status:'READY'},contactsBlurred:false,match:{assessable:true,total:87},applicationForJob:{id:'application',status:'IN_REVIEW',kanbanEnteredAt:'2026-10-30T00:00:00Z',canAddToKanban:false},cv:{title:cvTitle,format:'pdf',hasFile:true,application:true,downloadPath:'/applications/application/resume-download'}};
      else if(p==='/applications/application/resume-download')data={url:'http://cv.fixture/submitted.pdf'};
      else if(p.startsWith('/meta/'))data=p==='/meta/countries'?[country]:[];
      else if(p==='/recruiter-onboarding')data={status:'COMPLETE'};
      else if(p==='/jobs/recommended')data={items:[],total:0,totalPages:1,page:1,mode:'LATEST',rankingRevision:'fixture'};
      else if(p==='/jobs')data={items:[],total:0,totalPages:1,page:1,facets:{}};
      else if(p.includes('notifications')||p.includes('saved-jobs')||p==='/companies'||p==='/news')data=[];
      await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
    });const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return {page,context,requests,setScenario:value=>{scenario=value;}};
  }
  try{for(const locale of ['id','uz','en','ru']){
    const candidate=await context('employee',locale),recruiter=await context('hr',locale),onboarding=await context('employee',locale,true);
    try{for(const width of [390,768,1024,1440]){
      for(const entry of [candidate,recruiter,onboarding])await entry.page.setViewportSize({width,height:1000});
      await candidate.page.goto(origin+'/'+locale+'/dashboard/employee?tab=profile');await candidate.page.locator('[data-profile-section]').first().waitFor();
      assert.equal(await candidate.page.locator('#experience,#skills,#education').count(),0);assert.equal(await candidate.page.locator('#languages,#certifications').count(),2);
      await candidate.page.screenshot({path:path.join(out,locale+'-'+width+'-profile.png')});
      await candidate.page.goto(origin+'/'+locale+'/dashboard/employee?tab=profile&section=cvs');await candidate.page.getByText(cvTitle,{exact:true}).waitFor();
      assert.equal(await candidate.page.locator('a[href*="resume-builder"]').count(),0);await candidate.page.screenshot({path:path.join(out,locale+'-'+width+'-cvs.png')});
      await candidate.page.getByRole('button',{name:labels[locale].upload,exact:true}).click();const dialog=candidate.page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('input[type=file]').count(),1);assert.equal(await dialog.locator('input[name=jobTitle]').count(),0);await candidate.page.screenshot({path:path.join(out,locale+'-'+width+'-upload.png')});await candidate.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      await recruiter.page.goto(origin+'/'+locale+'/candidates/candidate?matchJobId=job&company=company&application=application');await recruiter.page.getByRole('heading',{name:employee.fullName,exact:true}).waitFor();
      await recruiter.page.locator('[class*=documentHeading] button').click();await recruiter.page.locator('iframe').waitFor();await recruiter.page.waitForTimeout(1000);assert.match(await recruiter.page.locator('iframe').getAttribute('src'),/submitted\.pdf/);await recruiter.page.screenshot({path:path.join(out,locale+'-'+width+'-hr.png')});
      await onboarding.page.goto(origin+'/'+locale+'/onboarding/employee');await onboarding.page.locator('input[type=file]').waitFor({state:'attached'});assert.equal(await onboarding.page.locator('input[name=companyName],input[name=startDate]').count(),0);await onboarding.page.screenshot({path:path.join(out,locale+'-'+width+'-onboarding.png')});
      for(const [name,entry] of [['candidate',candidate],['recruiter',recruiter],['onboarding',onboarding]])assert.equal(await entry.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,locale+' '+width+' '+name+' overflow');
      checks.push({locale,width,profile:true,cvs:true,upload:true,hr:true,onboarding:true});
    }
    candidate.setScenario('empty');await candidate.page.setViewportSize({width:390,height:1000});
    await candidate.page.goto(origin+'/'+locale+'/dashboard/employee?tab=profile&section=cvs');
    await candidate.page.getByRole('button',{name:labels[locale].upload,exact:true}).last().waitFor();
    assert.equal(await candidate.page.locator('[class*=cvRow]').count(),0);await candidate.page.screenshot({path:path.join(out,locale+'-390-empty.png')});
    candidate.setScenario('error');await candidate.page.reload();await candidate.page.getByRole('alert').waitFor();await candidate.page.screenshot({path:path.join(out,locale+'-390-error.png')});
    // A saved upload unlocks completion without a parser response or review form.
    const file=onboarding.page.locator('input[type=file]');await file.setInputFiles({name:'frontend.pdf',mimeType:'application/pdf',buffer:bytes});
    await onboarding.page.getByText('frontend.pdf',{exact:true}).waitFor();assert.equal(await onboarding.page.locator('footer button').last().isDisabled(),false);assert.ok(!onboarding.requests.some(r=>r.path.includes('parse-status')));
    }finally{await candidate.context.close();await recruiter.context.close();await onboarding.context.close();}
  }assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log('CV browser checks passed: '+checks.length+' viewport/language combinations, upload-only onboarding, CV library, optional profile fields, HR file viewer, keyboard close and no horizontal overflow.');}
  finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
