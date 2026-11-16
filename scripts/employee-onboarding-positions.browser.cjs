const assert = require('node:assert/strict');
const path = require('node:path');

const origin = process.env.EMPLOYEE_ONBOARDING_WEB || 'http://127.0.0.1:3160';
assert.match(new URL(origin).hostname, /^(127\.0\.0\.1|localhost)$/);
const { chromium } = require(require.resolve('playwright', { paths: [
  __dirname,
  process.env.CODEX_BROWSER_NODE_MODULES || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),
] }));

const onboarding = '/api/profiles/me/onboarding';
const country = { id: 'indonesia', name: 'Indonesia', iso2: 'ID', currencyCode: 'IDR', phoneCode: '62' };
const role = { kind: 'ROLE', id: 'frontend', name: 'Frontend Developer' };
const group = { kind: 'GROUP', id: 'web', name: 'Web Developer' };
const laterRole = { kind: 'ROLE', id: 'data', name: 'Data Analyst' };
const identities = selections => selections.map(({ kind, id }) => ({ kind, id }));

async function fixture(browser, step, selections, externalSelection) {
  const draft = {};
  const user = { id: 'onboarding-fixture', fullName: 'Kandidat Contoh', email: 'candidate@example.test', role: 'EMPLOYEE', locale: 'id', employeeOnboarding: { status: 'IN_PROGRESS', step } };
  const session = { accessToken: 'fixture-only', user };
  const profile = {
    user, resumes: [], desiredPositions: selections.map(item => item.name), desiredSelections: selections,
    preferencesRevision: 7, preferredCountries: [country], residenceCountry: country, residenceCountryId: country.id,
    desiredSalaryMin: null, desiredSalaryCurrency: 'IDR', desiredSalaryPeriod: 'MONTHLY', phone: '+6281234567890',
  };
  const requests = [];
  const context = await browser.newContext({ locale: 'id', serviceWorkers: 'block' });
  await context.addInitScript(({ origin, session }) => {
    if (location.origin !== origin || localStorage.getItem('jt_session')) return;
    localStorage.setItem('jt_session', JSON.stringify(session));
    localStorage.setItem('jt_token', session.accessToken);
  }, { origin, session });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const state = () => ({ ...user.employeeOnboarding, draft, profile });
    if (pathname === onboarding && method === 'GET') return route.fulfill({ json: state() });
    if (pathname === onboarding || pathname === onboarding + '/complete') {
      const body = request.postDataJSON();
      const complete = pathname.endsWith('/complete');
      if (externalSelection && requests.length === 0) {
        assert.ok(!('desiredSelections' in body));
        profile.desiredSelections = [externalSelection];
        profile.preferencesRevision++;
      }
      const status = 'desiredSelections' in body && body.preferencesRevision !== profile.preferencesRevision
        ? 409 : complete ? 201 : 200;
      requests.push({ complete, body, status });
      if (status === 409) return route.fulfill({ status, json: { message: 'POSITION_PREFERENCES_CHANGED' } });
      if ('desiredSelections' in body) {
        profile.desiredSelections = body.desiredSelections.map(({ id }) => [role, group, laterRole].find(item => item.id === id));
        profile.preferencesRevision++;
      }
      if (body.resumeId) draft.resumeId = body.resumeId;
      user.employeeOnboarding.step = body.step;
      if (complete) {
        assert.equal(body.resumeId, profile.resumes[0].id);
        user.employeeOnboarding.status = 'COMPLETED';
      }
      return route.fulfill({ status, json: state() });
    }
    if (pathname === '/api/auth/me') return route.fulfill({ json: session });
    if (pathname === '/api/meta/countries') return route.fulfill({ json: [country] });
    if (pathname === '/api/meta/positions/search') {
      const q = new URL(request.url()).searchParams.get('q')?.toLowerCase() || '';
      return route.fulfill({ json: { items: [role, group, laterRole].filter(item => item.name.toLowerCase().includes(q)), totalPages: 1 } });
    }
    if (pathname === '/api/profiles/me/resumes/upload') {
      const resume = { id: 'resume-fixture', title: 'cv.pdf', hasFile: true, isPrimary: true };
      profile.resumes.push(resume);
      return route.fulfill({ status: 201, json: resume });
    }
    return route.fulfill({ json: [] });
  });
  const page = await context.newPage();
  await page.goto(origin + '/id/onboarding/employee', { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { context, page, profile, requests };
}

async function upload(page) {
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === onboarding && r.request().method() === 'PATCH' && r.request().postDataJSON().resumeId);
  await page.locator('input[type=file]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await page.getByRole('heading', { name: 'cv.pdf', exact: true }).waitFor();
  assert.equal((await saved).status(), 200);
}

async function finish(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === onboarding + '/complete');
  await page.getByRole('button', { name: 'Simpan & selesai' }).click();
  assert.equal((await response).status(), 201, 'A saved position selection must allow completing onboarding after CV upload');
}

