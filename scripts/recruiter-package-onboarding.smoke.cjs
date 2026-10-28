const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {host, nodes, text} = require('./lib/react-hook-host.cjs');
const stub = () => null;
const t = key => key === 'commerce.companyDescriptionHint' ? 'Minimum 20; current {n}' : key;
const i18n = {useI18n: () => ({t, locale: 'en'}), useEnumLabel: () => (_, value) => value};
const commerce = {packagePreference: () => undefined, withPackagePreference: href => href,
  packageHref: (id, returnTo) => '/package/' + id + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : ''),
  commerceReturn: () => '/onboarding/recruiter', packageCode: code => code, money: String};
const navigation = {employerJobHref: id => '/jobs/' + id, employerWorkspaceHref: () => '/dashboard/recruiter', accountReturnHref: () => null};
const button = (tree, label) => nodes(tree, n => n.type === 'button' && text(n).replace(/\s+/g, ' ').trim() === label)[0];
const job = {id: 'job', status: 'DRAFT', updatedAt: '2026-10-28T00:00:00Z', title: 'Frontend Developer',
  description: 'Build reliable interfaces with our product team.', workMode: 'REMOTE', currency: 'USD', locale: 'en'};
const editorProps = {job, companyId: 'company', company: {name: 'EGI IT'}, meta: {}, initialStep: 3, onClose() {}, onSaved: async () => {}};
function editor(api, extra = {}) {
  return host('apps/web/src/components/recruiter/RecruiterJobEditor.tsx', 'RecruiterJobEditor', {
    '@/lib/api': {api}, '@/lib/i18n': i18n, '@/lib/jobCommerce': commerce,
    '@/lib/navigation': {localeUrl: (locale, href) => '/' + locale + href}, '@/lib/accountNavigation': navigation,
    '@/components/ui/ConfirmProvider': {useConfirm: () => async () => true},
    '@/components/ui/Field': {FormField: stub, LabelText: stub}, '@/components/ui/JobTitleInput': {JobTitleInput: stub},
    '@/components/ui/LocationFields': {LocationFields: stub}, '@/components/ui/LookupCombobox': {LookupCombobox: stub},
    '@/components/employee/WorkspaceIcon': {WorkspaceIcon: stub}, '@/components/employee/WorkspacePrimitives': {CompanyMark: stub},
    './ScreeningQuestionsEditor': {ScreeningQuestionsEditor: stub, screeningDraftsFromJob: () => []},
    './JobLanguageVersions': {JobLanguageVersions: stub}, './LinkedInSharePreview': {LinkedInSharePreview: stub},
    './useEmployerUnsaved': {useEmployerUnsaved: () => () => {}}, ...extra,
  });
}

test('Review routes an unselected job to packages, preserves its draft ID on retry, and never publishes early', async () => {
  const requests = [], choices = [];
  const ui = editor(async (route, options) => {requests.push({route, options}); return route.startsWith('/benefits/') ? {selected: false, packagesEnabled: true} : job;});
  const props = {...editorProps, onChoosePackage: async id => {choices.push(id); if (choices.length === 1) throw Error('Retry navigation');}};
  let tree = await ui.render(props);
  assert.match(text(tree), /commerce.packageBeforePublish/);
  button(tree, 'commerce.choose').props.onClick(); tree = await ui.render();
  assert.match(text(tree), /rec.jobUpdateFailed/);
  button(tree, 'commerce.choose').props.onClick(); await ui.render();
  assert.deepEqual(choices, ['job', 'job']);
  assert.equal(requests.filter(r => r.route === '/jobs/job').length, 2);
  assert.ok(requests.filter(r => r.route === '/jobs/job').every(r => r.options.method === 'PATCH'));
  assert.ok(requests.every(r => !r.route.endsWith('/status')));
  ui.unmount();
});

