const {test}=require('node:test'),assert=require('node:assert/strict');
const {host,nodes,text}=require('./lib/react-hook-host.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(request){
  let id='order-a';const stub=()=>null,redirects=[];
  const ui=host('apps/web/src/components/recruiter/JobCheckout.tsx','JobCheckout',{
    'next/navigation':{useParams:()=>({orderId:id}),useSearchParams:()=>new URLSearchParams()},
    '@/lib/navigation':{Link:stub,useRouter:()=>({replace:value=>redirects.push(value)})},
    '@/lib/api':{api:request},'@/lib/i18n':{useI18n:()=>({t:key=>key,locale:'id'})},
    '@/lib/jobCommerce':{commerceReturn:()=>'/dashboard/recruiter',money:String,packageHref:()=>'/package'},
    '@/components/employee/WorkspacePrimitives':{WorkspaceLoading:stub},
  },{window:{location:{assign:value=>redirects.push(value)}}});
  return {ui,redirects,change:value=>id=value};
}
const order=(id,status='PENDING')=>({id,jobId:'job-'+id,status,code:'STANDARD',amount:149000,currency:'IDR',jobTitle:'Role '+id,companyName:'Company'});
const catalog={testMode:true,paymentAvailable:false};
const btn=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node).includes(label))[0];
test('a failed status request retries and reaches PAID without reload',async()=>{
  let reads=0;
  const x=setup(async route=>{if(route.endsWith('/catalog'))return catalog;reads++;if(reads===2)throw Error('Temporary offline');return order('order-a',reads>=3?'PAID':'PENDING');});
  let tree=await x.ui.render();assert.ok(btn(tree,'commerce.testContinue'));
  x.ui.fireTimers();await x.ui.render();assert.equal(reads,2);
  x.ui.fireTimers();tree=await x.ui.render();assert.equal(reads,3);assert.match(text(tree),/commerce.success/);
  x.ui.fireTimers();await x.ui.render();assert.equal(reads,3,'terminal orders stop polling');x.ui.unmount();
});
test('an in-flight poll cannot replace a new order and cannot schedule after unmount',async()=>{
  const delayed=deferred();let firstReads=0;
  const x=setup(async route=>route.endsWith('/catalog')?catalog:route.endsWith('order-a')?(++firstReads===1?order('order-a'):delayed.promise):order('order-b'));
  await x.ui.render();x.ui.fireTimers();await x.ui.render();x.change('order-b');let tree=await x.ui.render();assert.match(text(tree),/Role order-b/);
  delayed.resolve(order('order-a','PAID'));tree=await x.ui.render();assert.doesNotMatch(text(tree),/commerce.success|Role order-a/);assert.match(text(tree),/Role order-b/);
  x.ui.unmount();x.ui.fireTimers();assert.equal(firstReads,2);
});
test('a delayed pay action cannot show success or redirect on a different order',async()=>{
  const delayed=deferred();
  const x=setup(async(route,options)=>route.endsWith('/catalog')?catalog:options?.method==='POST'?delayed.promise:order(route.split('/').at(-1)));
  let tree=await x.ui.render();const paying=btn(tree,'commerce.testContinue').props.onClick();await x.ui.render();
  x.change('order-b');tree=await x.ui.render();assert.match(text(tree),/Role order-b/);
  delayed.resolve(order('order-a','PAID'));await paying;tree=await x.ui.render();assert.doesNotMatch(text(tree),/commerce.success/);assert.match(text(tree),/Role order-b/);assert.deepEqual(x.redirects,[]);x.ui.unmount();
});
test('a delayed cancel cannot cancel the next order',async()=>{
  const delayed=deferred();const x=setup(async(route,options)=>route.endsWith('/catalog')?catalog:options?.method==='POST'?delayed.promise:order(route.split('/').at(-1)));
  let tree=await x.ui.render();const cancelling=btn(tree,'commerce.cancelOrder').props.onClick();x.change('order-b');await x.ui.render();
  delayed.resolve(order('order-a','CANCELLED'));await cancelling;tree=await x.ui.render();assert.ok(btn(tree,'commerce.testContinue'));assert.match(text(tree),/Role order-b/);x.ui.unmount();
});
