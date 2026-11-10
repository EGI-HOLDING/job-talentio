const assert = require('node:assert/strict');

const origin = process.env.POSITION_PICKER_WEB || 'http://localhost:3000';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const title = 'Artificial Intelligence Engineer';
const screen = process.env.POSITION_PICKER_SCREEN || 'alerts';
const aiRole = { kind: 'ROLE', id: 'jobcat_8a08d1d416693424d82fa97d5fa6328e', name: title };
const session = { accessToken: 'position-picker-browser-fixture', user: {
  id: 'position-picker-browser', role: screen === 'hr' ? 'RECRUITER' : screen === 'admin' ? 'SUPER_ADMIN' : 'EMPLOYEE', fullName: 'Catalog QA',
  locale: 'id', employeeOnboarding: { status: 'COMPLETED', step: 5 },
} };
const company = { id: 'position-picker-company', name: 'Catalog QA' };
const memberships = [{ companyId: company.id, role: 'OWNER', company }];
if (screen === 'hr') Object.assign(session.user, { memberships, recruiterOnboarding: { status: 'IN_PROGRESS', step: 2 } });
const hrSession = { id: 'position-picker-draft', companyId: company.id, company, phase: 'JOB',
  revision: 0, order: { code: 'FREE', status: 'PAID', amount: 0 }, draft: {} };
const profile = {
  id: 'position-picker-profile', user: session.user, phone: '+628123456789',
  desiredSelections: process.env.POSITION_PICKER_ALREADY_SELECTED === 'true' ? [aiRole] : [],
  preferencesRevision: 0, desiredPositions: [], preferredCountries: [], preferredWorkModes: [],
  experiences: [], educations: [], certifications: [], skills: [], languages: [], resumes: [],
};
if (screen === 'cv') profile.resumes.push({ id: 'cv-fixture', title: 'CV QA', hasFile: true,
  currentVersionId: 'cv-version-fixture', isPrimary: true, parseStatus: 'READY', updatedAt: '2026-11-10T00:00:00.000Z' });
