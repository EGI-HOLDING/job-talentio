// Runs actual table policy, hooks and components against isolated in-memory fixtures.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {host, nodes, text} = require('./lib/react-hook-host.cjs');
const base = 'apps/web/src/components/recruiter/';
const stub = () => null;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const i18n = {useI18n:()=>({locale:'id',t:key=>key}),useEnumLabel:()=> (_,value)=>value};
const benefit = (extra={}) => ({packagesEnabled:true,code:'PREMIUM',selected:true,startsAt:new Date(Date.now()-86400000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),boostEnabled:true,boostRemainingSeconds:7200,boostEffectiveSeconds:7200,activeBoost:null,...extra});
const job = (extra={}) => ({id:'job-a',title:'Platform Engineer',status:'PUBLISHED',publishedAt:'2026-01-01',employmentType:'FULL_TIME',experienceLevel:'SENIOR',_count:{applications:987654,views:123456789},...extra});
// Execute the actual pure policy once and reuse it in component fixtures.
function loadPolicy() {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const root=path.resolve(__dirname,'..');
  const ts=require(require.resolve('typescript',{paths:[path.join(root,'apps/web')]})),module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,base,'jobRowPolicy.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Date});
  return module.exports.jobRowPolicy;
}
const policyFn=loadPolicy();
function events() { const listeners=new Map(); return {addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},emit(k,event={}){listeners.get(k)?.forEach(fn=>fn(event));},listeners}; }
class ApiError extends Error { constructor(status){super('fixture error');this.status=status;} }

test('table policy covers five statuses, all packages, unselected, disabled and expired capabilities', async()=>{
  for (const status of ['DRAFT','PUBLISHED','PAUSED','CLOSED','EXPIRED']) for (const code of ['FREE','STANDARD','PREMIUM']) {
    const p=policyFn(job({status}),benefit({code}));
    assert.equal(p.canReview,status==='DRAFT');assert.equal(p.canResume,status==='PAUSED');assert.equal(p.canReopen,status==='CLOSED');
    assert.equal(p.canDuplicate,['CLOSED','EXPIRED'].includes(status));assert.equal(p.canPause,status==='PUBLISHED');assert.equal(p.canClose,status!=='CLOSED');
    assert.equal(p.publicVisible,status==='PUBLISHED');assert.equal(p.packageAction,status==='EXPIRED'?'renew':code==='PREMIUM'?'view':'upgrade');
    const expired=policyFn(job({status}),benefit({code,expiresAt:'2000-01-01'}));
    assert.equal(expired.canBoost,false);assert.equal(expired.canResume,false);assert.equal(expired.canReopen,false);assert.equal(expired.canReview,false);assert.equal(expired.canDuplicate,true);assert.equal(expired.packageAction,'renew');
  }
  assert.equal(policyFn(job({status:'CLOSED',publishedAt:null}),benefit()).canReview,true);
  assert.equal(policyFn(job({status:'CLOSED',publishedAt:null}),benefit()).canReopen,false);
  assert.equal(policyFn(job({status:'PAUSED'}),benefit({selected:false})).canResume,false);
  assert.equal(policyFn(job(),benefit({selected:false})).packageAction,'choose');
  assert.equal(policyFn(job(),benefit({packagesEnabled:false})).packageAction,null);
  assert.equal(policyFn(job({status:'PAUSED'}),benefit({packagesEnabled:false,selected:false})).canResume,true);
  for(const data of [null,benefit({boostEnabled:false}),benefit({expiresAt:null}),benefit({boostRemainingSeconds:0}),benefit({boostEffectiveSeconds:0}),benefit({activeBoost:{startsAt:'2000-01-01',endsAt:'2099-01-01'}})]) assert.equal(policyFn(job(),data).canBoost,false);
  assert.equal(policyFn(job(),benefit()).canBoost,true);assert.equal(policyFn(job(),benefit(),false).canBoost,false);
  assert.equal(policyFn(job({status:'CLOSED'}),benefit(),false).canDuplicate,false);
  assert.equal(policyFn(job(),null).packageAction,null);assert.equal(policyFn(job(),null).publicVisible,false);
});

