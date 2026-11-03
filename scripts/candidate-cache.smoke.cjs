const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/web/package.json')),ts=req('typescript');
const moduleCache={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/lib/resourceCache.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleCache,exports:moduleCache.exports,AbortController,DOMException});
const {ResourceCache}=moduleCache.exports;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('30-second freshness, deduplication, stale data retention and LRU capacity',async()=>{
 let now=0,calls=0;const store=new ResourceCache(2,()=>now),waiting=deferred();const loader=()=>{calls++;return waiting.promise;};
 const a=store.read('account-a:id:jobs',loader,30000),b=store.read('account-a:id:jobs',loader,30000);waiting.resolve(['first']);await Promise.all([a,b]);assert.equal(calls,1);
 now=29000;await store.read('account-a:id:jobs',loader,30000);assert.equal(calls,1);
 now=31000;assert.equal(store.peek('account-a:id:jobs')[0],'first');await store.read('account-a:id:jobs',async()=>['new'],30000);
 await store.read('account-b:id:jobs',async()=>['private-b'],30000);await store.read('public:id:catalog',async()=>[],600000);
 assert.equal(store.peek('account-a:id:jobs'),undefined);assert.equal(store.peek('account-b:id:jobs')[0],'private-b');
});
test('aborting one consumer preserves another; invalidation cannot accept a late old response',async()=>{
 const store=new ResourceCache(),one=new AbortController(),wait=deferred();let signal;
 const a=store.read('private',s=>{signal=s;return wait.promise;},30000,one.signal),b=store.read('private',()=>{throw Error('duplicate');},30000);
 one.abort();await assert.rejects(a,e=>e.name==='AbortError');assert.equal(signal.aborted,false);wait.resolve('safe');assert.equal(await b,'safe');
 const old=deferred();const request=store.read('private',()=>old.promise,30000,undefined,true);store.invalidate(k=>k==='private');
 await store.read('private',async()=> 'new-account-context',30000);old.resolve('old');await request;assert.equal(store.peek('private'),'new-account-context');
});
test('failed revalidation retains cached cards and a retry can succeed',async()=>{
 const store=new ResourceCache();await store.read('jobs',async()=>['card'],30000);
 await assert.rejects(store.read('jobs',async()=>{throw Error('offline');},30000,undefined,true),/offline/);
 assert.equal(store.peek('jobs')[0],'card');await store.read('jobs',async()=>['updated'],30000,undefined,true);assert.equal(store.peek('jobs')[0],'updated');
});
test('CV polling is serialized, skips hidden tabs, backs off and stops on cleanup',async()=>{
 let now=0,cleanup,changed=0,calls=0;const timers=new Map(),listeners=new Map();let timerId=0,pending;
 const doc={visibilityState:'visible',addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 const sub={exports:{}};
 const dependencies={react:{useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn();}},'./api':{api:()=>{calls++;pending=deferred();return pending.promise;}},'./useSessionIdentity':{useSessionIdentity:()=> 'account-a'},'./i18n':{useI18n:()=>({locale:'id'})}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/lib/useMatchingStatus.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:sub,exports:sub.exports,require:key=>dependencies[key],document:doc,AbortController,Date:{now:()=>now},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id)});
 sub.exports.useMatchingStatus(true,()=>changed++);
 const tick=async()=>{const [id,t]=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];timers.delete(id);now=t.due;await t.fn();};
 const [id,t]=[...timers][0];timers.delete(id);now=t.due;void t.fn();assert.equal(calls,1);assert.equal(timers.size,0);
 pending.resolve({state:'CV_PROCESSING',revision:'one'});await new Promise(r=>setImmediate(r));assert.equal(changed,0);
 doc.visibilityState='hidden';await tick();assert.equal(calls,1);
 doc.visibilityState='visible';listeners.get('visibilitychange')();assert.equal(calls,2);
 now=65000;pending.resolve({state:'READY',revision:'two'});await new Promise(r=>setImmediate(r));assert.equal(changed,1);assert.equal([...timers.values()][0].delay,15000);
 cleanup();assert.equal(timers.size,0);assert.equal(listeners.size,0);
});