const cvEvidence = { versionId: 'cv-version-fixture', status: 'READY', revision: 1, conflicts: [],
  facts: { roles: [{ key: 'qa-cv-role', title: 'Original CV title', source: 'PARSER', confirmed: false }],
    experiences: [], languages: [], skills: [] } };

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    let savedAlert;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'id' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.addInitScript(({ origin, session }) => {
      if (location.origin !== origin) return;
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_session', JSON.stringify(session));
      localStorage.setItem('jt_admin_token', session.accessToken);
    }, { origin, session });
    // Exercise the actual web release and its actual public catalog requests.
    // Stub account data so the probe cannot create or modify production alerts.
    await context.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/meta/')) {
        if (origin === 'http://localhost:3102' && new URL(request.url()).origin === 'http://localhost:4100') {
          const response = await route.fetch({ headers: { ...await request.allHeaders(), origin: 'http://localhost:3100' } });
          return route.fulfill({ response, headers: { ...response.headers(), 'Access-Control-Allow-Origin': origin } });
        }
        return route.continue();
      }
      if (path === '/api/admin/positions/search') {
        const url = new URL(request.url());
        url.pathname = '/api/meta/positions/search';
        url.searchParams.set('scope', 'role');
        const upstream = await route.fetch({ url: url.toString(), headers: { 'X-Locale': 'en' } });
        return route.fulfill({ response: upstream, headers: { 'Access-Control-Allow-Origin': origin } });
      }
      if (screen === 'filter' && path === '/api/jobs') {
        const headers = await request.allHeaders();
        delete headers.authorization;
        return route.continue({ headers });
      }
      if (path === '/api/alerts' && request.method() === 'POST') {
        const body = request.postDataJSON();
        assert.deepEqual(body.positionSelections, [{ id: aiRole.id, kind: 'ROLE' }]);
        assert.equal(body.query, undefined);
        savedAlert = { ...body, id: 'fixture-alert', isActive: true, positionSelections: [aiRole] };
        return route.fulfill({ json: savedAlert, headers: { 'Access-Control-Allow-Origin': origin } });
      }
      if (path === '/api/hr-flow/sessions/' + hrSession.id && request.method() === 'PATCH') {
        hrSession.draft = request.postDataJSON().draft;
        hrSession.revision++;
      }
      if (path === '/api/profiles/me' && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        assert.deepEqual(body.desiredSelections, [{ id: aiRole.id, kind: 'ROLE' }]);
        profile.desiredSelections = [aiRole];
        profile.preferencesRevision++;
      }
      if (screen === 'onboarding' && path === '/api/profiles/me/onboarding' && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        if (body.desiredSelections) {
          profile.desiredSelections = body.desiredSelections.map(selection => ({ ...selection, name: title }));
          profile.preferencesRevision++;
        }
      }
      if (screen === 'cv' && path.endsWith('/matching-evidence') && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        assert.equal(body.kind, 'ROLE');
        assert.equal(body.revision, cvEvidence.revision);
        assert.deepEqual(body.value, { title: 'Original CV title', jobTitleId: aiRole.id });
        cvEvidence.facts.roles[0] = { ...cvEvidence.facts.roles[0], ...body.value, confirmed: true };
        cvEvidence.revision++;
      }
      const data = path.endsWith('/auth/me') ? session
        : path.endsWith('/profiles/me/onboarding') ? screen === 'onboarding' ? { status: 'IN_PROGRESS', step: 1, profile } : { status: 'COMPLETED', profile: { phone: '+628123456789' } }
        : path.endsWith('/profiles/me') ? profile
        : path === '/api/alerts' ? savedAlert ? [savedAlert] : []
        : path.endsWith('/matching-evidence') ? cvEvidence
        : path.endsWith('/admin/occupation-relations') ? { items: [], total: 0, totalPages: 1, overrides: [] }
        : path.endsWith('/recruiter-onboarding') ? { status: 'IN_PROGRESS', companyId: company.id, memberships,
          creationSessionId: hrSession.id, flowVersion: 2, phase: 'JOB' }
        : path.endsWith('/job-commerce/catalog') ? { hrFlowV2: true, packages: [{ code: 'FREE', amount: 0 }] }
        : path === '/api/hr-flow/sessions/' + hrSession.id ? hrSession
        : [];
      return route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': origin } });
    });
    const page = await context.newPage();
    const trace = [];
    page.on('response', async response => {
      const url = new URL(response.url());
      if (!(url.pathname.startsWith('/api/meta/') || url.pathname === '/api/admin/positions/search') || !url.searchParams.get('q')) return;
      const data = await response.json().catch(() => null);
      trace.push({ path: url.pathname, query: url.searchParams.get('q'), status: response.status(),
        ids: data?.items?.slice(0, 5).map(row => row.id) });
    });
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/meta/')) trace.push({ path: url.pathname, failure: request.failure()?.errorText });
    });
    try {
      const path = screen === 'filter' ? '/id/jobs?mode=all' : screen === 'hr' ? '/id/onboarding/recruiter'
        : screen === 'onboarding' ? '/id/onboarding/employee'
        : screen === 'cv' ? '/id/dashboard/employee?tab=profile&section=cvs'
        : screen === 'admin' ? '/occupation-relations'
        : '/id/dashboard/employee?tab=' + screen + (screen === 'profile' ? '&section=preferences' : '');
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      if (screen === 'alerts') await page.getByRole('button', { name: /buat alert|buat pemberitahuan/i }).first().click({ timeout: 20000 });
      if (screen === 'filter') {
        await page.getByRole('button', { name: /^Filter$/i }).first().click({ timeout: 20000 });
        await page.locator('summary').filter({ hasText: 'Filter lainnya' }).click();
      }
      if (screen === 'cv') {
        await page.getByRole('button', { name: 'Tinjau bukti kecocokan CV' }).click();
        await page.getByRole('button', { name: 'Tinjau / koreksi' }).click();
      }
      if (screen === 'profile' && !await page.getByRole('dialog').isVisible()) {
        const open = page.getByRole('button', { name: /edit informasi dasar|perbarui profil/i }).first();
        await open.or(page.getByRole('dialog')).first().waitFor({ timeout: 15000 });
        if (!await page.getByRole('dialog').isVisible()) await open.click();
      }
      const picker = screen === 'filter' ? page.getByRole('combobox', { name: 'Posisi', exact: true })
        : ['hr', 'onboarding'].includes(screen) ? page.getByRole('combobox', { name: /posisi yang dicari/i })
        : screen === 'admin' ? page.getByRole('combobox', { name: 'Source profession' })
        : page.getByRole('dialog').getByRole('combobox', { name: screen === 'profile' ? /posisi yang dicari|jabatan yang dicari/i : undefined }).first();
      for (const method of ['paste', 'type']) {
        await picker.fill('');
        if (method === 'paste') {
          await page.evaluate(value => navigator.clipboard.writeText(value), title);
          await picker.press('Control+v');
        } else await picker.pressSequentially(title);
        const option = page.getByRole('option').filter({ hasText: title }).first();
        await option.waitFor({ state: 'visible', timeout: 15000 });
        trace.push({ method, visible: await option.innerText() });
      }
      if (process.env.POSITION_PICKER_EXPECT_NEW === 'true') {
        assert(trace.some(row => row.path === (screen === 'admin' ? '/api/admin/positions/search' : '/api/meta/positions/search')
          && row.query === title && row.status === 200));
        if (screen === 'filter') await picker.fill('AI Engineer');
        const option = page.getByRole('option').filter({ hasText: title }).first();
        if (screen === 'profile' && profile.desiredSelections.length) {
          assert.equal(await option.getAttribute('aria-selected'), 'true');
          if (process.env.POSITION_PICKER_MULTI === 'true') {
            const search = async (name, selectableOnly = false) => {
              await picker.fill(name);
              let rows = page.getByRole('option').filter({ has: page.getByText(name, { exact: true }) });
              if (selectableOnly) rows = rows.and(page.locator('[aria-disabled="false"]'));
              const row = rows.first();
              await row.waitFor({ state: 'visible' });
              return row;
            };
            for (const name of ['Chef', 'Cook', 'Backend Developer', 'Frontend Developer', 'Data Engineer',
              'Accountant', 'Sales Manager', 'Civil Engineer', 'Mechanical Engineer']) {
              await (await search(name, true)).click();
              await page.getByRole('button', { name: 'Hapus ' + name, exact: true }).waitFor({ state: 'visible', timeout: 5000 });
            }
            const extra = await search('Software Developer');
            trace.push({ chipLabels: await page.getByRole('button', { name: /^Hapus / }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))),
              extraSelected: await extra.getAttribute('aria-selected') });
            assert.equal(await extra.getAttribute('aria-disabled'), 'true');
            await picker.press('Escape');
            const remove = page.getByRole('button', { name: new RegExp(title, 'i') });
            await remove.click();
            assert.equal(await (await search('Software Developer')).getAttribute('aria-disabled'), 'false');
          }
        } else if (screen === 'onboarding') {
          await picker.press('ArrowDown');
          await picker.press('Enter');
        } else await option.click();
        if (screen === 'filter') await page.waitForURL(url => url.searchParams.get('positions') === 'ROLE:' + aiRole.id);
        else if (!(screen === 'profile' && process.env.POSITION_PICKER_MULTI === 'true')) {
          assert(await page.getByRole('button', { name: new RegExp(title, 'i') }).isVisible());
        }
        if (screen === 'hr') {
          const saved = await page.waitForResponse(response => response.request().method() === 'PATCH'
            && new URL(response.url()).pathname === '/api/hr-flow/sessions/' + hrSession.id);
          assert.equal(saved.request().postDataJSON().draft.jobTitleId, aiRole.id);
          assert.equal(saved.request().postDataJSON().draft.positionEntryMode, 'CATALOG');
        }
        if (screen === 'alerts') {
          const dialog = page.getByRole('dialog');
          await dialog.getByRole('textbox').first().fill('Position QA alert');
          await dialog.getByRole('button', { name: /buat pemberitahuan/i }).click();
          await page.getByRole('button', { name: 'Position QA alert', exact: true }).click();
          assert(await page.getByRole('dialog').getByRole('button', { name: new RegExp(title, 'i') }).isVisible());
        }
        if (screen === 'cv') {
          const saved = page.waitForResponse(response => response.request().method() === 'PATCH'
            && new URL(response.url()).pathname.endsWith('/matching-evidence'));
          await page.getByRole('button', { name: /konfirmasi.*simpan/i }).click();
          assert.equal((await saved).status(), 200);
        }
      }
    } finally {
      console.log(JSON.stringify({ screen, trace, options: await page.getByRole('option').allTextContents().catch(() => []) }, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
