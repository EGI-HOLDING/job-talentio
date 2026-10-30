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
    useId() {
      const index = cursor++;
      return (cells[index] ||= 'test-id-' + index);
    },
    useMemo(run, deps = []) {
      const index = cursor++, previous = cells[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) cells[index] = { deps, value: run() };
      return cells[index].value;
    },
    useCallback(callback, deps = []) {
      const index = cursor++, previous = cells[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) cells[index] = { deps, value: callback };
      return cells[index].value;
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
        if (name === '@/lib/useSessionIdentity') return { useSessionIdentity: () => 'test-user' };
        if (name === '@/components/applications/OfferComposer') return { OfferComposer: () => null };
        if (name === '@/components/applications/OfferPacketHistory') return { OfferPacketHistory: () => null };
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
const translate = (key) => key;
const t = {
  useI18n: () => ({ t: translate, locale: 'en' }),
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
test('recruiter job package filter matches confirmed Free, Standard and Premium packages',async()=>{
  function Select(){} function JobRow(){} function Editor(){}
  const jobs=[
    {id:'premium',title:'Premium role',status:'PUBLISHED',createdAt:'2026-10-26',benefit:{code:'PREMIUM',selectionConfirmedAt:'2026-10-26'},_count:{}},
    {id:'standard',title:'Standard role',status:'PUBLISHED',createdAt:'2026-10-25',benefit:{code:'STANDARD',selectionConfirmedAt:'2026-10-25'},_count:{}},
    {id:'free',title:'Free role',status:'PUBLISHED',createdAt:'2026-10-24',benefit:{code:'FREE',selectionConfirmedAt:'2026-10-24'},_count:{}},
    {id:'unselected',title:'Unselected role',status:'DRAFT',createdAt:'2026-10-23',benefit:{code:'FREE',selectionConfirmedAt:null},_count:{}},
  ];
  const ui=host('apps/web/src/components/recruiter/RecruiterJobs.tsx','RecruiterJobs',{
    '@/lib/api':{api:async()=>({})},'@/lib/useLiveRefresh':{useLiveRefresh(){}},'@/lib/navigation':{useRouter:()=>({push(){}})},
    '@/lib/accountNavigation':{employerJobHref:()=>'/job'},'@/lib/i18n':t,'@/components/employee/WorkspaceIcon':{WorkspaceIcon:()=>null},
    '@/components/employee/WorkspacePrimitives':{SearchField:()=>null,WorkspaceEmpty:()=>null,WorkspaceLoading:()=>null,Pagination:()=>null},
    '@/components/jobs/WorkspaceSelect':{WorkspaceSelect:Select},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},
    './RecruiterJobEditor':{RecruiterJobEditor:Editor},'./RecruiterJobRow':{RecruiterJobRow:JobRow},
  });
  const props={companyId:'company',company:{},jobs,loading:false,meta:{},createRequested:false,onCloseCreate(){},onReload:async()=>{},onApplicants(){},onStatus:async()=>{},onFlash(){}};
  let tree=await ui.render(props);
  const packageSelect=()=>nodes(tree,node=>node.type===Select&&node.props.label==='jr.package')[0];
  assert.deepEqual([...packageSelect().props.options].map(option=>option.value),['ALL','PREMIUM','STANDARD','FREE']);
  const visibleJobs=()=>nodes(tree,node=>node.type===JobRow).map(node=>node.props.job.id);
  assert.deepEqual(visibleJobs(),['premium','standard','free','unselected']);
  packageSelect().props.onChange('PREMIUM');tree=await ui.render();assert.deepEqual(visibleJobs(),['premium']);
  packageSelect().props.onChange('STANDARD');tree=await ui.render();assert.deepEqual(visibleJobs(),['standard']);
  packageSelect().props.onChange('FREE');tree=await ui.render();assert.deepEqual(visibleJobs(),['free'],'unselected jobs do not appear as Gratis');
  packageSelect().props.onChange('ALL');tree=await ui.render();assert.deepEqual(visibleJobs(),['premium','standard','free','unselected']);ui.unmount();
});
test('CV action resolves the submitted application file and has no database permission request',async()=>{
  const requests=[],tab={opener:'old',location:{href:''},close(){}};
  const ui=host('apps/web/src/components/recruiter/ApplicationActions.tsx','ApplicationCvAction',{'@/lib/api':{api:async route=>{requests.push(route);return{url:'https://example.test/submitted'};}},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:{open:()=>tab}});
  let tree=await ui.render({application:row()});nodes(tree,n=>n.type==='button')[0].props.onClick();await ui.render();assert.deepEqual(requests,['/applications/app/resume-download']);assert.equal(tab.location.href,'https://example.test/submitted');assert.equal(tab.opener,null);
  tree=await ui.render({application:row('empty',{hasResumeFile:false})});assert.equal(nodes(tree,n=>n.type==='button').length,0);ui.unmount();
});

test('offer composer accepts several documents and submits them through the private multipart endpoint', async () => {
  const uploads = [], sent = [];
  const gate = deferred();
  const FormDataMock = class { entries = []; append(...entry) { this.entries.push(entry); } };
  const ui = host('apps/web/src/components/applications/OfferComposer.tsx', 'OfferComposer', {
    '@/lib/api': { apiUpload: async (route, body, onProgress) => { uploads.push({ route, body }); onProgress(42); return gate.promise; } },
    '@/lib/i18n': t,
    '@/components/profile/ProfileDialog': { ProfileDialog: ({ children }) => children },
  }, { FormData: FormDataMock });
  let tree = await ui.render({ applicationId: 'app-1', candidateName: 'Candidate', jobTitle: 'Data Scientist', onClose() {}, onSent: () => sent.push(true) });
  const dropzone = () => nodes(tree, node => typeof node.props?.onDrop === 'function')[0];
  const files = [
    { name: 'offering.pdf', size: 1024, lastModified: 1 },
    { name: 'benefits.docx', size: 2048, lastModified: 2 },
  ];
  dropzone().props.onDrop({ preventDefault() {}, currentTarget: { dataset: {} }, dataTransfer: { files } });
  tree = await ui.render();
  assert.match(visibleText(tree), /offer\.decisionRule/, 'The composer explains that attachments control who decides the offer');
  assert.match(visibleText(tree), /offering\.pdf/);
  assert.match(visibleText(tree), /benefits\.docx/);
  assert.equal(nodes(tree, node => node.type === 'button' && node.props.children === 'offer.send').length, 1);
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  tree = await ui.render();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].route, '/applications/app-1/offers');
  assert.equal(uploads[0].body.entries.length, 2);
  assert.match(visibleText(tree), /42%/);
  gate.resolve({});
  await new Promise(resolve => setImmediate(resolve));
  await ui.render();
  assert.deepEqual(sent, [true]);
  ui.unmount();
});

