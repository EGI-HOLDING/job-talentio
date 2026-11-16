const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const webRequire = createRequire(path.join(repo, 'apps/web/package.json'));
const ts = webRequire('typescript');
const React = webRequire('react');
const { renderToStaticMarkup } = webRequire('react-dom/server');

function load(file, dependencies = {}, globals = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(repo, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, URL, URLSearchParams, ...globals,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'react' || name === 'react/jsx-runtime') return webRequire(name);
      if(name==='./StructuredJobContent')return {StructuredJobContent:()=>null,jobExperienceLabel:()=>null};
      throw Error('Unexpected dependency ' + name + ' in ' + file);
    },
  }, { filename: file });
  return mod.exports;
}
const locale = load('apps/web/src/lib/locale.ts');
const policy = load('apps/web/src/lib/accountNavigation.ts', { './locale': locale });

test('retired billing and checkout destinations return to the role-appropriate jobs workspace', () => {
  for (const language of ['en', 'id', 'uz', 'ru']) {
    for (const href of ['/billing', '/billing/mock-checkout?paymentId=old', '/billing/legacy', '/dashboard/recruiter?tab=billing&job=old']) {
      assert.equal(policy.accountHref('RECRUITER', `/${language}${href}`), `/${language}${policy.EMPLOYER_JOBS}`);
      assert.equal(policy.accountHref('SUPER_ADMIN', `/${language}${href}`), `/${language}${policy.EMPLOYER_JOBS}`);
      assert.equal(policy.accountHref('EMPLOYEE', `/${language}${href}`), `/${language}/jobs`);
    }
  }
});

test('retired billing URLs redirect in middleware before rendering the old page', () => {
  const { middleware } = load('apps/web/src/middleware.ts', {
    '@/lib/locale': locale,
    'next/server': webRequire('next/server'),
  });
  for (const language of ['en', 'id', 'uz', 'ru']) {
    for (const route of ['/billing', '/billing/mock-checkout?paymentId=legacy', '/billing/legacy', '/dashboard/recruiter?tab=billing']) {
      const url = new URL(`/${language}${route}`, 'http://localhost:3000');
      const result = middleware({ url: url.href, nextUrl: url, cookies: { get: () => null } });
      assert.equal(result.status, 307);
      assert.equal(result.headers.get('location'), `http://localhost:3000/${language}/dashboard/recruiter?tab=jobs`);
    }
  }
  const url = new URL('http://localhost:3000/id/dashboard/recruiter?tab=company');
  const result = middleware({ url: url.href, nextUrl: url, cookies: { get: () => null } });
  assert.equal(result.headers.get('x-middleware-next'), '1');
  assert.match(result.headers.get('cache-control'), /\bno-store\b/);
});

test('employer job viewing, company profile and return preserve the workspace in four locales', () => {
  for (const role of ['RECRUITER', 'SUPER_ADMIN']) {
    for (const language of ['en', 'id', 'uz', 'ru']) {
      const workspace = policy.employerWorkspaceHref('jobs', 'company-2');
      const detail = policy.jobDetailHref('job-7', workspace);
      assert.equal(policy.accountHref(role, `/${language}${detail}`), `/${language}${detail}`);
      assert.equal(policy.jobBackHref(role, new URL(detail, 'http://local').searchParams.get('returnTo')), workspace);
      assert.equal(policy.jobBackHref(role, null, 'company-2'), workspace);
      for (const wrong of ['/jobs?mode=for-you', '/dashboard/employee?tab=saved', '/dashboard/employee/resume-builder', '/onboarding/employee']) {
        assert.equal(policy.accountHref(role, `/${language}${wrong}`), `/${language}${policy.EMPLOYER_JOBS}`);
      }
      const publicCompany = '/companies/example?returnTo=' + encodeURIComponent(detail);
      const companyReturn = policy.accountReturnHref(role, new URL(publicCompany, 'http://local').searchParams.get('returnTo'));
      assert.equal(companyReturn, detail);
    }
  }
});