test('one benefit hook rejects stale company/page reads, handles timeout/retry, focus and deadline refresh',async()=>{
  const pending=[],win=events();
  const ui=host(base+'useJobRowBenefits.ts','useJobRowBenefits',{'@/lib/api':{ApiError,api:(path,options)=>{const d=deferred();pending.push({...d,path,signal:options.signal});return d.promise;}}},{window:win,invoke:(hook,companyId)=>hook(companyId,'job-a','PUBLISHED','id')});
  let tree=await ui.render('company-a');assert.equal(tree.phase,'loading');assert.equal(pending.length,1);
  tree=await ui.render('company-b');assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve(benefit({code:'STANDARD'}));tree=await ui.render();assert.equal(tree.data.code,'STANDARD');
  pending[0].resolve(benefit({code:'FREE'}));tree=await ui.render();assert.equal(tree.data.code,'STANDARD');
  win.emit('focus');tree=await ui.render();assert.equal(tree.phase,'loading');assert.equal(tree.data,null);
  pending[2].reject(new ApiError(503));tree=await ui.render();assert.equal(tree.phase,'error');assert.equal(tree.data,null);
  const retry=tree.refresh();await ui.render();ui.fireTimers();await retry;tree=await ui.render();assert.equal(tree.phase,'error');assert.equal(pending[3].signal.aborted,true);
  const again=tree.refresh();pending[4].resolve(benefit());await again;tree=await ui.render();assert.equal(tree.phase,'ready');
  ui.fireTimers();tree=await ui.render();assert.equal(pending.length,6);assert.equal(tree.phase,'loading');
  pending[5].resolve(benefit({activeBoost:{startsAt:'2000-01-01',endsAt:'2099-01-01'}}));tree=await ui.render();assert.ok(tree.data.activeBoost);
  ui.unmount();assert.equal(win.listeners.get('focus').size,0);
});

function rowHarness({read,post=async()=>{},clipboard=async()=>{},data=benefit()}={}) {
  function Actions(){} function Dialog(){}
  let state={phase:'ready',data,refresh:read||(async()=>data)};
  const flashes=[],statuses=[],win={...events(),location:{origin:'https://fixture.test'},dispatchEvent(){}};
  const ui=host(base+'RecruiterJobRow.tsx','RecruiterJobRow',{
    '@/lib/navigation':{Link:stub,localeUrl:(locale,path)=>'/'+locale+path},'@/lib/accountNavigation':{employerJobHref:()=>'/fixture/applicants'},
    '@/lib/hr-benefits':{postOnce:post},'@/lib/i18n':i18n,'@/lib/location':{localizedJobLocation:()=> 'Kota Jakarta Selatan, Hybrid'},
    '@/components/employee/WorkspacePrimitives':{dateLabel:v=>v||'-'},'./useJobRowBenefits':{useJobRowBenefits:()=>state},
    './jobRowPolicy':{jobRowPolicy:policyFn},'./JobRowIcon':{JobRowIcon:stub},'./JobRowDialog':{JobRowDialog:Dialog},'./RecruiterJobActions':{RecruiterJobActions:Actions},
  },{window:win,navigator:{clipboard:{writeText:clipboard}},Event:class{}});
  const props={job:job(),companyId:'company-a',companyOpen:true,busy:false,onEdit(){},onReviewPublish(){},onDuplicate(){},onStatus:s=>statuses.push(s),onApplicants(){},onPeriodExpired(){},onFlash:(...args)=>flashes.push(args)};
  return {ui,props,Actions,Dialog,flashes,statuses,setState:next=>state=next};
}
const component=(tree,type)=>nodes(tree,n=>n.type===type)[0];
const button=(tree,key)=>nodes(tree,n=>n.type==='button'&&text(n).trim()===key)[0];

test('boost uses one row read state, locks double clicks and preserves transaction success after refresh failure',async()=>{
  const write=deferred();let posts=0,reads=0;
  const h=rowHarness({read:async()=>++reads<=2?benefit():null,post:()=>{posts++;return write.promise;}});
  let tree=await h.ui.render(h.props);assert.equal(nodes(tree,n=>n.type==='details').length,0);assert.equal(nodes(tree,n=>n.type==='td').length,8);
  component(tree,h.Actions).props.onBoost();tree=await h.ui.render();assert.ok(component(tree,h.Dialog));
  const activate=button(component(tree,h.Dialog).props.footer,'hr.activateBoost');
  activate.props.onClick();activate.props.onClick();await h.ui.render();assert.equal(posts,1);
  write.resolve({});tree=await h.ui.render();assert.equal(h.flashes[0][0],'jr.boostActivated');assert.match(text(tree),/jr.boostActivatedRefreshFailed/);
  assert.equal(button(component(tree,h.Dialog).props.footer,'hr.activateBoost'),undefined);h.ui.unmount();
});

