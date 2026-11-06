const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/web/package.json')),ts=req('typescript'),React=req('react');const {renderToStaticMarkup}=req('react-dom/server');
function load(file,deps,globals={}){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>name in deps?deps[name]:name==='@/lib/i18n/employeeIntent'?load('apps/web/src/lib/i18n/employeeIntent.ts',deps,globals):req(name),...globals});return module.exports;}
const link=({href,children})=>React.createElement('a',{href},children);
function copy(locale){return load('apps/web/src/lib/i18n/employeeIntent.ts',{'@/lib/i18n':{useI18n:()=>({locale})}});}
test('all v3 unavailable states explain the next action without latest-job fallback or numeric scores',()=>{for(const locale of ['id','en']){const ui=load('apps/web/src/components/jobs/EmployeeRecommendationState.tsx',{'@/lib/navigation':{Link:link},'@/lib/i18n/employeeIntent':copy(locale),'@/lib/i18n':{useI18n:()=>({locale})}});for(const state of ['CV_REQUIRED','CV_PROCESSING','CV_FAILED','EVIDENCE_REVIEW_REQUIRED','PREFERENCES_REQUIRED','PREFERENCES_REVIEW_REQUIRED','NO_ELIGIBLE_JOBS','UNAVAILABLE']){const html=renderToStaticMarkup(React.createElement(ui.EmployeeRecommendationNotice,{state,emptyReason:state==='NO_ELIGIBLE_JOBS'?'NO_ACTIVE_JOBS':undefined}));assert.match(html,/role="status"/);assert.match(html,state==='NO_ELIGIBLE_JOBS'?/mode=exploration/:/mode=all/);assert.doesNotMatch(html,/matchScore|\d+%|latest jobs/i);if(state.startsWith('PREFERENCES'))assert.match(html,/section=preferences/);if(state==='NO_ELIGIBLE_JOBS'&&locale==='id'){assert.match(html,/Belum ada lowongan yang cocok dengan posisi pilihan/);assert.match(html,/Jelajahi lowongan lain/);}}}});

test('related task reasons are shown and exploration cards never render a match claim',()=>{
 const ui=load('apps/web/src/components/jobs/EmployeeRecommendationState.tsx',{'@/lib/navigation':{Link:link},'@/lib/i18n/employeeIntent':copy('id')});
 const insights={version:'employee-intent-v3.2',mode:'PREFERENCES_BASED',evidence:[],relatedTasks:['Mengelola target penjualan tim']};
 const related=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights}));
 assert.match(related,/Tanggung jawab yang beririsan/);
 assert.match(related,/Mengelola target penjualan tim/);
 assert.equal(renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{...insights,mode:'EXPLORATION'}})),'');
});
test('v3 reasons show evidence and uncertainty; old numeric assessments do not render',()=>{const ui=load('apps/web/src/components/jobs/EmployeeRecommendationState.tsx',{'@/lib/navigation':{Link:link},'@/lib/i18n':{useI18n:()=>({locale:'id'})}});assert.equal(renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{version:'employee-evidence-v2',evidence:[]}})),'');const html=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{version:'employee-intent-v3.2',evidence:[{kind:'ROLE',status:'MET'},{kind:'SKILL',label:'Python',status:'MET'},{kind:'EXPERIENCE',required:true,status:'UNKNOWN'}]}}));assert.match(html,/Posisi pilihan sesuai/);assert.match(html,/Python/);assert.match(html,/belum lengkap/);assert.doesNotMatch(html,/\d+%|matchScore|diterima kerja/);});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};const settle=()=>new Promise(r=>setImmediate(r));
function hooks(){let cursor=0;const cells=[],effects=[];return {react:{...React,useState(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return [cells[i],value=>cells[i]=typeof value==='function'?value(cells[i]):value];},useEffect(run,deps=[]){const i=cursor++,old=cells[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){effects.push(()=>{old?.cleanup?.();cells[i]={deps,cleanup:run()};});}}},render(component,props){cursor=0;const tree=component(props);while(effects.length)effects.shift()();return tree;}};}
test('job evidence discards a delayed response after navigation or account change',async()=>{const host=hooks();let identity='employee-a';const requests=[];const listeners=new Map();const component=load('apps/web/src/components/jobs/EmployeeJobMatch.tsx',{'react':host.react,'@/lib/employeePositionPreferences':{employeePositionPreferencesEnabled:true},'@/lib/api':{getSession:()=>({user:{id:identity,role:'EMPLOYEE'}}),api:url=>{const d=deferred();requests.push({url,...d});return d.promise;}},'@/lib/useSessionIdentity':{useSessionIdentity:()=>identity},'@/lib/i18n':{useI18n:()=>({locale:'id'})},'./EmployeeRecommendationState':{EmployeeMatchReasons:()=>null}},{process:{env:{}},window:{addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}}).EmployeeJobMatch;
 host.render(component,{jobId:'old'});host.render(component,{jobId:'new'});requests[1].resolve({matchInsights:{version:'employee-intent-v3.2',marker:'new'}});await settle();assert.equal(host.render(component,{jobId:'new'}).props.insights.marker,'new');requests[0].resolve({matchInsights:{version:'employee-intent-v3.2',marker:'old'}});await settle();assert.equal(host.render(component,{jobId:'new'}).props.insights.marker,'new');
 listeners.get('employee-matching-updated')();host.render(component,{jobId:'new'});const oldAccount=requests.at(-1);identity='employee-b';host.render(component,{jobId:'new'});oldAccount.resolve({matchInsights:{marker:'private-a'}});await settle();assert.equal(host.render(component,{jobId:'new'}).props.insights,null);
});

