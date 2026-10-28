import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LinkedInSocialPost, Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LinkedInClient, LinkedInFailure } from './linkedin-client';
import { LinkedInService } from './linkedin.service';
import { LinkedInSettings } from './linkedin-settings';
import { nextUtcReset, publicIp, sha256 } from './linkedin-security';
import { ShareContent, validateSharePoster } from './linkedin-content';
import { isIP } from 'node:net';
import { endpointLimits, LATENCY_BUCKETS, LINKEDIN_ENDPOINTS, LinkedInRequestMetric } from './linkedin-observability';

const QUEUE='linkedin-member-posts',LEASE_MS=180000,MAX_ATTEMPTS=6;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
class StaleAttempt extends Error {}
export function retryDate(error:LinkedInFailure,attempt:number,now=Date.now()) {
  if(error.options.retryAt)return error.options.retryAt;
  if(error.code==='RATE_LIMITED')return new Date(nextUtcReset(now).getTime()+Math.floor(Math.random()*30000));
  return new Date(now+Math.min(300000,15000*2**Math.max(0,attempt-1))+Math.floor(Math.random()*3000));
}
export function publicApplyUrl(raw:string) {
  try {const url=new URL(raw);return url.protocol==='https:' && !url.username && !url.password && !url.hash && (!url.port || url.port==='443') && !['localhost','127.0.0.1','::1'].includes(url.hostname) && !url.hostname.endsWith('.localhost') && (isIP(url.hostname)?publicIp(url.hostname):url.hostname.includes('.'));}catch{return false;}
}

