const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const {host,nodes,text}=require('./lib/react-hook-host.cjs'),root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/web/package.json')),ts=req('typescript'),cache={};
function lib(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;const code=ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,URL,URLSearchParams,require:target=>target==='./api'?{getSession:()=>null}:lib(target.replace('./',''))});return module.exports;}
const commerce=lib('jobCommerce'),stub=()=>null,pricing=()=>null;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const catalog={packages:['FREE','STANDARD','PREMIUM'].map((code,i)=>({code,amount:i*149000,currency:'IDR',settings:{durationDays:30,boostDays:0,featuredDays:0}}))};
function setup(api){let id='job-a',params=new URLSearchParams('package=PREMIUM');const redirects=[];const ui=host('apps/web/src/components/recruiter/JobPackageSelection.tsx','JobPackageSelection',{
  'next/navigation':{useParams:()=>({id}),useSearchParams:()=>params},'@/lib/api':{api},'@/lib/i18n':{useI18n:()=>({locale:'id',t:key=>key})},'@/lib/navigation':{Link:stub,useRouter:()=>({push:value=>redirects.push(value),replace:value=>redirects.push(value)})},'@/lib/jobCommerce':commerce,'@/components/employee/WorkspacePrimitives':{WorkspaceLoading:stub},'./PackagePricing':{PackagePricing:pricing},
},{crypto:require('node:crypto').webcrypto});return{ui,redirects,change:value=>id=value,params:value=>params=new URLSearchParams(value)};}
function response(route){return route.endsWith('/catalog')?catalog:route.startsWith('/benefits/')?{selected:false}:{id:route.split('/').at(-1),title:route.split('/').at(-1),company:{name:'Company'}};}
const choose=tree=>nodes(tree,n=>n.type===pricing)[0].props.onChoose;
test('pricing links preserve all three package choices through the auth return',async()=>{
  const ui=host('apps/web/src/components/recruiter/PackagePricing.tsx','PackagePricing',{'@/lib/api':{api:async()=>catalog,getSession:()=>null},'@/lib/navigation':{Link:stub,useRouter:()=>({push(){}})},'@/lib/i18n':{useI18n:()=>({locale:'id',t:key=>key})},'@/lib/jobCommerce':commerce,'@/components/employee/WorkspacePrimitives':{WorkspaceLoading:stub}});
  const tree=await ui.render({catalog});const links=nodes(tree,n=>n.type===stub&&n.props.href?.startsWith('/register?'));assert.equal(links.length,3);
  for(const [i,link]of links.entries()){const url=new URL(link.props.href,'https://local');assert.equal(url.searchParams.get('role'),'RECRUITER');assert.equal(commerce.packagePreference(url.search),catalog.packages[i].code);}ui.unmount();
});
test('package return allows a safe nested onboarding destination and rejects external or invalid choices',()=>{
  const next='/dashboard/recruiter?tab=jobs&company=original&package=PREMIUM',back='/onboarding/recruiter?next='+encodeURIComponent(next);
  assert.equal(commerce.commerceReturn(back,'job-a'),back);assert.equal(commerce.packagePreference('?next='+encodeURIComponent(next)),'PREMIUM');
  assert.equal(commerce.packageCode('ADMIN'),undefined);assert.equal(commerce.packagePreference('?next='+encodeURIComponent('https://evil.invalid/?package=PREMIUM')),undefined);
  assert.doesNotMatch(commerce.commerceReturn('/onboarding/recruiter?next='+encodeURIComponent('//evil.invalid'),'job-a'),/evil/);
});
test('a late previous-job load cannot overwrite the current job',async()=>{
  const delayed=deferred(),x=setup(route=>route==='/jobs/job-a'?delayed.promise:Promise.resolve(response(route)));await x.ui.render();x.change('job-b');let tree=await x.ui.render();assert.match(text(tree),/job-b/);
  delayed.resolve(response('/jobs/job-a'));tree=await x.ui.render();assert.match(text(tree),/job-b/);assert.doesNotMatch(text(tree),/job-a/);x.ui.unmount();
});
test('a delayed order cannot redirect from a different job or clear its controls',async()=>{
  const delayed=deferred(),x=setup((route,options)=>options?.method==='POST'?delayed.promise:Promise.resolve(response(route)));let tree=await x.ui.render();const pending=choose(tree)('STANDARD');x.change('job-b');tree=await x.ui.render();assert.equal(nodes(tree,n=>n.type===pricing)[0].props.busy,false);
  delayed.resolve({id:'old-order',status:'PENDING'});await pending;assert.deepEqual(x.redirects,[]);x.ui.unmount();
});
test('double clicks create one order, with an explicit job and package; no automatic purchase',async()=>{
  let posts=0,input;const delayed=deferred(),x=setup((route,options)=>{if(options?.method==='POST'){posts++;input=JSON.parse(options.body);return delayed.promise;}return Promise.resolve(response(route));});const tree=await x.ui.render();assert.equal(posts,0);assert.equal(nodes(tree,n=>n.type===pricing)[0].props.preferred,'PREMIUM');
  const pending=choose(tree)('STANDARD');await choose(tree)('PREMIUM');assert.equal(posts,1);assert.deepEqual(input,{jobId:'job-a',code:'STANDARD',intent:'PURCHASE'});delayed.resolve({id:'chosen-order',status:'PENDING'});await pending;assert.match(x.redirects[0],/chosen-order/);x.ui.unmount();
});
test('an unmounted package page ignores late order completion',async()=>{
  const delayed=deferred(),x=setup((route,options)=>options?.method==='POST'?delayed.promise:Promise.resolve(response(route)));const tree=await x.ui.render(),pending=choose(tree)('FREE');x.ui.unmount();delayed.resolve({status:'PAID'});await pending;assert.deepEqual(x.redirects,[]);
});