test('candidate offer history downloads private documents and accepts only the active offer', async () => {
  const requests = [], opened = [], confirmed = [], decisions = [];
  const pendingPacket = { id: 'packet-1', version: 2, kind: 'OFFER', status: 'PENDING', requiresCandidateDecision: true, createdAt: '2026-10-30T09:00:00.000Z', documents: [{ id: 'doc-1', originalName: 'Offer — Candidate.pdf', contentType: 'application/pdf', sizeBytes: 1024, createdAt: '2026-10-30T09:00:00.000Z' }] };
  const acceptedPacket = { ...pendingPacket, status: 'ACCEPTED', requiresCandidateDecision: false, respondedAt: '2026-10-30T10:00:00.000Z' };
  const ui = host('apps/web/src/components/applications/OfferPacketHistory.tsx', 'OfferPacketHistory', {
    '@/lib/api': { getSession: () => ({ user: { id: 'candidate-user' } }), api: async (route, options) => {
      requests.push({ route, options });
      if (route.endsWith('/offer-packets')) return { packets: [pendingPacket] };
      if (route.endsWith('/download')) return { url: 'https://private-storage.test/signed-document' };
      if (route.endsWith('/offer-decision')) return { application: { status: 'HIRED' }, packet: acceptedPacket };
      throw new Error('Unexpected API request: ' + route);
    } },
    '@/lib/i18n': t,
    '@/lib/useSessionIdentity': { useSessionIdentity: () => 'candidate-user' },
    '@/components/ui/ConfirmProvider': { useConfirm: () => async options => { confirmed.push(options); return true; } },
    '@/lib/useLiveRefresh': { useLiveRefresh() {} },
  }, { window: { open: (url, target) => { const tab = { opener: {}, location: { href: '' }, close() {} }; opened.push({ url, target, tab }); return tab; }, location: { assign: () => assert.fail('Signed document should open in the reserved tab') } } });
  const props = { applicationId: 'app-1', applicationStatus: 'OFFER', audience: 'candidate', onDecision: status => decisions.push(status) };
  let tree = await ui.render(props);
  assert.match(visibleText(tree), /offer.accept/);
  const documentList = () => {
    const component = nodes(tree, node => typeof node.type === 'function' && node.type.name === 'DocumentList')[0];
    assert.ok(component, visibleText(tree));
    return component.type(component.props);
  };
  let documents = documentList();
  assert.match(visibleText(documents), /Offer — Candidate\.pdf/);
  const download = nodes(documents, node => node.type === 'button' && node.props.children === 'offer.download')[0];
  assert.ok(download, visibleText(tree));
  await download.props.onClick();
  tree = await ui.render();
  assert.equal(requests[1].route, '/applications/app-1/offer-packets/packet-1/documents/doc-1/download');
  assert.deepEqual(opened.map(({ url, target }) => ({ url, target })), [{ url: 'about:blank', target: '_blank' }]);
  assert.equal(opened[0].tab.opener, null);
  assert.equal(opened[0].tab.location.href, 'https://private-storage.test/signed-document');
  const accept = nodes(tree, node => node.type === 'button' && node.props.children === 'offer.accept')[0];
  accept.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = await ui.render({ ...props, applicationStatus: 'HIRED' });
  const decisionRequest = requests.find(request => request.route.endsWith('/offer-decision'));
  assert.equal(decisionRequest.options.method, 'POST');
  assert.equal(JSON.parse(decisionRequest.options.body).decision, 'ACCEPT');
  assert.equal(decisions.at(-1), 'HIRED');
  assert.equal(confirmed.at(-1).confirmLabel, 'offer.acceptConfirm');
  assert.match(visibleText(tree), /offer.acceptedOutcome/);
  ui.unmount();
});

