const {test}=require('node:test'),assert=require('node:assert/strict');
const {host,nodes,text}=require('./lib/react-hook-host.cjs');
const translate=key=>key,i18n={useI18n:()=>({t:translate,locale:'id'}),useEnumLabel:()=>((_,value)=>value)};
const stub=()=>null,connection={enabled:true,sharingEnabled:true,connected:true,status:'CONNECTED',displayName:'Fixture HR',expiresAt:new Date(Date.now()+86400000).toISOString(),autoShareEnabled:false};
const preview={id:'approval',caption:'Server-approved caption',jobUrl:'https://jobs.example.com/id/jobs/job',posterDataUrl:'data:image/png;base64,synthetic',expiresAt:new Date(Date.now()+1800000).toISOString()};
const props={jobId:'job',title:'Engineer',companyName:'Company',draftKey:'draft-a'};
function dependencies(api,extra={}){return {'@/lib/api':{api:(route,options)=>route.startsWith('/benefits/jobs/')?Promise.resolve({code:'PREMIUM',selected:true,expiresAt:new Date(Date.now()+86400000).toISOString()}):api(route,options)},'@/lib/jobCommerce':{packageHref:id=>'/dashboard/recruiter/jobs/'+id+'/package'},'@/lib/i18n':i18n,'@/lib/navigation':{Link:stub,localeUrl:(locale,href)=>'/'+locale+href},'@/lib/linkedin':{linkedInActionError:()=> 'li.actionFailed',activeLinkedInPost:post=>['PENDING','RENDERING','UPLOADING','PUBLISHING'].includes(post.status)},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'./LinkedInPostStatus':{useLinkedInPosts:()=>({posts:[],error:'',reload(){}}),LinkedInPostStatus:stub},...extra};}
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
test('sharing waits for an exact server preview; changed drafts and expiry invalidate approval',async()=>{
  const approvals=[],intents=[],requests=[];let finish;
  const api=async(route,options)=>{requests.push({route,options});return route==='/integrations/linkedin'?connection:new Promise(resolve=>finish=resolve);};
  const ui=host('apps/web/src/components/recruiter/LinkedInSharePreview.tsx','LinkedInSharePreview',dependencies(api));
  const p={...props,onApprovalChange:id=>approvals.push(id),onShareIntentChange:value=>intents.push(value)};
  let tree=await ui.render(p);nodes(tree,node=>node.type==='input'&&node.props.type==='checkbox')[0].props.onChange({target:{checked:true}});tree=await ui.render();assert.equal(intents.at(-1),true);assert.equal(approvals.at(-1),null);
  finish(preview);tree=await ui.render();assert.equal(approvals.at(-1),'approval');assert.equal(nodes(tree,node=>node.type==='img')[0].props.src,preview.posterDataUrl);assert.match(text(tree),/Server-approved caption/);assert.equal(nodes(tree,node=>node.type==='a').length,0);
  tree=await ui.render({...p,draftKey:'draft-b'});assert.equal(approvals.at(-1),null);assert.equal(intents.at(-1),true);assert.equal(nodes(tree,node=>node.type==='img').length,0);
  finish(preview);await ui.render();ui.fireTimers();tree=await ui.render();assert.equal(approvals.at(-1),null);assert.match(text(tree),/li.previewExpired/);assert.equal(requests.filter(row=>row.route.includes('social-posts')&&!row.route.includes('preview')).length,0);ui.unmount();
});
test('connected Premium auto-sharing prepares its preview without an extra click, then authorizes publication',async()=>{
  const approvals=[],intents=[];let finish,previews=0;
  const ui=host('apps/web/src/components/recruiter/LinkedInSharePreview.tsx','LinkedInSharePreview',dependencies(async route=>{if(route==='/integrations/linkedin')return {...connection,autoShareEnabled:true};previews++;return new Promise(resolve=>finish=resolve);}));
  let tree=await ui.render({...props,onApprovalChange:id=>approvals.push(id),onShareIntentChange:value=>intents.push(value)});assert.equal(nodes(tree,node=>node.type==='input'&&node.props.type==='checkbox')[0].props.checked,true);assert.equal(intents.at(-1),true);assert.equal(approvals.at(-1),null);assert.equal(previews,1);
  finish(preview);tree=await ui.render();assert.equal(approvals.at(-1),'approval');assert.equal(previews,1);assert.match(text(tree),/Server-approved caption/);ui.unmount();
});
test('Free jobs cannot inherit Premium sharing intent from an account preference',async()=>{
  const intents=[];
  const api=async route=>route.startsWith('/benefits/jobs/')?{code:'FREE',selected:true,expiresAt:null}:{...connection,autoShareEnabled:true};
  const ui=host('apps/web/src/components/recruiter/LinkedInSharePreview.tsx','LinkedInSharePreview',dependencies(api,{'@/lib/api':{api}}));
  const tree=await ui.render({...props,onShareIntentChange:value=>intents.push(value)});assert.equal(intents.at(-1),false);assert.equal(nodes(tree,node=>node.type==='input'&&node.props.type==='checkbox').length,0);assert.match(text(tree),/commerce.PREMIUM/);ui.unmount();
});
test('a failed automatic preview clears sharing intent so portal publication can continue',async()=>{
  const intents=[];
  const ui=host('apps/web/src/components/recruiter/LinkedInSharePreview.tsx','LinkedInSharePreview',dependencies(async route=>{if(route==='/integrations/linkedin')return {...connection,autoShareEnabled:true};throw Error('Synthetic preview outage');}));
  const tree=await ui.render({...props,onShareIntentChange:value=>intents.push(value)});assert.equal(intents.at(-1),false);assert.match(text(tree),/li.actionFailed/);ui.unmount();
});
test('an old preview response cannot authorize changed draft contents',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve),approvals=[];
  const ui=host('apps/web/src/components/recruiter/LinkedInSharePreview.tsx','LinkedInSharePreview',dependencies(async route=>route==='/integrations/linkedin'?connection:pending));
  const p={...props,onApprovalChange:id=>approvals.push(id)};let tree=await ui.render(p);button(tree,'li.prepareSaved').props.onClick();await ui.render();await ui.render({...p,draftKey:'new-draft'});finish(preview);tree=await ui.render();assert.equal(nodes(tree,node=>node.type==='img').length,0);assert.equal(approvals.at(-1),null);ui.unmount();
});
test('UNKNOWN offers no retry and requires explicit feed review before reconciliation',async()=>{
  const requests=[],reload=[];
  const api=async(route,options)=>{requests.push({route,body:JSON.parse(options.body)});return{};};
  const ui=host('apps/web/src/components/recruiter/LinkedInPostStatus.tsx','LinkedInPostStatus',dependencies(api,{'@/lib/accountNavigation':{employerJobHref:()=>'/dashboard/recruiter/jobs/job'}}));
  let tree=await ui.render({post:{id:'uncertain',status:'UNKNOWN',reviewAfter:null},onReload:()=>reload.push(true),onRetry:()=>{throw Error('UNKNOWN must not retry');}});assert.equal(button(tree,'li.retryReview'),undefined);assert.equal(button(tree,'li.confirmNotPublished').props.disabled,true);assert.equal(requests.length,0);
  nodes(tree,node=>node.type==='input'&&node.props.type==='checkbox')[0].props.onChange({target:{checked:true}});tree=await ui.render();assert.equal(button(tree,'li.confirmPublished').props.disabled,false,'an HR who sees the post may confirm it without restricted API access or a technical URN');button(tree,'li.confirmNotPublished').props.onClick();await ui.render();assert.equal(requests.length,1);assert.equal(requests[0].route,'/social-posts/uncertain/reconcile');assert.equal(requests[0].body.outcome,'NOT_PUBLISHED');assert.equal(requests[0].body.feedChecked,true);assert.equal(reload.length,1);ui.unmount();
});
test('an unavailable integration is clearly disabled and cannot pretend to connect',async()=>{
  let connects=0;
  const ui=host('apps/web/src/components/recruiter/LinkedInIntegrationPanel.tsx','LinkedInIntegrationPanel',dependencies(async()=>({...connection,enabled:false,sharingEnabled:false,connected:false,status:'DISCONNECTED'}),{'@/lib/linkedin':{linkedInActionError:()=> 'li.actionFailed',connectLinkedIn:()=>connects++},'@/lib/accountNavigation':{accountReturnHref:()=>null}}),{window:{location:{href:'http://localhost/id/settings#integrations'},history:{state:{},replaceState(){}}}});
  const tree=await ui.render({});assert.equal(button(tree,'li.connect').props.disabled,true);assert.match(text(tree),/li.serviceUnavailable/);assert.equal(connects,0);ui.unmount();
});

