// Executes the production upload store with deterministic HTTP/XHR/browser primitives.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json')),ts=req('typescript');
const source=fs.readFileSync(path.join(root,'apps/web/src/lib/candidateImports.ts'),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function main(){
 let userId='hr',failMetadata=true,ready=false,failRefresh=false,maxTransfers=0;
 const stored=new Map(),server=new Map(),completed=[],requests=[],held=[];
 const api=async(route,options)=>{
  assert.equal(userId,'hr','an upload request must never use the account switched into');
  if(route==='/recruitment/imports'){
   const input=JSON.parse(options.body);requests.push(input);let data=server.get(input.requestKey);
   if(!data){data={id:'batch-'+(server.size+1),files:input.files.map(f=>({id:'file-'+server.size+'-'+f.clientId,clientId:f.clientId,status:'UPLOADING'}))};server.set(input.requestKey,data);}
   if(input.files.length===5&&failMetadata){failMetadata=false;throw Error('Synthetic lost metadata response after server commit');}return data;
  }
  if(route.endsWith('/upload-url'))return {status:'UPLOADING',uploadUrl:'https://synthetic.test/put'};
  if(route.endsWith('/upload-complete')){completed.push(route.split('/').at(-2));return {scoreStatus:'PENDING'};}
  if(route.startsWith('/recruitment/imports/')){if(failRefresh){failRefresh=false;throw Error('Synthetic restore refresh outage');}return {files:[...server.values()].flatMap(b=>b.files).map(f=>({...f,scoreStatus:ready?'READY':'PROCESSING'}))};}
  throw Error('Unexpected API '+route);
 };
 function createStore(){
  class Xhr{
   constructor(){this.upload={};this.status=0;}open(){}setRequestHeader(){}
   send(file){this.file=file;held.push(this);maxTransfers=Math.max(maxTransfers,held.length);}
  }
  const mod={exports:{}};
  const context={module:mod,exports:mod.exports,require:name=>name==='react'?{useSyncExternalStore:(_subscribe,snapshot)=>snapshot()}:name==='./api'?{api,getSession:()=>({user:{id:userId}})}:require(name),crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,XMLHttpRequest:Xhr,window:{dispatchEvent:()=>{}},Event:class{},localStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)},console};
  vm.runInNewContext(compiled,context,{filename:'candidateImports.production.js'});return mod.exports;
 }
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const store=createStore();await store.restoreCandidateImports('hr');
 const files=Array.from({length:105},(_,i)=>new File(['%PDF-1.4 synthetic CV'],'CV-'+i+'.pdf',{type:'application/pdf',lastModified:123}));
 await assert.rejects(store.startCandidateImport('co','job',files),/lost metadata response/);
 await store.startCandidateImport('co','job',files);await flush();
 assert.equal(server.size,2);assert.equal(requests.length,3);assert.equal(requests[1].requestKey,requests[2].requestKey,'unknown response retries the same durable import request key');
 assert.equal(store.useCandidateImports().flatMap(b=>b.files).length,105,'successful metadata chunk is never registered twice');assert.equal(held.length,3);
 userId='other';for(const xhr of held.splice(0)){xhr.status=200;xhr.onload();}await flush();await flush();
 assert.equal(completed.length,0,'account switch cannot seal an old account upload with another identity');
 userId='hr';await store.restoreCandidateImports('hr');await flush();assert.equal(held.length,3,'returning to an already restored account restarts its queued transfers');
 for(const batch of store.useCandidateImports())for(const file of batch.files)if(file.status==='error')store.retryCandidateTransfer(batch.id,file.id);
 for(let i=0;i<150&&completed.length<105;i++){for(const xhr of held.splice(0)){xhr.status=200;xhr.onload();}await flush();await flush();}
 assert.equal(completed.length,105);assert.equal(new Set(completed).size,105);assert.equal(maxTransfers,3);
 ready=true;await store.refreshCandidateImports();assert.ok(store.useCandidateImports().every(b=>b.files.every(f=>f.status==='done')));
 await new Promise(r=>setTimeout(r,300));
 const persisted=JSON.parse(stored.get('candidate-imports:hr'));assert.ok(persisted.every(b=>b.files.every(f=>!('file' in f))),'file bytes never enter localStorage');
 persisted[0].files[0].status='uploading';stored.set('candidate-imports:hr',JSON.stringify(persisted));failRefresh=true;
 const restored=createStore();await restored.restoreCandidateImports('hr');assert.equal(restored.useCandidateImports()[0].files[0].needsReselect,true);
 await restored.refreshCandidateImports();assert.equal(restored.useCandidateImports()[0].files[0].status,'done','a later refresh repairs an interrupted transfer when the first restore request failed');
 console.log('Candidate import store passed: 105 files, partial metadata response loss/idempotent retry, three parallel transfers, account-switch sealing guard, account-return queue recovery, durable refresh retry and metadata-only persistence. Paid calls: 0.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
