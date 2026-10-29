const {test} = require('node:test');
const assert = require('node:assert/strict');
const {host, nodes, text} = require('./lib/react-hook-host.cjs');
const stub = () => null;
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const i18n = {useI18n: () => ({t: key => key, locale: 'id'}), useEnumLabel: () => (_, value) => value};
const button = (tree, label) => nodes(tree, n => n.type === 'button' && text(n).trim() === label)[0];
class ApiError extends Error { constructor(status) { super('API failed'); this.status = status; } }
const ticket = (id, extra = {}) => ({id, title: 'Question ' + id, status: 'OPEN', priority: false, createdAt: '2026-10-29T00:00:00Z', ...extra});
const thread = id => ({...ticket(id), total: 1, replies: [{id: id + '-reply', body: 'Message for ' + id, authorRole: 'RECRUITER', createdAt: '2026-10-29T00:00:00Z'}]});
function support(api, postOnce = async () => {}, guard = async () => true) {
  function Pagination() {}
  const ui = host('apps/web/src/components/recruiter/HrSupport.tsx', 'HrSupport', {
    '@/lib/api': {api, ApiError}, '@/lib/hr-benefits': {postOnce}, '@/lib/i18n': i18n,
    '@/components/employee/WorkspaceIcon': {WorkspaceIcon: stub},
    '@/components/employee/WorkspacePrimitives': {Pagination, WorkspaceLoading: stub, dateLabel: value => value},
    './useEmployerUnsaved': {useEmployerUnsaved() {}, allowEmployerContextChange: guard},
  });
  return {ui, Pagination};
}
const props = {companyId: 'company-a', companyName: 'Company A'};
const edit = async (ui, tree, selector, value) => { nodes(tree, selector)[0].props.onChange({target: {value}}); return ui.render(); };

test('support starts with an empty inbox, no form and no zero-result pagination; explicit New request opens the composer', async () => {
  const {ui, Pagination} = support(async () => ({items: [], total: 0}));
  let tree = await ui.render(props);
  assert.equal(nodes(tree, n => n.type === 'form').length, 0);
  assert.equal(nodes(tree, n => n.type === Pagination).length, 0);
  button(tree, 'hr.newTicket').props.onClick(); tree = await ui.render();
  assert.equal(nodes(tree, n => n.type === 'form').length, 1);
  assert.equal(nodes(tree, n => n.type === 'input' && n.props.name === 'title').length, 1);
  ui.unmount();
});

test('creating a request preserves company context, trims the draft, blocks duplicate clicks and separates read failures from send success', async () => {
  const send = deferred(), writes = [];
  let created = false;
  const {ui} = support(async route => {
    if (route.startsWith('/hr-support?')) { if (created) throw Error('Read unavailable'); return {items: [], total: 0}; }
    return thread('new-ticket');
  }, async (route, body) => {writes.push({route, body}); await send.promise; created = true; return ticket('new-ticket');});
  let tree = await ui.render(props);
  button(tree, 'hr.newTicket').props.onClick(); tree = await ui.render();
  tree = await edit(ui, tree, n => n.type === 'input' && n.props.name === 'title', '  Posting question  ');
  tree = await edit(ui, tree, n => n.type === 'textarea', '  Please help with this job posting.  ');
  const form = nodes(tree, n => n.type === 'form')[0];
  form.props.onSubmit({preventDefault() {}}); form.props.onSubmit({preventDefault() {}});
  assert.equal(writes.length, 1);
  send.resolve(); tree = await ui.render();
  assert.deepEqual(writes[0].body.companyId, 'company-a');
  assert.equal(writes[0].body.title, 'Posting question');
  assert.equal(writes[0].body.body, 'Please help with this job posting.');
  assert.match(text(tree), /support.sent/);
  assert.doesNotMatch(text(tree), /support.sendFailed/);
  assert.equal(nodes(tree, n => n.type === 'textarea')[0].props.value, '');
  ui.unmount();
});