test('catalog picker supports five positions, duplicates, removal, the ten-position limit and legacy review', () => {
 const host=hooks(); let names=[],ids=[];
 function Input(){return null;}
 const picker=load('apps/web/src/components/onboarding/EmployeePositionPicker.tsx',{
  react:{...host.react,useId:()=> 'positions'}, '@/components/ui/JobTitleInput':{JobTitleInput:Input},
  '@/lib/i18n/employeeIntent':copy('id'), './Onboarding.module.css':{}
 },{document:{getElementById:()=>({focus(){}})}}).EmployeePositionPicker;
 function flatten(tree){return Array.isArray(tree)?tree.flatMap(flatten):React.isValidElement(tree)?[tree,...flatten(tree.props.children)]:[];}
 const render=()=>flatten(host.render(picker,{value:names,selectedIds:ids,onChange:(n,i)=>{names=n;ids=i;}}));
 const input=()=>render().find(el=>el.type===Input).props;
 for(let i=0;i<5;i++)input().onPickPosition({id:'role-'+i,name:'Position '+i});
 assert.equal(input().matchingOnly,true); assert.deepEqual(Array.from(ids),Array.from({length:5},(_,i)=>'role-'+i));
 input().onPickPosition({id:'role-0',name:'Duplicate'}); assert.equal(ids.length,5);
 render().find(el=>el.type==='button').props.onClick(); assert.equal(ids.length,4); assert.equal(names[0],'Position 1');
 for(let i=5;i<11;i++)input().onPickPosition({id:'role-'+i,name:'Position '+i});
 assert.equal(ids.length,10); assert.equal(input().disabled,true);
 input().onPickPosition({id:'overflow',name:'Overflow'}); assert.equal(ids.length,10);
 names=['Unmapped legacy'];ids=[];
 input().onPickPosition({id:'reviewed',name:'Reviewed position'});
 assert.deepEqual(Array.from(names),['Reviewed position','Unmapped legacy']); assert.deepEqual(Array.from(ids),['reviewed']);
 assert.ok(render().some(el=>el.props.role==='status'));
 names=['Legacy A','Legacy B'];ids=[];
 render().find(el=>el.props['aria-pressed']===false).props.onClick();
 input().onPickPosition({id:'replacement',name:'Catalog replacement'});
 assert.deepEqual(Array.from(names),['Catalog replacement','Legacy B']);
});

