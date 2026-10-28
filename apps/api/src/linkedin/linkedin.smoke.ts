import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { LinkedInTokenVault, publicIp, retryAt, safeLinkedInReturnTo, validateLinkedInUploadUrl } from './linkedin-security';
import { buildShareContent, renderSharePoster, shareCaption, validateSharePoster } from './linkedin-content';
import { LinkedInSettings } from './linkedin-settings';
import { LinkedInClient, LinkedInFailure } from './linkedin-client';
import { endpointLimits, LinkedInRequestMetric } from './linkedin-observability';

async function main() {
  const keys={v1:randomBytes(32).toString('base64'),v2:randomBytes(32).toString('base64')};
  const vault=new LinkedInTokenVault(keys,'v1'),sealed=vault.encrypt('synthetic-test-token','hr-a|member-a');
  assert.equal(vault.decrypt(sealed.ciphertext,sealed.keyVersion,'hr-a|member-a'),'synthetic-test-token');
  assert.ok(!sealed.ciphertext.includes('synthetic-test-token'));
  assert.throws(()=>vault.decrypt(sealed.ciphertext,'v1','hr-b|member-a'));
  assert.throws(()=>vault.decrypt(sealed.ciphertext.slice(0,-5)+'AAAAA','v1','hr-a|member-a'));
  assert.equal(new LinkedInTokenVault(keys,'v2').decrypt(sealed.ciphertext,'v1','hr-a|member-a'),'synthetic-test-token','rotation must retain previous keys for existing connections');
  assert.throws(()=>new LinkedInTokenVault({v1:'weak'},'v1'));
  for(const value of ['//evil.example','https://evil.example','/en/../../evil','/en/settings\\evil','/en/settings\r\nInjected'])assert.equal(safeLinkedInReturnTo(value,'https://jobs.example.com'),'/en/settings#integrations');
  assert.equal(safeLinkedInReturnTo('/id/settings?returnTo=%2Fdashboard%2Frecruiter#integrations','https://jobs.example.com'),'/id/settings?returnTo=%2Fdashboard%2Frecruiter#integrations');
  for(const value of ['http://www.linkedin.com/upload','https://linkedin.com.evil.example/upload','https://user:secret@www.linkedin.com/upload','https://127.0.0.1/upload','https://www.linkedin.com:444/upload'])assert.throws(()=>validateLinkedInUploadUrl(value));
  assert.equal(validateLinkedInUploadUrl('https://www.linkedin.com/dms-uploads/image?signature=synthetic').hostname,'www.linkedin.com');
  for(const ip of ['127.0.0.1','10.1.1.1','172.16.1.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicIp(ip),false,ip);
  assert.equal(publicIp('8.8.8.8'),true);assert.equal(retryAt('60',1000)?.getTime(),61000);assert.equal(retryAt('invalid'),undefined);
  const job={id:'synthetic-job',title:'Senior Frontend Developer',company:{name:'Private Company Identity'},isAnonymous:true,locale:'id',city:null,country:null,employmentType:'FULL_TIME',workMode:'REMOTE',salaryMin:null,salaryMax:null,salaryPeriod:'MONTHLY',currency:'IDR'};
  const content=buildShareContent(job,'id','https://jobs.example.com'),caption=shareCaption(content);
  assert.ok(!JSON.stringify(content).includes(job.company.name));assert.ok(!caption.includes(job.company.name));assert.equal(content.location,'Seluruh dunia');assert.equal(content.salary,null);
  assert.equal(new URL(content.jobUrl).searchParams.get('utm_source'),'linkedin');
  assert.equal(buildShareContent({...job,salaryMax:1200},'en','https://jobs.example.com').salary,'IDR Up to 1,200 / month');
  assert.equal(buildShareContent({...job,salaryMin:800},'en','https://jobs.example.com').salary,'IDR From 800 / month');
  assert.equal(buildShareContent({...job,salaryMin:800,salaryMax:800},'en','https://jobs.example.com').salary,'IDR 800 / month');
  const png=renderSharePoster(content);validateSharePoster(png);assert.ok(png.equals(renderSharePoster(content)),'poster must be deterministic');assert.throws(()=>validateSharePoster(Buffer.from('invalid')));
  const settings=new LinkedInSettings(new ConfigService({LINKEDIN_ENABLED:'true',LINKEDIN_ACCESS_VERIFIED:'true',LINKEDIN_CLIENT_ID:'synthetic-app',LINKEDIN_CLIENT_SECRET:'synthetic-secret',LINKEDIN_REDIRECT_URI:'https://api.example.com/api/integrations/linkedin/callback',WEB_URL:'https://jobs.example.com',LINKEDIN_TOKEN_KEYS:JSON.stringify(keys)}));
  assert.equal(settings.canShare,true);
  assert.deepEqual(endpointLimits('{}','posts'),{app:10000,member:100});assert.deepEqual(endpointLimits('{"posts":{"app":20,"member":2}}','posts'),{app:20,member:2});
  for(const raw of ['[]','null','{"posts":false}','{"posts":{"app":"20"}}','{"posts":{"member":0}}','{"posts":{"wrong":10}}'])assert.throws(()=>endpointLimits(raw,'posts'));
  const client=new LinkedInClient(settings);client.setQuota(async()=>undefined);
  const telemetry:LinkedInRequestMetric[]=[];client.setTelemetry(async metric=>{telemetry.push(metric);});
  const original=globalThis.fetch;
  const requests:Array<{url:string;options:RequestInit}>=[];
  let responses:Response[]=[];
  globalThis.fetch=async(input,options)=>{requests.push({url:String(input),options:options || {}});const response=responses.shift();if(!response)throw new Error('Synthetic timeout');return response;};
  try {
    responses=[new Response(JSON.stringify({access_token:'synthetic',expires_in:3600,scope:'openid profile w_member_social'})),new Response(JSON.stringify({sub:'member-a',name:'Synthetic HR'}))];
    const identity=await client.exchange('one-time-test-code');assert.equal(identity.authorUrn,'urn:li:person:member-a');assert.ok(identity.expiresAt.getTime()>Date.now()+3500000);
    responses=[new Response(JSON.stringify({value:{uploadUrl:'https://www.linkedin.com/dms-uploads/synthetic',uploadUrlExpiresAt:Date.now()+600000,image:'urn:li:image:test'}}))];
    const image=await client.initializeImage('synthetic','urn:li:person:member-a');assert.equal(image.imageUrn,'urn:li:image:test');
    assert.equal(new Headers(requests.at(-1)!.options.headers).get('Linkedin-Version'),'202610');assert.equal(requests.at(-1)!.options.redirect,'error');
    responses=[new Response('',{status:403})];assert.equal(await client.imageReady('synthetic','urn:li:person:member-a',image.imageUrn),'unreadable','write-only tokens must not be rejected because image GET is forbidden');
    responses=[new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:123'}})];assert.equal(await client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,content.title),'urn:li:share:123');
    const payload=JSON.parse(requests.at(-1)!.options.body as string);assert.equal(payload.author,identity.authorUrn);assert.equal(payload.content.media.id,'urn:li:image:test');assert.equal(payload.commentary,caption);
    for(const status of [500,502,503,408]) {responses=[new Response('',{status})];await assert.rejects(()=>client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),error=>error instanceof LinkedInFailure && error.options.ambiguous===true);}
    responses=[];await assert.rejects(()=>client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),error=>error instanceof LinkedInFailure && error.options.ambiguous===true);
    responses=[new Response('',{status:429,headers:{'retry-after':'120'}})];await assert.rejects(()=>client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),error=>error instanceof LinkedInFailure && error.options.retryable===true && !error.options.ambiguous && Boolean(error.options.retryAt));
    responses=[new Response(null,{status:201})];await assert.rejects(()=>client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),error=>error instanceof LinkedInFailure && error.options.ambiguous===true);
    responses=[new Response('',{status:401})];await assert.rejects(()=>client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),error=>error instanceof LinkedInFailure && error.code==='RECONNECT_REQUIRED' && !error.options.ambiguous);
    assert.ok(telemetry.some(metric=>metric.endpoint==='posts'&&metric.status===null));assert.ok(telemetry.some(metric=>metric.endpoint==='posts'&&metric.status===429));assert.ok(!JSON.stringify(telemetry).includes('synthetic'),'telemetry must not contain credentials, signed URLs or member identity');
    client.setTelemetry(async()=>{throw Error('Synthetic telemetry failure');});responses=[new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:124'}})];assert.equal(await client.publish('synthetic',identity.authorUrn,caption,image.imageUrn,''),'urn:li:share:124','telemetry failures cannot turn an accepted post into a retry');
  }finally{globalThis.fetch=original;}
  console.log('PASS LinkedIn: encryption/rotation, OAuth identity, SSRF destinations, poster privacy, actual API payloads, 429, 401 and uncertain final POST protection');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
