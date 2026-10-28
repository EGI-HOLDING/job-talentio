import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { JwtService } from '../apps/api/node_modules/@nestjs/jwt';
import { ConfigService } from '../apps/api/node_modules/@nestjs/config';
import { StorageService } from '../apps/api/src/storage/storage.service';
import { resolveJwtSecret } from '../apps/api/src/common/jwt-secret';

async function main(){
  process.loadEnvFile('.env');
  if(!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname))throw new Error('Local database required');
  const db=new PrismaClient(),jwt=new JwtService(),storage=new StorageService(new ConfigService()),tag='li-http-'+randomUUID(),users:string[]=[],companies:string[]=[];
  const base='http://localhost:4000/api';
  const token=(id:string)=>jwt.sign({sub:id,tv:0},{secret:resolveJwtSecret(),expiresIn:'5m'});
  const call=async(route:string,bearer?:string,body?:unknown,method=body?'POST':'GET')=>fetch(base+route,{method,headers:{...(bearer?{Authorization:'Bearer '+bearer}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(10000)});
  try {
    assert.equal((await call('/health')).status,200);
    const a=await db.user.create({data:{fullName:tag+' A',role:'RECRUITER'}}),b=await db.user.create({data:{fullName:tag+' B',role:'RECRUITER'}}),employee=await db.user.create({data:{fullName:tag+' Employee',role:'EMPLOYEE'}}),admin=await db.user.create({data:{fullName:tag+' Admin',role:'SUPER_ADMIN'}});users.push(a.id,b.id,employee.id,admin.id);
    const company=await db.company.create({data:{name:tag,slug:tag,members:{create:{userId:a.id,role:'OWNER'}}}});companies.push(company.id);
    const job=await db.jobPost.create({data:{companyId:company.id,title:'Synthetic Engineer '+tag,description:'Synthetic HTTP integration fixture for LinkedIn sharing.',status:'PUBLISHED',publishedAt:new Date(),workMode:'REMOTE'}});
    const ta=token(a.id),tb=token(b.id);
    assert.equal((await call('/integrations/linkedin')).status,401);assert.equal((await call('/integrations/linkedin',token(employee.id))).status,403);
    let response=await call('/integrations/linkedin',ta);assert.equal(response.status,200);const status=await response.json() as {enabled:boolean;sharingEnabled:boolean};
    if(status.enabled || status.sharingEnabled)throw new Error('This HTTP fault test requires LinkedIn to be disabled in the local API');
    response=await call('/integrations/linkedin/connect',ta,{});assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);
    await db.linkedInConnection.create({data:{userId:a.id,status:'CONNECTED',subject:'synthetic-'+tag,authorUrn:'urn:li:person:synthetic',displayName:'Synthetic HR',tokenCiphertext:'synthetic-not-a-real-token',tokenKeyVersion:'synthetic',tokenExpiresAt:new Date(Date.now()+3600000),generation:1}});
    response=await call('/jobs/'+job.id+'/linkedin/preview',tb,{locale:'id'});assert.equal(response.status,403);
    response=await call('/jobs/'+job.id+'/linkedin/preview',ta,{locale:'id'});assert.equal(response.status,201);const preview=await response.json() as {id:string;posterDataUrl:string;caption:string};assert.ok(preview.posterDataUrl.startsWith('data:image/png;base64,'));assert.ok(preview.caption.includes('/id/jobs/'+job.id));
    response=await call('/jobs/'+job.id+'/social-posts',ta,{previewId:preview.id});assert.equal(response.status,201);const post=await response.json() as {id:string;status:string;errorCode:string};assert.equal(post.status,'FAILED');assert.equal(post.errorCode,'SERVICE_UNAVAILABLE');assert.equal((await db.jobPost.findUniqueOrThrow({where:{id:job.id}})).status,'PUBLISHED');
    response=await call('/jobs/'+job.id+'/social-posts',ta,{previewId:preview.id});assert.equal((await response.json() as {id:string}).id,post.id);assert.equal(await db.linkedInSocialPost.count({where:{jobId:job.id}}),1);
    assert.equal((await call('/jobs/'+job.id+'/social-posts',tb)).status,403);
    await db.companyMember.create({data:{companyId:company.id,userId:b.id,role:'RECRUITER'}});
    response=await call('/jobs/'+job.id+'/social-posts',tb);assert.deepEqual(await response.json(),[],'another HR in the same company cannot see personal sharing records');
    assert.equal((await call('/social-posts/'+post.id+'/poster',tb)).status,404);
    assert.equal((await call('/social-posts/'+post.id+'/retry',tb,{previewId:preview.id})).status,404);
    response=await call('/social-posts/'+post.id+'/poster',ta);assert.equal(response.status,200);assert.match(response.headers.get('content-type') || '',/image\/png/);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.match(response.headers.get('cache-control') || '',/no-store/);
    assert.equal((await call('/social-posts/'+post.id+'/reconcile',ta,{outcome:'NOT_PUBLISHED',feedChecked:false})).status,400);
    assert.equal((await call('/admin/linkedin/metrics',ta)).status,403);response=await call('/admin/linkedin/metrics',token(admin.id));assert.equal(response.status,200);const metrics=await response.json() as {operations:{available:boolean;endpoints:{used:number|null}[]};sharingEnabled:boolean};assert.ok(!JSON.stringify(metrics).includes('synthetic-not-a-real-token'));assert.equal(metrics.sharingEnabled,false);assert.equal(metrics.operations.available,false);assert.ok(metrics.operations.endpoints.every(row=>row.used===null),'disabled telemetry must be unavailable, never an invented zero');
    await db.companyMember.delete({where:{companyId_userId:{companyId:company.id,userId:a.id}}});assert.equal((await call('/social-posts/'+post.id+'/poster',ta)).status,403);
    response=await call('/integrations/linkedin/callback?state=invalid&code=synthetic');assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location')!).hostname,'localhost');assert.ok(!response.headers.get('location')!.includes('code='));
    console.log('PASS LinkedIn HTTP: auth/role guards, real preview/poster, paused-provider portal safety, replay idempotency, HR/company isolation, reconciliation consent and private poster authorization');
  }finally{
    const previews=await db.linkedInPreview.findMany({where:{userId:{in:users}},select:{posterKey:true}});for(const item of previews)await storage.delete(item.posterKey);
    await db.company.deleteMany({where:{id:{in:companies}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
