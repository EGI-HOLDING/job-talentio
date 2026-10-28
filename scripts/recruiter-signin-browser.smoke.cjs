// Local demo only. Creates and removes one dedicated regression account/company.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const {chromium} = require(require.resolve('playwright', {paths: [process.env.CODEX_BROWSER_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const {config, assertDemoUrl, req} = require('./lib/hr-demo-env.cjs');
async function main() {
  const {env} = config(); assertDemoUrl(env.DATABASE_URL);
  const db = new (req('@prisma/client').PrismaClient)({datasources: {db: {url: env.DATABASE_URL}}});
  const email = `signin-regression-${Date.now()}@example.test`, password = 'Regression-pass-123!';
  const browser = await chromium.launch({headless: true, executablePath: process.env.LINKEDIN_TEST_BROWSER || 'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
  const out = path.resolve('output/recruiter-signin'); fs.mkdirSync(out, {recursive: true});
  let companyId;
  try {
    const context = await browser.newContext(), page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3000/en/register?role=RECRUITER');
    assert.equal(await page.locator('input[name=companyName]').count(), 0);
    await page.locator('input[name=fullName]').fill('Sign-in regression HR');
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.locator('input[name=confirmPassword]').fill(password);
    await page.locator('form input[type=checkbox]').check();
    await page.locator('form button[type=submit]').click();
    await page.waitForURL(/\/onboarding\/recruiter/, {timeout: 30000});
    const name = page.getByRole('textbox', {name: /Company name/}); await name.waitFor();
    assert.equal(await name.inputValue(), '', 'company details start in onboarding');
    await name.fill('Sign-in regression company ' + Date.now());
    const saved = page.waitForResponse(response => response.url().endsWith('/recruiter-onboarding') && response.request().method() === 'PATCH');
    await page.locator('form textarea').fill('A company profile for the local sign-in regression.'); await saved;
    await page.reload(); await name.waitFor(); assert.match(await name.inputValue(), /^Sign-in regression company/);
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 1000});
      const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll <= dimensions.width + 1, 'no horizontal overflow at ' + width);
      await page.screenshot({path: path.join(out, `onboarding-${width}.png`), fullPage: true});
    }
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('jt_session')));
    const city = await db.city.findFirstOrThrow({where: {kind: {in: ['CITY', 'REGENCY']}, archivedAt: null, province: {archivedAt: null, country: {isActive: true, archivedAt: null}}}, include: {province: true}});
    const industry = await db.industry.findFirstOrThrow({where: {archivedAt: null}});
    const api = async (route, body) => {
      const response = await fetch('http://localhost:4000/api' + route, {method: 'PATCH', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + session.accessToken}, body: JSON.stringify(body)});
      assert.ok(response.ok, await response.text());
    };
    await api('/recruiter-onboarding', {companyId: null, step: 1, companyDraft: {name: await name.inputValue(), description: 'A company profile for the local sign-in regression.', website: '', size: 'SIZE_1_10', countryId: city.province.countryId, citySlug: city.slug, industrySlug: industry.slug}});
    await page.reload(); await name.waitFor();
    await page.locator('form').locator('button').last().click();
    await page.getByRole('heading', {name: 'Create your first job', exact: true, level: 1}).waitFor();
    companyId = (await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: session.user.id}})).companyId;
    await page.getByRole('button', {name: 'Do this later, open dashboard'}).click();
    await page.waitForURL(/\/dashboard\/recruiter/);
    await context.clearCookies(); await page.evaluate(() => localStorage.clear());
    await page.goto('http://localhost:3000/en/login?role=RECRUITER');
    await page.locator('input[name=email]').fill(email); await page.locator('input[name=password]').fill(password);
    await page.locator('form button[type=submit]').click(); await page.waitForURL(/\/dashboard\/recruiter/);
    assert.equal(await page.getByRole('textbox', {name: /Company name/}).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS local desktop/mobile: registration without company gate, direct onboarding, draft reload, company save, finish, returning login to workspace.');
  } finally {
    await browser.close();
    const user = await db.user.findUnique({where: {email}});
    if (user) {
      const state = await db.recruiterOnboarding.findUnique({where: {userId: user.id}});
      companyId ||= state?.companyId;
      await db.user.delete({where: {id: user.id}});
    }
    if (companyId) await db.company.delete({where: {id: companyId}});
    await db.$disconnect();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