@Injectable()
export class LinkedInWorkerService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(LinkedInWorkerService.name);
  private queue?:Queue;private worker?:Worker;private redis?:IORedis;private connections:IORedis[]=[];
  private timer?:ReturnType<typeof setInterval>;private ticking=false;private stopping=false;
  private workerStarted=false;
  constructor(private prisma:PrismaService,private settings:LinkedInSettings,private client:LinkedInClient,private shares:LinkedInService,private storage:StorageService,private config:ConfigService) {}

  onModuleInit() {
    if(this.settings.canShare) {
      const redis=new IORedis(this.config.get('REDIS_URL','redis://localhost:6379'),{maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:5000});
      const workerRedis=redis.duplicate({maxRetriesPerRequest:null,enableOfflineQueue:true});
      this.redis=redis;this.connections=[redis,workerRedis];
      for(const connection of this.connections)connection.on('error',()=>this.logger.warn('LinkedIn Redis connection unavailable; requests remain in the outbox'));
      const queueName=QUEUE+'-'+sha256(this.settings.clientId+'|'+this.config.get('DATABASE_URL','')).slice(0,16);
      this.queue=new Queue(queueName,{connection:redis,defaultJobOptions:{attempts:1,removeOnComplete:{age:3600,count:10000},removeOnFail:{age:86400,count:10000}}});
      this.queue.on('error',()=>this.logger.warn('LinkedIn queue unavailable; outbox delivery will resume automatically'));
      this.client.setQuota((member,endpoint)=>this.takeQuota(member,endpoint));
      this.client.setTelemetry(metric=>this.recordMetric(metric));
      this.worker=new Worker<{postId:string}>(queueName,async job=>this.process(job.data.postId),{connection:workerRedis,concurrency:2,limiter:{max:1,duration:1000},lockDuration:LEASE_MS,autorun:false});
      this.worker.on('error',()=>this.logger.warn('LinkedIn worker transport unavailable'));
      this.worker.on('failed',job=>this.logger.warn(JSON.stringify({event:'linkedin_worker_delivery_failed',postId:job?.data.postId})));
    }
    const tick=async()=>{
      if(this.ticking || this.stopping)return;this.ticking=true;
      try {await this.recover();await this.dispatch();await this.cleanup();}
      catch {this.logger.warn('LinkedIn maintenance unavailable; persisted requests are retained');}
      finally {this.ticking=false;}
    };
    void tick();this.timer=setInterval(()=>void tick(),15000);this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping=true;if(this.timer)clearInterval(this.timer);
    await Promise.allSettled([this.worker?.close(),this.queue?.close()]);
    for(const connection of this.connections)connection.disconnect();
  }
  private async takeQuota(member:string,endpoint:string) {
    if(!this.redis || this.redis.status!=='ready')throw new LinkedInFailure('QUEUE_UNAVAILABLE','The sharing service is temporarily unavailable.',{retryable:true});
    // Internal safety ceilings, NOT a claim about LinkedIn's actual quotas.
    const limits=endpointLimits(this.config.get('LINKEDIN_ENDPOINT_LIMITS','{}'),endpoint);
    const app=limits.app,person=limits.member;
    const day=new Date().toISOString().slice(0,10),ttl=Math.ceil((nextUtcReset().getTime()-Date.now())/1000)+60;
    const script="local a=tonumber(redis.call('GET',KEYS[1]) or '0');local m=tonumber(redis.call('GET',KEYS[2]) or '0');if a>=tonumber(ARGV[1]) or m>=tonumber(ARGV[2]) then return 0 end;redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],ARGV[3]);redis.call('INCR',KEYS[2]);redis.call('EXPIRE',KEYS[2],ARGV[3]);return 1";
    let allowed:unknown;
    const appKey=sha256(this.settings.clientId).slice(0,16);
    try {allowed=await this.redis.eval(script,2,`li:quota:${appKey}:${day}:${endpoint}:app`,`li:quota:${appKey}:${day}:${endpoint}:member:${sha256(member)}`,app,person,ttl);}
    catch {throw new LinkedInFailure('QUEUE_UNAVAILABLE','Sharing is waiting for its quota service.',{retryable:true});}
    if(allowed!==1)throw new LinkedInFailure('RATE_LIMITED','The daily sharing safety limit was reached.',{retryable:true,retryAt:nextUtcReset()});
  }
  private async recordMetric(metric:LinkedInRequestMetric) {
    if(this.redis?.status!=='ready')return;
    const day=new Date().toISOString().slice(0,10),key=`li:metrics:${sha256(this.settings.clientId).slice(0,16)}:${day}:${metric.endpoint}`;
    const fields=['requests','durationMs',metric.status===null?'transportErrors':metric.status>=200&&metric.status<300?'success':'httpErrors',...(metric.status===429?['rateLimited']:[]),...LATENCY_BUCKETS.filter(max=>metric.durationMs<=max).map(max=>'le'+max),'leInfinity'];
    const transaction=this.redis.multi();for(const field of fields)transaction.hincrby(key,field,field==='durationMs'?metric.durationMs:1);
    transaction.expire(key,172800);await transaction.exec();
  }
  async operationalMetrics() {
    const day=new Date().toISOString().slice(0,10),appKey=sha256(this.settings.clientId).slice(0,16);
    const ready=this.redis?.status==='ready';
    try {
      const endpoints=await Promise.all(LINKEDIN_ENDPOINTS.map(async endpoint=>{
        const limits=endpointLimits(this.config.get('LINKEDIN_ENDPOINT_LIMITS','{}'),endpoint);
        const [used,metric]=ready?await Promise.all([this.redis!.get(`li:quota:${appKey}:${day}:${endpoint}:app`),this.redis!.hgetall(`li:metrics:${appKey}:${day}:${endpoint}`)]):[null,null];
        const count=(name:string)=>metric?Number(metric[name] || 0):null;
        return {endpoint,appLimit:limits.app,memberLimit:limits.member,used:used===null?(ready?0:null):Number(used),requests:count('requests'),success:count('success'),httpErrors:count('httpErrors'),transportErrors:count('transportErrors'),rateLimited:count('rateLimited'),averageMs:metric?.requests?Math.round(Number(metric.durationMs || 0)/Number(metric.requests)):null,latency:metric?Object.fromEntries([...LATENCY_BUCKETS.map(max=>'le'+max),'leInfinity'].map(key=>[key,Number(metric[key] || 0)])):null};
      }));
      return {available:Boolean(ready),configurationValid:true,day,resetAt:nextUtcReset(),endpoints};
    }catch(error){return {available:false,configurationValid:!(error instanceof LinkedInFailure && error.code==='CONFIGURATION_ERROR'),day,resetAt:nextUtcReset(),endpoints:[]};}
  }
  async dispatch() {
    if(!this.queue || this.redis?.status!=='ready' || this.stopping)return;
    if(this.worker && !this.workerStarted) {
      await this.queue.setGlobalConcurrency(2);
      this.workerStarted=true;
      void this.worker.run().catch(()=>{this.workerStarted=false;this.logger.warn('LinkedIn worker stopped; delivery will resume on the next maintenance cycle');});
    }
    const events=await this.prisma.linkedInOutbox.findMany({where:{processedAt:null,nextDispatchAt:{lte:new Date()},post:{status:'PENDING',nextAttemptAt:{lte:new Date()}}},include:{post:{select:{attempts:true}}},orderBy:{nextDispatchAt:'asc'},take:30});
    for(const event of events) {
      try {
        const key=`${event.socialPostId}-${event.post.attempts}`;
        const existing=await this.queue.getJob(key);
        if(existing && ['failed','completed'].includes(await existing.getState()))await existing.remove();
        await this.queue.add('share',{postId:event.socialPostId},{jobId:key});
        // Do not acknowledge here: a Redis loss before claim must be recoverable.
        await this.prisma.linkedInOutbox.updateMany({where:{id:event.id,processedAt:null},data:{nextDispatchAt:new Date(Date.now()+30000),attempts:{increment:1}}});
      }catch{break;}
    }
  }
  private async claim(id:string) {
    return this.prisma.$transaction(async tx=>{
      const initial=await tx.linkedInSocialPost.findUnique({where:{id}});
      if(!initial || initial.status!=='PENDING' || initial.nextAttemptAt.getTime()>Date.now())return null;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`linkedin-member:${initial.authorUrnSnapshot}`},0))`;
      await tx.$queryRaw`SELECT "id" FROM "LinkedInConnection" WHERE "id"=${initial.connectionId} FOR UPDATE`;
      const connection=await tx.linkedInConnection.findUniqueOrThrow({where:{id:initial.connectionId}});
      const post=await tx.linkedInSocialPost.findUniqueOrThrow({where:{id}});
      if(post.status!=='PENDING' || post.nextAttemptAt.getTime()>Date.now())return null;
      const memberBusy=await tx.linkedInSocialPost.findFirst({where:{id:{not:id},authorUrnSnapshot:post.authorUrnSnapshot,status:{in:['RENDERING','UPLOADING','PUBLISHING']},leaseUntil:{gt:new Date()}},select:{id:true}});
      if(memberBusy || (connection.leaseUntil && connection.leaseUntil.getTime()>Date.now())) {
        await tx.linkedInOutbox.updateMany({where:{socialPostId:id},data:{processedAt:null,nextDispatchAt:new Date(Date.now()+10000)}});return null;
      }
      let access=true;
      try {const job=await this.shares.assertJob(tx,post.userId,post.jobId,true);access=job.status==='PUBLISHED' && (job.benefit?.publicationCycle??1)===post.publicationRevision;}catch{access=false;}
      const connected=connection.status==='CONNECTED' && connection.generation===post.connectionGeneration && connection.authorUrn===post.authorUrnSnapshot && Boolean(connection.tokenCiphertext && connection.tokenKeyVersion && connection.tokenExpiresAt && connection.tokenExpiresAt.getTime()>Date.now());
      if(!access || !connected) {
        await tx.linkedInSocialPost.update({where:{id},data:{status:access?'FAILED':'CANCELLED',errorCode:access?'RECONNECT_REQUIRED':'ACCESS_REVOKED',errorSummary:access?'Reconnect LinkedIn and review a new preview.':'The job or company access is no longer available.',retrySafe:true}});
        await tx.linkedInOutbox.updateMany({where:{socialPostId:id},data:{processedAt:new Date()}});return null;
      }
      const attemptId=randomUUID(),leaseUntil=new Date(Date.now()+LEASE_MS);
      await tx.linkedInConnection.update({where:{id:connection.id},data:{leaseOwner:attemptId,leaseUntil}});
      const claimed=await tx.linkedInSocialPost.updateMany({where:{id,status:'PENDING'},data:{status:'RENDERING',attemptId,leaseUntil,attempts:{increment:1},errorCode:null,errorSummary:null}});
      if(!claimed.count)return null;
      await tx.linkedInOutbox.updateMany({where:{socialPostId:id},data:{processedAt:new Date()}});
      return {post:{...post,status:'RENDERING' as const,attemptId,leaseUntil,attempts:post.attempts+1},connection};
    });
  }
  private async active(post:LinkedInSocialPost,allowed:('RENDERING'|'UPLOADING'|'PUBLISHING')[]) {
    const fresh=await this.prisma.linkedInSocialPost.findUnique({where:{id:post.id}});
    if(!fresh || fresh.attemptId!==post.attemptId || !allowed.includes(fresh.status as never) || !fresh.leaseUntil || fresh.leaseUntil.getTime()<=Date.now())throw new StaleAttempt();
    const connection=await this.prisma.linkedInConnection.findUnique({where:{id:post.connectionId}});
    if(!connection || connection.leaseOwner!==post.attemptId || connection.generation!==post.connectionGeneration || connection.status!=='CONNECTED' || !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime()<=Date.now())throw new LinkedInFailure('RECONNECT_REQUIRED','The LinkedIn connection is no longer available.');
    try {const job=await this.shares.assertJob(this.prisma,post.userId,post.jobId,true);if(job.status!=='PUBLISHED' || (job.benefit?.publicationCycle??1)!==post.publicationRevision)throw new Error('Not published');}
    catch {throw new LinkedInFailure('ACCESS_REVOKED','The job or company access is no longer available.');}
  }
  private async stage(post:LinkedInSocialPost,status:'UPLOADING'|'PUBLISHING') {
    await this.active(post,status==='UPLOADING'?['RENDERING']:['UPLOADING']);
    const changed=await this.prisma.linkedInSocialPost.updateMany({where:{id:post.id,attemptId:post.attemptId,status:status==='UPLOADING'?'RENDERING':'UPLOADING'},data:{status,...(status==='PUBLISHING'?{retrySafe:false}:{})}});
    if(!changed.count)throw new StaleAttempt();
    this.logger.log(JSON.stringify({event:'linkedin_stage',postId:post.id,stage:status,attempt:post.attempts}));
  }
  async process(id:string) {
    if(!this.settings.canShare || this.stopping)return;
    const claimed=await this.claim(id);if(!claimed)return;
    const {post,connection}=claimed;let publishing=false;
    const started=Date.now();
    const heartbeat=setInterval(()=>{
      const leaseUntil=new Date(Date.now()+LEASE_MS);
      void Promise.all([
        this.prisma.linkedInConnection.updateMany({where:{id:connection.id,leaseOwner:post.attemptId},data:{leaseUntil}}),
        this.prisma.linkedInSocialPost.updateMany({where:{id,attemptId:post.attemptId,status:{in:['RENDERING','UPLOADING','PUBLISHING','UNKNOWN']}},data:{leaseUntil}}),
      ]).catch(()=>this.logger.warn(JSON.stringify({event:'linkedin_lease_renewal_failed',postId:id})));
    },20000);heartbeat.unref();
    try {
      if(!publicApplyUrl(post.jobUrlSnapshot))throw new LinkedInFailure('PUBLIC_URL_REQUIRED','Configure a public HTTPS application URL before sharing.');
      let token:string;
      try {token=this.settings.vault!.decrypt(connection.tokenCiphertext!,connection.tokenKeyVersion!,`${post.userId}|${connection.subject}`);}
      catch {throw new LinkedInFailure('TOKEN_KEY_UNAVAILABLE','Reconnect LinkedIn or contact support before retrying this share.');}
      let timeout:ReturnType<typeof setTimeout> | undefined;
      const bytes=await Promise.race([this.storage.getObjectBuffer(post.posterKey),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new LinkedInFailure('POSTER_UNAVAILABLE','The approved poster is temporarily unavailable.',{retryable:true})),30000);timeout.unref();})]).finally(()=>{if(timeout)clearTimeout(timeout);});
      try {validateSharePoster(bytes);if(sha256(bytes)!==post.posterSha256)throw new Error('Hash mismatch');}catch{throw new LinkedInFailure('POSTER_INVALID','The stored poster no longer matches the approved preview. Prepare a new preview.');}
      await this.stage(post,'UPLOADING');
      let imageUrn=post.imageUrn;
      if(!imageUrn) {
        await this.active(post,['UPLOADING']);
        const upload=await this.client.initializeImage(token,post.authorUrnSnapshot);
        await this.active(post,['UPLOADING']);
        await this.client.uploadImage(token,post.authorUrnSnapshot,upload.uploadUrl,bytes,upload.expiresAt);
        imageUrn=upload.imageUrn;
        const saved=await this.prisma.linkedInSocialPost.updateMany({where:{id,attemptId:post.attemptId,status:'UPLOADING'},data:{imageUrn}});
        if(!saved.count)throw new StaleAttempt();
      }
      for(let poll=0;poll<4;poll++) {
        await this.active(post,['UPLOADING']);
        const ready=await this.client.imageReady(token,post.authorUrnSnapshot,imageUrn);
        if(ready==='available')break;
        if(ready==='unreadable'){await sleep(5000);break;}
        if(poll===3)throw new LinkedInFailure('IMAGE_PROCESSING','The image is still processing on LinkedIn.',{retryable:true});
        await sleep(1500);
      }
      await this.stage(post,'PUBLISHING');publishing=true;
      await this.active(post,['PUBLISHING']);
      const content=post.content as unknown as ShareContent;
      const urn=await this.client.publish(token,post.authorUrnSnapshot,post.captionSnapshot,imageUrn,`${content.title} — ${content.location}`);
      this.logger.log(JSON.stringify({event:'linkedin_provider_accepted',postId:id,providerPostUrn:urn}));
      await this.prisma.$transaction(async tx=>{
        const saved=await tx.linkedInSocialPost.updateMany({where:{id,attemptId:post.attemptId,status:{in:['PUBLISHING','UNKNOWN']}},data:{status:'PUBLISHED',providerPostUrn:urn,publishedAt:new Date(),leaseUntil:null,retrySafe:false,errorCode:null,errorSummary:null}});
        if(saved.count)await tx.auditLog.create({data:{actorId:post.userId,action:'LINKEDIN_POST_PUBLISHED',entityType:'LinkedInSocialPost',entityId:id,metadata:{providerPostUrn:urn,attempt:post.attempts,durationMs:Date.now()-started}}});
      });
    }catch(error) {
      if(!(error instanceof StaleAttempt))await this.failure(post,error,publishing);
    }finally {
      clearInterval(heartbeat);
      await this.prisma.linkedInConnection.updateMany({where:{id:connection.id,leaseOwner:post.attemptId},data:{leaseOwner:null,leaseUntil:null}}).catch(()=>undefined);
    }
  }
  private async failure(post:LinkedInSocialPost,error:unknown,publishing:boolean) {
    const failure=error instanceof LinkedInFailure?error:new LinkedInFailure(publishing?'PUBLISH_RESULT_UNKNOWN':'PREPARATION_FAILED',publishing?'The posting result could not be saved or verified. Check your LinkedIn feed.':'The sharing service is temporarily unavailable.',{ambiguous:publishing,retryable:!publishing});
    const ambiguous=Boolean(failure.options.ambiguous),retry=Boolean(failure.options.retryable && !ambiguous && post.attempts<MAX_ATTEMPTS);
    const next=retry?retryDate(failure,post.attempts):new Date();
    await this.prisma.$transaction(async tx=>{
      const saved=await tx.linkedInSocialPost.updateMany({where:{id:post.id,attemptId:post.attemptId,status:{in:['RENDERING','UPLOADING','PUBLISHING']}},data:{status:ambiguous?'UNKNOWN':failure.code==='ACCESS_REVOKED'?'CANCELLED':retry?'PENDING':'FAILED',retrySafe:!ambiguous,errorCode:failure.code,errorSummary:failure.message,nextAttemptAt:next,leaseUntil:ambiguous?new Date(Date.now()+300000):null,...(retry?{attemptId:null}:{})}});
      if(!saved.count)return;
      if(retry)await tx.linkedInOutbox.upsert({where:{socialPostId:post.id},create:{socialPostId:post.id,nextDispatchAt:next},update:{processedAt:null,nextDispatchAt:next}});
      if(failure.code==='RECONNECT_REQUIRED') {
        await tx.linkedInConnection.updateMany({where:{id:post.connectionId,generation:post.connectionGeneration},data:{status:'REVOKED',autoShareEnabled:false,tokenCiphertext:null,tokenKeyVersion:null}});
        await tx.linkedInSocialPost.updateMany({where:{connectionId:post.connectionId,connectionGeneration:post.connectionGeneration,status:'PENDING'},data:{status:'FAILED',errorCode:'RECONNECT_REQUIRED',errorSummary:'Reconnect LinkedIn and review a new preview.'}});
      }
      await tx.auditLog.create({data:{actorId:post.userId,action:ambiguous?'LINKEDIN_POST_UNKNOWN':'LINKEDIN_POST_FAILED',entityType:'LinkedInSocialPost',entityId:post.id,metadata:{code:failure.code,willRetry:retry,attempt:post.attempts}}});
    }).catch(()=>this.logger.error(JSON.stringify({event:'linkedin_result_persistence_failed',postId:post.id,ambiguous:publishing})));
    this.logger.warn(JSON.stringify({event:'linkedin_attempt_finished',postId:post.id,code:failure.code,ambiguous,retry,attempt:post.attempts}));
  }
  async recover() {
    const stale=await this.prisma.linkedInSocialPost.findMany({where:{status:{in:['RENDERING','UPLOADING','PUBLISHING']},leaseUntil:{lt:new Date()}},take:50});
    for(const post of stale)await this.prisma.$transaction(async tx=>{
      const uncertain=post.status==='PUBLISHING';
      const changed=await tx.linkedInSocialPost.updateMany({where:{id:post.id,attemptId:post.attemptId,status:post.status,leaseUntil:{lt:new Date()}},data:{status:uncertain?'UNKNOWN':'PENDING',retrySafe:!uncertain,leaseUntil:null,...(!uncertain?{attemptId:null,nextAttemptAt:new Date()}:{}),errorCode:uncertain?'PUBLISH_RESULT_UNKNOWN':'WORKER_RECOVERED',errorSummary:uncertain?'The worker stopped during publishing. Check the feed; this request will not be posted again automatically.':'The background service restarted; sharing will resume.'}});
      if(!changed.count)return;
      await tx.linkedInConnection.updateMany({where:{id:post.connectionId,leaseOwner:post.attemptId},data:{leaseOwner:null,leaseUntil:null}});
      if(!uncertain)await tx.linkedInOutbox.upsert({where:{socialPostId:post.id},create:{socialPostId:post.id},update:{processedAt:null,nextDispatchAt:new Date()}});
      await tx.auditLog.create({data:{actorId:post.userId,action:'LINKEDIN_WORKER_RECOVERED',entityType:'LinkedInSocialPost',entityId:post.id,metadata:{uncertain}}});
    });
  }
  private lastCleanup=0;
  async cleanup() {
    if(Date.now()-this.lastCleanup<3600000)return;this.lastCleanup=Date.now();
    await this.prisma.linkedInOAuthState.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)}}});
    await this.prisma.linkedInConnection.updateMany({where:{status:'CONNECTED',tokenExpiresAt:{lte:new Date()}},data:{status:'EXPIRED',autoShareEnabled:false,tokenCiphertext:null,tokenKeyVersion:null}});
    const expired=await this.prisma.linkedInPreview.findMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)}},take:100});
    for(const preview of expired) {
      const used=await this.prisma.linkedInSocialPost.count({where:{posterKey:preview.posterKey}});
      await this.prisma.linkedInPreview.deleteMany({where:{id:preview.id,expiresAt:{lt:new Date()}}});
      if(!used)await this.storage.delete(preview.posterKey);
    }
  }
}