test('failed writes retain the draft and changing ticket cannot discard it without the context guard', async () => {
  let allow = true;
  const writes = [];
  const {ui} = support(async route => route.startsWith('/hr-support?') ? {items: [ticket('a')], total: 1} : thread('a'), async (...args) => {writes.push(args); throw Error('Uncertain network');}, async () => allow);
  let tree = await ui.render(props);
  button(tree, 'hr.newTicket').props.onClick(); tree = await ui.render();
  tree = await edit(ui, tree, n => n.type === 'input' && n.props.name === 'title', 'Need assistance');
  tree = await edit(ui, tree, n => n.type === 'textarea', 'Preserve this request draft.');
  nodes(tree, n => n.type === 'form')[0].props.onSubmit({preventDefault() {}}); tree = await ui.render();
  assert.match(text(tree), /support.sendFailed/);
  assert.equal(nodes(tree, n => n.type === 'textarea')[0].props.value, 'Preserve this request draft.');
  allow = false;
  nodes(tree, n => n.type === 'button' && n.props['aria-pressed'] !== undefined)[0].props.onClick(); tree = await ui.render();
  assert.equal(nodes(tree, n => n.type === 'input' && n.props.name === 'title')[0].props.value, 'Need assistance');
  assert.equal(writes.length, 1);
  ui.unmount();
});

test('a delayed response from a previous ticket cannot replace the selected conversation', async () => {
  const slow = deferred();
  const {ui} = support(async route => route.startsWith('/hr-support?') ? {items: [ticket('a'), ticket('b')], total: 2} : route.startsWith('/hr-support/a?') ? slow.promise : thread('b'));
  let tree = await ui.render(props);
  const tickets = () => nodes(tree, n => n.type === 'button' && n.props['aria-pressed'] !== undefined);
  tickets()[0].props.onClick(); tree = await ui.render();
  tickets()[1].props.onClick(); tree = await ui.render();
  assert.match(text(tree), /Message for b/);
  slow.resolve(thread('a')); tree = await ui.render();
  assert.match(text(tree), /Message for b/); assert.doesNotMatch(text(tree), /Message for a/);
  ui.unmount();
});

test('resolved filter resets list pagination and the unavailable feature never renders a send form', async () => {
  const requests = [];
  const {ui, Pagination} = support(async route => { requests.push(route); return {items: [ticket('a')], total: 45}; });
  let tree = await ui.render(props);
  nodes(tree, n => n.type === Pagination)[0].props.onChange(2); tree = await ui.render();
  nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({target: {checked: true}}); await ui.render();
  const params = new URLSearchParams(requests.at(-1).split('?')[1]);
  assert.equal(params.get('page'), '1'); assert.equal(params.get('status'), 'ALL'); assert.equal(params.get('companyId'), 'company-a'); ui.unmount();
  const disabled = support(async () => {throw new ApiError(404);});
  tree = await disabled.ui.render(props); assert.match(text(tree), /support.unavailable/); assert.equal(nodes(tree, n => n.type === 'form').length, 0); disabled.ui.unmount();
});

test('the support workspace validates membership before mounting company support; forged company IDs never load tickets', async () => {
  function HrSupport() {}
  let params = new URLSearchParams('company=forged');
  const remembered = [];
  const ui = host('apps/web/src/components/recruiter/RecruiterSupport.tsx', 'RecruiterSupport', {
    'next/navigation': {useSearchParams: () => params}, '@/lib/api': {api: async () => [{companyId:'a', company:{name:'A'}}]},
    '@/lib/i18n': i18n, '@/lib/navigation': {Link: stub}, '@/lib/accountNavigation': {employerWorkspaceHref: () => '/jobs'},
    '@/components/employee/WorkspaceIcon': {WorkspaceIcon: stub}, '@/components/employee/WorkspacePrimitives': {WorkspaceLoading: stub},
    './RecruiterPrimitives': {preferredCompany: mine => mine[0], rememberCompany: id => remembered.push(id)}, './HrSupport': {HrSupport},
  });
  let tree = await ui.render({}); assert.equal(nodes(tree,n=>n.type===HrSupport).length,0); assert.equal(remembered.length,0);
  params = new URLSearchParams('company=a'); tree = await ui.render({});
  assert.equal(nodes(tree,n=>n.type===HrSupport)[0].props.companyId,'a'); assert.deepEqual(remembered,['a']); ui.unmount();
});