async function choose(page, position) {
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === onboarding && r.request().method() === 'PATCH' && r.request().postDataJSON().desiredSelections);
  await page.getByRole('combobox').fill(position.name);
  await page.getByRole('option').filter({ hasText: position.name }).click();
  return (await saved).status();
}

async function finishFromPositions(page) {
  for (const step of [2, 3, 4, 5]) {
    await page.getByRole('button', { name: 'Lanjut', exact: true }).click();
    await page.getByRole('progressbar').and(page.locator(`[aria-valuenow="${step}"]`)).waitFor();
  }
  await upload(page);
  await finish(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const saved = await fixture(browser, 5, [role, group]);
    await upload(saved.page);
    await saved.page.reload({ waitUntil: 'domcontentloaded' });
    await saved.page.getByRole('heading', { name: 'cv.pdf', exact: true }).waitFor();
    await finish(saved.page);
    assert.deepEqual(saved.profile.desiredSelections, [role, group]);
    assert.equal(saved.profile.preferencesRevision, 7);
    for (const { body } of saved.requests) {
      for (const key of ['desiredSelections', 'desiredPositions', 'desiredJobTitleIds', 'preferencesRevision']) assert.ok(!(key in body));
    }
    await saved.context.close();
    console.log('Onboarding browser: upload, refresh and completion preserve saved role, group and revision.');

    const fresh = await fixture(browser, 1, []);
    assert.equal(await choose(fresh.page, role), 200);
    assert.equal(await choose(fresh.page, group), 200);
    await finishFromPositions(fresh.page);
    const positionWrites = fresh.requests.filter(({ body }) => 'desiredSelections' in body);
    assert.deepEqual(positionWrites.map(({ body }) => [body.preferencesRevision, body.desiredSelections]), [
      [7, identities([role])], [8, identities([role, group])],
    ]);
    assert.equal(fresh.profile.preferencesRevision, 9);
    await fresh.context.close();
    console.log('Onboarding browser: a fresh role and group each save once using their expected revision.');

    const stale = await fixture(browser, 1, [role], laterRole);
    assert.equal(await choose(stale.page, group), 409);
    await stale.page.getByRole('alert').filter({ hasText: 'Pilihan posisi sudah berubah' }).waitFor();
    assert.equal(await stale.page.getByRole('button', { name: 'Lanjut', exact: true }).isDisabled(), true);
    assert.deepEqual(stale.profile.desiredSelections, [laterRole]);
    await stale.page.getByRole('button', { name: 'Muat pilihan terbaru' }).click();
    await stale.page.getByRole('button', { name: `Hapus ${laterRole.name}` }).waitFor();
    assert.equal(await choose(stale.page, group), 200);
    await finishFromPositions(stale.page);
    assert.deepEqual(stale.profile.desiredSelections, [laterRole, group]);
    assert.equal(stale.profile.preferencesRevision, 9);
    await stale.context.close();
    console.log('Onboarding browser: a concurrent change is preserved across rejection, reload and completion.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
