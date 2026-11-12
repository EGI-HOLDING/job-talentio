// Full compiled Nest graph, JWT guards, real local PostgreSQL/S3/SMTP. Paid AI is opt-in.
const {execFileSync,spawnSync}=require('node:child_process'),{createRequire}=require('node:module'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
function inspect(name){return JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true}))[0];}
function envOf(info){return Object.fromEntries(info.Config.Env.map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));}
if(!process.env.RECRUITMENT_HTTP_CHILD){
 const pg=inspect('jt-postgres'),pgEnv=envOf(pg),minio=inspect(process.env.RECRUITMENT_MINIO_CONTAINER||'jt-hr-flow-minio'),minioEnv=envOf(minio),mailpit=inspect('jt-mailpit');
 const dbName='talentio_http_it_'+Date.now(),user=pgEnv.POSTGRES_USER||'postgres',port=pg.NetworkSettings.Ports['5432/tcp'][0].HostPort;
 if(port!=='5434'||!/^talentio_http_it_\d+$/.test(dbName))throw Error('Disposable local database guard failed');
 const bucket=dbName.replaceAll('_','-'),s3='http://127.0.0.1:'+minio.NetworkSettings.Ports['9000/tcp'][0].HostPort;
 const env={...process.env,NODE_ENV:'test',RECRUITMENT_HTTP_CHILD:'1',DATABASE_URL:`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pgEnv.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${dbName}`,JWT_SECRET:'recruitment-http-synthetic-signing-key-only',OPENAI_API_KEY:'',TARA_SCREENING_ENABLED:'true',TARA_SCREENING_MARKET:'id',TELEGRAM_BOT_TOKEN:'',RESEND_API_KEY:'',SUPERADMIN_PASSWORD:'',MEILI_HOST:'',REDIS_URL:'',HR_RANKING_V2_MODE:'off',EMPLOYEE_INTENT_V3_MODE:'off',S3_ENDPOINT:s3,S3_PUBLIC_URL:s3+'/'+bucket,S3_BUCKET:bucket,S3_ACCESS_KEY:minioEnv.MINIO_ROOT_USER||'minioadmin',S3_SECRET_KEY:minioEnv.MINIO_ROOT_PASSWORD||'minioadmin',S3_REGION:'us-east-1',S3_FORCE_PATH_STYLE:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:mailpit.NetworkSettings.Ports['1025/tcp'][0].HostPort,SMTP_USER:'',SMTP_PASS:'',SMTP_SECURE:'false',WEB_URL:'http://127.0.0.1:3035',SMTP_FROM:'Talentio Tests <recruitment@synthetic.test>',RECRUITMENT_MAILPIT_URL:'http://127.0.0.1:'+mailpit.NetworkSettings.Ports['8025/tcp'][0].HostPort};
 if (process.argv.includes('--onboarding') || process.argv.includes('--onboarding-live-draft')) { env.HR_CREATION_V2_ENABLED = 'true'; env.HR_FLOW_MARKET = 'id'; }
 if (process.argv.includes('--taka-v2')) {
  env.CV_SCORING_V2_ENABLED='true'; env.CV_SCORING_V2_COMPANIES='http-co';
  env.OPENAI_CV_WEBHOOK_SECRET='whsec_'+Buffer.alloc(32,81).toString('base64');
 }
 if (['--live-draft', '--live-voice', '--live-text', '--live-cv-formats', '--onboarding-live-draft'].some(mode => process.argv.includes(mode))) {
  assert.equal(process.env.RELIABILITY_LIVE_AI, '1', 'Explicit live-provider opt-in required');
  const dotenv = createRequire(req.resolve('@nestjs/config'))('dotenv');
  env.OPENAI_API_KEY = dotenv.parse(require('node:fs').readFileSync(path.join(root, '.env'))).OPENAI_API_KEY;
  assert.ok(env.OPENAI_API_KEY, 'Local provider credential unavailable');
  env.JOB_CONTENT_AI_MODEL = 'gpt-6-luna';
  env.TARA_LIVE_MODEL = 'gpt-live-1';
  env.TARA_LIVE_REASONING_MODEL = 'gpt-6-luna';
 }
 let disposableRedis, retainProviderState = false;
 try{
  if (process.argv.includes('--load')) {
   const template = inspect('jt-redis');
   assert.ok(template.Image);
   const name = bucket + '-redis';
   assert.match(name, /^talentio-http-it-\d+-redis$/);
   const port = execFileSync(process.execPath, ['-e', "const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>{console.log(server.address().port);server.close()})"], { encoding: 'utf8', windowsHide: true }).trim();
   assert.match(port, /^\d+$/);
   execFileSync('docker', ['run', '--pull', 'never', '--name', name, '--publish', '127.0.0.1:' + port + ':6379', '-d', template.Image], { windowsHide: true, stdio: 'ignore' });
   disposableRedis = name;
   const mapped = inspect(name).NetworkSettings.Ports['6379/tcp'][0].HostPort;
   assert.equal(mapped, port);
   env.REDIS_URL = 'redis://127.0.0.1:' + mapped;
   env.RECRUITMENT_TEST_REDIS_NAME = name;
  }
  execFileSync('docker',['exec','jt-postgres','createdb','-U',user,dbName],{windowsHide:true});
  const migration=spawnSync(process.execPath,[req.resolve('prisma/build/index.js'),'migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{cwd:root,env,stdio:'pipe',encoding:'utf8',windowsHide:true});if(migration.status)throw Error('HTTP test migration failed: '+migration.stderr);
  const result=spawnSync(process.execPath,[__filename,...process.argv.slice(2)],{cwd:root,env,stdio:'inherit',windowsHide:true});retainProviderState = result.status === 42;process.exitCode=result.status??1;
 }finally{
  try{if(!retainProviderState)execFileSync('docker',['exec','jt-postgres','dropdb','-U',user,'--force','--if-exists',dbName],{windowsHide:true});}
  finally{if(disposableRedis)execFileSync('docker',['rm','-f',disposableRedis],{windowsHide:true,stdio:'ignore'});}
 }
}else{
 req('reflect-metadata');
 const {NestFactory}=req('@nestjs/core'),{ValidationPipe}=req('@nestjs/common'),{JwtService}=req('@nestjs/jwt');
 const {AppModule}=require(path.join(root,'apps/api/dist/app.module.js'));
 const {PrismaService}=require(path.join(root,'apps/api/dist/prisma/prisma.service.js'));
 const {ScreeningClient}=require(path.join(root,'apps/api/dist/ai-screening/screening.client.js'));
 const {ScreeningWorker}=require(path.join(root,'apps/api/dist/ai-screening/screening-worker.service.js'));
 const {InvitationsService}=require(path.join(root,'apps/api/dist/ai-screening/recruitment/invitations.service.js'));
 const {CV_RUBRIC}=require(path.join(root,'apps/api/dist/ai-screening/recruitment/cv-scoring.policy.js'));
 const {RATE_LIMIT_REDIS}=require(path.join(root,'apps/api/dist/rate-limit/search-rate-limit.guard.js'));
 let retainProviderState = false;
 async function main(){
  const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false,rawBody:true});let db;
  try{
   app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}));
   await app.listen(0,'127.0.0.1');db=app.get(PrismaService);
   const worker=app.get(ScreeningWorker);await worker.onModuleDestroy(); // deterministic work draining, no competing timers/queues
   const text='Mengembangkan API Node.js selama empat tahun.';let paidMockCalls=0;
   const candidateEmail = `${process.env.S3_BUCKET}@synthetic.test`;
   const takaV2 = process.argv.includes('--taka-v2');
   if(takaV2){
    const { CvProvider } = require(path.join(root,'apps/api/dist/ai-screening/recruitment/cv-provider.js'));
    const provider=app.get(CvProvider);
    Object.defineProperty(provider,'configured',{value:true});
    provider.create=async (attempt,_model,spec,file)=>{
     paidMockCalls++;
     const gradeOnly=!!spec.data.blocks;
     assert.equal(Boolean(file),!gradeOnly);
     const grades=Object.fromEntries(spec.data.rubric.map(({id})=>[id,{level:3,reason:'Tertulis di CV.',
      ...(gradeOnly?{blockIds:['p1-b1']}:{})}]));
     if(gradeOnly)assert.deepEqual(Object.keys(grades),['skills']);
     const value={grades,...(gradeOnly?{}:{source:{readable:true,fullName:'HTTP Candidate',email:candidateEmail,phone:null,
      headline:'Developer',summary:'Pengalaman API.',limitations:[],pages:[{page:1,status:'READ'}],blocks:[{page:1,text,supports:['experience','requirements']}]}})};
     return {status:200,body:{id:'resp_'+attempt,status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}};
    };
   }
   const allowedProviderWork = new Set();
   const voiceEvents = [];
   if (process.argv.includes('--live-voice')) {
    const { VoiceProvider } = require(path.join(root,'apps/api/dist/ai-screening/voice/voice.provider.js'));
    const provider = app.get(VoiceProvider), attach = provider.attach.bind(provider);
    provider.attach = (id, onEvent, onLost) => attach(id, event => {
     if (event.type === 'session.closed') voiceEvents.push({ reason: event.reason });
     onEvent(event);
    }, onLost);
   }
   const textUi = process.argv.includes('--text-ui');
   let scoreHook;
   const screeningClient = app.get(ScreeningClient), originalRun = screeningClient.run.bind(screeningClient);
   screeningClient.run=async(_w,_s,task,input,...options)=>{
     if (allowedProviderWork.has(_w)) return textUi ? require('./recruitment-screening-fixture.cjs')(task,input) : originalRun(_w,_s,task,input,...options);
     assert.equal(task,'cv-score');paidMockCalls++;if(scoreHook)await scoreHook(_s);return {readable:true,fullName:'HTTP Candidate',email:candidateEmail,phone:null,headline:'Developer',summary:'Pengalaman API.',cvText:text,criteria:input.job?CV_RUBRIC.map(c=>({criterionId:c.id,level:3,reason:'Tertulis di CV.',evidence:[text]})):[],limitations:[]};};
   const base=(await app.getUrl())+'/api',jwt=new JwtService(),token=id=>jwt.sign({sub:id,tv:0},{secret:process.env.JWT_SECRET,expiresIn:'1h'});
   async function call(route,bearer,body,method=body?'POST':'GET',status=body?201:200,timeoutMs=15000){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});const raw=await r.text();assert.equal(r.status,status,route+': '+raw.slice(0,500));return raw?JSON.parse(raw):null;}
   await call('/health');
   await db.user.createMany({data:[{id:'http-hr',fullName:'HTTP HR',role:'RECRUITER',email:'hr-http@synthetic.test',emailVerified:true},{id:'http-foreign',fullName:'Other HR',role:'RECRUITER'},{id:'http-employee',fullName:'HTTP Candidate',role:'EMPLOYEE',email:candidateEmail,emailVerified:true}]});
   async function candidateMail() {
     const inbox = await fetch(process.env.RECRUITMENT_MAILPIT_URL + '/api/v1/search?query=' + encodeURIComponent('to:' + candidateEmail));
     assert.ok(inbox.ok);
     return (await inbox.json()).messages;
   }
   async function findVerificationToken(existing = new Set()) {
     for (const message of await candidateMail()) {
       if (existing.has(message.ID)) continue;
       const response = await fetch(process.env.RECRUITMENT_MAILPIT_URL + '/api/v1/message/' + message.ID);
       assert.ok(response.ok);
       const mail = await response.json();
       const match = String(mail.HTML || mail.Text || '').match(/verify-email\?token=([a-zA-Z0-9_-]+)/);
       if (match) return match[1];
     }
     throw Error('Verification link did not reach the isolated Mailpit inbox');
   }
   const hr=token('http-hr'),employee=token('http-employee'),foreign=token('http-foreign');
   await db.company.create({data:{id:'http-co',name:'HTTP Company',slug:'http-company',members:{create:{userId:'http-hr',role:'OWNER'}}}});
   await db.jobPost.create({data:{id:'http-job',companyId:'http-co',title:'Backend Developer',description:'Mengembangkan API dan layanan backend dengan Node.js.',status:'PUBLISHED',workMode:'REMOTE'}});
   await call('/recruitment/candidates?companyId=http-co',null,null,'GET',401);
   await call('/recruitment/candidates?companyId=http-co',employee,null,'GET',403);
   await call('/recruitment/candidates?companyId=http-co',foreign,null,'GET',403);
   await call('/recruitment/imports',hr,{companyId:'http-co',files:[]},'POST',400);
   const makePdf = content => new Promise((resolve, reject) => {
     const doc = new (req('pdfkit'))();
     const chunks = [];
     doc.on('data', chunk => chunks.push(chunk));
     doc.on('end', () => resolve(Buffer.concat(chunks)));
     doc.on('error', reject);
     doc.text('HTTP Candidate').text(content).end();
   });
   const bytes = await makePdf(text);
   const batch=await call('/recruitment/imports',hr,{companyId:'http-co',jobId:'http-job',requestKey:'http-import-request',files:[{clientId:'1',filename:'CV.pdf',size:bytes.length,contentType:'application/pdf'}]});
   assert.equal((await fetch(batch.files[0].uploadUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:bytes})).status,200);
   const id=batch.files[0].id;await call('/recruitment/candidates/'+id+'/upload-complete',hr,{});
   let work=await db.aiScreeningWork.findFirstOrThrow({where:{subjectId:id,kind:'CV_SCORE'}});await worker.process(work.id);
   if(takaV2){
    assert.equal((await call('/recruitment/companies/http-co/cv-status?ids='+id,hr))[0].cvProgress.phase,'REPAIRING');
    await call('/recruitment/companies/http-co/cv-status?ids='+id,foreign,null,'GET',403);
    await call('/recruitment/cv-recovery',hr,null,'GET',403);
    await db.aiScreeningWork.update({where:{id:work.id},data:{availableAt:new Date(0)}});await worker.process(work.id);
    const {Webhook}=req('standardwebhooks'),timestamp=new Date(),webhookId='wh_taka_http_fixture';
    const body=JSON.stringify({type:'response.completed',data:{id:'resp_synthetic_http'}});
    const signature=new Webhook(process.env.OPENAI_CV_WEBHOOK_SECRET).sign(webhookId,timestamp,body);
    const send=async value=>(await fetch(base+'/recruitment/provider/openai',{method:'POST',body,headers:{'Content-Type':'application/json',
      'webhook-id':webhookId,'webhook-timestamp':String(Math.floor(+timestamp/1000)),'webhook-signature':value}})).status;
    assert.equal(await send('v1,invalid'),400);
    assert.deepEqual(await Promise.all([send(signature),send(signature)]),[204,204]);
    assert.equal(await db.aiScreeningWork.count({where:{kind:'CV_PROVIDER_EVENT'}}),1);
    console.log('Taka HTTP v2: evidence repair, status authorization, verified duplicate webhook and no paid calls.');
   }
   const list=await call('/recruitment/candidates?companyId=http-co&jobId=http-job',hr);assert.equal(list.items[0].cvScore,75);assert.equal(list.overallTotal,1);
   const detail=await call('/recruitment/candidates/'+id,hr);assert.equal(detail.cvResult.criteria.length,3);
   const signed=await call('/recruitment/candidates/'+id+'/cv',hr);assert.ok((await fetch(signed.url)).ok);assert.equal((await fetch(signed.url.split('?')[0])).status,403,'CV object is private');
   const profile=await db.employeeProfile.create({data:{userId:'http-employee',headline:'Developer'}}),candidate=await db.recruitmentCandidate.findUniqueOrThrow({where:{id}});
   const resume=await db.resume.create({data:{profileId:profile.id,title:'CV.pdf',fileKey:candidate.fileKey,isPrimary:true}});
   const application=await call('/applications/jobs/http-job',employee,{resumeId:resume.id});assert.ok(application.id);assert.equal(await db.aiScreeningSession.count(),0,'applying has no interview');
   const linked=await call('/recruitment/jobs/http-job/applications/'+application.id+'/candidate',hr);assert.equal(linked.applicationId,application.id);await call('/recruitment/jobs/http-job/applications/'+application.id+'/candidate',foreign,null,'GET',403);await call('/recruitment/jobs/wrong-job/applications/'+application.id+'/candidate',hr,null,'GET',404);
   const invite=await call('/recruitment/candidates/'+id+'/invitations',hr,{mode:'TEXT',requestKey:'http-invitation-request'});
   await call('/recruitment/invitations/'+invite.id+'/report',foreign,null,'GET',403);
   await app.get(InvitationsService).deliver(invite.id);const invitation=await db.screeningInvitation.findUniqueOrThrow({where:{id:invite.id}});assert.equal(invitation.emailStatus,'SENT');assert.equal(invitation.messageStatus,'SENT');
   const chat=await db.chatMessage.findUniqueOrThrow({where:{id:invitation.messageId}}),url=chat.body.match(/http:\/\/[^\s]+\/screening\/([^\s]+)/);assert.ok(url);const invitationToken=url[1];
   const publicInvite=await call('/recruitment/invitations/open/'+invitationToken);assert.ok(!('recipientEmail' in publicInvite));
   await db.user.update({where:{id:'http-employee'},data:{emailVerified:false}});
   await call('/recruitment/invitations/open/'+invitationToken+'/claim',employee,{},'POST',403);
   await call('/auth/request-verification',employee,{});
   const verificationToken = await findVerificationToken();
   const verified=await call('/auth/verify-email',null,{token:verificationToken});assert.equal(verified.user.emailVerified,true);
   const refreshed=await call('/auth/me',employee);assert.equal(refreshed.user.emailVerified,true,'original invitation tab token sees current server verification');
   await call('/auth/verify-email',null,{token:verificationToken},'POST',400);
   const claimed=await call('/recruitment/invitations/open/'+invitationToken+'/claim',employee,{});assert.ok(claimed.session.id);

   await call('/ai-screening/sessions/'+claimed.session.id+'/voice',hr,null,'GET',403);
   await call('/ai-screening/sessions/'+claimed.session.id+'/voice',employee,null,'GET',403);
   const message=await call('/recruitment/messages',hr,{companyId:'http-co',selection:{ids:[id]},requestKey:'http-message-request',subject:'Tahap rekrutmen',body:'Halo {{name}}, terima kasih.',channels:{email:true,talentio:true}});assert.equal(message.count,1);
   work=await db.aiScreeningWork.findFirstOrThrow({where:{kind:'CANDIDATE_DELIVERY'}});await worker.process(work.id);
   const delivery=await call('/recruitment/message-batches/'+message.id,hr);assert.equal(delivery.emailCounts.SENT,1);assert.equal(delivery.messageCounts.SENT,1);
   const schedule=await call('/recruitment/candidates/'+id+'/interviews',hr,{requestKey:'http-schedule-request',scheduledAt:new Date(Date.now()+86400000).toISOString(),durationMins:30,meetingUrl:'https://meeting.synthetic.test/session'});assert.ok(schedule.id);
   const schedules=await call('/recruitment/candidates/'+id+'/interviews',hr);assert.ok(schedules.some(s=>s.id===schedule.id));
   assert.ok((await candidateMail()).length >= 2, 'real SMTP invite and message reach local Mailpit');
   assert.equal(paidMockCalls,takaV2?2:1);assert.equal(await db.aiScreeningCall.count(),takaV2?2:0);
   if (process.argv.includes('--live-draft')) await require('./job-draft-live.cjs')({call,db,hr,foreign,app,root});
   if (process.argv.includes('--load')) await require('./recruitment-load-real.cjs')({db,call,makeToken:token,makePdf,worker,setScoreHook:hook=>{scoreHook=hook;}});
   const liveCvFormats = process.argv.includes('--live-cv-formats');
   if (liveCvFormats) await require('./recruitment-cv-formats-live.cjs')({db,worker,call,hr,makeToken:token,allowed:allowedProviderWork});
   const liveVoice = process.argv.includes('--live-voice');
   const liveText = process.argv.includes('--live-text');
   const onboardingDraft = process.argv.includes('--onboarding-live-draft');
   const onboarding = onboardingDraft || process.argv.includes('--onboarding');
   if (process.argv.includes('--browser') || liveVoice || liveText || textUi || onboarding) await require('./recruitment-real-browser.cjs')({
     base,call,db,employee,hr,foreign,worker,deliver: id => app.get(InvitationsService).deliver(id),candidateMail,findVerificationToken,liveVoice,liveText,textUi,voiceEvents,allowed: allowedProviderWork,onboarding,onboardingDraft,makeToken: token,makePdf,
   });
   console.log('Recruitment HTTP passed: full compiled Nest DI, JWT/role/tenant guards, actual private MinIO PUT/GET, CV-only native application, ranking/detail APIs, invitation/email/Talentio, real SMTP verification and stale-token refresh/verified claim, bulk delivery, imported schedule and real local Mailpit SMTP. ' + (liveVoice ? 'Bounded live voice probe.' : liveText ? 'Bounded live text probe.' : liveCvFormats ? 'Bounded real-provider CV formats probe.' : onboardingDraft ? 'Four real drafting calls through the HR browser.' : process.argv.includes('--live-draft') ? 'Bounded live drafting probe.' : 'No paid API calls.'));
  }finally{
   if (db && process.argv.some(option => option.startsWith('--live-'))) {
    const unresolved = await db.aiScreeningCall.count({where:{status:{in:['RUNNING','UNCERTAIN']}}});
    if (unresolved) {
     retainProviderState = true;
     const fs = require('node:fs');
     const dir = process.env.AI_RELIABILITY_OUTPUT || path.resolve('output/ai-reliability');
     fs.mkdirSync(dir,{recursive:true});
     fs.writeFileSync(path.join(dir,process.env.S3_BUCKET+'-retained-provider.json'),JSON.stringify({database:new URL(process.env.DATABASE_URL).pathname.slice(1),bucket:process.env.S3_BUCKET,unresolved},null,2));
     console.error('Unresolved synthetic provider state retained for recovery.');
    }
   }
   try{app.get(RATE_LIMIT_REDIS)?.disconnect();}catch{}
   await app.close();
   if (!retainProviderState) {
   const {S3Client,ListObjectsV2Command,DeleteObjectsCommand,DeleteBucketCommand}=req('@aws-sdk/client-s3');
   const bucket=process.env.S3_BUCKET;if(!/^talentio-http-it-\d+$/.test(bucket))throw Error('S3 cleanup guard');
   const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
   try{const list=await s3.send(new ListObjectsV2Command({Bucket:bucket}));if(list.Contents?.length)await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:list.Contents.map(o=>({Key:o.Key}))}}));await s3.send(new DeleteBucketCommand({Bucket:bucket}));}finally{s3.destroy();}
   }
  }
 }
 main().then(()=>process.exit(retainProviderState?42:0)).catch(e=>{console.error(e);process.exit(retainProviderState?42:1);});
}