test('reply uses the selected ticket and loads the last reply page after a successful send', async () => {
  const reads = [], writes = [];
  const {ui} = support(async route => { reads.push(route); return route.startsWith('/hr-support?') ? {items: [ticket('a')], total: 1} : {...thread('a'), total: 50}; }, async (route, body) => {writes.push({route,body}); return {};});
  let tree = await ui.render(props);
  nodes(tree,n=>n.type==='button'&&n.props['aria-pressed']!==undefined)[0].props.onClick(); tree = await ui.render();
  tree = await edit(ui,tree,n=>n.type==='textarea','  Here is our follow-up.  ');
  nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}}); tree = await ui.render();
  assert.equal(writes[0].route,'/hr-support/a/replies'); assert.equal(writes[0].body.body,'Here is our follow-up.');
  assert.ok(reads.includes('/hr-support/a?page=2')); assert.equal(nodes(tree,n=>n.type==='textarea')[0].props.value,''); ui.unmount();
});

test('combined job toolbar retains company totals while filtering and still opens the correct create-job editor', async () => {
  function SearchField() {} function WorkspaceSelect() {} function Editor() {}
  const ui = host('apps/web/src/components/recruiter/RecruiterJobs.tsx','RecruiterJobs',{
    '@/lib/api':{api:async()=>{}},'@/lib/navigation':{Link:stub,useRouter:()=>({push(){}})},'@/lib/accountNavigation':{employerJobHref:id=>'/job/'+id},
    '@/lib/i18n':i18n,'@/lib/location':{localizedJobLocation:()=>''},'@/components/employee/WorkspaceIcon':{WorkspaceIcon:stub},
    '@/components/employee/WorkspacePrimitives':{SearchField,WorkspaceEmpty:stub,WorkspaceLoading:stub,Pagination:stub,dateLabel:()=>''},
    '@/components/jobs/WorkspaceSelect':{WorkspaceSelect},'@/components/ui/ConfirmProvider':{useConfirm:()=>async()=>true},
    './RecruiterJobEditor':{RecruiterJobEditor:Editor},'./HrBenefits':{JobBenefits:stub},'./RecruiterJobActions':{RecruiterJobActions:stub},
  });
  const jobs=[{id:'a',title:'Backend Engineer',status:'PUBLISHED',createdAt:'2026-10-29',_count:{applications:3,views:5}},{id:'b',title:'QA Engineer',status:'DRAFT',createdAt:'2026-10-28',_count:{applications:2,views:7}}];
  let tree=await ui.render({companyId:'company-a',company:{name:'Company A'},jobs,loading:false,meta:{},createRequested:false});
  const metrics=()=>text(nodes(tree,n=>n.type==='dl')[0]); const initial=metrics();
  nodes(tree,n=>n.type===SearchField)[0].props.onChange('Backend');tree=await ui.render();assert.equal(metrics(),initial);
  assert.equal(nodes(tree,n=>n.type===stub&&n.props.href==='/job/a').length,1);
  assert.equal(nodes(tree,n=>n.type===stub&&n.props.href==='/job/b').length,0);
  assert.match(initial,/rw.published 1/);assert.match(initial,/applications 5/);assert.match(initial,/rec.viewsWord 12/);
  button(tree,'postAJob').props.onClick();tree=await ui.render();const editor=nodes(tree,n=>n.type===Editor)[0];assert.equal(editor.props.companyId,'company-a');assert.equal(editor.props.job,null);ui.unmount();
});