test('a confirmed Free package changes the CTA to Publish and publishes only after confirmation', async () => {
  const requests = [];
  const ui = editor(async (route, options) => {requests.push({route, options}); return route.startsWith('/benefits/') ? {selected: true, code: 'FREE', packagesEnabled: true} : job;});
  let tree = await ui.render(editorProps);
  assert.equal(button(tree, 'commerce.choose'), undefined);
  button(tree, 'rec.publish').props.onClick(); await ui.render();
  assert.equal(JSON.parse(requests.find(r => r.route.endsWith('/status')).options.body).status, 'PUBLISHED');
  ui.unmount();
});

test('disabled package rollout preserves the editor and gives a localized actionable message', async () => {
  const choices = [], requests = [];
  const ui = editor(async (route, options) => {requests.push(route); return route.startsWith('/benefits/') ? {selected: false, packagesEnabled: false} : job;});
  let tree = await ui.render({...editorProps, onChoosePackage: async id => choices.push(id)});
  button(tree, 'commerce.choose').props.onClick(); tree = await ui.render();
  assert.match(text(tree), /commerce.packagesUnavailable/);
  assert.equal(choices.length, 0); assert.ok(requests.every(r => !r.endsWith('/status')));
  ui.unmount();
});

const company = {id: 'company', name: 'EGI IT', description: 'A complete company description.', industry: {slug: 'it'}, size: 'SIZE_11_50', city: {slug: 'jakarta', province: {country: {id: 'id'}}}};
function onboarding(api) {
  function Field() {}
  return {Field, ui: host('apps/web/src/components/onboarding/RecruiterOnboarding.tsx', 'RecruiterOnboarding', {
    '@/lib/api': {api, saveSession() {}}, '@/lib/i18n': i18n, '@/lib/jobCommerce': commerce, '@/lib/accountNavigation': navigation,
    'next/navigation': {useSearchParams: () => new URLSearchParams()}, '@/lib/navigation': {useRouter: () => ({push() {}, replace() {}})},
    '@/components/ui/Field': {FormField: Field}, '@/components/ui/LocationFields': {LocationFields: stub},
    '@/components/recruiter/RecruiterJobEditor': {RecruiterJobEditor: stub}, '@/components/recruiter/LinkedInSharePreview': {LinkedInSharePreview: stub},
    '@/components/employee/WorkspacePrimitives': {WorkspaceLoading: stub}, '@/components/employee/WorkspaceIcon': {WorkspaceIcon: stub},
  }, {document: {addEventListener() {}, removeEventListener() {}}})};
}
const progress = {status: 'IN_PROGRESS', step: 1, companyId: 'company', jobId: null, memberships: [{companyId: 'company', role: 'OWNER', company}]};
test('onboarding explains the 20-character minimum and rejects short or space-padded descriptions before writing', async () => {
  const writes = [];
  const {ui, Field} = onboarding(async (route, options) => {if (options?.method) writes.push(route); return route === '/recruiter-onboarding' ? progress : [];});
  let tree = await ui.render({});
  const textarea = () => nodes(tree, n => n.type === 'textarea')[0];
  for (const value of ['BADASS', '                 BADASS                 ']) {
    textarea().props.onChange({target: {value}}); tree = await ui.render();
    await nodes(tree, n => n.type === 'form')[0].props.onSubmit({preventDefault() {}}); tree = await ui.render();
    const field = nodes(tree, n => n.type === Field)[0];
    assert.equal(field.props.error, 'commerce.companyDescriptionError');
    assert.equal(field.props.hint, 'Minimum 20; current 6');
  }
  assert.equal(writes.length, 0); ui.unmount();
});

test('returning to onboarding shows Choose package for an unselected draft without marking it ready', async () => {
  const writes = [];
  const state = {...progress, step: 2, jobId: 'job'};
  const {ui} = onboarding(async (route, options) => {
    if (options?.method) writes.push(JSON.parse(options.body));
    if (route === '/recruiter-onboarding') return state;
    if (route === '/jobs/job') return job;
    if (route.startsWith('/benefits/')) return {selected: false, packagesEnabled: true};
    return [];
  });
  let tree = await ui.render({});
  button(tree, 'commerce.choose →').props.onClick(); await ui.render();
  assert.equal(writes.at(-1).step, 2); assert.equal(writes.at(-1).jobId, 'job');
  ui.unmount();
});