test('v3 always uses the ID picker and preserves unreviewed legacy choices without multiplying them',()=>{
 const helper=load('apps/web/src/lib/employeePositionPreferences.ts',{}, {process:{env:{}}});
 assert.equal(helper.employeePositionPreferencesEnabled,true);
 const old=Array.from({length:10},(_,i)=>'Old '+i);
 const names=helper.positionPreferenceNames({matchingPreferencesReviewed:false,desiredPositions:old,desiredRoles:[{jobTitle:{name:'Translated name'}}]});
 assert.deepEqual(Array.from(names),['Translated name',...old]);
});

test('related recommendations explain relationship and incomplete CV in all supported languages',()=>{
 for(const locale of ['id','en','ru','uz']){
  const ui=load('apps/web/src/components/jobs/EmployeeRecommendationState.tsx',{'@/lib/navigation':{Link:link},'@/lib/i18n/employeeIntent':copy(locale),'@/lib/i18n':{useI18n:()=>({locale})}});
  for(const evidenceState of ['REQUIRED','PROCESSING','FAILED','REVIEW_REQUIRED']){
   const html=renderToStaticMarkup(React.createElement(ui.EmployeeRecommendationNotice,{state:'READY',evidenceState,preferenceWarnings:['PREFERENCES_REVIEW_REQUIRED']}));
   assert.match(html,/section=cvs/);assert.match(html,/section=preferences/);assert.doesNotMatch(html,/undefined|NaN|\d+%/);
  }
  const html=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{version:'employee-intent-v3.2',mode:'PREFERENCES_BASED',evidence:[{kind:'ROLE',code:'RELATED_ROLE',status:'MET',required:false,label:'Chef',evidenceRefs:[]}],reviewExperienceIds:[]}}));
  assert.match(html,/Chef/);assert.doesNotMatch(html,/undefined|NaN|\d+%/);
  for(const emptyReason of ['NO_ACTIVE_JOBS','ALL_APPLIED','UNRECOGNIZED_PREFERENCES','SERVICE_UNAVAILABLE'])assert.match(renderToStaticMarkup(React.createElement(ui.EmployeeRecommendationNotice,{state:'NO_ELIGIBLE_JOBS',emptyReason})),/role="status"/);
 }
});

test('salary uncertainty is a separate feed with its own count, and practical reasons make no offer guarantee',()=>{
 const deps={'@/lib/navigation':{Link:link},'@/lib/i18n/employeeIntent':copy('id')};
 const section=load('apps/web/src/components/jobs/EmployeeSalaryUnverifiedSection.tsx',deps).EmployeeSalaryUnverifiedSection;
 assert.equal(renderToStaticMarkup(React.createElement(section,{total:0})), '');
 const html=renderToStaticMarkup(React.createElement(section,{total:3}));assert.match(html,/mode=salary-unverified/);assert.match(html,/gaji belum dapat dipastikan/);assert.match(html,/\(3\)/);
 const ui=load('apps/web/src/components/jobs/EmployeeRecommendationState.tsx',deps);
 const insights={version:'employee-intent-v3.2',mode:'PERSONALIZED',evidence:[],reviewExperienceIds:[],practicalFit:{active:true,country:'MET',salary:'MET',salaryReason:'UPPER_BOUND_MEETS',group:'MAIN'}};
 const reasons=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights}));assert.match(reasons,/penawaran akhirnya bisa lebih rendah/);assert.doesNotMatch(reasons,/seluruh rentang/i);
 const unknown=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{...insights,practicalFit:{...insights.practicalFit,salary:'UNKNOWN'}}}));assert.match(unknown,/belum dapat dibandingkan/);
 const outside=renderToStaticMarkup(React.createElement(ui.EmployeeMatchReasons,{insights:{...insights,practicalFit:{...insights.practicalFit,country:'UNMET',salary:'UNMET'}}}));assert.match(outside,/di luar negara/);assert.match(outside,/di bawah target/);
 const notice=renderToStaticMarkup(React.createElement(ui.EmployeeRecommendationNotice,{state:'NO_ELIGIBLE_JOBS',emptyReason:'PRACTICAL_PREFERENCES'}));assert.match(notice,/posisi, negara, dan gaji/);assert.match(notice,/mode=exploration/);
});