test('the actual job editor blocks unreviewed sharing and sends the approved preview with portal publication',async()=>{
  function Share(){}const requests=[],published=[];
  const job={id:'job',status:'DRAFT',updatedAt:'2026-10-26T00:00:00Z',title:'Frontend Developer',description:'Build reliable interfaces with our product team.',workMode:'REMOTE',employmentType:'FULL_TIME',currency:'USD',locale:'id'};
  const ui=host('apps/web/src/components/recruiter/RecruiterJobEditor.tsx','RecruiterJobEditor',{
    '@/lib/api':{api:async(route,options)=>{if(route.startsWith('/benefits/jobs/'))return {selected:true,code:'PREMIUM'};requests.push({route,body:JSON.parse(options.body)});return {...job};}},'@/lib/i18n':i18n,
    '@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/ui/Field':{FormField:stub,LabelText:stub},'@/components/ui/JobTitleInput':{JobTitleInput:stub},'@/components/ui/LocationFields':{LocationFields:stub},'@/components/ui/LookupCombobox':{LookupCombobox:stub},'@/components/employee/WorkspaceIcon':{WorkspaceIcon:stub},'@/components/employee/WorkspacePrimitives':{CompanyMark:stub},
    './ScreeningQuestionsEditor':{ScreeningQuestionsEditor:stub,screeningDraftsFromJob:()=>[]},'./JobLanguageVersions':{JobLanguageVersions:stub},'./LinkedInSharePreview':{LinkedInSharePreview:Share},'./useEmployerUnsaved':{useEmployerUnsaved:()=>()=>{}},'@/lib/jobCommerce':{packageHref:id=>'/dashboard/recruiter/jobs/'+id+'/package'},'@/lib/navigation':{localeUrl:(locale,path)=>'/'+locale+path},'@/lib/accountNavigation':{employerJobHref:id=>'/dashboard/recruiter/jobs/'+id}
  });
  let tree=await ui.render({job,companyId:'company',company:{name:'Fixture Company'},meta:{},initialStep:3,onClose(){},onSaved:async()=>{},onPublished:id=>published.push(id)});
  nodes(tree,node=>node.type===Share)[0].props.onShareIntentChange(true);tree=await ui.render();
  nodes(tree,node=>node.type==='button'&&text(node).trim()==='rec.publish')[0].props.onClick();tree=await ui.render();assert.match(text(tree),/li.previewRequired/);assert.equal(requests.length,0,'unreviewed requested sharing must block publication');
  nodes(tree,node=>node.type===Share)[0].props.onApprovalChange('exact-server-preview');tree=await ui.render();nodes(tree,node=>node.type==='button'&&text(node).trim()==='rec.publish')[0].props.onClick();await ui.render();
  assert.equal(requests[0].route,'/jobs/job');assert.equal(requests[1].route,'/jobs/job/status');assert.equal(requests[1].body.linkedinPreviewId,'exact-server-preview');assert.equal(requests[1].body.status,'PUBLISHED');assert.deepEqual(published,['job']);ui.unmount();
});