test('candidate actions still use candidate routes, while employer routes are rejected', () => {
  for (const href of ['/jobs?city=jakarta', '/jobs/job-7', '/dashboard/employee?tab=applications', '/settings', '/messages?peer=p']) {
    assert.equal(policy.accountHref('EMPLOYEE', href), href);
    assert.equal(policy.accountHref(null, href), href);
  }
  for (const href of ['/dashboard/recruiter?tab=company', '/talent', '/candidates/private-cv', '/billing/mock-checkout']) {
    assert.equal(policy.accountHref('EMPLOYEE', href), '/jobs');
  }
});

test('the public jobs preview retains filters and a valid back link for employers', () => {
  for (const role of ['RECRUITER', 'SUPER_ADMIN']) {
    for (const language of ['id', 'en', 'uz', 'ru']) {
      const preview = `/${language}${policy.SEEKER_JOBS_PREVIEW}&q=engineer&page=2`;
      assert.equal(policy.accountHref(role, preview), preview);
      assert.equal(policy.jobBackHref(role, preview), '/jobs?audience=seekers&q=engineer&page=2');
      assert.equal(policy.accountHref(role, `/${language}/jobs?audience=employers`), `/${language}${policy.EMPLOYER_JOBS}`);
      assert.equal(policy.accountHref(role, `/${language}/dashboard/employee?tab=profile&audience=seekers`), `/${language}${policy.EMPLOYER_JOBS}`);
      assert.equal(policy.accountReturnHref(role, '//outside.test/jobs?audience=seekers'), null);
    }
  }
  assert.equal(policy.accountHref('EMPLOYEE', policy.EMPLOYER_LANDING_PREVIEW), policy.EMPLOYER_LANDING_PREVIEW);
  assert.equal(policy.accountHref('EMPLOYEE', '/dashboard/recruiter?audience=employers'), '/jobs');
});

