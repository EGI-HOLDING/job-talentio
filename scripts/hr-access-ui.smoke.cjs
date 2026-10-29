// Execute the real client components with a small hook host. No browser session,
// personal account, network request or business database is used.
const { test } = require('node:test');
require('./journey-sync-ui.smoke.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const ts = requireWeb('typescript');
const React = requireWeb('react');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function host(file, exportName, dependencies, globals = {}) {
  let cursor = 0,
    dirty = true,
    tree,
    props,
    component;
  const cells = [],
    effects = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [
        cells[index],
        (value) => {
          const next = typeof value === 'function' ? value(cells[index]) : value;
          if (!Object.is(next, cells[index])) {
            cells[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (cells[index] ||= { current: initial });
    },
    useMemo(run) {
      return run();
    },
    useEffect(effect, deps) {
      const index = cursor++,
        previous = cells[index];
      if (!previous || !deps || deps.some((v, i) => !Object.is(v, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          cells[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      URLSearchParams,
      AbortSignal,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      clearInterval() {},
      ...globals,
      require(name) {
        if (name === 'react') return hooks;
        if (name === '@job-talentio/shared') return requireWeb(name);
        if (name === 'react/jsx-runtime') return requireWeb(name);
        if (name in dependencies) return dependencies[name];
        if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
        if (name === '@/lib/useLiveRefresh') return { useLiveRefresh() {} };
        throw Error('Unexpected dependency: ' + name);
      },
    },
    { filename: file },
  );
  component = module.exports[exportName];
  return {
    exports: module.exports,
    async render(next = props) {
      props = next;
      dirty = true;
      for (let cycle = 0; cycle < 20; cycle++) {
        if (dirty) {
          dirty = false;
          cursor = 0;
          tree = component(props);
        }
        effects.splice(0).forEach((run) => run());
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty && !effects.length) return tree;
      }
      throw Error('Component did not settle');
    },
    unmount() {
      cells.forEach((cell) => cell?.cleanup?.());
    },
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function visibleText(tree) {
  if(Array.isArray(tree))return tree.map(visibleText).join(' ');
  if(typeof tree==='string'||typeof tree==='number')return String(tree);
  return tree&&typeof tree==='object'?visibleText(tree.props?.children):'';
}
const t = {
  useI18n: () => ({ t: (key) => key, locale: 'en' }),
  useEnumLabel: () => (_, value) => value,
};
class ApiError extends Error {}

const row = (id='app', extra={}) => ({id,jobPostId:'job',status:'NEW',kanbanEnteredAt:null,canAddToKanban:true,hasResumeFile:true,createdAt:'2026-10-25',profile:{id:'profile-'+id,user:{id:'user-'+id,fullName:'Fixture applicant'},headline:'Fixture occupation',city:{name:'Fixture city'}},...extra});
function applicantDependencies(api, extra={}) {
  const stub=()=>null;
  return {'@/lib/api':{api},'@/lib/i18n':t,'@/components/employee/WorkspaceIcon':{WorkspaceIcon:stub},'./ApplicantFilters':{ApplicantFilters:stub},'./RecruiterPrimitives':{RecruiterAvatar:stub},'./ApplicationActions':{KanbanAction:stub,ApplicationCvAction:stub},'./ApplicationDetail':{ApplicationDetail:stub},'@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceEmpty:stub,WorkspaceLoading:stub},...extra};
}
test('Applicants uses applications, ranks across pages and does not render score assessments',async()=>{
  const requests=[];function Detail(){} function Filters(){}
  const ui=host('apps/web/src/components/recruiter/JobApplicants.tsx','JobApplicants',applicantDependencies(async route=>{requests.push(route);const q=new URL(route,'http://local').searchParams;return {items:[row('app',{matchScore:87,matchBreakdown:{assessable:true,total:87}})],total:35,page:Number(q.get('page'))};},{'./ApplicationDetail':{ApplicationDetail:Detail},'./ApplicantFilters':{ApplicantFilters:Filters}}));
  let tree=await ui.render({jobId:'job',companyId:'company',meta:{},applicationId:'notification-off-page',onChanged(){}});
  assert.equal(nodes(tree,n=>n.type===Detail)[0].props.applicationId,'notification-off-page');
  const settle=async()=>{await new Promise(r=>setTimeout(r,230));tree=await ui.render();return new URL(requests.at(-1),'http://local');};
  let url=await settle();assert.equal(url.pathname,'/applications/jobs/job/search');assert.equal(url.searchParams.get('sort'),'match');assert.equal(url.searchParams.get('limit'),'10');assert.equal(url.searchParams.has('excludeApplied'),false);
  assert.deepEqual(nodes(tree,n=>n.type==='th').map(n=>n.props.children),['ranking.rank','applicants.person','ranking.position','ranking.location','status','rw.actions']);
  assert.doesNotMatch(visibleText(tree),/87|ranking.outOf100|Required skills/);
  nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='ew.nextPage')[0].props.onClick();await ui.render();await settle();assert.equal(nodes(nodes(tree,n=>n.type==='tbody')[0],n=>n.type==='td')[0].props.children,'11');
  nodes(tree,n=>n.type==='input'&&n.props.type==='search')[0].props.onChange({target:{value:'Fixture'}});await ui.render();url=await settle();assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('q'),'Fixture');
  nodes(tree,n=>n.type===Filters)[0].props.onApply({country:'indonesia'});await ui.render();url=await settle();assert.equal(url.searchParams.get('country'),'indonesia');
  nodes(tree,n=>n.type==='select'&&n.props['aria-label']==='sortBy')[0].props.onChange({target:{value:'newest'}});await ui.render();await settle();assert.equal(nodes(tree,n=>n.type==='th')[0].props.children,'ranking.rowNumber');
  ui.unmount();
});
test('adding to Kanban is a single direct action, survives retries and ignores stale responses',async()=>{
  const pending=deferred(),requests=[],changes=[];const stub=()=>null;
  const ui=host('apps/web/src/components/recruiter/ApplicationActions.tsx','KanbanAction',{'@/lib/api':{api:route=>{requests.push(route);return pending.promise;}},'@/lib/i18n':t,'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerJobHref:()=>'/dashboard/recruiter/jobs/job?section=kanban&company=company'}});
  const props={application:row(),jobId:'job',companyId:'company',onChanged:v=>changes.push(v)};
  let tree=await ui.render(props);const button=nodes(tree,n=>n.type==='button')[0];button.props.onClick();button.props.onClick();assert.equal(requests.length,1);assert.equal(requests[0],'/applications/app/kanban');
  pending.resolve({id:'app',kanbanEnteredAt:'2026-10-26',canAddToKanban:false});await ui.render();assert.equal(changes.length,1);
  tree=await ui.render({...props,application:{...row(),...changes[0]}});assert.match(nodes(tree,n=>n.props?.href)[0].props.href,/section=kanban.*application=app/);ui.unmount();
});
test('CV action resolves the submitted application file and has no database permission request',async()=>{
  const requests=[],tab={opener:'old',location:{href:''},close(){}};
  const ui=host('apps/web/src/components/recruiter/ApplicationActions.tsx','ApplicationCvAction',{'@/lib/api':{api:async route=>{requests.push(route);return{url:'https://example.test/submitted'};}},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:{open:()=>tab}});
  let tree=await ui.render({application:row()});nodes(tree,n=>n.type==='button')[0].props.onClick();await ui.render();assert.deepEqual(requests,['/applications/app/resume-download']);assert.equal(tab.location.href,'https://example.test/submitted');assert.equal(tab.opener,null);
  tree=await ui.render({application:row('empty',{hasResumeFile:false})});assert.equal(nodes(tree,n=>n.type==='button').length,0);ui.unmount();
});
test('Kanban loads each column independently and preserves loaded pages during live refresh',async()=>{
  const stub=()=>null,requests=[];let refresh;
  const dependencies=applicantDependencies(async route=>{requests.push(route);if(route.includes('/applicants/'))return row('linked',{kanbanEnteredAt:'2026-10-26'});const q=new URL(route,'http://local').searchParams,page=Number(q.get('page'));return {columns:[{status:'NEW',items:Array.from({length:page===1?20:5},(_,i)=>row('p'+page+'-'+i,{kanbanEnteredAt:'2026-10-26'})),total:25,totalPages:2,page,hasMore:page===1}]};},{'@/lib/useLiveRefresh':{useLiveRefresh:(_kind,fn)=>{refresh=fn;}},'@/lib/hr-benefits':{postOnce:async()=>{}},'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerJobHref:()=>'/job'},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/jobs/WorkspaceSelect':{WorkspaceSelect:stub},'@/components/employee/WorkspacePrimitives':{SearchField:stub,WorkspaceEmpty:stub,WorkspaceLoading:stub,dateLabel:()=>''}});
  const ui=host('apps/web/src/components/recruiter/RecruiterPipeline.tsx','RecruiterPipeline',dependencies);
  let tree=await ui.render({embedded:true,meta:{},companyId:'company',companyName:'Company',jobs:[{id:'job'}],selectedJob:'job',applicationId:'linked',applicants:[],templates:[],onReload:async()=>{},onTemplates(){},onFlash(){},onJobChange(){}});
  await new Promise(r=>setTimeout(r,230));tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,21);assert.equal(nodes(tree,n=>n.type==='article'&&n.props['data-active']).length,1);
  nodes(tree,n=>n.type==='button'&&n.props.children==='applicants.loadMore')[0].props.onClick();tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,26);assert.match(requests.at(-1),/status=NEW.*page=2/);assert.doesNotMatch(JSON.stringify(tree),/matchScore|miniScore|\/100/);await refresh();tree=await ui.render();await new Promise(r=>setTimeout(r,230));tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,26,'Live updates preserve page two');ui.unmount();
});

test('application detail keeps the application identity and exposes the same Kanban action without scores',async()=>{
  const stub=()=>null;function Action(){} function Cv(){}
  const ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',{'@/lib/api':{api:async()=>row('review',{matchScore:95,matchBreakdown:{total:95},answers:[],interviews:[]})},'@/lib/i18n':t,'@/lib/navigation':{Link:stub},'@/lib/hr-benefits':{postOnce:async()=>{}},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/profile/ProfileDialog':{ProfileDialog:stub},'@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceLoading:stub,dateLabel:()=>''},'./ApplicationActions':{KanbanAction:Action,ApplicationCvAction:Cv},'./RecruiterPrimitives':{RecruiterAvatar:stub}});
  const tree=await ui.render({applicationId:'review',jobId:'job',companyId:'company',onClose(){},onChanged(){}});
  const action=nodes(tree,n=>n.type===Action)[0];assert.equal(action.props.application.id,'review');assert.equal(action.props.jobId,'job');assert.equal(action.props.companyId,'company');
  assert.equal(nodes(tree,n=>n.type===Cv)[0].props.application.id,'review');
  const profile=nodes(tree,n=>n.props?.href?.startsWith('/candidates/'))[0];const url=new URL(profile.props.href,'http://local');assert.equal(url.searchParams.get('application'),'review');assert.equal(url.searchParams.get('matchJobId'),'job');assert.equal(url.searchParams.get('company'),'company');
  assert.doesNotMatch(visibleText(tree),/95|matchScore|ranking.index|ranking.coverage/);ui.unmount();
});
test('a delayed Kanban response cannot update a different application after navigation',async()=>{
  const result=deferred(),changes=[],stub=()=>null;
  const ui=host('apps/web/src/components/recruiter/ApplicationActions.tsx','KanbanAction',{'@/lib/api':{api:()=>result.promise},'@/lib/i18n':t,'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerJobHref:()=>'/kanban'}});
  const props={application:row('old'),jobId:'job',companyId:'company',onChanged:v=>changes.push(v)};
  let tree=await ui.render(props);nodes(tree,n=>n.type==='button')[0].props.onClick();await ui.render({...props,application:row('new')});result.resolve({kanbanEnteredAt:'2026-10-26'});await ui.render();assert.equal(changes.length,0);ui.unmount();
});

test('job workspace defaults to Applicants, separates Kanban, preserves draft history and blocks unauthorized access', async () => {
  const stub=()=>null;
  function Ranking(){} function Pipeline(){} function Editor(){}
  let section='',job={id:'job',title:'Fixture occupation',companyId:'company',company:{name:'Company'},status:'PUBLISHED',publishedAt:'2026-10-25'};
  let member=true;const remembered=[];
  const dependencies={
    'next/navigation':{useParams:()=>({id:'job'}),useSearchParams:()=>new URLSearchParams(section)},
    '@/lib/navigation':{Link:stub,useRouter:()=>({push(){}})},
    '@/lib/api':{getSession:()=>({user:{role:'RECRUITER'}}),api:async route=>route==='/jobs/job'?job:route==='/jobs/job/translations'?{sourceLocale:'uz',source:{title:'Authored title',description:'Authored description'},questions:[{id:'question',question:'Authored question'}]}:route==='/companies/mine'?(member?[{companyId:'company',company:{name:'Company'}}]:[]):[]},
    '@/lib/accountNavigation':{employerJobHref:(id,section='candidates')=>'/dashboard/recruiter/jobs/'+id+'?section='+section,employerWorkspaceHref:()=>'/dashboard/recruiter?tab=jobs',jobDetailHref:id=>'/jobs/'+id},
    '@/components/employee/WorkspaceIcon':{WorkspaceIcon:stub},'@/lib/i18n':t,'@/lib/location':{localizedJobLocation:()=>''},'@/components/jobs/formatJobSalary':{formatJobSalary:()=>''},
    '@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceLoading:stub,WorkspaceEmpty:stub},
    './RecruiterJobEditor':{RecruiterJobEditor:Editor},'./RecruiterPipeline':{RecruiterPipeline:Pipeline},'./JobApplicants':{JobApplicants:Ranking},
    './RecruiterPrimitives':{rememberCompany:id=>remembered.push(id)},
    './LinkedInSharePreview':{LinkedInSharePreview:stub},'./LinkedInPostStatus':{LinkedInJobSummary:stub},
    './HrBenefits':{JobBenefits:stub},
  };
  let ui=host('apps/web/src/components/recruiter/RecruiterJobWorkspace.tsx','RecruiterJobWorkspace',dependencies),tree=await ui.render({});
  assert.equal(nodes(tree,node=>node.type===Ranking).length,1);assert.equal(nodes(tree,node=>node.type===Pipeline).length,0);
  assert.deepEqual(remembered,['company'],'Opening an authorized job selects its company for subsequent HR navigation');
  section='section=kanban&application=notification-app';tree=await ui.render();
  const pipeline=nodes(tree,node=>node.type===Pipeline)[0];assert.equal(pipeline.props.applicationId,'notification-app');assert.equal(pipeline.props.embedded,true);assert.equal(nodes(tree,node=>node.type===Ranking).length,0);ui.unmount();
  section='';job={...job,questions:[{id:'question',question:'Display translation'}]};ui=host('apps/web/src/components/recruiter/RecruiterJobWorkspace.tsx','RecruiterJobWorkspace',dependencies);tree=await ui.render({});
  nodes(tree,node=>node.type==='button'&&nodes(node,child=>child.props?.kind==='edit').length>0)[0].props.onClick();tree=await ui.render();
  const editor=nodes(tree,node=>node.type===Editor)[0];assert.equal(editor.props.job.title,'Authored title');assert.equal(editor.props.job.description,'Authored description');assert.equal(editor.props.job.locale,'uz');assert.equal(editor.props.job.questions[0].question,'Authored question');ui.unmount();
  section='';job={...job,status:'DRAFT',publishedAt:null};ui=host('apps/web/src/components/recruiter/RecruiterJobWorkspace.tsx','RecruiterJobWorkspace',dependencies);tree=await ui.render({});assert.equal(nodes(tree,node=>node.type===Ranking).length,1);ui.unmount();
  job={...job,status:'PUBLISHED',publishedAt:'2026-10-25'};member=false;const priorRemembered=remembered.length;ui=host('apps/web/src/components/recruiter/RecruiterJobWorkspace.tsx','RecruiterJobWorkspace',dependencies);tree=await ui.render({});assert.equal(nodes(tree,node=>node.type===Ranking).length,0);assert.match(JSON.stringify(tree),/rw.noCompanyHint/);assert.equal(remembered.length,priorRemembered,'Unauthorized jobs cannot change the selected company');ui.unmount();
});

test('CV download is direct, has no unlock/credit UI, and ignores a response after navigation', async () => {
  const urls = [],
    clicks = [],
    requests = [];
  let downloading = deferred();
  const ui = host(
    'apps/web/src/components/recruiter/HrBenefits.tsx',
    'DatabaseCvAccess',
    {
      '@/components/employee/WorkspaceIcon': {WorkspaceIcon:()=>null},
      '@/lib/navigation': {Link:()=>null},
      '@/lib/jobCommerce': {packageHref:id=>'/dashboard/recruiter/jobs/'+id+'/package'},
      '@/lib/i18n': t,
      '@/lib/api': {
        ApiError,
        api: async (route) => {
          requests.push(route);
          return { canReadCv: true };
        },
        apiBlob: (route) => {
          urls.push(route);
          return downloading.promise;
        },
      },
      '@/lib/hr-benefits': {
        postOnce: () => {
          throw Error('CV must not unlock');
        },
      },
    },
    {
      URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
      document: { createElement: () => ({ click: () => clicks.push('download') }) },
    },
  );
  let tree = await ui.render({ profileId: 'candidate', companyId: 'free-company' });
  assert.equal(nodes(tree, (node) => node.type === 'button').length, 1);
  assert.doesNotMatch(JSON.stringify(tree), /unlock|credit|quota|balance/i);
  nodes(tree, (node) => node.type === 'button')[0].props.onClick();
  downloading.resolve({ type: 'application/pdf' });
  await ui.render();
  assert.equal(clicks.length, 1);
  assert.equal(urls[0], '/profiles/candidates/candidate/database-cv?companyId=free-company');
  downloading = deferred();
  tree = await ui.render();
  nodes(tree, (node) => node.type === 'button')[0].props.onClick();
  ui.unmount();
  downloading.resolve({ type: 'application/pdf' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clicks.length, 1, 'Leaving the candidate must cancel the old download result');
  assert.ok(requests.every((route) => route.startsWith('/profiles/')));
});

test('the job editor saves content and questions in one request with its loaded version', async () => {
  const requests = [],
    saved = [];
  const stub = () => null;
  const question = {
    id: 'question',
    question: 'Do you hold a certificate?',
    type: 'YES_NO',
    isRequired: true,
  };
  const draft = {
    id: 'job',
    title: 'A synthetic role',
    description: 'A sufficiently detailed synthetic job description.',
    workMode: 'REMOTE',
    status: 'DRAFT',
    currency: 'IDR',
    updatedAt: '2026-10-25T00:00:00.000Z',
    questions: [question],
  };
  const drafts = (value) => (value.questions || []).map((row) => ({ ...row, answerCount: 0 }));
  const ui = host(
    'apps/web/src/components/recruiter/RecruiterJobEditor.tsx',
    'RecruiterJobEditor',
    {
      '@/lib/api': {
        api: async (route, options) => {
          requests.push({ route, ...options });
          return draft;
        },
      },
      '@/lib/i18n': t,
      '@/lib/navigation': {localeUrl:(locale,href)=>'/'+locale+href},
      '@/lib/accountNavigation': {employerJobHref:id=>'/dashboard/recruiter/jobs/'+id},
      '@/lib/jobCommerce': {packageHref:id=>'/dashboard/recruiter/jobs/'+id+'/package'},
      '@/components/ui/ConfirmProvider': { useConfirm: () => async () => true },
      '@/components/ui/Field': { FormField: stub, LabelText: stub },
      '@/components/ui/JobTitleInput': { JobTitleInput: stub },
      '@/components/ui/LocationFields': { LocationFields: stub },
      '@/components/ui/LookupCombobox': { LookupCombobox: stub },
      '@/components/employee/WorkspaceIcon': { WorkspaceIcon: stub },
      '@/components/employee/WorkspacePrimitives': { CompanyMark: stub },
      './ScreeningQuestionsEditor': {
        ScreeningQuestionsEditor: stub,
        screeningDraftsFromJob: drafts,
      },
      './JobLanguageVersions': { JobLanguageVersions: stub },
      './LinkedInSharePreview': { LinkedInSharePreview: stub },
      './useEmployerUnsaved': { useEmployerUnsaved() {} },
    },
  );
  const tree = await ui.render({
    companyId: 'company',
    company: { name: 'Company' },
    job: draft,
    meta: {},
    onClose() {},
    onSaved: async (value) => saved.push(value),
  });
  const button = nodes(
    tree,
    (node) => node.type === 'button' && node.props.children === 'rw.saveDraft',
  )[0];
  assert.ok(button);
  button.props.onClick();
  await ui.render();
  assert.equal(requests.length, 1, 'Screening must not be saved by a later series of HTTP calls');
  const payload = JSON.parse(requests[0].body);
  assert.equal(requests[0].route, '/jobs/job');
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(payload.expectedUpdatedAt, draft.updatedAt);
  assert.equal(payload.screeningQuestions[0].id, question.id);
  assert.equal(payload.screeningQuestions[0].question, question.question);
  assert.equal(saved.length, 1);
  ui.unmount();
});

for (const [file, name] of [
  ['apps/web/src/lib/hr-benefits.ts', 'web'],
  ['apps/admin/src/lib/operations.ts', 'admin'],
])
  test(
    name +
      ': an uncertain action reuses its key after refresh; a successful new intent gets a new key',
    async () => {
      const storage = new Map(),
        calls = [];
      let fail = true;
      const globals = {
        crypto: require('node:crypto').webcrypto,
        TextEncoder,
        atob,
        sessionStorage: {
          getItem: (key) => storage.get(key) || null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
      };
      const deps = {
        './api': {
          ApiError,
          getSession: () => ({ user: { id: 'actor' } }),
          getToken: () =>
            'header.' +
            Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url') +
            '.signature',
          api: async (_, options) => {
            calls.push(options.headers['Idempotency-Key']);
            if (fail) throw new TypeError('Lost response');
            return { ok: true };
          },
        },
      };
      const load = () => host(file, 'postOnce', deps, globals).exports.postOnce;
      await assert.rejects(() => load()('/test-action', { reason: 'same intent' }));
      fail = false;
      await load()('/test-action', { reason: 'same intent' });
      assert.equal(calls[0], calls[1]);
      await load()('/test-action', { reason: 'same intent' });
      assert.notEqual(calls[1], calls[2]);
      assert.equal(storage.size, 0);
    },
  );

test('company benefits never render a balance or a stale previous company promotion', async () => {
  const second = deferred();
  const ui = host(
    'apps/web/src/components/recruiter/HrBenefits.tsx',
    'CompanyBenefits',
    {
      '@/components/employee/WorkspaceIcon': {WorkspaceIcon:()=>null},
      '@/lib/navigation': {Link:()=>null},
      '@/lib/jobCommerce': {packageHref:id=>'/dashboard/recruiter/jobs/'+id+'/package'},
      '@/lib/i18n': t,
      '@/lib/hr-benefits': {},
      '@/lib/api': {
        ApiError,
        api: async (route) =>
          route.endsWith('/company-a')
            ? {
                companyId: 'company-a',
                featuredUntil: new Date(Date.now() + 86400000).toISOString(),
                remaining: 99,
                credits: [{ capacity: 99 }],
              }
            : second.promise,
      },
    },
    { window: { addEventListener() {}, removeEventListener() {} } },
  );
  const first = await ui.render({ companyId: 'company-a', companySlug: 'alpha' });
  assert.equal(nodes(first, node => node.type === 'time').length, 1);
  assert.doesNotMatch(JSON.stringify(first), /99|balance|credit/i);
  const pending = await ui.render({ companyId: 'company-b', companySlug: 'beta' });
  assert.equal(nodes(pending, node => node.type === 'time').length, 0, 'Do not show the previous company expiry while loading');
  assert.equal(nodes(pending, node => node.props?.role === 'status').length, 1);
  second.resolve({companyId: 'company-b', featuredUntil: null});
  const inactive = await ui.render();
  assert.match(JSON.stringify(inactive), /rw.promotionInactive/);
  assert.equal(nodes(inactive, node => node.type === 'time').length, 0);
  ui.unmount();
});

test('the actual candidate CV tab mounts the direct CV component with company context', async () => {
  function SharedCv() {}
  const remembered=[];
  const stub = () => null;
  const profile = {
    user: { id: 'user', fullName: 'Synthetic Candidate' },
    resumes: [],
    experiences: [],
    educations: [],
    languages: [],
    skills: [],
    certifications: [],
  };
  const ui = host(
    'apps/web/src/components/recruiter/RecruiterCandidate.tsx',
    'RecruiterCandidate',
    {
      'next/navigation': {
        useParams: () => ({ id: 'candidate' }),
        useSearchParams: () => new URLSearchParams('section=cvs&company=free-company'),
      },
      '@/lib/navigation': { Link: stub, useRouter: () => ({ replace() {} }) },
      '@/lib/accountNavigation': { employerJobHref: id => '/dashboard/recruiter/jobs/'+id, employerWorkspaceHref: () => '/dashboard/recruiter?tab=jobs', jobDetailHref: (id) => '/jobs/' + id },
      './HrBenefits': { DatabaseCvAccess: SharedCv },
      '@/lib/i18n': t,
      '@/lib/api': {
        getSession: () => ({ user: { role: 'RECRUITER' } }),
        api: async (route) =>
          route === '/companies/mine'
            ? [{ companyId: 'free-company' }]
            : route.startsWith('/jobs/company/')
              ? []
              : profile,
      },
      '@/lib/presence': { seedPresence() {}, usePresence: () => ({}) },
      '@/components/presence/PresenceDot': { PresenceDot: stub },
      './ApplicationActions': {KanbanAction:stub},
      '@/components/ui/UgcText': { UgcText: stub },
      '@/components/ui/ShareButton': { ShareButton: stub },
      '@/components/employee/WorkspacePrimitives': {
        WorkspaceLoading: stub,
        ResourceError: stub,
        WorkspaceEmpty: stub,
        dateLabel: () => '',
      },
      '@/components/employee/WorkspaceIcon': { WorkspaceIcon: stub },
      './RecruiterPrimitives': {
        RecruiterAvatar: stub,
        JobContextSelect: stub,
        preferredCompany: (rows) => rows[0],
        rememberCompany:id=>remembered.push(id),
      },
    },
  );
  const tree = await ui.render({});
  const components = nodes(tree, (node) => node.type === SharedCv);
  assert.equal(components.length, 1, 'An unused import cannot substitute for a mounted CV action');
  assert.equal(components[0].props.companyId, 'free-company');
  assert.equal(components[0].props.profileId, 'candidate');
  assert.deepEqual(remembered,['free-company'],'An authorized profile keeps the same company when returning to reports or jobs');
  assert.doesNotMatch(JSON.stringify(tree), /hr\.oneAccess|hr\.alreadyUnlocked|hr\.accessBalance/);
  ui.unmount();
});