test('boost revalidates eligibility before POST and failed/late requests never report success in another company',async()=>{
  let posts=0;
  const changed=rowHarness({read:async()=>benefit({boostRemainingSeconds:0}),post:async()=>posts++});
  let tree=await changed.ui.render(changed.props);component(tree,changed.Actions).props.onBoost();tree=await changed.ui.render();
  button(component(tree,changed.Dialog).props.footer,'hr.activateBoost').props.onClick();tree=await changed.ui.render();assert.equal(posts,0);assert.match(text(tree),/jr.boostChanged/);changed.ui.unmount();
  const delayed=deferred(),h=rowHarness({post:()=>delayed.promise});tree=await h.ui.render(h.props);component(tree,h.Actions).props.onBoost();tree=await h.ui.render();button(component(tree,h.Dialog).props.footer,'hr.activateBoost').props.onClick();await h.ui.render();
  tree=await h.ui.render({...h.props,companyId:'company-b',job:job({id:'job-b'})});delayed.resolve({});tree=await h.ui.render();assert.equal(h.flashes.length,0);assert.equal(component(tree,h.Dialog),undefined);h.ui.unmount();
  const conflict=rowHarness({post:async()=>{throw new ApiError(409);}});tree=await conflict.ui.render(conflict.props);component(tree,conflict.Actions).props.onBoost();tree=await conflict.ui.render();button(component(tree,conflict.Dialog).props.footer,'hr.activateBoost').props.onClick();tree=await conflict.ui.render();assert.equal(conflict.flashes.length,0);assert.match(text(tree),/jr.boostFailed/);conflict.ui.unmount();
});

test('clipboard denial exposes a manual localized public URL without dashboard/company parameters',async()=>{
  let copied;const h=rowHarness({clipboard:async value=>{copied=value;throw Error('denied');}});
  let tree=await h.ui.render(h.props);component(tree,h.Actions).props.onCopy();tree=await h.ui.render();
  assert.equal(copied,'https://fixture.test/id/jobs/job-a');assert.equal(component(tree,h.Dialog).props.title,'jr.copyLink');
  const input=nodes(tree,n=>n.type==='input')[0];assert.equal(input.props.value,copied);assert.equal(input.props.readOnly,true);
  let selected=false;input.props.onFocus({currentTarget:{select(){selected=true;}}});assert.equal(selected,true);h.ui.unmount();
});

test('unavailable benefits render retry without guessing a Free package or offering activation',async()=>{
  const h=rowHarness();h.setState({phase:'error',data:null,refresh:async()=>null});
  const tree=await h.ui.render(h.props);assert.match(text(tree),/workspace.retry/);assert.doesNotMatch(text(tree),/hr.package.FREE/);assert.equal(component(tree,h.Actions).props.policy.canBoost,false);h.ui.unmount();
});

test('exhausted allowance has no quota button; an active boost keeps duration and finish details without activation',async()=>{
  const empty=rowHarness({data:benefit({boostRemainingSeconds:0,boostEffectiveSeconds:0})});
  let tree=await empty.ui.render(empty.props);assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='jr.boostDetails').length,0);empty.ui.unmount();
  const active=rowHarness({data:benefit({boostRemainingSeconds:0,boostEffectiveSeconds:0,activeBoost:{startsAt:'2026-01-01',endsAt:'2099-01-01'}})});
  tree=await active.ui.render(active.props);component(tree,active.Actions).props.onBoost();tree=await active.ui.render();
  assert.match(text(tree),/jr.effectiveDuration/);assert.match(text(tree),/hr.boostUntil/);assert.equal(button(component(tree,active.Dialog).props.footer,'hr.activateBoost'),undefined);active.ui.unmount();
});

