const {test}=require('node:test');
const assert=require('node:assert/strict');
const {host,nodes,text}=require('./lib/react-hook-host.cjs');
const stub=()=>null,translate=key=>key,router={replace(){},push(){}};
const i18n={useI18n:()=>({locale:'id',t:translate}),useEnumLabel:()=> (_group,value)=>value};
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const events=()=>{const listeners=new Map();return{listeners,visibilityState:'visible',addEventListener(key,fn){if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);},removeEventListener(key,fn){listeners.get(key)?.delete(fn);},emit(key,detail){for(const fn of listeners.get(key)||[])fn({detail});}};};

test('live refresh serializes hints, queues a change during a read, recovers focus/reconnect and cleans up',async()=>{
  const win=events(),doc=events();let tick,requests=0;const first=pending();
  win.setInterval=fn=>{tick=fn;return 1;};win.clearInterval=()=>{tick=null;};
  const ui=host('apps/web/src/lib/useLiveRefresh.ts','useLiveRefresh',{}, {window:win,document:doc,invoke:hook=>hook('applications',async()=>{requests++;if(requests===1)await first.promise;},true,'company-a')});
  await ui.render();win.emit('talentio:resource-changed',{resource:'chat'});assert.equal(requests,0);
  win.emit('talentio:resource-changed',{resource:'applications'});win.emit('talentio:resource-changed',{resource:'applications'});assert.equal(requests,1);
  first.resolve();await ui.render();assert.equal(requests,2,'A change while a read is pending must be read afterwards');
  doc.visibilityState='hidden';tick();await ui.render();assert.equal(requests,2);
  doc.visibilityState='visible';doc.emit('visibilitychange');await ui.render();assert.equal(requests,3);
  win.emit('focus');await ui.render();assert.equal(requests,4);win.emit('talentio:resource-changed');await ui.render();assert.equal(requests,5);
  ui.unmount();assert.equal(win.listeners.get('focus').size,0);assert.equal(doc.listeners.get('visibilitychange').size,0);assert.equal(tick,null);
});

test('employee application resource refreshes all stages without clearing rows and rejects old account/language responses',async()=>{
  let locale='id',refresh,account='candidate',response=[{id:'application',status:'NEW'}];const requests=[];
  const ui=host('apps/web/src/components/employee/WorkspacePrimitives.tsx','useEmployeeResource',{
    '@/lib/api':{getSession:()=>({user:{id:account,role:'EMPLOYEE'}}),api:()=>{const read=pending();requests.push(read);return read.promise;}},
    '@/lib/navigation':{Link:stub,useRouter:()=>router},'@/lib/i18n':{useI18n:()=>({locale,t:translate})},'./WorkspaceIcon':{WorkspaceIcon:stub},
    '@/lib/useLiveRefresh':{useLiveRefresh:(kind,fn,enabled)=>{assert.equal(kind,'applications');assert.equal(enabled,true);refresh=fn;}},
    '@/lib/useSessionIdentity':{useSessionIdentity:()=>account},
  },{invoke:hook=>hook('/applications/mine',true)});
  let tree=await ui.render();requests[0].resolve(response);tree=await ui.render();assert.equal(tree.items[0].status,'NEW');
  for(const status of ['IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN']) {
    const running=refresh();tree=await ui.render();assert.equal(tree.items.length,1);assert.equal(tree.loading,false);
    requests.at(-1).resolve([{id:'application',status}]);await running;tree=await ui.render();assert.equal(tree.items[0].status,status);
  }
  const beforeMutation=refresh();tree.setItems(items=>items.map(item=>({...item,status:'OFFER'})));requests.at(-1).resolve([{id:'application',status:'NEW'}]);await beforeMutation;tree=await ui.render();assert.equal(tree.items[0].status,'OFFER','A background read cannot undo a successful mutation');
  const failing=refresh();requests.at(-1).reject(Error('Temporary failure'));await failing;tree=await ui.render();assert.equal(tree.items.length,1);assert.ok(tree.error,'A failed background refresh exposes an error while retaining the previous rows');
  const recovered=refresh();requests.at(-1).resolve([{id:'application',status:'OFFER'}]);await recovered;tree=await ui.render();assert.equal(tree.error,'');
  const late=refresh();locale='uz';tree=await ui.render();requests.at(-1).resolve([{id:'application',status:'OFFER'}]);tree=await ui.render();
  requests.at(-2).resolve([{id:'application',status:'NEW'}]);await late;tree=await ui.render();assert.equal(tree.items[0].status,'OFFER');
  const switched=refresh();const oldRequest=requests.at(-1);account='other';tree=await ui.render();oldRequest.resolve([{id:'secret',status:'HIRED'}]);await switched;tree=await ui.render();assert.equal(tree.items.length,0);ui.unmount();
});

test('session identity follows same-tab and cross-tab account changes and releases listeners',async()=>{
  let account='candidate-a';const win=events();
  const ui=host('apps/web/src/lib/useSessionIdentity.ts','useSessionIdentity',{'@/lib/api':{getSession:()=>account?{user:{id:account}}:null}},{window:win});
  let value=await ui.render();assert.equal(value,'candidate-a');account='candidate-b';win.emit('storage');value=await ui.render();assert.equal(value,'candidate-b');
  account='';win.emit('jt-session-updated');value=await ui.render();assert.equal(value,'');ui.unmount();assert.equal(win.listeners.get('storage').size,0);
});

