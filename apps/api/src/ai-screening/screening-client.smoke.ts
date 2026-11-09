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
  globalThis.fetch=(async(_url:any,init:any)=>{if(init.method==='POST'){creates++;assert.equal(lastTimeout,120000);return new Response(JSON.stringify({id:'resp_synthetic',status:'queued'}));}polls++;throw Error('synthetic polling timeout');}) as any;
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(creates,1);
  await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(creates,1,'poll timeout cannot create another billed response');assert.equal(row.status,'RUNNING');
  row.status='UNCERTAIN';globalThis.fetch=(async()=>new Response(JSON.stringify({id:'resp_synthetic',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}))) as any;
  assert.deepEqual(await client.run('w','s','evaluate',{},preset),{ok:true},'known uncertain response resumes by ID');assert.equal(row.status,'COMPLETED');
  row={...row,status:'RUNNING',responseId:null,updatedAt:new Date(Date.now()-60000)};await assert.rejects(client.run('w','s','evaluate',{},preset),AiPending);assert.equal(row.status,'RUNNING','long create is not prematurely declared uncertain');
  row.status='UNCERTAIN';await assert.rejects(client.run('w','s','evaluate',{},preset),AiUncertain);assert.equal(creates,1,'unknown creation cannot silently duplicate');
  row=null;globalThis.fetch=(async()=>new Response('{broken')) as any;await assert.rejects(client.run('w','s','evaluate',{},preset),AiUncertain);assert.equal(row.status,'UNCERTAIN','unreadable creation acknowledgement stays protected');
  console.log('Screening client transport recovery passed; paid API calls: 0.');
 }finally{globalThis.fetch=original;AbortSignal.timeout=timeout;}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
