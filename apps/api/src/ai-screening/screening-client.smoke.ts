import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ScreeningClient,AiPending,AiUncertain } from './screening.client';
async function main(){
 const original=globalThis.fetch,timeout=AbortSignal.timeout;let creates=0,polls=0,lastTimeout=0;
 let row:any=null;
 const db:any={aiScreeningCall:{findFirst:async()=>row,findUnique:async()=>row,count:async()=>row?1:0,create:async({data}:any)=>(row={id:'call',updatedAt:new Date(),createdAt:new Date(),...data}),update:async({data}:any)=>(row={...row,...data}),updateMany:async({data}:any)=>{row={...row,...data};return{count:1};}}};
 const client=new ScreeningClient(db,{get:()=> 'synthetic-key'} as any),preset:any={instructions:'Synthetic',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},name:'synthetic',version:'test',reasoning:'low',maxOutput:100,model:'gpt-6-luna'};
 try{
  AbortSignal.timeout=(ms:number)=>{lastTimeout=ms;return timeout(ms);};
  globalThis.fetch=(async(_url:any,init:any)=>{if(init.method==='POST'){creates++;assert.equal(lastTimeout,120000);return new Response(JSON.stringify({id:'resp_synthetic',status:'queued',created_at:1700000000}));}polls++;throw Error('synthetic polling timeout');}) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(creates,1);assert.equal(row.usage.providerTiming.createdAt,1700000000);assert.equal(row.usage.providerTiming.lastStatus,'queued');
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(creates,1,'poll timeout cannot create another billed response');assert.equal(row.status,'RUNNING');
  row.status='UNCERTAIN';row.error='PROVIDER_RESPONSE_REQUIRES_REVIEW';globalThis.fetch=(async()=>new Response(JSON.stringify({id:'resp_synthetic',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}))) as any;
  assert.deepEqual(await client.run('w','s','evaluate',{},preset),{ok:true},'known uncertain response resumes by ID');assert.equal(row.status,'COMPLETED');assert.equal(row.error,null,'successful recovery clears obsolete failure reason');
  row={...row,status:'RUNNING',responseId:'resp_synthetic',createdAt:new Date(Date.now()-40*60000)};
  globalThis.fetch=(async(_url:any,init:any)=>{assert.notEqual(init.method,'POST','old response only retrieved');return new Response(JSON.stringify({id:'resp_synthetic',status:'in_progress'}));}) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(row.status,'RUNNING','long background queue stays pollable after fifteen minutes');assert.ok(row.usage.providerTiming.firstInProgressObservedAt,'provider processing observation is recorded');
  row.status='UNCERTAIN';
  globalThis.fetch=(async(_url:any,init:any)=>{assert.notEqual(init.method,'POST');return new Response(JSON.stringify({id:'resp_synthetic',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}));}) as any;
  assert.deepEqual(await client.run('w','s','evaluate',{},preset),{ok:true},'completed result older than local timeout is recovered');assert.equal(creates,1);
  row.status='RUNNING';
  globalThis.fetch=(async()=>new Response('{}',{status:503})) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(row.status,'RUNNING','temporary provider error remains resumable regardless of age');
  globalThis.fetch=(async(_url:any,init:any)=>{
   assert.notEqual(init.method,'POST');
   return new Response('{}',{status:429,headers:{'Retry-After':'2'}});
  }) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);
  assert.equal(row.status,'RUNNING');
  assert.equal(row.responseId,'resp_synthetic','provider rate limit must preserve the existing response');
  globalThis.fetch=(async()=>new Response('{}',{status:404})) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiUncertain);assert.equal(row.status,'UNCERTAIN','unavailable stored response still requires operator review');
  row={...row,status:'RUNNING',responseId:null,updatedAt:new Date(Date.now()-60000)};await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(row.status,'RUNNING','long create is not prematurely declared uncertain');
  row.status='UNCERTAIN';await assert.rejects(client.run('w','s','evaluate',{},preset),AiUncertain);assert.equal(creates,1,'unknown creation cannot silently duplicate');
  row=null;globalThis.fetch=(async()=>new Response('{broken')) as any;await assert.rejects(client.run('w','s','evaluate',{},preset),AiUncertain);assert.equal(row.status,'UNCERTAIN','unreadable creation acknowledgement stays protected');
  const complete=(result:string)=>new Response(JSON.stringify({id:'resp_candidate',status:'completed',output:[{type:'message',content:[{type:'output_text',text:result}]}]}));
  for(const content of ['{"claims":[null,{"sourceRef":"cv-2-1","skillText":"Figma","criterionId":"design","relevance":"CORE"}]}','{"invalid":true}','{broken']){
   row=null;let submissions=0,gets=0;
   globalThis.fetch=(async(url:string,init:RequestInit)=>{
    if(init.method==='POST'){
     submissions++;return new Response(JSON.stringify({id:'resp_candidate',status:'queued'}));
    }
    assert.ok(url.endsWith('/resp_candidate'));
    if(init.method==='DELETE')return new Response(null,{status:204});
    return ++gets===1?new Response('{}',{status:503}):complete(content);
   }) as any;
   await assert.rejects(client.run('candidate-w','candidate-s','candidate',{},preset),AiPending);
   await assert.rejects(client.pollCandidate(row,100),AiPending);
   if(content.startsWith('{"claims"'))assert.deepEqual(await client.pollCandidate(row,100),JSON.parse(content));
   else{
    await assert.rejects(client.pollCandidate(row,100),/TARA_INVALID_OUTPUT/);
    await assert.rejects(client.run('candidate-w','candidate-s','candidate',{},preset),/TARA_CANDIDATE_ALREADY_SUBMITTED/);
   }
   assert.equal(submissions,1,'mixed or malformed content uses a single submission');
  }
  row=null;let agendaSubmissions=0,agendaPolls=0;
  globalThis.fetch=(async(url:string,init:RequestInit)=>{
   if(init.method==='POST'){
    agendaSubmissions++;return new Response(JSON.stringify({id:'resp_agenda',status:'queued'}));
   }
   assert.ok(url.endsWith('/resp_agenda'));
   if(init.method==='DELETE')return new Response(null,{status:204});
   return ++agendaPolls===1?new Response('{}',{status:503}):complete('{"invalid":true}');
  }) as any;
  await assert.rejects(client.run('agenda-work','agenda-packet','live-agenda',{},preset),AiPending);
  assert.equal(row.key,'agenda-work:live-agenda');
  await assert.rejects(client.pollLiveAgenda(row,preset,100),AiPending);
  await assert.rejects(client.pollLiveAgenda(row,preset,100),/TARA_INVALID_OUTPUT/);
  await assert.rejects(client.run('agenda-work','agenda-packet','live-agenda',{},preset),/TARA_LIVE_AGENDA_ALREADY_SUBMITTED/);
  assert.equal(agendaSubmissions,1,'one paid submission per frozen agenda despite polling and invalid results');
  console.log('Screening client transport recovery passed; paid API calls: 0.');
 }finally{globalThis.fetch=original;AbortSignal.timeout=timeout;}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