test('documentless offers are informational and do not request an employee decision', async () => {
  const ui = host('apps/web/src/components/applications/OfferPacketHistory.tsx', 'OfferPacketHistory', {
    '@/lib/api': { getSession: () => ({ user: { id: 'candidate-user' } }), api: async route => route.endsWith('/offer-packets') ? { packets: [{ id: 'packet-no-docs', version: 1, kind: 'OFFER', status: 'SHARED', requiresCandidateDecision: false, createdAt: '2026-10-30T09:00:00.000Z', documents: [] }] } : {} },
    '@/lib/i18n': t,
    '@/lib/useSessionIdentity': { useSessionIdentity: () => 'candidate-user' },
    '@/components/ui/ConfirmProvider': { useConfirm: () => async () => true },
    '@/lib/useLiveRefresh': { useLiveRefresh() {} },
  });
  const tree = await ui.render({ applicationId: 'app-2', applicationStatus: 'OFFER', audience: 'candidate' });
  assert.match(visibleText(tree), /offer\.status\.OUTSIDE_APP/);
  assert.equal(nodes(tree, node => node.type === 'button' && ['offer.accept', 'offer.decline'].includes(node.props.children)).length, 0);
  const documentList = nodes(tree, node => typeof node.type === 'function' && node.type.name === 'DocumentList')[0];
  assert.ok(documentList);
  assert.match(visibleText(documentList.type(documentList.props)), /offer\.externalDetails/);
  ui.unmount();
});
test('WhatsApp action reveals a phone only on click, uses a bare wa.me link and caches the audited reveal',async()=>{
  const requests=[],tabs=[];
  const windowMock={open:(url,target)=>{assert.equal(url,'about:blank');assert.equal(target,'_blank');const tab={opener:{},location:{href:''},closed:false,close(){this.closed=true;}};tabs.push(tab);return tab;},location:{assign(){assert.fail('A successful popup should be used');}}};
  const ui=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:async(route,options)=>{requests.push({route,options});return{phone:'+6281234567890'};}},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:windowMock});
  const props={profileId:'candidate/a',companyId:'company & one'};
  let tree=await ui.render(props),button=nodes(tree,n=>n.type==='button')[0];assert.equal(button.props['aria-label'],'rec.whatsappChat');assert.equal(button.props.title,'rec.whatsappChat');assert.equal(requests.length,0,'Contact is not revealed before an explicit click');
  button.props.onClick();button.props.onClick();assert.equal(requests.length,1,'Repeated clicks during the request are ignored');
  tree=await ui.render();assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].route,'/profiles/candidates/candidate%2Fa/reveal-contact?companyId=company+%26+one');assert.equal(tabs[0].opener,null);assert.equal(tabs[0].location.href,'https://wa.me/6281234567890');assert.doesNotMatch(tabs[0].location.href,/[?&]text=/);
  button=nodes(tree,n=>n.type==='button')[0];button.props.onClick();tree=await ui.render();assert.equal(requests.length,1,'A previously revealed number is reused during this component session');assert.equal(tabs[1].location.href,'https://wa.me/6281234567890');ui.unmount();
});
test('WhatsApp action localizes missing phone and reveal failures, and falls back when popup is blocked',async()=>{
  const emptyTab={closed:false,location:{href:''},close(){this.closed=true;}},noPhoneWindow={open:()=>emptyTab,location:{assign(){assert.fail('No phone must not navigate to WhatsApp');}}};
  let calls=0;const noPhone=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:async()=>{calls++;throw Error('private API response');}},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:noPhoneWindow});
  let tree=await noPhone.render({profileId:'candidate',companyId:'company',contactRevealed:true,phone:null});nodes(tree,n=>n.type==='button')[0].props.onClick();tree=await noPhone.render();assert.equal(calls,0,'A revealed missing phone does not repeat contact disclosure');assert.equal(emptyTab.closed,true,'The temporary tab closes when no phone is available');assert.match(visibleText(tree),/rec\.whatsappNoPhone/);noPhone.unmount();
  const failedTab={closed:false,location:{href:''},close(){this.closed=true;}},fail=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:async()=>{throw Error('private API response');}},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:{open:()=>failedTab,location:{assign(){}}}});
  tree=await fail.render({profileId:'candidate',companyId:'company'});nodes(tree,n=>n.type==='button')[0].props.onClick();tree=await fail.render();assert.equal(failedTab.closed,true);assert.match(visibleText(tree),/rec\.whatsappFailed/);assert.doesNotMatch(visibleText(tree),/private API response/);fail.unmount();
  const assigned=[],fallback=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:async()=>({phone:'+998901234567'})},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:{open:()=>null,location:{assign:url=>assigned.push(url)}}});
  tree=await fallback.render({profileId:'candidate',companyId:'company'});nodes(tree,n=>n.type==='button')[0].props.onClick();await fallback.render();assert.deepEqual(assigned,['https://wa.me/998901234567']);fallback.unmount();
});
test('WhatsApp URL accepts E.164 only and stale reveals close their temporary tab',async()=>{
  const pending=deferred(),action=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:()=>pending.promise},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}});
  assert.equal(action.exports.whatsAppChatUrl('+12025550123'),'https://wa.me/12025550123');assert.equal(action.exports.whatsAppChatUrl('2025550123'),null);assert.equal(action.exports.whatsAppChatUrl('+0123456789'),null);assert.equal(action.exports.whatsAppChatUrl('+123'),null);
  const tabs=[],windowMock={open:()=>{const tab={location:{href:''},closed:false,close(){this.closed=true;}};tabs.push(tab);return tab;},location:{assign(){assert.fail('Stale reveal must not navigate');}}};
  const stale=host('apps/web/src/components/recruiter/ApplicationActions.tsx','WhatsAppAction',{'@/lib/api':{api:()=>pending.promise},'@/lib/i18n':t,'@/lib/navigation':{Link:()=>null},'@/lib/accountNavigation':{employerJobHref(){}}},{window:windowMock});
  let tree=await stale.render({profileId:'candidate',companyId:'company-a'});nodes(tree,n=>n.type==='button')[0].props.onClick();tree=await stale.render({profileId:'candidate',companyId:'company-b'});pending.resolve({phone:'+6281234567890'});await stale.render();assert.equal(tabs[0].closed,true);assert.equal(tabs[0].location.href,'');stale.unmount();action.unmount();
});
test('Kanban loads each column independently and preserves loaded pages during live refresh',async()=>{
  const stub=()=>null,requests=[];let refresh;
  const dependencies=applicantDependencies(async route=>{requests.push(route);if(route.includes('/applicants/'))return row('linked',{status:'IN_REVIEW',kanbanEnteredAt:'2026-10-26'});const q=new URL(route,'http://local').searchParams,page=Number(q.get('page'));return {columns:[{status:'IN_REVIEW',items:Array.from({length:page===1?20:5},(_,i)=>row('p'+page+'-'+i,{status:'IN_REVIEW',kanbanEnteredAt:'2026-10-26'})),total:25,totalPages:2,page,hasMore:page===1}]};},{'@/lib/useLiveRefresh':{useLiveRefresh:(_kind,fn)=>{refresh=fn;}},'@/lib/hr-benefits':{postOnce:async()=>{}},'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerJobHref:()=>'/job'},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/jobs/WorkspaceSelect':{WorkspaceSelect:stub},'@/components/employee/WorkspacePrimitives':{SearchField:stub,WorkspaceEmpty:stub,WorkspaceLoading:stub,dateLabel:()=>''}});
  const ui=host('apps/web/src/components/recruiter/RecruiterPipeline.tsx','RecruiterPipeline',dependencies);
  let tree=await ui.render({embedded:true,meta:{},companyId:'company',companyName:'Company',jobs:[{id:'job'}],selectedJob:'job',applicationId:'linked',applicants:[],templates:[],onReload:async()=>{},onTemplates(){},onFlash(){},onJobChange(){}});
  await new Promise(r=>setTimeout(r,230));tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,21);assert.equal(nodes(tree,n=>n.type==='article'&&n.props['data-active']).length,1);
  nodes(tree,n=>n.type==='button'&&n.props.children==='applicants.loadMore')[0].props.onClick();tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,26);assert.match(requests.at(-1),/status=IN_REVIEW.*page=2/);assert.doesNotMatch(JSON.stringify(tree),/applicationStatus\.NEW|matchScore|miniScore|\/100/);await refresh();tree=await ui.render();await new Promise(r=>setTimeout(r,230));tree=await ui.render();assert.equal(nodes(tree,n=>n.type==='article').length,26,'Live updates preserve page two');ui.unmount();
});