test('the shared header shows both audience choices only for guests', () => {
  const hrefCases = [
    { role: null, href: '/', selected: 'Cari kerja', links: ['/', '/employers'] },
    { role: null, href: '/employers', selected: 'Cari pelamar', links: ['/', '/employers'] },
    { role: null, loading: true, href: '/', selected: null },
    { role: 'EMPLOYEE', href: '/jobs', selected: null },
    { role: 'EMPLOYEE', href: policy.EMPLOYER_LANDING_PREVIEW, selected: null },
    { role: 'RECRUITER', href: '/dashboard/recruiter?tab=jobs', selected: null },
    { role: 'RECRUITER', href: policy.SEEKER_JOBS_PREVIEW, selected: null },
    { role: 'RECRUITER', href: '/dashboard/recruiter/candidates/candidate-1', selected: null },
    { role: 'RECRUITER', href: '/onboarding/recruiter', selected: null },
    { role: 'EMPLOYEE', href: '/apply/invitation-1', selected: null },
    { role: 'SUPER_ADMIN', href: '/pricing', selected: null },
  ];
  for (const { role, loading, href, selected, links } of hrefCases) {
    const url = new URL(href, 'http://local');
    const session = loading ? undefined : role ? { user: { role, id: 'fixture', fullName: 'Fixture' } } : null;
    let stateIndex = 0;
    const Link = ({href, children, ...props}) => React.createElement('a', { ...props, href: policy.accountHref(role, href) }, children);
    const { SiteNav } = load('apps/web/src/components/SiteNav.tsx', {
      react: { ...React, useState: (initial) => React.useState(++stateIndex === 3 ? session : initial) },
      'next/navigation': { useSearchParams: () => url.searchParams },
      '@/lib/navigation': { Link, usePathname: () => url.pathname, useRouter: () => ({}) },
      '@/lib/i18n': { useI18n: () => ({ locale: 'id', t: key => key }) },
      '@/lib/api': { getSession: () => session, ADMIN_URL: '/admin' },
      '@/lib/accountNavigation': policy,
      '@/lib/authReturn': { authRoleFrom: role => role || 'EMPLOYEE' },
      '@/lib/useLiveRefresh': { useLiveRefresh: () => {} },
      '@/components/ui/DirectionalIcon': { DirectionalIcon: () => null },
      './SiteNav.module.css': {},
      './auth/AuthLink': { AuthLink: ({ children }) => children },
      './employee/WorkspaceIcon': { WorkspaceIcon: () => null },
      './recruiter/RecruiterPrimitives': {},
      './recruiter/useEmployerUnsaved': {},
      './recruiter/HrFlowPresentation': { useHrFlowContext: () => null, useHrAssistantContext: () => null },
      './recruiter/HrAssistantOnboarding': {},
      './screening/ApplicationPresentation': { useApplicationPresentation: () => ({ focused: false }) },
    }, { process: { env: {} } });
    const html = renderToStaticMarkup(React.createElement(SiteNav));
    assert.doesNotMatch(html, /#(?:how-it-works|hiring-insights)/, href);
    const group = html.match(/role="group" aria-label="Pilih tujuan">(.+?)<\/div>/)?.[1];
    if (selected === null) {
      assert.equal(group, undefined, href);
      continue;
    }
    assert.ok(group, href);
    assert.deepEqual([...group.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), links, href);
    assert.equal(group.match(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/)?.[1], selected, href);
    assert.equal((group.match(/aria-current/g) || []).length, 1, href);
  }
});

test('job returns support candidate and message context, and reject unsafe or opposite-role destinations', () => {
  for (const href of ['/candidates/candidate-1?matchJobId=job-7&company=company-2', '/messages?peer=person&job=job-7&role=RECRUITER']) {
    assert.equal(policy.jobBackHref('RECRUITER', href), href);
  }
  for (const value of ['https://outside.test', '//outside.test', '/\\outside.test', '/login', '/dashboard/employee?tab=profile', '/jobs?mode=all', '/settings\n']) {
    assert.equal(policy.jobBackHref('RECRUITER', value), policy.EMPLOYER_JOBS);
  }
  assert.equal(policy.jobBackHref('EMPLOYEE', '/candidates/candidate-1'), '/jobs');
  assert.equal(policy.jobBackHref('EMPLOYEE', '/dashboard/employee?tab=saved'), '/dashboard/employee?tab=saved');
});

test('old notifications retain their job and open pipeline; mismatched message role is corrected', () => {
  const old = policy.accountHref('RECRUITER', '/id/dashboard/recruiter?job=j&company=c');
  const url = new URL(old, 'http://local');
  assert.equal(url.pathname, '/id/dashboard/recruiter/jobs/j');
  assert.equal(url.searchParams.get('section'), null);
  assert.equal(url.searchParams.get('company'), 'c');
  assert.equal(policy.accountHref('RECRUITER', '/dashboard/recruiter?tab=analytics&job=j'), '/dashboard/recruiter?tab=analytics&job=j');
  const message = new URL(policy.accountHref('RECRUITER', '/messages?peer=p&job=j&role=EMPLOYEE'), 'http://local');
  assert.equal(message.searchParams.get('role'), 'RECRUITER');
  assert.equal(message.searchParams.get('job'), 'j');
});

test('retired talent navigation preserves job and company in every locale and has no standalone destination', async () => {
  for(const language of ['en','id','uz','ru']){
    const target=policy.accountHref('RECRUITER',`/${language}/talent?matchJobId=job-7&company=company-2`);
    const url=new URL(target,'http://synthetic');
    assert.equal(url.pathname,`/${language}/dashboard/recruiter/jobs/job-7`);
    assert.equal(url.searchParams.get('company'),'company-2');
    assert.equal(policy.accountHref('RECRUITER',`/${language}/talent`),`/${language}${policy.EMPLOYER_JOBS}`);
    assert.equal(policy.accountReturnHref('RECRUITER','/dashboard/recruiter/jobs/job-7?section=applicants'),'/dashboard/recruiter/jobs/job-7?section=applicants');
    const Page=load('apps/web/src/app/[locale]/talent/page.tsx',{
      'next/navigation':{redirect:target=>{throw Error('REDIRECT:'+target);}},
      '@/lib/accountNavigation':policy,'@/lib/locale':locale,
    }).default;
    await assert.rejects(()=>Page({params:Promise.resolve({locale:language}),searchParams:Promise.resolve({matchJobId:'job-7',company:'company-2'})}),new RegExp('REDIRECT:/'+language+'/dashboard/recruiter/jobs/job-7'));
  }
  assert.equal(fs.existsSync(path.join(repo,'apps/web/src/components/talent/FindTalentPanel.tsx')),false);
});

test('all auth return paths respect the signed-in role and employee onboarding', () => {
  let session = { user: { role: 'RECRUITER' } };
  const window = { location: { pathname: '/id/login', search: '' } };
  const auth = load('apps/web/src/lib/authReturn.ts', { './api': { getSession: () => session }, './locale': locale, './accountNavigation': policy }, { window });
  for (const next of ['/jobs', '/id/dashboard/employee?tab=profile']) {
    window.location.search = '?next=' + encodeURIComponent(next);
    assert.equal(auth.authDestination(policy.EMPLOYER_JOBS), policy.accountHref('RECRUITER', locale.stripLocale(next)));
  }
  session = { user: { role: 'EMPLOYEE', employeeOnboarding: { status: 'IN_PROGRESS' } } };
  window.location.search = '?next=' + encodeURIComponent('/dashboard/recruiter?tab=company');
  assert.equal(auth.authDestination('/dashboard/employee'), '/onboarding/employee?next=%2Fjobs');
  session.user.employeeOnboarding.status = 'COMPLETED';
  assert.equal(auth.authDestination('/dashboard/employee'), '/jobs');
  session = null;
  window.location = { pathname: '/id/dashboard/recruiter', search: '' };
  assert.equal(auth.currentAuthRole(), 'RECRUITER');
  window.location = { pathname: '/id/settings', search: '?role=RECRUITER' };
  assert.match(auth.loginForCurrentPage(), /^\/login\?role=RECRUITER&next=/);
});

test('shared Link and router apply the policy and retain the active locale', () => {
  const calls = [];
  const nextRouter = Object.fromEntries(['push', 'replace', 'prefetch', 'back', 'forward', 'refresh'].map((key) => [key, (...args) => calls.push({ key, args })]));
  const navigation = load('apps/web/src/lib/navigation.tsx', {
    'next/link': ({ href, children }) => React.createElement('a', { href }, children),
    'next/navigation': { useParams: () => ({ locale: 'id' }), usePathname: () => '/id/settings', useRouter: () => nextRouter },
    '@/lib/locale': locale, './accountNavigation': policy, './useAccountRole': { useAccountRole: () => 'RECRUITER' },
  });
  const markup = renderToStaticMarkup(React.createElement(navigation.Link, { href: '/jobs' }, 'Jobs'));
  assert.match(markup, /href="\/id\/dashboard\/recruiter\?tab=jobs"/);
  const Probe = () => {
    const router = navigation.useRouter();
    router.push('/dashboard/employee?tab=saved');
    router.replace('/jobs');
    router.prefetch('/jobs/job-7');
    return null;
  };
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(calls[0].args[0], '/id/dashboard/recruiter?tab=jobs');
  assert.equal(calls[1].args[0], '/id/dashboard/recruiter?tab=jobs');
  assert.equal(calls[2].args[0], '/id/jobs/job-7');
});

test('job preview scopes apply and save to candidates and shares the public job URL', () => {
  const shares = [];
  const Preview = load('apps/web/src/components/jobs/JobPreview.tsx', {
    '@/lib/navigation': { Link: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
    '@/lib/i18n': { useI18n: () => ({ t: (key) => key, locale: 'id' }), useEnumLabel: () => (_group, value) => value || '' },
    '@/components/ui/UgcText': { UgcText: ({ text }) => React.createElement('p', null, text) },
    '@/components/employee/EmployeeWhatsAppAction': { EmployeeWhatsAppAction: () => null },
    '@/components/ui/ShareButton': { ShareButton: (props) => { shares.push(props.path); return null; } },
    './JobsIcon': { JobsIcon: () => null }, './formatJobSalary': { formatJobSalary: () => 'IDR 100' },
    './PromotionBadge': { PromotionBadge: () => null },
    './JobsWorkspace.module.css': {}, '@/lib/authReturn': { authLink: () => '/login' },
  }).JobPreview;
  const job = { id: 'job-7', title: 'Developer', description: 'Role description', company: { name: 'Example', slug: 'example' } };
  const employer = renderToStaticMarkup(React.createElement(Preview, { standalone: true, backHref: '/dashboard/recruiter?tab=jobs&company=c', job, canSave: false, guest: false, busy: false }));
  assert.match(employer, /href="\/dashboard\/recruiter\?tab=jobs&amp;company=c"/);
  assert.doesNotMatch(employer, /saveJob|applyNow/);
  assert.equal(shares[0], '/jobs/job-7');
  const employee = renderToStaticMarkup(React.createElement(Preview, { standalone: true, job, guest: false, busy: false, onApply: () => {}, onSave: () => {} }));
  assert.match(employee, /applyNow/);
  assert.match(employee, /saveJob/);
});

test('public catalog cards keep their meaning for employers and candidates', () => {
  for (const role of ['RECRUITER', 'EMPLOYEE', null]) {
    const employer = role === 'RECRUITER';
    for (const [component, props, employerHref, employeeHref] of [
      ['ExploreTitleCard', { name: 'Engineer', slug: 'engineer' }, '/dashboard/recruiter?tab=jobs', '/jobs?jobTitle=engineer'],
      ['ExploreCityCard', { name: 'Jakarta', slug: 'jakarta' }, '/dashboard/recruiter?tab=jobs', '/jobs?city=jakarta'],
      ['ExploreCategoryCard', { name: 'Engineering', slug: 'engineering' }, '/dashboard/recruiter?tab=jobs', '/jobs?category=engineering'],
    ]) {
      const Card = load(`apps/web/src/components/explore/${component}.tsx`, {
        '@/lib/navigation': { Link: ({ href, children }) => React.createElement('a', { href }, children) },
        '@/lib/useAccountRole': { useAccountRole: () => role }, '@/lib/accountNavigation': policy,
        '@/lib/icons': { categoryIconLabel: () => '' }, '@/components/ui/VipBadge': { VipBadge: () => null },
      })[component];
      const markup = renderToStaticMarkup(React.createElement(Card, props));
      assert.ok(markup.includes(`href="${employer ? employerHref : employeeHref}"`), `${role || 'guest'} ${component}: ${markup}`);
    }
  }
});

test('retired industry and company directories redirect to the jobs workspace for the active role', () => {
  for (const role of ['RECRUITER', 'EMPLOYEE', null]) {
    const redirects = [];
    const navigation = load('apps/web/src/lib/navigation.tsx', {
      'next/link': () => null,
      'next/navigation': { useParams: () => ({ locale: 'id' }), usePathname: () => '/id/explore',
        useRouter: () => ({ replace: (href) => redirects.push(href) }) },
      '@/lib/locale': locale, './accountNavigation': policy, './useAccountRole': { useAccountRole: () => role },
    });
    for (const directory of ['industries', 'companies']) {
      const effects = [];
      const { default: Page } = load(`apps/web/src/app/[locale]/explore/${directory}/page.tsx`, {
        react: { useEffect: (effect) => effects.push(effect) }, '@/lib/navigation': navigation,
      });
      assert.equal(renderToStaticMarkup(React.createElement(Page)), '');
      effects.forEach((effect) => effect());
    }
    const expected = role === 'RECRUITER' ? '/id/dashboard/recruiter?tab=jobs' : '/id/jobs';
    assert.deepEqual(redirects, [expected, expected]);
  }
});

test('wrong-role page children do not mount before a redirect', () => {
  for (const [role, pathname] of [['RECRUITER', '/jobs'], ['RECRUITER', '/dashboard/employee'], ['EMPLOYEE', '/dashboard/recruiter'], ['EMPLOYEE', '/candidates/person']]) {
    let mounted = false;
    const Gate = load('apps/web/src/components/auth/AccountRouteGate.tsx', {
      'next/navigation': { useSearchParams: () => new URLSearchParams() },
      '@/lib/navigation': { usePathname: () => pathname, useRouter: () => ({ replace: () => {} }) },
      '@/lib/useAccountRole': { useAccountRole: () => role }, '@/lib/accountNavigation': policy,
      '@/components/employee/WorkspacePrimitives': { WorkspaceLoading: () => React.createElement('p', null, 'Loading') },
    }).AccountRouteGate;
    const PrivatePage = () => { mounted = true; return React.createElement('p', null, 'Private page'); };
    const html = renderToStaticMarkup(React.createElement(Gate, null, React.createElement(PrivatePage)));
    assert.equal(mounted, false, `${role}: ${pathname}`);
    assert.ok(!html.includes('Private page'));
  }
});

test('the mounted route guard preserves workspace query parameters and redirects only retired or wrong-role pages', () => {
  const cases = [
    ...['profile', 'profile&section=cvs', 'applications', 'saved', 'alerts'].map((tab) =>
      ['EMPLOYEE', `/dashboard/employee?tab=${tab}`, null]),
    ['RECRUITER', '/dashboard/recruiter?tab=pipeline&job=j&company=c', '/dashboard/recruiter/jobs/j?company=c'],
    ['EMPLOYEE', '/dashboard/employee?tab=overview', '/jobs?mode=for-you'],
    ['RECRUITER', '/dashboard/employee?tab=profile', policy.EMPLOYER_JOBS],
    ['EMPLOYEE', '/dashboard/recruiter?tab=pipeline', '/jobs'],
    ['RECRUITER', '/dashboard/recruiter?job=j&company=c', '/dashboard/recruiter/jobs/j?company=c'],
  ];
  for (const [role, href, destination] of cases) {
    const url = new URL(href, 'http://localhost:3000');
    const effects = [], redirects = [];
    let mounted = false;
    const Gate = load('apps/web/src/components/auth/AccountRouteGate.tsx', {
      react: { ...React, useState: () => [true, () => {}], useEffect: (effect) => effects.push(effect) },
      'next/navigation': { useSearchParams: () => url.searchParams },
      '@/lib/navigation': { usePathname: () => url.pathname, useRouter: () => ({ replace: (target) => redirects.push(target) }) },
      '@/lib/useAccountRole': { useAccountRole: () => role }, '@/lib/accountNavigation': policy,
      '@/components/employee/WorkspacePrimitives': { WorkspaceLoading: () => React.createElement('p', null, 'Loading') },
    }).AccountRouteGate;
    const Workspace = () => { mounted = true; return React.createElement('p', null, 'Workspace content'); };
    renderToStaticMarkup(React.createElement(Gate, null, React.createElement(Workspace)));
    effects.forEach((effect) => effect());
    assert.equal(mounted, destination === null, `${role} ${href}: correct workspace must render`);
    assert.deepEqual(redirects, destination ? [destination] : [], `${role} ${href}: unexpected redirect`);
  }
});


test('HR support deep links preserve company and locale for recruiters and auth returns, and reject employee access', () => {
  for (const language of ['en', 'id', 'uz', 'ru']) {
    const href = `/${language}/dashboard/recruiter/support?company=company-2`;
    assert.equal(policy.accountHref('RECRUITER', href), href);
    assert.equal(policy.accountReturnHref('RECRUITER', href), '/dashboard/recruiter/support?company=company-2');
    assert.equal(policy.accountHref('EMPLOYEE', href), `/${language}/jobs`);
    assert.equal(policy.accountReturnHref('EMPLOYEE', href), null);
  }
});
