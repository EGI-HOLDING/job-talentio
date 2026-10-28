import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, LinkedInSocialPost } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { LinkedInSettings } from './linkedin-settings';
import { LinkedInClient, validPostUrn } from './linkedin-client';
import { safeLinkedInReturnTo, sha256 } from './linkedin-security';
import { buildShareContent, renderSharePoster, shareCaption, shareFingerprint, ShareLocale } from './linkedin-content';
import { StorageService } from '../storage/storage.service';

export const LINKEDIN_COOKIE = 'jt_linkedin_oauth';
export const LINKEDIN_COOKIE_PATH = '/api/integrations/linkedin/callback';
const queuedStatuses = ['PENDING','RENDERING','UPLOADING'] as const;
export const shareJobInclude = { company:true, city:true, country:true, benefit:true } as const;
export function socialPostDto(post:LinkedInSocialPost) {
  return {id:post.id,jobId:post.jobId,status:post.status,attempts:post.attempts,retrySafe:post.retrySafe,
    errorCode:post.errorCode,errorSummary:post.errorSummary,nextAttemptAt:post.nextAttemptAt,
    providerPostUrn:post.providerPostUrn,publishedAt:post.publishedAt,reconciledAt:post.reconciledAt,
    reviewAfter:post.status==='UNKNOWN'?post.leaseUntil:null,
    createdAt:post.createdAt,updatedAt:post.updatedAt};
}

@Injectable()
export class LinkedInService {
  constructor(private prisma:PrismaService,private settings:LinkedInSettings,private client:LinkedInClient,private storage:StorageService) {}