test('menu groups valid actions, flips above bottom row, supports keyboard and preserves package return context',async()=>{
  const doc=events(),win={...events(),innerWidth:1200,innerHeight:800};let focused='',status='',copies=0;
  const trigger={getBoundingClientRect:()=>({top:740,bottom:772,right:1180}),focus(){focused='trigger';},contains:()=>false};
  const items=[{focus(){focused='first';}},{focus(){focused='last';}}];
  const menu={getBoundingClientRect:()=>({height:430}),querySelector:()=>items[0],querySelectorAll:()=>items,contains:target=>items.includes(target)};
  doc.activeElement=trigger;doc.body={};
  const ui=host(base+'RecruiterJobActions.tsx','RecruiterJobActions',{'react-dom':{createPortal:tree=>tree},'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerWorkspaceHref:(_,id)=>'/dashboard/recruiter?tab=jobs&companyId='+id,jobDetailHref:id=>'/jobs/'+id},'@/lib/jobCommerce':{packageHref:(id,back)=>'/package/'+id+'?returnTo='+encodeURIComponent(back)},'@/lib/i18n':i18n,'./JobRowIcon':{JobRowIcon:stub}},{document:doc,window:win,attachRefs:tree=>nodes(tree,n=>n.props?.role==='menu').forEach(n=>n.props.ref.current=menu)});
  const props={job:job(),companyId:'company-a',busy:false,policy:policyFn(job(),benefit()),benefitPhase:'ready',triggerRef:{current:trigger},onEdit(){},onReviewPublish(){},onStatus:s=>status=s,onDuplicate(){},onBoost(){},onCopy(){copies++;},onRetry(){}};
  let tree=await ui.render(props);nodes(tree,n=>n.props?.['aria-haspopup']==='menu')[0].props.onClick();tree=await ui.render();
  const popup=nodes(tree,n=>n.props?.role==='menu')[0];assert.ok(popup.props.style.top<740);assert.ok(popup.props.style.top+430<=800);assert.equal(focused,'first');
  doc.activeElement=items[1];focused='last';tree=await ui.render({...props,benefitPhase:'loading'});assert.equal(focused,'last','A benefit refresh must not steal keyboard focus');tree=await ui.render(props);
  assert.equal(nodes(tree,n=>n.props?.role==='group').length,3);assert.doesNotMatch(text(tree),/rw.applicants/);assert.match(text(tree),/jr.copyLink/);assert.match(text(tree),/rec.pause/);assert.doesNotMatch(text(tree),/rw.reviewPublish|rec.resumeJob|rec.reopen|hr.duplicateJob/);
  const pkg=nodes(tree,n=>n.props?.href?.startsWith('/package/'))[0];assert.match(decodeURIComponent(pkg.props.href),/companyId=company-a/);
  doc.emit('keydown',{key:'End',preventDefault(){}});assert.equal(focused,'last');doc.emit('keydown',{key:'Escape',preventDefault(){}});tree=await ui.render();assert.equal(focused,'trigger');assert.equal(nodes(tree,n=>n.props?.role==='menu').length,0);
  tree=await ui.render({...props,job:job({status:'EXPIRED'}),policy:policyFn(job({status:'EXPIRED'}),benefit())});nodes(tree,n=>n.props?.['aria-haspopup']==='menu')[0].props.onClick();tree=await ui.render();assert.match(text(tree),/commerce.renew|hr.duplicateJob/);assert.doesNotMatch(text(tree),/rw.reviewPublish|rec.resumeJob|rec.reopen|jr.copyLink/);ui.unmount();
});

test('dialog traps focus, blocks Escape during activation, restores focus and releases body scrolling',async()=>{
  const doc=events();let focused='',closed=0;
  const first={focus(){focused='first';},getClientRects:()=>[{}]},last={focus(){focused='last';},getClientRects:()=>[{}]};
  const previous={isConnected:true,focus(){focused='previous';}};
  const panel={focus(){focused='panel';},querySelectorAll:()=>[first,last],contains:target=>[first,last,panel].includes(target)};
  doc.activeElement=previous;doc.body={style:{overflow:'auto'}};
  const ui=host(base+'JobRowDialog.tsx','JobRowDialog',{'react-dom':{createPortal:tree=>tree},'@/lib/i18n':i18n,'./JobRowIcon':{JobRowIcon:stub}},{document:doc,attachRefs:tree=>nodes(tree,n=>n.props?.role==='dialog').forEach(n=>n.props.ref.current=panel)});
  const props={title:'Details',children:'Fixture',busy:false,onClose(){closed++;},returnFocus:{current:previous}};
  await ui.render(props);assert.equal(focused,'panel');assert.equal(doc.body.style.overflow,'hidden');
  doc.activeElement=last;doc.emit('keydown',{key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(focused,'first');
  doc.activeElement=first;doc.emit('keydown',{key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(focused,'last');
  await ui.render({...props,busy:true});doc.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(closed,0);
  await ui.render(props);doc.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(closed,1);
  ui.unmount();assert.equal(doc.body.style.overflow,'auto');assert.equal(focused,'previous');assert.equal(doc.listeners.get('keydown').size,0);
});
