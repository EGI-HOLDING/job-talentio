const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

module.exports = async function verifyRankingUi({ base, token, companyId, jobId, score, out }) {
  const runtime = process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
  const { chromium } = createRequire(path.join(runtime, 'playwright/package.json'))('playwright');
  const web = process.env.RECRUITMENT_WEB_URL || 'http://127.0.0.1:3037';
  assert.ok([base, web, process.env.S3_ENDPOINT].every(value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname)));
  const response = await fetch(base + '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  assert.ok(response.ok);
  const session = { ...await response.json(), accessToken: token };
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
    await context.addInitScript(session => {
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_session', JSON.stringify(session));
      localStorage.setItem('jt_country', 'ID');
    }, session);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/socket')) {
        const headers = {
          'access-control-allow-origin': web,
          'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
          'access-control-allow-headers': '*',
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const source = await request.allHeaders();
        const forwarded = Object.fromEntries(['authorization', 'content-type', 'accept-language'].filter(key => source[key]).map(key => [key, source[key]]));
        const actual = await fetch(base + url.pathname.slice(4) + url.search, {
          method: request.method(), headers: forwarded, body: request.postDataBuffer() ?? undefined,
          signal: AbortSignal.timeout(20000),
        });
        headers['content-type'] = actual.headers.get('content-type') || 'application/json';
        return route.fulfill({ status: actual.status, headers, body: Buffer.from(await actual.arrayBuffer()) });
      }
      if ([new URL(web).origin, new URL(process.env.S3_ENDPOINT).origin].includes(url.origin)) return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(web + '/id/dashboard/recruiter/jobs/' + jobId + '?company=' + companyId, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'Dinda Pramesti', exact: true }).waitFor({ timeout: 30000 });
    await page.locator('tbody').getByText(score + '%', { exact: true }).waitFor();
    const firstVisibleAt = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Dinda Pramesti', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Dinda Pramesti', exact: true });
    await drawer.getByText(score + '%', { exact: true }).waitFor();
    await drawer.locator('blockquote').first().waitFor();
    await page.screenshot({ path: path.join(out, 'live-cv-ranking-ui.png') });
    assert.deepEqual(errors, []);
    return { firstVisibleAt, refreshedScore: score, evidenceVisible: true, pageErrors: errors };
  } finally { await browser.close(); }
};
