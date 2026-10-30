const {test}=require('node:test');
const assert=require('node:assert/strict');
const {host,nodes,text}=require('./lib/react-hook-host.cjs');
function events(){const listeners=new Map();return {addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},emit(k,event){listeners.get(k)?.forEach(fn=>fn(event));}};}
test('promotion badge supports package/boost states, portal, Escape, outside click and focus',async()=>{
  const document={...events(),body:{}},window={...events(),innerWidth:390,innerHeight:800};let focused=0;
  class Element {contains(node){return this===node;}}
  const trigger=Object.assign(new Element(),{getBoundingClientRect:()=>({left:330,top:760,bottom:782}),focus(){focused++;}});
  const panel=Object.assign(new Element(),{offsetHeight:90});
  const render=host('apps/web/src/components/jobs/PromotionBadge.tsx','PromotionBadge',{
    'react-dom':{createPortal:child=>child},'@/lib/i18n':{useI18n:()=>({t:key=>key})},
  },{document,window,Node:Element,attachRefs(tree){nodes(tree,node=>node.props?.ref).forEach(node=>{node.props.ref.current=node.type==='button'?trigger:panel;});}});
  assert.equal(await render.render({promotion:null}),null);
  assert.equal(await render.render({promotion:{active:false,boostActive:false,revalidateAt:null}}),null);
  let tree=await render.render({promotion:{active:true,boostActive:false,revalidateAt:null}});
  let button=nodes(tree,n=>n.type==='button')[0];assert.equal(text(button).trim(),'job.promoted');
  button.props.onClick();tree=await render.render();
  const tooltip=nodes(tree,n=>n.props?.role==='tooltip')[0];assert.ok(tooltip);
  assert.ok(tooltip.props.style.left>=16&&tooltip.props.style.left+288<=390-16);assert.ok(tooltip.props.style.top<760,'bottom row opens upward');
  assert.equal(nodes(tree,n=>n.type==='button')[0].props['aria-expanded'],true);
  document.emit('keydown',{key:'Escape'});tree=await render.render();assert.equal(focused,1);assert.equal(nodes(tree,n=>n.props?.role==='tooltip').length,0);
  nodes(tree,n=>n.type==='button')[0].props.onClick();await render.render();document.emit('pointerdown',{target:new Element()});tree=await render.render();assert.equal(nodes(tree,n=>n.props?.role==='tooltip').length,0);
  nodes(tree,n=>n.type==='button')[0].props.onClick();await render.render();document.emit('focusin',{target:new Element()});tree=await render.render();assert.equal(nodes(tree,n=>n.props?.role==='tooltip').length,0);
  assert.equal(await render.render({promotion:{active:true,boostActive:true,revalidateAt:'2000-01-01'}}),null);
  render.unmount();
});
test('refresh deadlines survive long timeouts, recent focus and hidden tabs, and clean up',async()=>{
  let now=Date.now(),calls=0,id=0;const timers=new Map();
  class Clock extends Date {static now(){return now;}}
  const document={...events(),visibilityState:'visible'};
  const window={...events(),setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimeout(key){timers.delete(key);}};
  const hook=host('apps/web/src/lib/usePromotionRefresh.ts','usePromotionRefresh',{}, {document,window,Date:Clock,invoke(fn,props){fn(props.rows,()=>calls++);return null;}});
  const deadline=now+30*86400000;
  await hook.render({rows:[{promotion:{active:true,boostActive:false,revalidateAt:new Date(deadline).toISOString()}}]});
  assert.equal([...timers.values()][0].delay,2147483647);
  now+=2147483647;const first=[...timers.values()][0];timers.clear();first.fn();assert.equal(calls,0);assert.equal(timers.size,1);
  now=deadline-100;window.emit('focus');assert.equal(calls,1);
  now=deadline+50;const last=[...timers.values()][0];timers.clear();last.fn();assert.equal(calls,2,'deadline cannot be dropped by the focus debounce');
  document.visibilityState='hidden';window.emit('focus');assert.equal(calls,2);
  now+=1000;document.visibilityState='visible';document.emit('visibilitychange');assert.equal(calls,3);
  hook.unmount();assert.equal(timers.size,0);
});
