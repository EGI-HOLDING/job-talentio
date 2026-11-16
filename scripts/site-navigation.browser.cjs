// Runs against an existing web build. All application API calls use fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  playwright = require(path.join(process.env.CODEX_RUNTIME_NODE_MODULES ||
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
}

const web = new URL(process.env.SITE_NAV_WEB_URL || 'http://127.0.0.1:3038');
assert.ok(['127.0.0.1', 'localhost', 'cari-kerja.co.id'].includes(web.hostname));
const output = process.env.SITE_NAV_OUTPUT;
const companies = [
  { companyId: 'company-a', role: 'OWNER', company: { id: 'company-a', name: 'Studio Rekrutmen dan Pengembangan Talenta Nusantara' } },
  { companyId: 'company-b', role: 'OWNER', company: { id: 'company-b', name: 'Studio Dua' } },
];
const job = {
  id: 'navigation-job', title: 'Navigation fixture job', description: 'Build and maintain services.',
  company: { id: 'job-company', slug: 'fixture-company', name: 'Fixture Company' },
  city: { slug: 'jakarta', name: 'Jakarta' }, country: { name: 'Indonesia' },
  workMode: 'REMOTE', employmentType: 'FULL_TIME', status: 'PUBLISHED',
  jobSkills: [], benefits: [], jobLanguages: [],
};
const emptyPage = { items: [], total: 0, page: 1, totalPages: 1, limit: 12, sort: 'relevance' };
const accountSelector = 'nav button[aria-controls="workspace-account-menu"]';
const bellSelector = 'nav button[aria-controls="workspace-notifications"]';
const mobileSelector = 'nav button[aria-controls="landing-mobile-menu"]';

function auth(role, id = role.toLowerCase()) {
  return { accessToken: 'fixture-' + id, user: { id, role,
    fullName: 'Navigation Fixture', email: id + '@example.test', emailVerified: true,
    memberships: role === 'RECRUITER' ? companies : [],
  } };
}