test('admin operations shows quota pressure and preserves unavailable usage rather than inventing zero',async()=>{
  function Stat(){}function Alert(){}function Card(){}function Badge(){}
  const data={posts:[{status:'UNKNOWN',_count:{_all:2}}],connections:[],oldestQueuedAt:null,expiring:0,failures:[],daily:[],operations:{available:true,configurationValid:true,day:'2026-10-26',resetAt:'2026-10-27T00:00:00Z',endpoints:[{endpoint:'posts',appLimit:100,memberLimit:10,used:80,requests:80,success:77,httpErrors:3,transportErrors:0,rateLimited:3,averageMs:900,latency:{le250:0,le1000:70,le5000:80,le20000:80}}]},enabled:true,sharingEnabled:true,apiVersion:'202610',generatedAt:'2026-10-26T00:00:00Z'};
  let fail=false;
  const ui=host('apps/admin/src/app/linkedin/page.tsx','default',{'next/link':stub,'@/lib/api':{api:async()=>{if(fail)throw Error('Synthetic metrics outage');return data;}},'@/components/shell/PageHeader':{PageHeader:stub},'@/components/ui/primitives':{Stat,Alert,Card,Badge}});
  let tree=await ui.render({});assert.equal(nodes(tree,node=>node.type===Stat&&node.props.label==='Needs owner review')[0].props.value,2);assert.match(text(nodes(tree,node=>node.type===Alert)[0]),/75%/);assert.equal(nodes(tree,node=>node.type==='button').length,1,'operators must not have an unsafe force-retry action');
  data.operations={...data.operations,available:false,endpoints:[{...data.operations.endpoints[0],used:null,requests:null,success:null,httpErrors:null,transportErrors:null,rateLimited:null,averageMs:null,latency:null}]};ui.fireTimers();tree=await ui.render();assert.match(text(tree),/Unavailable/);assert.match(text(tree),/unavailable while delivery is paused/);
  fail=true;ui.fireTimers();tree=await ui.render();assert.match(text(tree),/last successful refresh/);assert.match(text(tree),/LinkedIn metrics could not be loaded/);ui.unmount();
});

