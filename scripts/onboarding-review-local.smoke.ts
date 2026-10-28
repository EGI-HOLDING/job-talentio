import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { JwtService } from '../apps/api/node_modules/@nestjs/jwt';
const { config, assertDemoUrl } = require('./lib/hr-demo-env.cjs');
const { createReview, selectedReview } = require('./lib/load-onboarding-review.cjs')();
const parsed = require('./fixtures/incomplete-onboarding-cv.cjs');

async function main() {
  const { env } = config({ realAuth: true }); assertDemoUrl(env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } }), jwt = new JwtService();
  const ids: string[] = [], report: { checks: string[]; errors: string[] } = { checks: [], errors: [] };
  const out = path.resolve('output/onboarding-review'); fs.mkdirSync(out, { recursive: true });
  let browser: any, activePage: any;
  const country = await db.country.findFirstOrThrow({ where: { isActive: true, archivedAt: null } });
  async function fixture() {
    const user = await db.user.create({ data: { role: 'EMPLOYEE', locale: 'id', email: 'review-' + randomUUID() + '@example.invalid', fullName: 'Local CV Review', employeeProfile: { create: { onboardingStatus: 'IN_PROGRESS', onboardingStep: 5, desiredPositions: ['Frontend Developer'], desiredPosition: 'Frontend Developer', residenceCountryId: country.id, preferredCountries: { connect: { id: country.id } } } } }, include: { employeeProfile: true } });
    ids.push(user.id); const profile = user.employeeProfile!;
    const resume = await db.resume.create({ data: { profileId: profile.id, title: 'CV-review-fixture.pdf', parseStatus: 'READY', parseGeneration: 1, parsedAt: new Date(), parsedData: parsed } });
    await db.employeeProfile.update({ where: { id: profile.id }, data: { onboardingDraft: { resumeId: resume.id, resumeGeneration: 1 } } });
    const token = jwt.sign({ sub: user.id, tv: 0 }, { secret: env.JWT_SECRET, expiresIn: '15m' });
    const call = async (method: string, body?: any, suffix = '') => { const response = await fetch('http://localhost:4000/api/profiles/me/onboarding' + suffix, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() as any }; };
    return { user, profile, resume, token, call };
  }
  try {
    const f = await fixture(), review = createReview(parsed), body = { step: 5, resumeId: f.resume.id, resumeGeneration: 1, reviewState: review, review: null };
    assert.equal((await f.call('PATCH', body)).status, 200); assert.equal((await f.call('GET')).data.draft.reviewState.data.experiences.length, 10);
    assert.equal(await db.workExperience.count({ where: { profileId: f.profile.id } }), 0);
    const editing = structuredClone(review); editing.data.skills[0] = ''; editing.data.educations[0].school = '';
    assert.equal((await f.call('PATCH', { ...body, reviewState: editing })).status, 200);
    assert.equal((await f.call('GET')).data.draft.reviewState.data.skills[0], '');
    const invalid = structuredClone(review); invalid.experiences[0] = true;
    assert.equal((await f.call('POST', { ...body, reviewState: invalid, review: selectedReview(invalid) }, '/complete')).status, 400);
    assert.equal((await f.call('GET')).data.status, 'IN_PROGRESS');
    const completed = await f.call('POST', { ...body, review: selectedReview(review) }, '/complete'); assert.equal(completed.status, 201); assert.equal(completed.data.status, 'COMPLETED');
    assert.equal(await db.workExperience.count({ where: { profileId: f.profile.id } }), 7); assert.equal(await db.workExperience.count({ where: { profileId: f.profile.id, title: '' } }), 0);
    assert.equal((await f.call('POST', {}, '/complete')).status, 201); assert.equal(await db.workExperience.count({ where: { profileId: f.profile.id } }), 7);
    report.checks.push('Actual API accepts partial draft/edit/reload; incomplete final import rejected; seven reviewed experiences imported exactly once');
    if (!process.argv.includes('--api-only')) {
      const runtime = process.env.CODEX_BROWSER_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
      const { chromium } = require(require.resolve('playwright', { paths: [runtime] }));
      browser = await chromium.launch({ headless: true, executablePath: process.env.LINKEDIN_TEST_BROWSER || 'C:/Users/egi_i/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
      for (const width of [390, 1280]) {
        const f = await fixture(), context = await browser.newContext({ viewport: { width, height: 1000 } });
        const session = { accessToken: f.token, user: { id: f.user.id, email: f.user.email, fullName: f.user.fullName, role: 'EMPLOYEE', locale: 'id', employeeOnboarding: { status: 'IN_PROGRESS', step: 5 } } };
        await context.addInitScript((value: any) => { if (location.origin === 'http://localhost:3000') { localStorage.setItem('jt_token', value.accessToken); localStorage.setItem('jt_session', JSON.stringify(value)); } }, session);
        await context.route('**/*', (route: any) => { if (!['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)) return route.abort(); return route.continue(); });
        const page = await context.newPage(); activePage = page; page.on('pageerror', (error: Error) => report.errors.push(error.name));
        page.on('response', (response: any) => { if (response.url().includes('/profiles/me/onboarding') && response.status() >= 400) report.errors.push('Onboarding HTTP ' + response.status()); });
        await page.goto('http://localhost:3000/id/onboarding/employee'); await page.getByRole('heading', { name: 'Periksa pengalaman dari CV' }).waitFor();
        const saved = () => page.getByText('Progres tersimpan', { exact: true }).waitFor(); await saved();
        const cards = page.locator('article').filter({ hasText: 'Example Studio' }); assert.equal(await cards.count(), 10);
        assert.equal(await cards.locator('input[type=checkbox]:checked').count(), 7);
        assert.equal(await page.getByText('Lengkapi posisi, perusahaan, dan tanggal mulai melalui Edit sebelum memilih pengalaman ini.', { exact: true }).count(), 3);
        assert.ok((await f.call('GET')).data.draft.reviewState); assert.equal((await f.call('GET')).data.draft.review, null);
        await cards.first().getByRole('button', { name: 'Edit', exact: true }).click(); const dialog = page.getByRole('dialog');
        await dialog.locator('input[name=title]').fill('Reviewed engineer'); await dialog.getByRole('button', { name: /Simpan pengalaman/ }).click(); await dialog.waitFor({ state: 'hidden' });
        await cards.first().getByRole('checkbox').check(); await saved();
        await page.getByRole('textbox', { name: 'Keahlian', exact: true }).fill(''); await saved();
        await page.getByRole('button', { name: /Simpan & selesai/ }).click(); await page.getByRole('alert').filter({ hasText: 'Lengkapi data CV yang dipilih' }).waitFor();
        await page.getByRole('textbox', { name: 'Keahlian', exact: true }).fill('React');
        const education = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Pendidikan' }) });
        await education.getByRole('checkbox').uncheck(); await education.getByRole('textbox', { name: 'Pendidikan', exact: true }).fill(''); await saved();
        await page.reload(); await page.getByRole('heading', { name: 'Periksa pengalaman dari CV' }).waitFor(); await saved();
        assert.equal(await cards.first().getByRole('checkbox').isChecked(), true); assert.equal(await education.getByRole('checkbox').isChecked(), false); assert.equal(await education.getByRole('textbox', { name: 'Pendidikan', exact: true }).inputValue(), '');
        const size = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.viewport + 1);
        await page.screenshot({ path: path.join(out, 'review-' + width + '.png'), fullPage: true });
        await page.getByRole('button', { name: /Simpan & selesai/ }).click(); await page.waitForURL((url: URL) => url.pathname === '/id/jobs');
        assert.equal((await f.call('GET')).data.status, 'COMPLETED'); assert.equal(await db.workExperience.count({ where: { profileId: f.profile.id } }), 8); assert.equal(await db.education.count({ where: { profileId: f.profile.id } }), 0);
        await context.close(); report.checks.push('Browser ' + width + ': autosave, incomplete roles excluded, role edit, selected empty field validation, exclusions persist on refresh, complete with eight experiences');
      }
      assert.deepEqual(report.errors, []);
    }
    console.log('PASS onboarding review integration:', report.checks.length, 'checks');
  } catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'CV review integration failed'); process.exitCode = 1; });