  async assertActor(db:Prisma.TransactionClient,userId:string) {
    const user=await db.user.findUnique({where:{id:userId}});
    if(!user || user.isBanned || user.anonymizedAt || !['RECRUITER','SUPER_ADMIN'].includes(user.role))throw new ForbiddenException('An active HR account is required');
    return user;
  }
  async assertJob(db:Prisma.TransactionClient,userId:string,jobId:string,requirePremium=false) {
    const user=await this.assertActor(db,userId);
    const job=await db.jobPost.findUnique({where:{id:jobId},include:shareJobInclude});
    if(!job)throw new NotFoundException('Job not found');
    if(job.company.isBanned || job.company.anonymizedAt)throw new ForbiddenException('Company unavailable');
    if(user.role!=='SUPER_ADMIN' && !await db.companyMember.findUnique({where:{companyId_userId:{companyId:job.companyId,userId}}}))throw new ForbiddenException('Not a company member');
    if(requirePremium) {
      const benefit=await db.jobBenefit.findUnique({where:{jobId}});
      if(!benefit || benefit.code!=='PREMIUM' || !benefit.selectionConfirmedAt || (benefit.expiresAt && benefit.expiresAt<=new Date()))
        throw new ForbiddenException('PREMIUM_REQUIRED: LinkedIn sharing requires Premium for this job');
    }
    return job;
  }
  async status(user:AuthUser) {
    await this.assertActor(this.prisma,user.id);
    const connection=await this.prisma.linkedInConnection.findUnique({where:{userId:user.id}});
    const expired=Boolean(connection?.tokenExpiresAt && connection.tokenExpiresAt.getTime()<=Date.now());
    const connected=connection?.status==='CONNECTED' && !expired && Boolean(connection.tokenCiphertext);
    return { enabled:this.settings.canConnect,sharingEnabled:this.settings.canShare,
      unavailableReason:!this.settings.canConnect?'SERVICE_UNAVAILABLE':!this.settings.accessVerified?'ACCESS_NOT_VERIFIED':!this.settings.publicSite?'PUBLIC_URL_REQUIRED':null,
      status:expired && connection?.status==='CONNECTED'?'EXPIRED':connected && connection!.tokenExpiresAt!.getTime()-Date.now()<14*86400000?'EXPIRING':connection?.status || 'DISCONNECTED',
      connected,displayName:connection?.displayName || null,avatarUrl:connection?.avatarUrl || null,
      expiresAt:connection?.tokenExpiresAt || null,autoShareEnabled:connection?.autoShareEnabled || false };
  }
  async startConnection(user:AuthUser,returnTo:unknown) {
    if(!this.settings.canConnect)throw new ServiceUnavailableException('LinkedIn connection is not configured yet');
    const actor=await this.assertActor(this.prisma,user.id);
    const recent=await this.prisma.linkedInOAuthState.count({where:{userId:user.id,createdAt:{gte:new Date(Date.now()-600000)}}});
    if(recent>=5)throw new HttpException('Too many connection attempts. Try again in a few minutes.',429);
    const state=randomBytes(32).toString('base64url'),cookie=randomBytes(32).toString('base64url');
    await this.prisma.linkedInOAuthState.create({data:{stateHash:sha256(state),cookieHash:sha256(cookie),userId:user.id,sessionVersion:actor.tokenVersion,returnTo:safeLinkedInReturnTo(returnTo,this.settings.webUrl),expiresAt:new Date(Date.now()+600000)}});
    const url=new URL('https://www.linkedin.com/oauth/v2/authorization');
    Object.entries({response_type:'code',client_id:this.settings.clientId,redirect_uri:this.settings.redirectUri,state,scope:this.settings.scopes.join(' ')}).forEach(([key,value])=>url.searchParams.set(key,value));
    return {authorizationUrl:url.toString(),cookie};
  }
  private callbackUrl(returnTo:string,result:string) {
    const url=new URL(returnTo,this.settings.webUrl);url.searchParams.set('linkedin',result);return url.toString();
  }
  async callback(input:{state?:string;code?:string;error?:string},cookie:string | undefined) {
    const fallback=this.callbackUrl('/en/settings#integrations','failed');
    if(!this.settings.canConnect || !input.state || !cookie || input.state.length>200 || cookie.length>200)return fallback;
    const state=await this.prisma.$transaction(async tx=>{
      const saved=await tx.linkedInOAuthState.findUnique({where:{stateHash:sha256(input.state!)}});
      if(!saved || saved.cookieHash!==sha256(cookie) || saved.expiresAt.getTime()<=Date.now() || saved.consumedAt)return null;
      const claimed=await tx.linkedInOAuthState.updateMany({where:{stateHash:saved.stateHash,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
      return claimed.count?saved:null;
    });
    if(!state)return fallback;
    if(input.error)return this.callbackUrl(state.returnTo,'denied');
    if(!input.code || input.code.length>8000)return this.callbackUrl(state.returnTo,'failed');
    try {
      const actor=await this.assertActor(this.prisma,state.userId);
      if(actor.tokenVersion!==state.sessionVersion)return this.callbackUrl(state.returnTo,'failed');
      const identity=await this.client.exchange(input.code);
      const encrypted=this.settings.vault!.encrypt(identity.accessToken,`${state.userId}|${identity.subject}`);
      await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${state.userId} FOR UPDATE`;
        const current=await this.assertActor(tx,state.userId);
        if(current.tokenVersion!==state.sessionVersion)throw new ForbiddenException('Session changed');
        const connection=await tx.linkedInConnection.upsert({where:{userId:state.userId},create:{userId:state.userId,subject:identity.subject,authorUrn:identity.authorUrn,displayName:identity.displayName,avatarUrl:identity.avatarUrl,grantedScopes:identity.scopes,tokenCiphertext:encrypted.ciphertext,tokenKeyVersion:encrypted.keyVersion,tokenExpiresAt:identity.expiresAt,status:'CONNECTED',generation:1,connectedAt:new Date()},update:{subject:identity.subject,authorUrn:identity.authorUrn,displayName:identity.displayName,avatarUrl:identity.avatarUrl,grantedScopes:identity.scopes,tokenCiphertext:encrypted.ciphertext,tokenKeyVersion:encrypted.keyVersion,tokenExpiresAt:identity.expiresAt,status:'CONNECTED',generation:{increment:1},autoShareEnabled:false,connectedAt:new Date(),disconnectedAt:null}});
        await tx.linkedInSocialPost.updateMany({where:{userId:state.userId,status:{in:[...queuedStatuses]},connectionGeneration:{not:connection.generation}},data:{status:'CANCELLED',errorCode:'CONNECTION_CHANGED',errorSummary:'The LinkedIn connection changed. Prepare a new preview.',retrySafe:true}});
        await tx.auditLog.create({data:{actorId:state.userId,action:'LINKEDIN_CONNECTED',entityType:'LinkedInConnection',entityId:connection.id,metadata:{generation:connection.generation,scopes:identity.scopes}}});
      });
      return this.callbackUrl(state.returnTo,'connected');
    } catch {return this.callbackUrl(state.returnTo,'failed');}
  }
  async preferences(user:AuthUser,autoShareEnabled:boolean) {
    await this.assertActor(this.prisma,user.id);
    const conn=await this.prisma.linkedInConnection.findUnique({where:{userId:user.id}});
    if(!conn || (autoShareEnabled && (!this.settings.canShare || conn.status!=='CONNECTED' || !conn.tokenExpiresAt || conn.tokenExpiresAt.getTime()<=Date.now())))throw new ConflictException('Connect an available LinkedIn account before enabling this preference');
    await this.prisma.$transaction(async tx=>{
      const saved=await tx.linkedInConnection.updateMany({where:{userId:user.id,generation:conn.generation,...(autoShareEnabled?{status:'CONNECTED',tokenExpiresAt:{gt:new Date()}}:{})},data:{autoShareEnabled}});
      if(!saved.count)throw new ConflictException('The connection changed. Check its status before updating this preference.');
      await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_PREFERENCES',entityType:'LinkedInConnection',entityId:conn.id,metadata:{autoShareEnabled}}});
    });
    return this.status(user);
  }
  async disconnect(user:AuthUser) {
    await this.assertActor(this.prisma,user.id);
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id} FOR UPDATE`;
      const connection=await tx.linkedInConnection.findUnique({where:{userId:user.id}});
      if(!connection)return;
      await tx.linkedInConnection.update({where:{id:connection.id},data:{status:'DISCONNECTED',autoShareEnabled:false,tokenCiphertext:null,tokenKeyVersion:null,tokenExpiresAt:null,generation:{increment:1},disconnectedAt:new Date()}});
      await tx.linkedInOAuthState.updateMany({where:{userId:user.id,consumedAt:null},data:{consumedAt:new Date()}});
      await tx.linkedInSocialPost.updateMany({where:{userId:user.id,status:{in:[...queuedStatuses]}},data:{status:'CANCELLED',errorCode:'DISCONNECTED',errorSummary:'Sharing cancelled because the account was disconnected.'}});
      await tx.linkedInSocialPost.updateMany({where:{userId:user.id,status:'PUBLISHING'},data:{status:'UNKNOWN',retrySafe:false,errorCode:'DISCONNECTED_DURING_PUBLISH',errorSummary:'A posting request was already in flight. Check your LinkedIn feed.'}});
      await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_DISCONNECTED',entityType:'LinkedInConnection',entityId:connection.id}});
    });
    return this.status(user);
  }
  async preview(user:AuthUser,jobId:string,locale:ShareLocale) {
    const job=await this.assertJob(this.prisma,user.id,jobId,true);
    const connection=await this.prisma.linkedInConnection.findUnique({where:{userId:user.id}});
    if(!connection || connection.status!=='CONNECTED' || !connection.authorUrn || !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime()<=Date.now())throw new ConflictException('Reconnect LinkedIn to prepare an approved preview');
    if(await this.prisma.linkedInPreview.count({where:{userId:user.id,createdAt:{gte:new Date(Date.now()-60000)}}})>=10)throw new HttpException('Too many previews. Please wait a minute.',429);
    const content=buildShareContent(job,locale,this.settings.webUrl),caption=shareCaption(content),poster=renderSharePoster(content);
    const id=randomUUID(),posterKey=`linkedin/previews/${user.id}/${id}.png`;
    const fingerprint=shareFingerprint(content)+':'+(job.benefit?.publicationCycle??1);
    await this.storage.putObject(posterKey,poster,'image/png');
    let preview;
    try {preview=await this.prisma.linkedInPreview.create({data:{id,userId:user.id,companyId:job.companyId,jobId,connectionId:connection.id,connectionGeneration:connection.generation,locale,fingerprint,content:content as unknown as Prisma.InputJsonValue,caption,jobUrl:content.jobUrl,posterKey,posterSha256:sha256(poster),expiresAt:new Date(Date.now()+1800000)}});}
    catch(error){await this.storage.delete(posterKey);throw error;}
    return {id:preview.id,caption,jobUrl:content.jobUrl,fingerprint:preview.fingerprint,posterDataUrl:`data:image/png;base64,${poster.toString('base64')}`,expiresAt:preview.expiresAt,isAnonymous:content.isAnonymous,displayName:connection.displayName};
  }
  private async approved(tx:Prisma.TransactionClient,userId:string,jobId:string,previewId:string) {
    const job=await this.assertJob(tx,userId,jobId,true);
    const preview=await tx.linkedInPreview.findFirst({where:{id:previewId,userId,jobId,companyId:job.companyId,expiresAt:{gt:new Date()}}});
    const connection=await tx.linkedInConnection.findUnique({where:{userId}});
    if(!preview || !connection || preview.connectionId!==connection.id || preview.connectionGeneration!==connection.generation || !connection.authorUrn)throw new ConflictException('The LinkedIn preview expired or the connection changed. Prepare a new preview.');
    const locale=preview.locale as ShareLocale;
    const content=buildShareContent(job,locale,this.settings.webUrl);
    if(shareFingerprint(content)+':'+(job.benefit?.publicationCycle??1)!==preview.fingerprint || shareCaption(content)!==preview.caption)throw new ConflictException('The job changed after the preview. Review the new poster before sharing.');
    return {job,preview,connection};
  }
  /** Called inside the SAME transaction as portal publication; no network I/O. */
  async enqueueApproved(tx:Prisma.TransactionClient,user:AuthUser,jobId:string,previewId:string) {
    const job=await this.assertJob(tx,user.id,jobId,true);
    if(job.status!=='PUBLISHED')throw new ConflictException('Publish the job before sharing it');
    const publicationRevision=job.benefit?.publicationCycle??1;
    const existing=await tx.linkedInSocialPost.findUnique({where:{jobId_userId_publicationRevision:{jobId,userId:user.id,publicationRevision}}});
    if(existing)return socialPostDto(existing);
    const approved=await this.approved(tx,user.id,jobId,previewId);
    const {preview,connection}=approved;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`linkedin-share:${jobId}:${connection.authorUrn}`},0))`;
    if(await tx.linkedInSocialPost.findFirst({where:{jobId,authorUrnSnapshot:connection.authorUrn!,publicationRevision,userId:{not:user.id}}}))throw new ConflictException('This LinkedIn profile already has a sharing request for this job');
    const ready=this.settings.canShare && connection.status==='CONNECTED' && Boolean(connection.tokenCiphertext) && Boolean(connection.tokenExpiresAt && connection.tokenExpiresAt.getTime()>Date.now());
    const post=await tx.linkedInSocialPost.create({data:{userId:user.id,jobId,publicationRevision,companyId:job.companyId,connectionId:connection.id,connectionGeneration:connection.generation,authorUrnSnapshot:connection.authorUrn!,previewId:preview.id,content:preview.content as Prisma.InputJsonValue,captionSnapshot:preview.caption,jobUrlSnapshot:preview.jobUrl,posterKey:preview.posterKey,posterSha256:preview.posterSha256,status:ready?'PENDING':'FAILED',...(!ready?{errorCode:this.settings.canShare?'RECONNECT_REQUIRED':'SERVICE_UNAVAILABLE',errorSummary:this.settings.canShare?'Reconnect LinkedIn, then review and retry.':'LinkedIn sharing is temporarily unavailable. Your job is published on Talentio.'}:{})}});
    if(ready)await tx.linkedInOutbox.create({data:{socialPostId:post.id}});
    await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_SHARE_APPROVED',entityType:'LinkedInSocialPost',entityId:post.id,metadata:{jobId,companyId:job.companyId,previewId:preview.id,posterSha256:preview.posterSha256,fingerprint:preview.fingerprint}}});
    return socialPostDto(post);
  }
  async requestShare(user:AuthUser,jobId:string,previewId:string) {
    const job=await this.assertJob(this.prisma,user.id,jobId);
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id"=${job.companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "JobPost" WHERE "id"=${jobId} FOR UPDATE`;
      return this.enqueueApproved(tx,user,jobId,previewId);
    });
  }
  async list(user:AuthUser,jobId:string) {
    const job=await this.assertJob(this.prisma,user.id,jobId);
    return (await this.prisma.linkedInSocialPost.findMany({where:{jobId,userId:user.id,publicationRevision:job.benefit?.publicationCycle??1},orderBy:{createdAt:'desc'},take:20})).map(socialPostDto);
  }
  private async ownPost(tx:Prisma.TransactionClient,user:AuthUser,id:string) {
    const post=await tx.linkedInSocialPost.findFirst({where:{id,userId:user.id}});
    if(!post)throw new NotFoundException('Sharing request not found');
    await this.assertJob(tx,user.id,post.jobId);
    return post;
  }
  async retry(user:AuthUser,id:string,previewId:string) {
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "LinkedInSocialPost" WHERE "id"=${id} FOR UPDATE`;
      const post=await this.ownPost(tx,user,id);
      if(!['FAILED','CANCELLED'].includes(post.status) || !post.retrySafe)throw new ConflictException('This request cannot be retried. Uncertain posts must be reviewed first.');
      const {job,preview,connection}=await this.approved(tx,user.id,post.jobId,previewId);
      if(post.publicationRevision!==(job.benefit?.publicationCycle??1))throw new ConflictException('This request belongs to an earlier publication period');
      if(job.status!=='PUBLISHED')throw new ConflictException('This job is no longer published');
      if(!this.settings.canShare || connection.status!=='CONNECTED' || !connection.tokenCiphertext || !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime()<=Date.now())throw new ConflictException('Reconnect an available LinkedIn account first');
      if(connection.authorUrn!==post.authorUrnSnapshot)throw new ConflictException('Retry requires the same LinkedIn profile that originally approved this post');
      const updated=await tx.linkedInSocialPost.update({where:{id},data:{status:'PENDING',connectionGeneration:connection.generation,previewId:preview.id,content:preview.content as Prisma.InputJsonValue,captionSnapshot:preview.caption,jobUrlSnapshot:preview.jobUrl,posterKey:preview.posterKey,posterSha256:preview.posterSha256,imageUrn:null,attemptId:null,leaseUntil:null,nextAttemptAt:new Date(),errorCode:null,errorSummary:null}});
      await tx.linkedInOutbox.upsert({where:{socialPostId:id},create:{socialPostId:id},update:{processedAt:null,nextDispatchAt:new Date()}});
      await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_SHARE_RETRY',entityType:'LinkedInSocialPost',entityId:id,metadata:{previewId}}});
      return socialPostDto(updated);
    });
  }
  async reconcile(user:AuthUser,id:string,outcome:'PUBLISHED'|'NOT_PUBLISHED',postUrn?:string) {
    if(postUrn && !validPostUrn(postUrn))throw new BadRequestException('The LinkedIn post URN is invalid');
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "LinkedInSocialPost" WHERE "id"=${id} FOR UPDATE`;
      const post=await this.ownPost(tx,user,id);
      if(post.status!=='UNKNOWN')throw new ConflictException('Only uncertain posts require reconciliation');
      // An in-flight request must first finish or reach its recovery deadline.
      if(post.leaseUntil && post.leaseUntil.getTime()>Date.now())throw new ConflictException('The original request may still be in flight. Wait before confirming its result.');
      const updated=await tx.linkedInSocialPost.update({where:{id},data:{status:outcome==='PUBLISHED'?'PUBLISHED':'FAILED',retrySafe:outcome==='NOT_PUBLISHED',providerPostUrn:outcome==='PUBLISHED'?(postUrn || null):null,publishedAt:outcome==='PUBLISHED'?new Date():null,reconciledAt:new Date(),errorCode:outcome==='PUBLISHED'?null:'CONFIRMED_NOT_PUBLISHED',errorSummary:outcome==='PUBLISHED'?null:'The account owner confirmed that this post did not appear. Review a new preview before retrying.'}});
      await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_SHARE_RECONCILED',entityType:'LinkedInSocialPost',entityId:id,metadata:{outcome,postUrn:postUrn || null}}});
      return socialPostDto(updated);
    });
  }
  async cancel(user:AuthUser,id:string) {
    return this.prisma.$transaction(async tx=>{
      const post=await this.ownPost(tx,user,id);
      const changed=await tx.linkedInSocialPost.updateMany({where:{id,status:{in:[...queuedStatuses]}},data:{status:'CANCELLED',errorCode:'CANCELLED_BY_OWNER',errorSummary:'Sharing cancelled by the account owner.'}});
      if(!changed.count)throw new ConflictException('This request is already publishing or finished');
      await tx.auditLog.create({data:{actorId:user.id,action:'LINKEDIN_SHARE_CANCELLED',entityType:'LinkedInSocialPost',entityId:id}});
      return socialPostDto(await tx.linkedInSocialPost.findUniqueOrThrow({where:{id:post.id}}));
    });
  }
  async poster(user:AuthUser,id:string) {
    const post=await this.ownPost(this.prisma,user,id);
    return this.storage.getObjectBuffer(post.posterKey);
  }
  async cancelForJob(tx:Prisma.TransactionClient,jobId:string) {
    await tx.linkedInSocialPost.updateMany({where:{jobId,status:{in:[...queuedStatuses]}},data:{status:'CANCELLED',errorCode:'JOB_NOT_PUBLISHED',errorSummary:'Sharing cancelled because the job is no longer published.'}});
  }
}