test('LinkedIn confirmation keyboard focus stays in the dialog and returns to its triggering control',async()=>{
  const listeners=new Map();let cancelled=0;
  const doc={body:{style:{overflow:'auto'}},activeElement:null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const control=name=>({name,tabIndex:0,isConnected:true,getClientRects:()=>[{}],focus(){doc.activeElement=this;}});
  const trigger=control('trigger'),cancel=control('cancel'),confirm=control('confirm');doc.activeElement=trigger;
  const modal={...control('modal'),querySelectorAll:()=>[cancel,confirm],contains:element=>[cancel,confirm,modal].includes(element)};
  const ui=host('apps/web/src/components/ui/ConfirmModal.tsx','ConfirmModal',{'@/lib/i18n':i18n},{document:doc,attachRefs(tree){nodes(tree,node=>node.props?.ref).forEach(node=>{node.props.ref.current=node.props.role==='dialog'?modal:node.props.className==='secondary'?cancel:confirm;});}});
  const props={title:'Confirm LinkedIn sharing',message:'Review your approved post',tone:'danger',onCancel:()=>cancelled++,onConfirm(){}};
  await ui.render(props);assert.equal(doc.activeElement,cancel);assert.equal(doc.body.style.overflow,'hidden');
  const key=(name,shiftKey=false)=>{let prevented=false;listeners.get('keydown')({key:name,shiftKey,preventDefault(){prevented=true;}});return prevented;};
  assert.equal(key('Tab',true),true);assert.equal(doc.activeElement,confirm);assert.equal(key('Tab'),true);assert.equal(doc.activeElement,cancel);
  doc.activeElement=trigger;key('Tab');assert.equal(doc.activeElement,cancel,'Tab cannot leave the underlying page focused while the dialog is open');
  key('Escape');assert.equal(cancelled,1);await ui.render({...props,busy:true});key('Escape');assert.equal(cancelled,1,'Escape cannot dismiss a busy action');
  ui.unmount();assert.equal(doc.activeElement,trigger);assert.equal(doc.body.style.overflow,'auto');assert.equal(listeners.size,0);
});
