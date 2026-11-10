const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {host, nodes, text} = require('./lib/react-hook-host.cjs');
const stub = () => null;
const i18n = {useI18n: () => ({t: key => key, locale: 'en'}), useEnumLabel: () => (_, value) => value};
const commerce = {packagePreference: () => undefined, withPackagePreference: href => href,
  packageHref: (id, returnTo) => '/package/' + id + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : ''),
  commerceReturn: () => '/onboarding/recruiter', packageCode: code => code, money: String};
const job = {id: 'job', status: 'DRAFT', updatedAt: '2026-10-28T00:00:00Z', title: 'Frontend Developer',
  description: 'Build reliable interfaces with our product team.', workMode: 'REMOTE', currency: 'USD', locale: 'en'};

test('recruiter onboarding uses the Indonesia flow and has no legacy Uzbek frontend fallback', async () => {
  const V2 = () => null, Unavailable = () => null;
  const ui = host('apps/web/src/components/onboarding/RecruiterOnboarding.tsx', 'RecruiterOnboarding', {
    '@/components/recruiter/HrCreationFlow': {hrFlowV2Enabled: true},
    '@/components/recruiter/HrFlowUnavailable': {HrFlowUnavailable: Unavailable},
    './RecruiterOnboardingV2': {RecruiterOnboardingV2: V2},
  });
  const tree = await ui.render({});
  assert.equal(tree.type, V2);
  ui.unmount();
});

test('unsupported market shows the localized availability notice instead of the removed onboarding frontend', async () => {
  const V2 = () => null, Unavailable = () => null;
  const ui = host('apps/web/src/components/onboarding/RecruiterOnboarding.tsx', 'RecruiterOnboarding', {
    '@/components/recruiter/HrCreationFlow': {hrFlowV2Enabled: false},
    '@/components/recruiter/HrFlowUnavailable': {HrFlowUnavailable: Unavailable},
    './RecruiterOnboardingV2': {RecruiterOnboardingV2: V2},
  });
  const tree = await ui.render({});
  assert.equal(tree.type, Unavailable);
  ui.unmount();
});

test('existing jobs keep the V2 editor while unsupported new-job creation is guarded', async () => {
  const Existing = () => null, Flow = () => null, Unavailable = () => null;
  const dependencies = {
    './HrCreationFlow': {hrFlowV2Enabled: false, HrCreationFlow: Flow},
    './RecruiterJobEditorV2': {RecruiterJobEditorV2: Existing},
    './HrFlowUnavailable': {HrFlowUnavailable: Unavailable},
  };
  const ui = host('apps/web/src/components/recruiter/RecruiterJobEditor.tsx', 'RecruiterJobEditor', dependencies);
  let tree = await ui.render({companyId: 'company', company: {}, job, meta: {}, onClose() {}, onSaved: async () => {}});
  assert.equal(tree.type, Existing);
  tree = await ui.render({companyId: 'company', company: {}, job: null, meta: {}, onClose() {}, onSaved: async () => {}});
  assert.equal(tree.type, Unavailable);
  ui.unmount();
});

test('Indonesia new jobs and resumable creation sessions use HrCreationFlow', async () => {
  const Existing = () => null, Flow = () => null, Unavailable = () => null;
  const ui = host('apps/web/src/components/recruiter/RecruiterJobEditor.tsx', 'RecruiterJobEditor', {
    './HrCreationFlow': {hrFlowV2Enabled: true, HrCreationFlow: Flow},
    './RecruiterJobEditorV2': {RecruiterJobEditorV2: Existing},
    './HrFlowUnavailable': {HrFlowUnavailable: Unavailable},
  });
  let tree = await ui.render({companyId: 'company', company: {}, job: null, meta: {}, onClose() {}, onSaved: async () => {}});
  assert.equal(tree.type, Flow);
  tree = await ui.render({companyId: 'company', company: {}, job: {...job, _creationSessionId: 'session'}, meta: {}, onClose() {}, onSaved: async () => {}});
  assert.equal(tree.type, Flow);
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