function chatHarness() {
  const account={user:{id:'candidate',role:'EMPLOYEE'}},live={};let reader,poster;
  const conversations=['a','b'].map(id=>({id,userAId:'candidate',userBId:'hr-'+id,userA:{id:'candidate',fullName:'Candidate',role:'EMPLOYEE'},userB:{id:'hr-'+id,fullName:'HR '+id,role:'RECRUITER'},isColdOutreach:false,updatedAt:'2026-10-29T10:00:00Z',messages:[]}));
  const list=()=>conversations.map(c=>({...c,messages:[...c.messages]}));
  const ui=host('apps/web/src/components/employee/MessagesWorkspace.tsx','MessagesWorkspace',{
    'next/navigation':{useSearchParams:()=>new URLSearchParams()},'@/lib/navigation':{Link:stub,useRouter:()=>router},'@/lib/accountNavigation':{jobDetailHref:()=>'/job'},'@/lib/i18n':i18n,
    '@/lib/api':{getSession:()=>account,api:async(path,options)=>{if(path==='/chat/conversations')return list();if(options?.method==='POST')return poster(path,options);return reader?reader(path):[];}},
    '@/lib/hr-benefits':{postOnce:(path,body)=>poster(path,{body:JSON.stringify(body)})},
    '@/lib/useSessionIdentity':{useSessionIdentity:()=>account.user.id},
    '@/lib/presence':{usePresence:()=>({}),seedPresence(){}},'@/components/presence/PresenceDot':{PresenceDot:stub},'./WorkspaceIcon':{WorkspaceIcon:stub},
    './WorkspacePrimitives':{ResourceError:stub,SearchField:stub,WorkspaceEmpty:stub,WorkspaceLoading:stub,dateLabel:x=>x},'@/components/recruiter/RecruiterMessageContext':{RecruiterMessageContext:stub},
    '@/lib/useLiveRefresh':{useLiveRefresh:(kind,fn)=>{live[kind]=fn;}},
  });
  return {ui,conversations,live,setRead:fn=>reader=fn,setPost:fn=>poster=fn};
}
const conversationButton=(tree,id)=>nodes(tree,n=>n.type==='button'&&n.key===id)[0];
test('chat shows incoming HR messages and receipts after a live refresh; stale replies never enter another thread',async()=>{
  const h=chatHarness();let tree=await h.ui.render();
  h.setRead(()=>[{id:'first',senderId:'hr-a',body:'Incoming HR message',createdAt:'2026-10-29T10:00:00Z'}]);
  conversationButton(tree,'a').props.onClick();tree=await h.ui.render();assert.match(text(tree),/Incoming HR message/);
  h.setRead(()=>[{id:'first',senderId:'hr-a',body:'Incoming HR message',createdAt:'2026-10-29T10:00:00Z'},{id:'second',senderId:'hr-a',body:'HR live update',createdAt:'2026-10-29T10:01:00Z'}]);
  await h.live.chat();tree=await h.ui.render();assert.match(text(tree),/HR live update/);
  const late=pending();h.setRead(()=>late.promise);const reading=h.live.chat();
  h.setRead(()=>[{id:'b-first',senderId:'hr-b',body:'Other HR thread',createdAt:'2026-10-29T10:00:00Z'}]);conversationButton(tree,'b').props.onClick();tree=await h.ui.render();
  late.resolve([{id:'stale',senderId:'hr-a',body:'STALE PRIVATE MESSAGE',createdAt:'2026-10-29T10:00:00Z'}]);await reading;tree=await h.ui.render();assert.match(text(tree),/Other HR thread/);assert.doesNotMatch(text(tree),/STALE PRIVATE MESSAGE/);h.ui.unmount();
});
test('chat blocks double submit, preserves a failed draft and a late polling response cannot erase a sent message',async()=>{
  const h=chatHarness();let tree=await h.ui.render();conversationButton(tree,'a').props.onClick();tree=await h.ui.render();
  nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Employee reply'}});tree=await h.ui.render();
  const sent=pending();let writes=0;h.setPost(()=>{writes++;return sent.promise;});const form=nodes(tree,n=>n.type==='form')[0];
  form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});assert.equal(writes,1);
  const old=pending();h.setRead(()=>old.promise);const polling=h.live.chat();
  sent.resolve({id:'sent',senderId:'candidate',body:'Employee reply',createdAt:'2026-10-29T10:02:00Z'});tree=await h.ui.render();assert.match(text(tree),/Employee reply/);
  old.resolve([]);await polling;tree=await h.ui.render();assert.match(text(tree),/Employee reply/);assert.equal(nodes(tree,n=>n.type==='textarea')[0].props.value,'');
  nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Keep my draft'}});tree=await h.ui.render();h.setPost(async()=>{throw Error('Offline');});
  nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=await h.ui.render();assert.equal(nodes(tree,n=>n.type==='textarea')[0].props.value,'Keep my draft');h.ui.unmount();
});