async function scenario(browser, { role, width, locale, entry, recover = false }, test) {
  const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [], requests = [];
  const session = role ? auth(role) : null;
  let companyReadUnavailable = recover;
  await context.addInitScript(session => {
    if (session) {
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_session', JSON.stringify(session));
    }
  }, session);
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) {
      return url.origin === web.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
    }
    const headers = { 'access-control-allow-origin': web.origin, 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const endpoint = url.pathname.slice('/api'.length);
    requests.push(endpoint);
    let data = [];
    if (endpoint === '/auth/me') data = session;
    if (endpoint === '/companies/mine') {
      if (companyReadUnavailable) {
        return route.fulfill({ status: 503, headers: { ...headers, 'retry-after': '1' },
          json: { message: 'Temporary navigation fixture failure' } });
      }
      data = companies;
    }
    if (endpoint === '/recruiter-onboarding') data = { status: 'COMPLETED' };
    if (endpoint === '/profiles/me/onboarding') data = { status: 'COMPLETED', profile: { phone: '+6281212345678' } };
    if (endpoint === '/profiles/me') data = { desiredPosition: 'Engineer', skills: [], resumes: [] };
    if (endpoint === '/profiles/me/saved-jobs') data = [];
    const secondAccount = request.headers().authorization === 'Bearer fixture-second-user';
    if (endpoint === '/notifications/unread-count') data = { count: secondAccount ? 0 : 2 };
    if (endpoint === '/notifications') data = { items: [{ id: 'notice', title: secondAccount ? 'Second notice' : 'First notice' }], unread: secondAccount ? 0 : 1 };
    if (endpoint === '/jobs' || endpoint === '/jobs/recommended') data = { ...emptyPage, items: endpoint === '/jobs' ? [job] : [], totalPages: 1,
      total: endpoint === '/jobs' ? 1 : 0, mode: 'LATEST', facets: { experienceLevels: {} } };
    if (endpoint === '/jobs/' + job.id) data = job;
    if (endpoint === '/applications/mine/jobs/' + job.id) data = { applied: false, application: null };
    if (endpoint === '/companies' || endpoint === '/news') data = emptyPage;
    if (endpoint === '/job-commerce/catalog') data = { version: 2, packages: [], hrFlowV2: true };
    return route.fulfill({ headers, json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    const response = await page.goto(web.origin + '/' + locale + entry, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response.status(), 200);
    if (role) await page.locator(accountSelector).waitFor();
    const group = page.locator('nav.shell > [role="group"]');
    if (role) {
      assert.equal(await group.count(), 0);
    } else {
      await group.waitFor();
      assert.equal(await group.getByRole('link').count(), 2);
    }
    assert.equal(await page.locator('nav.shell a[href$="#how-it-works"], nav.shell a[href$="#hiring-insights"]').count(), 0);
    await test({ page, group, requests, restoreCompanyRead: () => { companyReadUnavailable = false; } });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function fits(page, locator) {
  const box = await locator.boundingBox();
  const { width } = page.viewportSize();
  assert.ok(box && box.x >= -0.5 && box.x + box.width <= width + 0.5, JSON.stringify({ width, box }));
}

async function menuAndFocus(page, trigger, panel) {
  const button = page.locator(trigger);
  const content = page.locator(panel);
  await button.click();
  await content.waitFor();
  await fits(page, content);
  await page.keyboard.press('Escape');
  await content.waitFor({ state: 'hidden' });
  assert.ok(await button.evaluate(element => document.activeElement === element));
}

async function verifyHeader(browser) {
  const widths = [320, 390, 767, 768, 1024, 1141, 1440, 1887];
  for (const width of widths) {
    const locale = width === 1141 ? 'ru' : width === 767 ? 'uz' : width === 768 ? 'en' : 'id';
    await Promise.all([
      { role: null, entry: '/employers' },
      { role: 'EMPLOYEE', entry: '/jobs?mode=all' },
      { role: 'RECRUITER', entry: '/dashboard/recruiter?tab=jobs&company=company-a' },
    ].map(({ role, entry }) => scenario(browser, { role, width, locale, entry }, async ({ page, group }) => {
      if (!role) {
        assert.equal(await group.getByRole('link').nth(1).getAttribute('aria-current'), 'page');
        await fits(page, group);
      }
      await fits(page, page.locator('nav.shell .brand').first());
      if (role) await fits(page, page.locator(accountSelector));
      if (width <= 1140) {
        await menuAndFocus(page, mobileSelector, '#landing-mobile-menu');
      }
      if (width === 320 || width === 767) {
        if (role) {
          await menuAndFocus(page, bellSelector, '#workspace-notifications');
          await menuAndFocus(page, accountSelector, '#workspace-account-menu');
        }
        await menuAndFocus(page, 'nav .lang-switch button[aria-haspopup]', 'nav [role="listbox"]');
      }
      if (output && [390, 1440].includes(width)) {
        await page.locator('nav.shell').screenshot({ path: path.join(output, (role || 'guest').toLowerCase() + '-' + width + '.png') });
      }
    })));
    console.log('Header and viewport verified:', width, locale, 'guest, candidate, employer');
  }
}

async function verifyRoutes(browser) {
  await scenario(browser, { role: null, width: 390, locale: 'id', entry: '' }, async ({ page, group }) => {
    const employer = group.getByRole('link', { name: 'Cari pelamar', exact: true });
    await employer.press('Enter');
    await page.waitForURL('**/id/employers');
    await page.locator('#employer-title').waitFor();
    assert.equal(await employer.getAttribute('aria-current'), 'page');
    await page.locator(mobileSelector).click();
    const menu = page.locator('#landing-mobile-menu');
    await menu.waitFor();
    assert.equal(await menu.locator('a[href$="#how-it-works"], a[href$="#hiring-insights"]').count(), 0);
    await page.keyboard.press('Escape');
    await group.getByRole('link', { name: 'Cari kerja', exact: true }).click();
    await page.waitForURL('**/id');
    await page.evaluate(session => {
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_session', JSON.stringify(session));
      window.dispatchEvent(new Event('jt-session-updated'));
    }, auth('EMPLOYEE'));
    await page.locator(accountSelector).waitFor();
    assert.equal(await group.count(), 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(accountSelector).waitFor();
    assert.equal(await group.count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.jt_session).user.role), 'EMPLOYEE');
  });
  await scenario(browser, { role: 'RECRUITER', width: 1440, locale: 'en', entry: '/jobs?audience=seekers' }, async ({ page, group, requests }) => {
    await page.getByRole('searchbox').fill('engineer');
    await page.getByRole('searchbox').press('Enter');
    await page.waitForURL(url => url.searchParams.get('q') === 'engineer' && url.searchParams.get('audience') === 'seekers');
    const jobLink = page.getByRole('link', { name: job.title, exact: true });
    const detailHref = await jobLink.getAttribute('href');
    await page.goto(web.origin + detailHref, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: job.title, exact: true }).waitFor();
    await page.locator('main a[href*="audience=seekers"][href*="q=engineer"]').first().click();
    await page.waitForURL(url => url.pathname === '/en/jobs' && url.searchParams.get('q') === 'engineer');
    assert.ok(!requests.some(endpoint => ['/profiles/me', '/profiles/me/saved-jobs', '/jobs/recommended'].includes(endpoint)));
    assert.equal(await group.count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.jt_session).user.role), 'RECRUITER');
  });
  console.log('Guest destinations, toggle removal after login and reload, and public job detail back verified');
}

async function verifyAccountIsolation(browser) {
  await scenario(browser, { role: 'EMPLOYEE', width: 390, locale: 'id', entry: '/jobs?mode=all' }, async ({ page }) => {
    await page.locator(bellSelector).click();
    await page.getByText('First notice', { exact: true }).waitFor();
    await page.evaluate(session => {
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_session', JSON.stringify(session));
      window.dispatchEvent(new Event('jt-session-updated'));
    }, auth('EMPLOYEE', 'second-user'));
    await page.locator('#workspace-notifications').waitFor({ state: 'hidden' });
    await page.locator(bellSelector).click();
    await page.getByText('Second notice', { exact: true }).waitFor();
    assert.equal(await page.getByText('First notice', { exact: true }).count(), 0);
  });
  console.log('Account change does not retain the previous notification list');
}

async function verifyRecruiterRecovery(browser) {
  await scenario(browser, { role: 'RECRUITER', width: 1440, locale: 'id', entry: '/dashboard/recruiter?tab=jobs', recover: true }, async ({ page, requests, restoreCompanyRead }) => {
    const retry = page.getByRole('button', { name: 'Coba lagi', exact: true });
    await retry.waitFor();
    restoreCompanyRead();
    await retry.click();
    await retry.waitFor({ state: 'hidden' });
    await page.locator(accountSelector).getByText(companies[0].company.name, { exact: true }).waitFor();
    assert.ok(requests.includes('/jobs/company/company-a'));
  });
  console.log('The previously shipped recruiter read recovery survives navigator changes');
}

(async () => {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    await verifyHeader(browser);
    await verifyRoutes(browser);
    await verifyAccountIsolation(browser);
    await verifyRecruiterRecovery(browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