for (const selected of [false, true]) test('onboarding restores the correct step after package return: selected=' + selected, async () => {
  const writes = [], state = {...progress, step: selected ? 2 : 3, jobId: 'job'};
  const {ui} = onboarding(async (route, options) => {
    if (options?.method) writes.push(JSON.parse(options.body));
    if (route === '/recruiter-onboarding') return state;
    if (route === '/jobs/job') return job;
    if (route.startsWith('/benefits/')) return {selected, packagesEnabled: true};
    return [];
  });
  const tree = await ui.render({});
  assert.equal(writes.at(-1).step, selected ? 3 : 2);
  assert.match(text(tree), selected ? /commerce.ready/ : /commerce.firstJob/);
  ui.unmount();
});

for (const code of ['FREE', 'STANDARD']) test('package selection confirms ' + code + ' and preserves the onboarding return path', async () => {
  function Pricing() {}
  const destinations = [], orders = [];
  const ui = host('apps/web/src/components/recruiter/JobPackageSelection.tsx', 'JobPackageSelection', {
    'next/navigation': {useParams: () => ({id: 'job'}), useSearchParams: () => new URLSearchParams()},
    '@/lib/navigation': {Link: stub, useRouter: () => ({replace: url => destinations.push(url), push: url => destinations.push(url)})},
    '@/lib/i18n': i18n, '@/lib/jobCommerce': commerce, '@/components/employee/WorkspacePrimitives': {WorkspaceLoading: stub},
    './PackagePricing': {PackagePricing: Pricing}, '@/lib/api': {api: async (route, options) => {
      if (route === '/jobs/job') return job;
      if (route.startsWith('/benefits/')) return {selected: false};
      if (route === '/job-commerce/catalog') return {enabled: true, packages: []};
      orders.push(JSON.parse(options.body)); return {id: 'order', status: code === 'FREE' ? 'PAID' : 'PENDING'};
    }},
  }, {crypto: {randomUUID}});
  let tree = await ui.render({});
  await nodes(tree, n => n.type === Pricing)[0].props.onChoose(code); await ui.render();
  assert.equal(orders[0].code, code); assert.equal(orders[0].jobId, 'job');
  assert.equal(destinations[0], code === 'FREE' ? '/onboarding/recruiter' : '/checkout/order?returnTo=%2Fonboarding%2Frecruiter');
  ui.unmount();
});

test('disabled pricing remains visible without allowing orders', async () => {
  function Pricing() {}
  let orders = 0;
  const ui = host('apps/web/src/components/recruiter/JobPackageSelection.tsx', 'JobPackageSelection', {
    'next/navigation': {useParams: () => ({id: 'job'}), useSearchParams: () => new URLSearchParams()},
    '@/lib/navigation': {Link: stub, useRouter: () => ({replace() {}, push() {}})},
    '@/lib/i18n': i18n, '@/lib/jobCommerce': commerce, '@/components/employee/WorkspacePrimitives': {WorkspaceLoading: stub},
    './PackagePricing': {PackagePricing: Pricing}, '@/lib/api': {api: async (route, options) => {
      if (options?.method) orders++;
      if (route === '/jobs/job') return job;
      if (route.startsWith('/benefits/')) return {selected: false};
      return {enabled: false, packages: []};
    }},
  });
  const tree = await ui.render({}), pricing = nodes(tree, n => n.type === Pricing)[0];
  assert.match(text(tree), /commerce.packagesUnavailable/); assert.equal(pricing.props.busy, true);
  await pricing.props.onChoose('FREE'); assert.equal(orders, 0); ui.unmount();
});