test('Kanban disables drag and shows a lock reason while a documented offer awaits a response',async()=>{
  const stub=()=>null;
  const locked=row('offer-pending',{status:'OFFER',kanbanEnteredAt:'2026-10-26',candidateDecisionRequired:true});
  const dependencies=applicantDependencies(async route=>route.includes('/applicants/')?locked:{columns:[{status:'OFFER',items:[locked],total:1,totalPages:1,page:1,hasMore:false}]},{
    '@/lib/useLiveRefresh':{useLiveRefresh(){}},'@/lib/hr-benefits':{postOnce:async()=>{}},'@/lib/navigation':{Link:stub},'@/lib/accountNavigation':{employerJobHref:()=>'/job'},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/jobs/WorkspaceSelect':{WorkspaceSelect:stub},'@/components/employee/WorkspacePrimitives':{SearchField:stub,WorkspaceEmpty:stub,WorkspaceLoading:stub,dateLabel:()=>''},
  });
  const ui=host('apps/web/src/components/recruiter/RecruiterPipeline.tsx','RecruiterPipeline',dependencies);
  const tree=await ui.render({embedded:true,meta:{},companyId:'company',companyName:'Company',jobs:[{id:'job'}],selectedJob:'job',applicants:[],templates:[],onReload:async()=>{},onTemplates(){},onFlash(){},onJobChange(){}});
  await new Promise(resolve=>setTimeout(resolve,230));
  const settled=await ui.render();
  const card=nodes(settled,node=>node.type==='article'&&visibleText(node).includes('offer.cardStageLocked'))[0];
  assert.ok(card,'The locked offer is visibly identified on its Kanban card');
  const handle=nodes(card,node=>node.type==='button'&&String(node.props['aria-label']).includes('offer.stageLocked'))[0];
  assert.equal(handle.props.disabled,true);
  assert.match(handle.props['aria-label'],/offer\.stageLocked/);
  ui.unmount();
});


