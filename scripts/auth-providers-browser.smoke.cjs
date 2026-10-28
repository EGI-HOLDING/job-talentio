// Isolated Chromium, local pages, real provider SDKs. No user credentials or bot messages.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_BROWSER_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const { config, assertDemoUrl, req } = require('./lib/hr-demo-env.cjs');
async function main() {
  const { env } = config({ realAuth: true }); assertDemoUrl(env.DATABASE_URL);
  const db = new (req('@prisma/client').PrismaClient)({ datasources: { db: { url: env.DATABASE_URL } } }), hashes = [];
  const out = path.resolve('output/auth-audit'); fs.mkdirSync(out, { recursive: true });
  const report = { cases: [], providerResults: {}, errors: [] };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LINKEDIN_TEST_BROWSER || 'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
  try {
    const context = await browser.newContext(), page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.name));
    for (const role of ['EMPLOYEE', 'RECRUITER']) for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://localhost:3000/id/login?role=' + role);
      const google = page.locator('.auth-social-gis [role=button]'); await google.waitFor();
      const telegram = page.getByRole('button', { name: 'Lanjutkan dengan Telegram', exact: true }), phone = page.getByRole('button', { name: 'Masuk dengan nomor telepon (melalui Telegram)', exact: true });
      await page.waitForFunction(() => [...document.querySelectorAll('.auth-social-btn')].every(button => !button.disabled));
      assert.equal(await telegram.isEnabled(), true); assert.equal(await phone.isEnabled(), true);
      const size = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.viewport + 1, role + ' ' + width + ': no horizontal overflow');
      assert.ok((await google.boundingBox()).height >= 39, 'Google native button is visible');
      if (role === 'EMPLOYEE' && [390, 1280].includes(width)) await page.screenshot({ path: path.join(out, width === 390 ? 'mobile-login.png' : 'desktop-login.png'), fullPage: true });
      report.cases.push(role + ' login controls responsive ' + width);
    }
    await page.goto('http://localhost:3000/id/login'); await page.locator('.auth-social-gis [role=button]').waitFor();
    const googlePopup = page.waitForEvent('popup'); await page.locator('.auth-social-gis [role=button]').click(); const google = await googlePopup;
    await google.waitForLoadState('domcontentloaded'); assert.equal(new URL(google.url()).hostname, 'accounts.google.com'); await google.getByText('Sign in with Google', { exact: true }).waitFor();
    report.providerResults.google = 'Official Google account login opens; completing a real account sign-in and allowed-origin configuration still requires owner verification'; await google.close();
    const tgPopup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Lanjutkan dengan Telegram', exact: true }).click(); const telegram = await tgPopup; await telegram.waitForLoadState('domcontentloaded');
    assert.equal(new URL(telegram.url()).hostname, 'oauth.telegram.org'); const tgText = await telegram.locator('body').innerText(); report.providerResults.telegram = tgText.includes('Bot domain invalid') ? 'BLOCKED: bot domain has not authorized localhost' : 'Official Telegram authorization opens'; await telegram.close();
    await page.waitForFunction(() => !document.querySelector('.auth-social-btn--phone')?.disabled);
    const tokenResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/phone/telegram/start') && response.request().method() === 'POST'), phonePopup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Masuk dengan nomor telepon (melalui Telegram)', exact: true }).click(); const started = await tokenResponse, start = await started.json(); assert.equal(started.status(), 201); hashes.push(crypto.createHash('sha256').update(start.token).digest('hex'));
    const phone = await phonePopup; await phone.waitForURL(url => url.hostname === 't.me', { waitUntil: 'domcontentloaded' }); await page.getByRole('link', { name: 'Buka Telegram lagi' }).waitFor();
    assert.equal(new URL(phone.url()).pathname.replace('/', ''), start.botUsername); await page.getByRole('button', { name: 'Batal', exact: true }).click(); await phone.close();
    report.providerResults.phone = 'Bot deep link opens and pending sign-in/cancel work; separate local API test verifies own-contact authentication and issued session';
    await context.close(); assert.deepEqual(report.errors, []);
    console.log('PASS real login browser:', report.cases.length, 'responsive cases; Google login opens, phone bot opens; Telegram widget blocked by provider domain registration');
  } finally {
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); await browser.close();
    if (hashes.length) await db.phoneLoginToken.deleteMany({ where: { tokenHash: { in: hashes } } }); await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')); process.exitCode = 1; });
