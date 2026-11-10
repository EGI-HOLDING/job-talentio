const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = createRequire(path.join(runtime, 'playwright/package.json'))('playwright');
const base = process.env.RECRUITMENT_WEB_URL || 'http://127.0.0.1:3037';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const out = process.env.AI_RELIABILITY_OUTPUT || path.resolve('output/ai-reliability');
fs.mkdirSync(out, { recursive: true });
const report = { test: 'login-hydration', checks: [], passwordInUrl: false, attempts: 0 };

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const role of ['EMPLOYEE', 'RECRUITER']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      let release = () => {};
      const scripts = new Promise(resolve => { release = resolve; });
      try {
        await context.route('**/_next/static/**/*.js', async route => { await scripts; await route.continue(); });
        await context.route('**/api/**', async route => {
          if (new URL(route.request().url()).pathname === '/api/auth/login') {
            report.attempts++;
            const data = route.request().postDataJSON();
            assert.equal(data.expectedRole, role);
            return route.fulfill({ status: 401, json: { message: 'Synthetic login response' } });
          }
          return route.fulfill({ status: 200, json: [] });
        });
        const page = await context.newPage();
        page.on('request', request => {
          if (new URL(request.url()).searchParams.has('password')) report.passwordInUrl = true;
        });
        const url = base + '/id/login?role=' + role;
        const html = await (await fetch(url)).text();
        const serverForm = /<form\b[^>]*class="form-stack"/.test(html);
        await page.goto(url, { waitUntil: 'commit' });
        const form = page.locator('form.form-stack');
        const submit = form.locator('button[type="submit"]');
        if (serverForm) {
          await submit.waitFor({ state: 'attached', timeout: 30000 });
          assert.equal(await form.getAttribute('method'), 'post', 'The HTML form must not default to GET');
          assert.equal(await submit.isDisabled(), true, 'Server-rendered submit waits for hydration');
          await form.locator('input[name="email"]').fill('hydration-test@synthetic.test');
          await form.locator('input[name="password"]').fill('SyntheticPasswordOnly');
          await form.locator('input[name="password"]').press('Enter');
          await submit.evaluate(button => button.click());
          await page.waitForTimeout(150);
        } else {
          report.checks.push(role + ' has no credential form in the static HTML while scripts are held');
        }
        assert.equal(report.passwordInUrl, false);
        assert.equal(report.attempts, role === 'EMPLOYEE' ? 0 : 1);
        release();
        await page.waitForFunction(() => { const submit = document.querySelector('form button[type="submit"]'); return submit && !submit.disabled; }, undefined, { timeout: 30000 });
        assert.equal(await form.getAttribute('method'), 'post');
        await form.locator('input[name="email"]').fill('hydration-test@synthetic.test');
        await form.locator('input[name="password"]').fill('SyntheticPasswordOnly');
        const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
        await submit.click();
        assert.equal((await result).status(), 401);
        await page.getByText('Synthetic login response', { exact: true }).waitFor();
        assert.equal(report.passwordInUrl, false);
        report.checks.push(role + ' waits before hydration and sends credentials through the API after hydration');
      } finally { release(); await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
    }
    assert.equal(report.attempts, 2);
    report.passed = true;
  } finally { await browser.close(); }
}
main().catch(error => { report.failure = error.message; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out, 'login-hydration-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