test('application detail keeps the application identity and exposes the same Kanban action without scores',async()=>{
  const stub=()=>null;function Action(){} function Cv(){} function WhatsApp(){}
  const dependencies={'@/lib/api':{api:async()=>row('review',{matchScore:95,matchBreakdown:{total:95},answers:[],interviews:[]})},'@/lib/i18n':t,'@/lib/navigation':{Link:stub},'@/lib/hr-benefits':{postOnce:async()=>{}},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/profile/ProfileDialog':{ProfileDialog:stub},'@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceLoading:stub,dateLabel:()=>''},'./ApplicationActions':{KanbanAction:Action,ApplicationCvAction:Cv,WhatsAppAction:WhatsApp},'./RecruiterPrimitives':{RecruiterAvatar:stub}};
  const ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',dependencies);
  const tree=await ui.render({applicationId:'review',jobId:'job',companyId:'company',onClose(){},onChanged(){}});
  const action=nodes(tree,n=>n.type===Action)[0];assert.equal(action.props.application.id,'review');assert.equal(action.props.jobId,'job');assert.equal(action.props.companyId,'company');
  assert.equal(nodes(tree,n=>n.type===Cv)[0].props.application.id,'review');
  assert.deepEqual({profileId:nodes(tree,n=>n.type===WhatsApp)[0].props.profileId,companyId:nodes(tree,n=>n.type===WhatsApp)[0].props.companyId},{profileId:'profile-review',companyId:'company'});
  const profile=nodes(tree,n=>n.props?.href?.startsWith('/candidates/'))[0];const url=new URL(profile.props.href,'http://local');assert.equal(url.searchParams.get('application'),'review');assert.equal(url.searchParams.get('matchJobId'),'job');assert.equal(url.searchParams.get('company'),'company');
  assert.doesNotMatch(visibleText(tree),/95|matchScore|ranking.index|ranking.coverage/);ui.unmount();
  const withdrawn=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',{...dependencies,'@/lib/api':{api:async()=>row('withdrawn',{status:'WITHDRAWN'})}});
  const withdrawnTree=await withdrawn.render({applicationId:'withdrawn',jobId:'job',companyId:'company',onClose(){},onChanged(){}});assert.equal(nodes(withdrawnTree,n=>n.type===WhatsApp).length,0,'Withdrawn applications hide both chat actions');withdrawn.unmount();
});
test('HR stage control is locked while a documented offer awaits the candidate', async () => {
  const stub=()=>null;
  const locked=row('offer-locked',{status:'OFFER',kanbanEnteredAt:'2026-10-26',candidateDecisionRequired:true,interviews:[]});
  const ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',{
    '@/lib/api':{api:async()=>locked},
    '@/lib/i18n':t,
    '@/lib/navigation':{Link:stub},
    '@/lib/hr-benefits':{postOnce:async()=>{}},
    '@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},
    '@/components/profile/ProfileDialog':{ProfileDialog:({children})=>children},
    '@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceLoading:stub,dateLabel:()=>''},
    './ApplicationActions':{KanbanAction:stub,ApplicationCvAction:stub,WhatsAppAction:stub},
    './RecruiterPrimitives':{RecruiterAvatar:stub},
  });
  const tree=await ui.render({applicationId:'offer-locked',jobId:'job',companyId:'company',onClose(){},onChanged(){}});
  const stage=nodes(tree,node=>node.type==='select'&&node.props.value==='OFFER')[0];
  assert.ok(stage);
  assert.equal(stage.props.disabled,true);
  assert.match(visibleText(tree),/offer\.stageLocked/);
  ui.unmount();
});

