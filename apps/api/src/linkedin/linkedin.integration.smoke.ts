import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LinkedInClient,LinkedInFailure } from './linkedin-client';
import { LinkedInSettings } from './linkedin-settings';
import { LinkedInService } from './linkedin.service';
import { LinkedInWorkerService } from './linkedin-worker.service';
import { INITIAL_POLICIES } from '../benefits/benefit-policy';
import { sha256 } from './linkedin-security';
import { AuthUser } from '../common/auth.decorators';
import { JobsService } from '../jobs/jobs.service';

async function main() {
  const root=path.resolve(__dirname,'../../../..');process.loadEnvFile(path.join(root,'.env'));
  const dbUrl=new URL(process.env.DATABASE_URL!);
  if(!['localhost','127.0.0.1'].includes(dbUrl.hostname))throw new Error('This test requires the local database');
  const s3Url=new URL(process.env.S3_ENDPOINT!);
  if(!['localhost','127.0.0.1'].includes(s3Url.hostname) || s3Url.port!=='9100')throw new Error('This test requires the Talentio local MinIO on port 9100');
  const prisma=new PrismaClient(),db=prisma as PrismaService;
  const tag='linkedin-test-'+randomUUID(),users:string[]=[],companies:string[]=[],objects=new Set<string>();
  const configValues:Record<string,string>={LINKEDIN_ENABLED:'true',LINKEDIN_ACCESS_VERIFIED:'true',LINKEDIN_CLIENT_ID:tag,LINKEDIN_CLIENT_SECRET:'synthetic-secret',LINKEDIN_REDIRECT_URI:'https://api.example.com/api/integrations/linkedin/callback',WEB_URL:'https://jobs.example.com',LINKEDIN_TOKEN_KEYS:JSON.stringify({v1:randomBytes(32).toString('base64')}),REDIS_URL:process.env.REDIS_URL!,DATABASE_URL:process.env.DATABASE_URL!,LINKEDIN_ENDPOINT_LIMITS:JSON.stringify({fixtureQuota:{app:2,member:1}})};
  const testConfig={get:(key:string,fallback?:string)=>configValues[key]??fallback} as ConfigService;
  const settings=new LinkedInSettings(testConfig),storage=new StorageService(new ConfigService());
  const put=storage.putObject.bind(storage);storage.putObject=async(key,bytes,mime)=>{objects.add(key);return put(key,bytes,mime);};
  let publishCalls=0,exchangeCalls=0,mode:'success'|'unknown'|'rate'|'revoked'='success';
  let uploadGate:Promise<void>|undefined,uploadStarted:(()=>void)|undefined;
  const provider={exchange:async()=>{exchangeCalls++;return {accessToken:'synthetic-token',subject:'synthetic-member',authorUrn:'urn:li:person:synthetic-member',displayName:'Synthetic HR',avatarUrl:null,scopes:['openid','profile','w_member_social'],expiresAt:new Date(Date.now()+86400000)};},
    initializeImage:async()=>{if(mode==='revoked')throw new LinkedInFailure('RECONNECT_REQUIRED','Synthetic revoked token');if(mode==='rate')throw new LinkedInFailure('RATE_LIMITED','Synthetic rate limit',{retryable:true,retryAt:new Date(Date.now()+120000)});return {imageUrn:'urn:li:image:synthetic',uploadUrl:'https://www.linkedin.com/dms-uploads/synthetic',expiresAt:Date.now()+600000};},
    setQuota:()=>undefined,setTelemetry:()=>undefined,uploadImage:async()=>{uploadStarted?.();await uploadGate;},imageReady:async()=>'available',publish:async()=>{publishCalls++;if(mode==='unknown')throw new LinkedInFailure('PUBLISH_RESULT_UNKNOWN','Synthetic final timeout',{ambiguous:true});return 'urn:li:share:'+String(1000+publishCalls);}} as unknown as LinkedInClient;
  const service=new LinkedInService(db,settings,provider,storage),worker=new LinkedInWorkerService(db,settings,provider,service,storage,testConfig);
  let serial=0;
  try {
    const a=await prisma.user.create({data:{fullName:tag+' A',role:'RECRUITER'}}),b=await prisma.user.create({data:{fullName:tag+' B',role:'RECRUITER'}});users.push(a.id,b.id);
    const hrA={id:a.id,role:'RECRUITER',email:null,fullName:a.fullName,isBanned:false} as AuthUser,hrB={id:b.id,role:'RECRUITER',email:null,fullName:b.fullName,isBanned:false} as AuthUser;
    const ca=await prisma.company.create({data:{name:tag+' Company A',slug:tag+'-a',members:{create:{userId:a.id,role:'OWNER'}}}}),cb=await prisma.company.create({data:{name:tag+' Company B',slug:tag+'-b',members:{create:{userId:b.id,role:'OWNER'}}}});companies.push(ca.id,cb.id);
    const job=async(status:'PUBLISHED'|'DRAFT'='PUBLISHED')=>prisma.jobPost.create({data:{companyId:ca.id,title:'Synthetic '+randomUUID(),description:'Synthetic LinkedIn integration fixture '+(++serial)+' '+tag,workMode:'REMOTE',status,locale:'id',benefit:{create:{companyId:ca.id,code:'PREMIUM',highestCode:'PREMIUM',selectionConfirmedAt:new Date(),policySnapshot:INITIAL_POLICIES.PREMIUM,...(status==='PUBLISHED'?{startsAt:new Date(),expiresAt:new Date(Date.now()+30*86400000)}:{})}},...(status==='PUBLISHED'?{publishedAt:new Date()}:{})}});
    const freeJob=await job();await prisma.jobBenefit.update({where:{jobId:freeJob.id},data:{code:'FREE'}});
    await assert.rejects(()=>service.preview(hrA,freeJob.id,'id'),/PREMIUM_REQUIRED/);
    await prisma.jobBenefit.update({where:{jobId:freeJob.id},data:{code:'STANDARD'}});
    await assert.rejects(()=>service.preview(hrA,freeJob.id,'id'),/PREMIUM_REQUIRED/);
    await prisma.jobBenefit.update({where:{jobId:freeJob.id},data:{code:'PREMIUM',expiresAt:new Date(Date.now()-1000)}});
    await assert.rejects(()=>service.preview(hrA,freeJob.id,'id'),/PREMIUM_REQUIRED/);
    const first=await job();
    const start=await service.startConnection(hrA,'/id/settings#integrations'),state=new URL(start.authorizationUrl).searchParams.get('state')!;
    const wrongCookie=(await service.startConnection(hrB,'/id/settings#integrations')).cookie;
    assert.equal(new URL(await service.callback({state,code:'synthetic'},wrongCookie)).searchParams.get('linkedin'),'failed');assert.equal(exchangeCalls,0);
    assert.equal(new URL(await service.callback({state,code:'synthetic'},start.cookie)).searchParams.get('linkedin'),'connected');assert.equal(exchangeCalls,1);
    await service.callback({state,code:'replay'},start.cookie);assert.equal(exchangeCalls,1,'OAuth state must be single use');
    const denied=await service.startConnection(hrB,'/id/settings#integrations');
    assert.equal(new URL(await service.callback({state:new URL(denied.authorizationUrl).searchParams.get('state')!,error:'user_cancelled_authorize'},denied.cookie)).searchParams.get('linkedin'),'denied');
    assert.equal(await prisma.linkedInConnection.count({where:{userId:b.id}}),0);
    const conn=await prisma.linkedInConnection.findUniqueOrThrow({where:{userId:a.id}});
    assert.ok(conn.tokenCiphertext && !conn.tokenCiphertext.includes('synthetic-token'));
    const status=await service.status(hrA);assert.equal(status.connected,true);assert.ok(!JSON.stringify(status).includes('tokenCiphertext'));
    await assert.rejects(()=>service.preview(hrB,first.id,'id'));
    const oldPreview=await service.preview(hrA,first.id,'id');
    const stored=await prisma.linkedInPreview.findUniqueOrThrow({where:{id:oldPreview.id}});
    assert.equal(sha256(await storage.getObjectBuffer(stored.posterKey)),stored.posterSha256,'approved poster must be retrievable from real object storage');
    assert.equal((await fetch(storage.publicUrlForKey(stored.posterKey))).status,403,'unapproved previews must not be downloadable anonymously from S3');
    fs.mkdirSync(path.join(root,'output','linkedin-audit'),{recursive:true});fs.writeFileSync(path.join(root,'output','linkedin-audit','poster-id.png'),Buffer.from(oldPreview.posterDataUrl.split(',')[1],'base64'));
    await prisma.jobPost.update({where:{id:first.id},data:{title:first.title+' changed'}});
    await assert.rejects(()=>service.requestShare(hrA,first.id,oldPreview.id));assert.equal(await prisma.linkedInSocialPost.count({where:{jobId:first.id}}),0);
    const approved=await service.preview(hrA,first.id,'id');
    const requested=await Promise.all([service.requestShare(hrA,first.id,approved.id),service.requestShare(hrA,first.id,approved.id)]);
    assert.equal(requested[0].id,requested[1].id);assert.equal(await prisma.linkedInOutbox.count({where:{socialPostId:requested[0].id}}),1);
    await assert.rejects(()=>service.list(hrB,first.id));await assert.rejects(()=>service.poster(hrB,requested[0].id));
    await worker.process(requested[0].id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:requested[0].id}})).status,'PUBLISHED');
    const calls=publishCalls;await worker.process(requested[0].id);assert.equal(publishCalls,calls,'a completed delivery must not post twice');
    const makePost=async()=>{const row=await job();const preview=await service.preview(hrA,row.id,'id');return {job:row,post:await service.requestShare(hrA,row.id,preview.id)};};
    const unavailablePoster=await makePost(),readPoster=storage.getObjectBuffer.bind(storage),beforeStorageFault=publishCalls;
    storage.getObjectBuffer=async()=>{throw Error('Injected object storage outage');};
    await worker.process(unavailablePoster.post.id);storage.getObjectBuffer=readPoster;
    const storageRetry=await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:unavailablePoster.post.id}});
    assert.equal(storageRetry.status,'PENDING');assert.equal(storageRetry.retrySafe,true);assert.equal(publishCalls,beforeStorageFault);
    await prisma.linkedInSocialPost.update({where:{id:storageRetry.id},data:{nextAttemptAt:new Date(Date.now()-1)}});
    await worker.process(storageRetry.id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:storageRetry.id}})).status,'PUBLISHED');
    const corruptPoster=await makePost(),beforeCorruption=publishCalls;
    storage.getObjectBuffer=async()=>Buffer.from('An altered stored poster');await worker.process(corruptPoster.post.id);storage.getObjectBuffer=readPoster;
    assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:corruptPoster.post.id}})).errorCode,'POSTER_INVALID');assert.equal(publishCalls,beforeCorruption);
    mode='unknown';const uncertain=await makePost();await worker.process(uncertain.post.id);
    let unknown=await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:uncertain.post.id}});assert.equal(unknown.status,'UNKNOWN');assert.equal(unknown.retrySafe,false);
    const unknownCalls=publishCalls;await worker.process(unknown.id);assert.equal(publishCalls,unknownCalls);
    const uncertainPreview=await service.preview(hrA,uncertain.job.id,'id');await assert.rejects(()=>service.retry(hrA,unknown.id,uncertainPreview.id));
    await assert.rejects(()=>service.reconcile(hrA,unknown.id,'NOT_PUBLISHED'),'must wait for the in-flight review deadline');await assert.rejects(()=>service.reconcile(hrB,unknown.id,'NOT_PUBLISHED'));
    await prisma.linkedInSocialPost.update({where:{id:unknown.id},data:{leaseUntil:new Date(Date.now()-1000)}});
    await service.reconcile(hrA,unknown.id,'NOT_PUBLISHED');await service.retry(hrA,unknown.id,uncertainPreview.id);mode='success';await worker.process(unknown.id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:unknown.id}})).status,'PUBLISHED');
    mode='rate';const limited=await makePost();await worker.process(limited.post.id);const pending=await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:limited.post.id}});assert.equal(pending.status,'PENDING');assert.ok(pending.nextAttemptAt.getTime()>Date.now()+110000);
    const rateCalls=publishCalls;await worker.process(pending.id);assert.equal(publishCalls,rateCalls);mode='success';await prisma.linkedInSocialPost.update({where:{id:pending.id},data:{nextAttemptAt:new Date(Date.now()-1)}});await worker.process(pending.id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:pending.id}})).status,'PUBLISHED');
    const revoked=await makePost();await prisma.companyMember.delete({where:{companyId_userId:{companyId:ca.id,userId:a.id}}});const revokedCalls=publishCalls;await worker.process(revoked.post.id);assert.equal(publishCalls,revokedCalls);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:revoked.post.id}})).status,'CANCELLED');await prisma.companyMember.create({data:{companyId:ca.id,userId:a.id,role:'OWNER'}});
    const crash=await makePost();await prisma.linkedInSocialPost.update({where:{id:crash.post.id},data:{status:'PUBLISHING',attemptId:'synthetic-crash',leaseUntil:new Date(Date.now()-1000)}});await worker.recover();assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:crash.post.id}})).status,'UNKNOWN');
    const disconnected=await makePost();await service.disconnect(hrA);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:disconnected.post.id}})).status,'CANCELLED');const cleared=await prisma.linkedInConnection.findUniqueOrThrow({where:{userId:a.id}});assert.equal(cleared.tokenCiphertext,null);assert.equal(cleared.autoShareEnabled,false);
    const reconnect=await service.startConnection(hrA,'/id/settings#integrations');await service.callback({state:new URL(reconnect.authorizationUrl).searchParams.get('state')!,code:'synthetic'},reconnect.cookie);
    // Independently verify the real preview rate window, then advance only this
    // disposable actor's fixture timestamps so subsequent scenarios stay independent.
    await prisma.linkedInPreview.updateMany({where:{userId:a.id},data:{createdAt:new Date()}});
    await assert.rejects(()=>service.preview(hrA,first.id,'id'),error=>(error as {status?:number}).status===429);
    await prisma.linkedInPreview.updateMany({where:{userId:a.id},data:{createdAt:new Date(Date.now()-61000)}});
    const draft=await job('DRAFT'),draftPreview=await service.preview(hrA,draft.id,'id');
    const companyGuard={assertMember:async()=>undefined,assertOpen:()=>undefined};
    const jobs=new JobsService(db,companyGuard as never,{} as never,{create:async()=>undefined} as never,{syncJob:async()=>undefined} as never,{announceJob:async()=>undefined} as never,{} as never,{publish:async()=>undefined} as never,{} as never,service);
    await Promise.all([jobs.changeStatus(hrA,draft.id,'PUBLISHED',undefined,draftPreview.id),jobs.changeStatus(hrA,draft.id,'PUBLISHED',undefined,draftPreview.id)]);
    assert.equal(await prisma.linkedInSocialPost.count({where:{jobId:draft.id}}),1,'publication and approved outbox must be idempotent together');assert.equal((await prisma.jobPost.findUniqueOrThrow({where:{id:draft.id}})).status,'PUBLISHED');
    const rollback=await job('DRAFT'),rollbackPreview=await service.preview(hrA,rollback.id,'id');await prisma.jobPost.update({where:{id:rollback.id},data:{title:rollback.title+' stale'}});await assert.rejects(()=>jobs.changeStatus(hrA,rollback.id,'PUBLISHED',undefined,rollbackPreview.id));assert.equal((await prisma.jobPost.findUniqueOrThrow({where:{id:rollback.id}})).status,'DRAFT');assert.equal(await prisma.linkedInSocialPost.count({where:{jobId:rollback.id}}),0,'invalid approval must roll back portal publication and outbox');
    // The same LinkedIn member can be connected through multiple Talentio accounts.
    // Serialize member delivery across those connections, not only per user.
    await prisma.companyMember.create({data:{companyId:ca.id,userId:b.id,role:'RECRUITER'}});
    const connectB=await service.startConnection(hrB,'/id/settings#integrations');await service.callback({state:new URL(connectB.authorizationUrl).searchParams.get('state')!,code:'synthetic'},connectB.cookie);
    const forB=async()=>{const row=await job(),preview=await service.preview(hrB,row.id,'id');return {job:row,post:await service.requestShare(hrB,row.id,preview.id)};};
    const duplicatePreview=await service.preview(hrB,first.id,'id');await assert.rejects(()=>service.requestShare(hrB,first.id,duplicatePreview.id),'a second Talentio account must not duplicate the same member/job share');
    const parallel=await forB(),draftPost=await prisma.linkedInSocialPost.findFirstOrThrow({where:{jobId:draft.id}});
    let release!:()=>void;uploadGate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{uploadStarted=resolve;});
    const inFlight=worker.process(draftPost.id);await started;
    await worker.process(parallel.post.id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:parallel.post.id}})).status,'PENDING','another connection for the same member must wait');
    release();await inFlight;uploadGate=undefined;uploadStarted=undefined;await worker.process(parallel.post.id);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:parallel.post.id}})).status,'PUBLISHED');
    // A delivery outage cannot consume the durable DB event. Re-delivery is safe.
    const outage=await forB(),internals=worker as unknown as {queue:unknown;redis:unknown};let deliveries=0;
    internals.redis={status:'ready'};internals.queue={getJob:async()=>null,add:async()=>{throw new Error('Synthetic Redis loss');}};
    await worker.dispatch();assert.equal((await prisma.linkedInOutbox.findUniqueOrThrow({where:{socialPostId:outage.post.id}})).processedAt,null);
    internals.queue={getJob:async()=>null,add:async()=>{deliveries++;}};await worker.dispatch();assert.ok(deliveries>0);assert.equal((await prisma.linkedInOutbox.findUniqueOrThrow({where:{socialPostId:outage.post.id}})).processedAt,null,'queue delivery is not an acknowledgment');
    internals.queue=undefined;internals.redis=undefined;await worker.process(outage.post.id);assert.ok((await prisma.linkedInOutbox.findUniqueOrThrow({where:{socialPostId:outage.post.id}})).processedAt);
    mode='unknown';const manual=await forB();await worker.process(manual.post.id);await prisma.linkedInSocialPost.update({where:{id:manual.post.id},data:{leaseUntil:new Date(Date.now()-1)}});await service.reconcile(hrB,manual.post.id,'PUBLISHED');assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:manual.post.id}})).status,'PUBLISHED','feed verification does not require restricted read access or a guessed URN');
    mode='revoked';const authFailure=await forB(),waiting=await forB(),before401=publishCalls;await worker.process(authFailure.post.id);assert.equal(publishCalls,before401);assert.equal((await prisma.linkedInConnection.findUniqueOrThrow({where:{userId:b.id}})).status,'REVOKED');assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:waiting.post.id}})).status,'FAILED');
    // Exercise real BullMQ startup, dispatch, claim/ack and distributed Redis limits.
    const queueConnect=await service.startConnection(hrB,'/id/settings#integrations');await service.callback({state:new URL(queueConnect.authorizationUrl).searchParams.get('state')!,code:'synthetic'},queueConnect.cookie);mode='success';const queued=await forB();
    const liveWorker=new LinkedInWorkerService(db,settings,provider,service,storage,testConfig);
    liveWorker.cleanup=async()=>undefined;liveWorker.recover=async()=>undefined; // Keep maintenance away from unrelated local records in this fixture.
    const runtime=liveWorker as unknown as {redis:import('ioredis').default;queue:import('bullmq').Queue;takeQuota:(member:string,endpoint:string)=>Promise<void>;recordMetric:(metric:{endpoint:'posts';durationMs:number;status:number|null})=>Promise<void>};
    liveWorker.onModuleInit();
    try {
      const deadline=Date.now()+15000;
      while((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:queued.post.id}})).status!=='PUBLISHED' && Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,100));await liveWorker.dispatch();}
      assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:queued.post.id}})).status,'PUBLISHED','real Redis queue must deliver the persisted event');
      await runtime.takeQuota('fixture-member-a','fixtureQuota');await assert.rejects(()=>runtime.takeQuota('fixture-member-a','fixtureQuota'),error=>error instanceof LinkedInFailure && error.code==='RATE_LIMITED');await runtime.takeQuota('fixture-member-b','fixtureQuota');await assert.rejects(()=>runtime.takeQuota('fixture-member-c','fixtureQuota'),error=>error instanceof LinkedInFailure && error.code==='RATE_LIMITED');
      await runtime.takeQuota('fixture-member-a','posts');await runtime.recordMetric({endpoint:'posts',durationMs:900,status:201});await runtime.recordMetric({endpoint:'posts',durationMs:1800,status:429});await runtime.recordMetric({endpoint:'posts',durationMs:20000,status:null});
      const operational=await liveWorker.operationalMetrics(),postMetrics=operational.endpoints.find(row=>row.endpoint==='posts')!;assert.equal(operational.available,true);assert.equal(postMetrics.used,1);assert.equal(postMetrics.requests,3);assert.equal(postMetrics.success,1);assert.equal(postMetrics.rateLimited,1);assert.equal(postMetrics.transportErrors,1);assert.equal(postMetrics.latency!.le1000,1);assert.equal(postMetrics.latency!.leInfinity,3);assert.ok(!JSON.stringify(operational).includes('fixture-member'),'operator telemetry is aggregate only');
      const offline=await worker.operationalMetrics();assert.equal(offline.available,false);assert.equal(offline.endpoints[0].used,null,'disabled or offline telemetry cannot be reported as zero');
      configValues.LINKEDIN_ENDPOINT_LIMITS='{"fixtureQuota":{"app":"invalid"}}';await assert.rejects(()=>runtime.takeQuota('fixture-member-z','fixtureQuota'),error=>error instanceof LinkedInFailure && error.code==='CONFIGURATION_ERROR');
      configValues.LINKEDIN_ENDPOINT_LIMITS='{"posts":{"app":"invalid"}}';assert.equal((await liveWorker.operationalMetrics()).configurationValid,false);
      const quotaKeys=[...await runtime.redis.keys(`li:quota:${sha256(settings.clientId).slice(0,16)}:*`),...await runtime.redis.keys(`li:metrics:${sha256(settings.clientId).slice(0,16)}:*`)];if(quotaKeys.length)await runtime.redis.del(...quotaKeys);
      await runtime.queue.obliterate({force:true});
    }finally{await liveWorker.onModuleDestroy();}
    const expiredPost=await forB(),beforeExpiry=publishCalls;
    await prisma.linkedInConnection.update({where:{userId:b.id},data:{tokenExpiresAt:new Date(Date.now()-1000)}});await worker.process(expiredPost.post.id);assert.equal(publishCalls,beforeExpiry);assert.equal((await prisma.linkedInSocialPost.findUniqueOrThrow({where:{id:expiredPost.post.id}})).status,'FAILED');assert.equal((await service.status(hrB)).status,'EXPIRED');await assert.rejects(()=>service.preview(hrB,expiredPost.job.id,'id'));
    console.log('PASS LinkedIn local integration: real DB/S3/Redis worker, distributed quotas, OAuth binding, company isolation, concurrent publication, member serialization across accounts, durable outbox outage recovery, 429, UNKNOWN/manual reconciliation, revoked tokens, disconnect and crash recovery');
  }finally {
    for(const key of objects)await storage.delete(key);
    await prisma.company.deleteMany({where:{id:{in:companies}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
