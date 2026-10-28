const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{req,directory,assertDemoUrl}=require('./lib/hr-demo-env.cjs');
assertDemoUrl(process.env.DATABASE_URL);
const{PrismaClient}=req('@prisma/client');
const{S3Client,HeadObjectCommand}=req('@aws-sdk/client-s3');
const db=new PrismaClient(),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),credentials=JSON.parse(fs.readFileSync(path.join(directory,'credentials.json')));
const checks=[];
function pass(name){checks.push(name);console.log('PASS '+name);}
async function request(route,token,body,expected=200,key,method){
  const response=await fetch('http://localhost:4000/api'+route,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','Accept-Language':'en',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const content=await response.text();assert.equal(response.status,expected,route+' '+content.slice(0,200));
  return content&&response.headers.get('content-type')?.includes('json')?JSON.parse(content):content;
}
async function login(key){const data=await request('/auth/login',null,{email:credentials.accounts[key],password:credentials.password},201);assert.ok(data.accessToken);return data;}
async function main(){
  await db.$connect();
  const [hr,admin,employee,hr2,outsider]=await Promise.all(['hr','admin','employee','secondHr','outsider'].map(login));
  assert.equal(hr.user.role,'RECRUITER');assert.equal(admin.user.role,'SUPER_ADMIN');assert.equal(employee.user.role,'EMPLOYEE');
  const companies=await request('/companies/mine',hr.accessToken);assert.equal(companies.length,3);assert.deepEqual(new Set(companies.map(c=>c.company.name)),new Set(manifest.companies.map(c=>c.name)));
  pass('Normal password login works for HR, Admin, employee and second HR; presenter has all three companies');
  assert.equal(await db.company.count(),3);assert.equal(await db.jobPost.count(),17);assert.equal(await db.application.count(),310);assert.equal(await db.employeeProfile.count(),160);
  assert.equal(await db.subscription.count(),0);assert.equal(await db.payment.count(),0);assert.equal(await db.candidateCredit.count(),0);assert.equal(await db.candidateAccess.count(),0);
  pass('Dataset and absence of payment/subscription/CV-credit records');
  const hero=manifest.jobs[0],base='/applications/jobs/'+hero.id;
  const pages=[];
  for(let page=1;page<=8;page++){
    const result=await request(base+'/search?sort=match&limit=10&page='+page,hr.accessToken);
    assert.equal(result.total,80);assert.equal(result.items.length,10);pages.push(...result.items);
  }
  const expected=await db.application.findMany({where:{jobPostId:hero.id},select:{id:true}});
  assert.equal(new Set(pages.map(a=>a.id)).size,80);assert.deepEqual(new Set(pages.map(a=>a.id)),new Set(expected.map(a=>a.id)));
  const latest=await request(base+'/search?sort=newest&limit=10&page=1',hr.accessToken);
  assert.ok(latest.items.every((a,i)=>!i||Date.parse(latest.items[i-1].createdAt)>=Date.parse(a.createdAt)));
  const needle=pages.find(p=>p.profile.user.fullName).profile.user.fullName;
  const search=await request(base+'/search?q='+encodeURIComponent(needle)+'&limit=10&page=1',hr.accessToken);assert.ok(search.total>0);assert.ok(search.items.every(p=>p.profile.user.fullName.includes(needle)));
  const withdrawn=await request(base+'/search?status=WITHDRAWN&limit=10&page=1',hr.accessToken);assert.equal(withdrawn.total,2);assert.ok(withdrawn.items.every(p=>!p.canAddToKanban));
  pass('Applicants only, all eight ranking pages, no duplicates, newest/search/status filters');
  const board=await request(base+'/kanban?limit=20',hr.accessToken),newColumn=board.columns.find(c=>c.status==='NEW');
  assert.equal(newColumn.total,25);assert.equal(newColumn.items.length,20);assert.equal(newColumn.hasMore,true);
  const more=await request(base+'/kanban?status=NEW&limit=20&page=2',hr.accessToken);assert.equal(more.columns[0].items.length,5);
  assert.equal(new Set([...newColumn.items,...more.columns[0].items].map(a=>a.id)).size,25);
  assert.equal(board.columns.reduce((sum,c)=>sum+c.total,0),58);
  pass('Kanban membership separate from Applicants; per-column pagination beyond 24 applications');
  await request(base+'/search?limit=10&page=1',outsider.accessToken,undefined,403);
  await request(base+'/kanban',employee.accessToken,undefined,403);
  await request(base+'/search?limit=10&page=1',null,undefined,401);
  const foreign=await db.application.findFirst({where:{jobPostId:{not:hero.id}}});
  await request(base+'/applicants/'+foreign.id,hr.accessToken,undefined,404);
  pass('Unauthenticated, employee, non-member and wrong-job detail access rejected');
  const privateApp=await db.application.findFirst({where:{jobPostId:hero.id,profile:{visibility:'PRIVATE'}}});
  assert.ok(privateApp);assert.equal((await request(base+'/applicants/'+privateApp.id,hr.accessToken)).id,privateApp.id);
  pass('Private applicants remain available to the company receiving their application');
  const changed=await db.application.findUniqueOrThrow({where:{id:manifest.changedCvApplicationId},include:{resume:true}});
  assert.notEqual(changed.resumeSnapshot.resume.fileKey,changed.resume.fileKey);
  const download=await request('/applications/'+changed.id+'/resume-download',hr.accessToken),file=await fetch(download.url);
  assert.equal(file.status,200);const bytes=Buffer.from(await file.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  const submitted=manifest.files.find(f=>f.key===changed.resumeSnapshot.resume.fileKey);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),submitted.sha256);
  const noCv=pages.find(p=>!p.hasResumeFile);assert.ok(noCv);await request('/applications/'+noCv.id+'/resume-download',hr.accessToken,undefined,404);
  pass('Application CV is the exact original PDF after library replacement; absent CV is honest');
  const s3=new S3Client({region:process.env.S3_REGION,endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
  try{for(const f of manifest.files){const item=await s3.send(new HeadObjectCommand({Bucket:process.env.S3_BUCKET,Key:f.key}));assert.equal(item.ContentLength,f.bytes);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,'objects',f.key))).digest('hex'),f.sha256);}}finally{s3.destroy();}
  pass('Every PDF/logo exists in the isolated bucket and has a verified local backup');
  for(const company of manifest.companies){
    const job=manifest.jobs.find(j=>j.companyId===company.id&&!j.draft),benefit=await request('/benefits/jobs/'+job.id,hr.accessToken);
    assert.equal(benefit.code,company.package);
    const summary=await request('/hr-reports?companyId='+company.id,hr.accessToken);
    assert.equal(summary.totalApplications,company.package==='PREMIUM'?210:company.package==='STANDARD'?60:40);
    assert.equal(summary.capabilities.conversions,company.package!=='FREE');assert.equal(summary.capabilities.reports,company.package==='PREMIUM');
    const count=await db.jobEvent.count({where:{kind:'APPLICATION_SUBMITTED',session:{job:{companyId:company.id}}}});assert.equal(summary.events.APPLICATION_SUBMITTED,count);
    const eventCounts=await db.jobEvent.groupBy({by:['kind'],where:{session:{job:{companyId:company.id}}},_count:{_all:true}});
    for(const event of eventCounts)assert.equal(summary.events[event.kind],event._count._all,'Report must include every stored '+event.kind+' event');
    const csv=await request('/hr-reports/csv?companyId='+company.id,hr.accessToken,undefined,company.package==='PREMIUM'?200:403);if(company.package==='PREMIUM')assert.ok(csv.includes('Job ID')&&csv.includes('Operations Supervisor'));
    // Identical public candidate CV available with every tier, no unlock action.
    const candidate=await db.employeeProfile.findFirst({where:{databaseCvEnabled:true,visibility:{not:'PRIVATE'},databaseResume:{fileKey:{not:null}}}});
    const cv=await fetch('http://localhost:4000/api/profiles/candidates/'+candidate.id+'/database-cv?companyId='+company.id,{headers:{Authorization:'Bearer '+hr.accessToken}});assert.equal(cv.status,200);assert.equal(Buffer.from(await cv.arrayBuffer()).subarray(0,4).toString(),'%PDF');
    const tickets=await request('/hr-support?companyId='+company.id,hr.accessToken);assert.equal(tickets.items.length,1);assert.equal(tickets.items[0].priority,company.package==='PREMIUM');
  }
  pass('Free/Standard/Premium capabilities, reconciled reports/CSV, unrestricted commercial CV access and support priorities');
  const featured=await request('/benefits/featured',null);const featuredList=Array.isArray(featured)?featured:featured.items;assert.equal(featuredList.length,2);assert.equal(new Set(featuredList.map(c=>c.id)).size,2);
  const conversations=await request('/chat/conversations',hr.accessToken);assert.equal(conversations.length,6);const messages=await request('/chat/conversations/'+conversations[0].id+'/messages',hr.accessToken);assert.ok((Array.isArray(messages)?messages:messages.items).length>=2);
  pass('Featured companies unique, seeded chat conversations and messages readable');
  const live=await request('/jobs?limit=50&sort=newest',null);assert.equal(live.total,13);assert.ok(live.items.every(j=>!['DRAFT','PAUSED','CLOSED','EXPIRED'].includes(j.status)));
  pass('Only 13 currently published jobs appear in public search');
  if(process.argv.includes('--exercise')){
    const waiting=pages.find(p=>p.canAddToKanban),eventsBefore=await db.pipelineEvent.count({where:{applicationId:waiting.id}});
    await Promise.all([request('/applications/'+waiting.id+'/kanban',hr.accessToken,{},201),request('/applications/'+waiting.id+'/kanban',hr2.accessToken,{},201)]);
    assert.equal(await db.auditLog.count({where:{entityId:waiting.id,action:'APPLICATION_KANBAN_ADDED'}}),1);assert.equal(await db.pipelineEvent.count({where:{applicationId:waiting.id}}),eventsBefore);
    await request('/applications/'+waiting.id+'/status',hr.accessToken,{status:'IN_REVIEW'},201);
    const scheduled={scheduledAt:new Date(Date.now()+2*86400000).toISOString(),durationMins:30,location:'Demo meeting room',note:'Local rehearsal'};
    await request('/applications/'+waiting.id+'/interviews',hr.accessToken,scheduled,201,'demo-rehearsal-interview');await request('/applications/'+waiting.id+'/interviews',hr.accessToken,scheduled,201,'demo-rehearsal-interview');
    assert.equal(await db.interview.count({where:{applicationId:waiting.id}}),1);
    assert.equal((await request(base+'/applicants/'+waiting.id,hr.accessToken)).status,'INTERVIEW');
    const premiumBoost=manifest.jobs[0];await request('/benefits/jobs/'+premiumBoost.id+'/boost',hr.accessToken,{},201,'demo-rehearsal-boost');await request('/benefits/jobs/'+premiumBoost.id+'/boost',hr.accessToken,{},201,'demo-rehearsal-boost');assert.equal(await db.boostEpisode.count({where:{benefit:{jobId:premiumBoost.id}}}),1);
    const heroQuestion=await db.jobQuestion.findFirstOrThrow({where:{jobPostId:hero.id}});
    const applied=await request('/applications/jobs/'+hero.id,employee.accessToken,{coverLetter:'Live local demo rehearsal',answers:[{questionId:heroQuestion.id,answer:'Coordinated a regional operations team and improved inventory accuracy.'}]},201);
    assert.equal(applied.kanbanEnteredAt,null);assert.equal(applied.status,'NEW');await request('/applications/jobs/'+hero.id,employee.accessToken,{answers:[{questionId:heroQuestion.id,answer:'Repeated request'}]},409);
    const expired=manifest.jobs.find(j=>j.companyIndex===0&&j.index===9);await request('/applications/jobs/'+expired.id,employee.accessToken,{answers:[]},404);
    const newMessage=await request('/chat/conversations/'+conversations[0].id+'/messages',hr.accessToken,{body:'Local demo rehearsal: interview confirmed.'},201);assert.ok(newMessage.id);
    const draft=manifest.jobs.find(job=>job.draft),originalDraft=await request('/jobs/'+draft.id,hr.accessToken);
    await request('/jobs/'+draft.id,outsider.accessToken,{description:'An outsider must not be able to change this draft.'},403,undefined,'PATCH');
    await request('/jobs/'+draft.id,hr.accessToken,{description:originalDraft.description+'\n\nLocal rehearsal: applications reviewed weekly.',expectedUpdatedAt:originalDraft.updatedAt},200,undefined,'PATCH');
    const beforePublish=Date.now();await request('/jobs/'+draft.id+'/status',hr.accessToken,{status:'PUBLISHED'},201);
    const publication=await db.jobBenefit.findUniqueOrThrow({where:{jobId:draft.id}});assert.ok(publication.startsAt.getTime()>=beforePublish);assert.equal(publication.expiresAt-publication.startsAt,30*86400000);
    await request('/jobs/'+draft.id+'/status',hr.accessToken,{status:'PAUSED'},201);await request('/jobs/'+draft.id+'/status',hr.accessToken,{status:'PUBLISHED'},201);
    assert.equal((await db.jobBenefit.findUniqueOrThrow({where:{jobId:draft.id}})).expiresAt.toISOString(),publication.expiresAt.toISOString());
    assert.equal((await request('/jobs?limit=50&sort=newest',null)).total,14);
    const ticket=await request('/hr-support',hr.accessToken,{companyId:hero.companyId,jobId:hero.id,title:'Local rehearsal support request',body:'Please review our recruitment report for this fictional vacancy.'},201,'demo-rehearsal-ticket');assert.equal(ticket.priority,true);
    await request('/hr-support/'+ticket.id+'/assign-self',admin.accessToken,{},201);
    await request('/hr-support/'+ticket.id+'/replies',admin.accessToken,{body:'Local rehearsal: report reviewed.'},201,'demo-rehearsal-support-reply');
    const employeeResume=await db.resume.findFirstOrThrow({where:{profile:{userId:employee.user.id},deletedAt:null,fileKey:{not:null}}});
    await request('/profiles/me/resumes/'+employeeResume.id+'/parse',employee.accessToken,{},201);
    let parsed;for(let attempt=0;attempt<45;attempt++){parsed=await request('/profiles/me/resumes/'+employeeResume.id+'/parse-status',employee.accessToken);if(['READY','FAILED'].includes(parsed.parseStatus))break;await new Promise(resolve=>setTimeout(resolve,500));}
    assert.equal(parsed.parseStatus,'READY',parsed.parseError);assert.ok(parsed.parsedData);
    assert.equal(await db.candidateCredit.count(),0);assert.equal(await db.subscription.count(),0);assert.equal(await db.payment.count(),0);
    pass('Live rehearsal: concurrent Kanban admission, stage change, idempotent interview/boost, employee application, duplicate/expired rejection and chat');
    pass('Live rehearsal: draft edit/publication, 30-day period survives pause/reopen, Admin support reply and local CV parsing');
    console.log('Exercise changed only the demo database. Run node scripts/hr-demo.cjs restore before presenting.');
  }
  for(const url of ['http://localhost:3000/en/login?role=RECRUITER','http://localhost:3000/id/dashboard/recruiter?tab=jobs','http://localhost:3000/en/dashboard/recruiter/jobs/'+hero.id+'?company='+hero.companyId,'http://localhost:3001'])assert.equal((await fetch(url)).status,200);
  pass('Web and Admin routes return successful responses');
  fs.writeFileSync(path.join(directory,'verification'+(process.argv.includes('--exercise')?'-exercise':'')+'.json'),JSON.stringify({at:new Date().toISOString(),checks},null,2));
} 
main().then(()=>console.log('All '+checks.length+' demo verification groups passed.')).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