test('application detail scopes screening to review and offers repeat interview scheduling only in the Interview stage',async()=>{
  const stub=()=>null,base={profile:{id:'profile-review',user:{id:'employee',fullName:'Fixture applicant'}},kanbanEnteredAt:'2026-10-26',answers:[{id:'answer',question:{question:'Screening fixture question'},answer:'Fixture answer'}],coverLetter:null,interviews:[]};
  const dependencies=(getApplication,postInterview=async()=>{})=>({'@/lib/api':{api:async()=>getApplication()},'@/lib/i18n':t,'@/lib/navigation':{Link:stub},'@/lib/hr-benefits':{postOnce:postInterview},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},'@/components/profile/ProfileDialog':{ProfileDialog:stub},'@/components/employee/WorkspacePrimitives':{ResourceError:stub,WorkspaceLoading:stub,dateLabel:()=> 'Fixture date'},'./ApplicationActions':{KanbanAction:stub,ApplicationCvAction:stub,WhatsAppAction:stub},'./RecruiterPrimitives':{RecruiterAvatar:stub}});
  const props={applicationId:'review',jobId:'job',companyId:'company',onClose(){},onChanged(){}};
  let current={...row('review',base),status:'IN_REVIEW'};
  let ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',dependencies(()=>current));
  let tree=await ui.render(props);assert.match(visibleText(tree),/Screening fixture question/);assert.match(visibleText(tree),/Fixture answer/);assert.equal(nodes(tree,node=>node.type==='form').length,0);assert.equal(nodes(tree,node=>node.type==='button'&&String(node.props.children).includes('rec.schedule')).length,0);ui.unmount();

  current={...row('interview',base),status:'INTERVIEW',interviews:[]};const scheduled=[];let changed=0;
  ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',dependencies(()=>current,async(_path,body)=>{scheduled.push(body);current={...current,interviews:[...current.interviews,{id:'interview-'+scheduled.length,...body,status:'SCHEDULED'}]};return current.interviews.at(-1);}),{FormData:class{get(name){return({scheduledAt:'2030-01-01T10:00',durationMins:'45',meetingUrl:'https://example.test/meeting-next',location:'Fixture room',note:'Next round'})[name]||'';}}});
  tree=await ui.render({...props,applicationId:'interview',onChanged(){changed++;}});assert.doesNotMatch(visibleText(tree),/Screening fixture question|Fixture answer/);assert.equal(nodes(tree,node=>node.type==='article'&&node.props.className==='interviewItem').length,0);
  const open=nodes(tree,node=>node.type==='button'&&node.props.children==='rec.scheduleInterview')[0];assert.ok(open);assert.equal(open.props['aria-expanded'],false);open.props.onClick();tree=await ui.render();const form=nodes(tree,node=>node.type==='form')[0];assert.ok(form);form.props.onSubmit({preventDefault(){},currentTarget:{reset(){}}});tree=await ui.render();
  assert.equal(scheduled.length,1);assert.equal(scheduled[0].durationMins,45);assert.equal(changed,1);assert.equal(nodes(tree,node=>node.type==='form').length,0);assert.equal(nodes(tree,node=>node.type==='article').length,1,'Successful scheduling should refresh the interview history: '+visibleText(tree));assert.ok(nodes(tree,node=>node.type==='button'&&node.props.children==='rec.scheduleNextInterview')[0]);assert.doesNotMatch(visibleText(tree),/Interview 1|Interview 2|Wawancara 1|Wawancara 2/);ui.unmount();

  current={...row('later',{...base,interviews:[{id:'cancelled',scheduledAt:'2026-10-27T10:00:00.000Z',status:'CANCELLED',durationMins:45}]}),status:'OFFER'};
  ui=host('apps/web/src/components/recruiter/ApplicationDetail.tsx','ApplicationDetail',dependencies(()=>current));tree=await ui.render({...props,applicationId:'later'});assert.doesNotMatch(visibleText(tree),/Screening fixture question|Fixture answer|rec.scheduleInterview|rec.scheduleNextInterview/);assert.equal(nodes(tree,node=>node.type==='article').length,1);assert.equal(nodes(tree,node=>node.type==='form').length,0);ui.unmount();
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
  assert.doesNotMatch(visibleText(first), /99|balance|credit/i);
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
  function SharedCv() {} function SharedWhatsApp() {}
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
      './ApplicationActions': {KanbanAction:stub,WhatsAppAction:SharedWhatsApp},
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
  const whatsApp = nodes(tree, (node) => node.type === SharedWhatsApp);
  assert.equal(whatsApp.length, 1, 'The recruiter candidate profile exposes the shared WhatsApp action beside internal chat');
  assert.deepEqual({profileId:whatsApp[0].props.profileId,companyId:whatsApp[0].props.companyId,contactRevealed:whatsApp[0].props.contactRevealed},{profileId:'candidate',companyId:'free-company',contactRevealed:false});
  assert.deepEqual(remembered,['free-company'],'An authorized profile keeps the same company when returning to reports or jobs');
  assert.doesNotMatch(JSON.stringify(tree), /hr\.oneAccess|hr\.alreadyUnlocked|hr\.accessBalance/);
  ui.unmount();
});
