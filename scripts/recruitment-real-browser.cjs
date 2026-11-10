// Browser, Nest, database, worker and storage share one disposable recruitment journey.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function playwright() {
  try { return require('playwright'); }
  catch {
    const runtime = process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
    return createRequire(path.join(runtime, 'playwright/package.json'))('playwright');
  }
}

module.exports = async function runBrowserJourney({ base, call, db, employee, hr, foreign, worker, deliver, candidateMail, findVerificationToken, liveVoice, liveText, textUi, voiceEvents, allowed, onboarding, onboardingDraft, makeToken, makePdf }) {
  const web = process.env.RECRUITMENT_WEB_URL || 'http://127.0.0.1:3035';
  const redact = value => value.replace(/(\/screening\/|\/invitations\/open\/)[^/\s?]+/g, '$1[redacted]').replace(/([?&]token=)[^&\s]+/g, '$1[redacted]');
  const isLoopback = url => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
  assert.ok(isLoopback(web) && isLoopback(base) && isLoopback(process.env.S3_ENDPOINT));
  const out = process.env.AI_RELIABILITY_OUTPUT || path.resolve('output/ai-reliability');
  fs.mkdirSync(out, { recursive: true });
  const voiceProbe = liveVoice ? require('./recruitment-voice-live.cjs') : null;
  const wav = voiceProbe?.loadSyntheticAudio(process.env.RELIABILITY_VOICE_WAV);
  const browser = await playwright().chromium.launch({ headless: true });
  const contexts = [];
  const interruptedVoice = liveVoice && process.env.RELIABILITY_VOICE_SCENARIO === 'interrupted-indonesian';
  const timedVoice = liveVoice && process.env.RELIABILITY_VOICE_SCENARIO === 'timed';
  const taraClosesVoice = liveVoice && process.env.RELIABILITY_VOICE_SCENARIO === 'tara-closes';
  const test = liveVoice ? taraClosesVoice ? 'live-browser-voice-tara-closes' : timedVoice ? 'live-browser-voice-timed' : interruptedVoice ? 'live-browser-voice-indonesian-fault' : 'live-browser-voice' : liveText ? process.env.RELIABILITY_TEXT_SCENARIO==='unsupported-injection'?'live-browser-text-unsupported-injection':'live-browser-text' : textUi ? 'browser-text-timing-'+(process.env.RELIABILITY_TEXT_VIEWPORT==='desktop'?'desktop':'mobile') : onboarding ? onboardingDraft ? 'real-browser-hr-onboarding-with-ai' : 'real-browser-hr-onboarding' : 'real-browser-candidate-to-hr';
  const report = { steps: [], exceptions: [], requests: [], provider: liveVoice ? 'real voice and screening, simulated CV scoring' : liveText ? 'real text screening, simulated CV scoring' : onboardingDraft ? 'real job drafting, simulated CV scoring' : 'simulated', test };
  const job = await db.jobPost.create({ data: {
    id: 'http-browser-job', companyId: 'http-co', title: 'Backend Engineer Browser Audit',
    description: 'Mengembangkan API dan layanan backend dengan Node.js.', status: 'PUBLISHED',
    workMode: 'REMOTE', publishedAt: new Date(),
  } });

  async function openContext(token, useAudio = false) {
    const session = token ? { ...await call('/auth/me', token), accessToken: token } : null;
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
    contexts.push(context);
    if (useAudio) await voiceProbe.useSyntheticMicrophone(context, wav, interruptedVoice);
    await context.addInitScript(session => {
      if (session) {
        localStorage.setItem('jt_token', session.accessToken);
        localStorage.setItem('jt_session', JSON.stringify(session));
      }
      localStorage.setItem('jt_country', 'ID');
    }, session);
    // Forward browser API traffic to the ephemeral Nest port. All responses come from Nest.
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/socket')) {
        const endpoint = new URL(base + url.pathname.slice(4) + url.search);
        const method = request.method();
        const headers = { 'access-control-allow-origin': web, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const forwarded = await request.allHeaders();
        const requestHeaders = Object.fromEntries(['authorization', 'content-type', 'accept-language', 'x-locale', 'idempotency-key'].filter(key => forwarded[key]).map(key => [key, forwarded[key]]));
        const response = await fetch(endpoint, { method, headers: requestHeaders, body: request.postDataBuffer() ?? undefined, redirect: 'manual', signal: AbortSignal.timeout(liveVoice || onboardingDraft ? 50000 : 20000) });
        report.requests.push({ method, path: redact(url.pathname), status: response.status });
        const contentType = response.headers.get('content-type');
        if (contentType) headers['content-type'] = contentType;
        return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      }
      if ([web, process.env.S3_ENDPOINT].includes(url.origin)) return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.exceptions.push(redact(error.message)));
    return page;
  }

  async function loginUser(userId, page) {
    const apiRequire = createRequire(path.resolve('apps/api/package.json'));
    const password = 'SyntheticAuditOnly-729!Local';
    const user = await db.user.update({ where: { id: userId }, data: {
      passwordHash: await apiRequire('bcryptjs').hash(password, 4), locale: 'id',
    } });
    const target = page || await openContext(null);
    await target.goto(web + '/id/login?role=' + user.role, { waitUntil: 'domcontentloaded' });
    await target.waitForLoadState('networkidle', { timeout: 30000 });
    await target.locator('input[name="email"]').fill(user.email);
    await target.locator('input[name="password"]').fill(password);
    const response = target.waitForResponse(item => new URL(item.url()).pathname === '/api/auth/login' && item.request().method() === 'POST');
    await target.locator('form button[type="submit"]').click();
    assert.equal((await response).status(), 201);
    await target.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 30000 });
    assert.equal(await target.evaluate(() => JSON.parse(localStorage.getItem('jt_session')).user.id), userId);
    return target;
  }

  async function logoutAndReturn(page, userId, destination) {
    await page.locator('button[aria-controls="workspace-account-menu"]').click();
    await page.locator('#workspace-account-menu').getByRole('button', { name: 'Keluar', exact: true }).click();
    await page.waitForFunction(() => !localStorage.getItem('jt_token') && !localStorage.getItem('jt_session'));
    await loginUser(userId, page);
    await page.goto(destination, { waitUntil: 'domcontentloaded' });
  }

  try {
    if (onboarding) {
      await db.featureFlag.upsert({ where: { key: 'hr_packages' }, create: { key: 'hr_packages', enabled: true }, update: { enabled: true } });
      await require('./recruitment-onboarding-real.cjs')({ web, db, openContext, makeToken, makePdf, worker, report, onboardingDraft });
      assert.deepEqual(report.exceptions, []);
      report.passed = true;
      return;
    }
    await db.employeeProfile.update({ where: { userId: 'http-employee' }, data: { onboardingStatus: 'COMPLETED', onboardingStep: 3, phone: '+6281234567890' } });
    await db.recruiterOnboarding.upsert({ where: { userId: 'http-hr' }, create: { userId: 'http-hr', status: 'COMPLETE', step: 3, companyId: 'http-co' }, update: { status: 'COMPLETE', step: 3, companyId: 'http-co' } });
    const candidate = await loginUser('http-employee');
    await candidate.goto(web + '/id/jobs/' + job.id, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await candidate.getByRole('button', { name: /Lamar sekarang/i }).first().click({ timeout: 60000 });
    const picker = candidate.getByRole('dialog', { name: 'Pilih CV untuk melamar' });
    await picker.getByRole('radio', { name: /CV.pdf/i }).check();
    const submit = picker.getByRole('button', { name: 'Lamar dengan CV ini', exact: true });
    await submit.evaluate(button => { button.click(); button.click(); });
    await candidate.getByText(/^Sudah dilamar/).first().waitFor({ timeout: 30000 });
    assert.equal(report.requests.filter(req => req.method === 'POST' && req.path === '/api/applications/jobs/' + job.id).length, 1);
    assert.equal(await db.aiScreeningSession.count({ where: { jobId: job.id } }), 0);
    const application = await db.application.findFirstOrThrow({ where: { jobPostId: job.id } });
    await candidate.reload({ waitUntil: 'domcontentloaded' });
    await candidate.getByText(/^Sudah dilamar/).first().waitFor({ timeout: 30000 });
    report.steps.push('Browser applies once with the existing CV, survives reload, and creates no screening session.');
    await logoutAndReturn(candidate, 'http-employee', web + '/id/jobs/' + job.id);
    await candidate.getByText(/^Sudah dilamar/).first().waitFor({ timeout: 30000 });
    employee = await candidate.evaluate(() => localStorage.getItem('jt_token'));
    assert.equal(await db.application.count({ where: { jobPostId: job.id } }), 1);
    report.steps.push('The candidate logs out through the account menu, logs back in through the password form and still sees one saved application.');


    await worker.onModuleInit();
    const deadline = Date.now() + 25000;
    let row;
    do {
      row = await db.recruitmentCandidate.findUnique({ where: { applicationId: application.id } });
      if (row?.scoreStatus === 'READY') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert.equal(row?.scoreStatus, 'READY');
    assert.equal(row.cvScore, 75);
    assert.equal(await db.aiScreeningWork.count({ where: { subjectId: row.id, kind: 'CV_SCORE' } }), 1);
    await call('/recruitment/jobs/' + job.id + '/applications/' + application.id + '/candidate', foreign, null, 'GET', 403);

    const dashboard = await loginUser('http-hr');
    await dashboard.goto(web + '/id/dashboard/recruiter/jobs/' + job.id + '?company=http-co', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await dashboard.getByRole('button', { name: 'HTTP Candidate', exact: true }).click({ timeout: 60000 });
    const drawer = dashboard.getByRole('dialog', { name: 'HTTP Candidate' });
    report.steps.push('HR dashboard opened the candidate drawer.');
    await drawer.getByText('Kecocokan CV', { exact: true }).waitFor({ timeout: 12000 });
    await drawer.getByText('75%', { exact: true }).waitFor({ timeout: 12000 });
    await drawer.getByText('Tertulis di CV.', { exact: true }).first().waitFor({ timeout: 12000 });
    report.steps.push('Durable worker scores once; HR browser displays score and reason; foreign recruiter receives 403.');
    await drawer.getByRole('button', { name: 'Tutup detail kandidat', exact: true }).click();
    await logoutAndReturn(dashboard, 'http-hr', web + '/id/dashboard/recruiter/jobs/' + job.id + '?company=http-co');
    await dashboard.getByRole('button', { name: 'HTTP Candidate', exact: true }).click({ timeout: 30000 });
    await drawer.getByText('75%', { exact: true }).waitFor({ timeout: 12000 });
    hr = await dashboard.evaluate(() => localStorage.getItem('jt_token'));
    report.steps.push('The HR logs out and back in through the password form and sees the original score and candidate.');

    await worker.onModuleDestroy();
    if (!liveVoice && !liveText && !textUi) {
      await require('./recruitment-cv-recovery-browser.cjs')({ db, worker, call, hr, row, dashboard, drawer, job, web, allowed, report });
    }

    const invitation = await call('/recruitment/candidates/' + row.id + '/invitations', hr, { mode: liveVoice ? 'VOICE' : 'TEXT', requestKey: 'http-browser-invite' });
    await deliver(invitation.id);
    const delivered = await db.screeningInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    assert.equal(delivered.emailStatus, 'SENT');
    assert.equal(delivered.messageStatus, 'SENT');
    const message = await db.chatMessage.findUniqueOrThrow({ where: { id: delivered.messageId } });
    const inviteToken = message.body.match(/\/screening\/([^\s]+)/)?.[1];
    assert.ok(inviteToken);
    await db.user.update({ where: { id: 'http-employee' }, data: { emailVerified: false } });
    const invitationPage = await openContext(employee, liveVoice);
    await invitationPage.goto(web + '/id/screening/' + inviteToken, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await invitationPage.getByRole('heading', { name: 'Verifikasi email sebelum mulai' }).waitFor({ timeout: 30000 });
    assert.equal(await invitationPage.getByRole('button', { name: 'Buka interview' }).count(), 0);

    const oldMessages = new Set((await candidateMail()).map(message => message.ID));
    await invitationPage.getByRole('button', { name: 'Kirim email verifikasi' }).click();
    await invitationPage.getByText(/Email verifikasi sudah diminta/).waitFor({ timeout: 15000 });
    const token = await findVerificationToken(oldMessages);
    const verification = await openContext(employee);
    const verified = verification.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/verify-email' && response.request().method() === 'POST');
    await verification.goto(web + '/id/verify-email?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded' });
    assert.equal((await verified).status(), 201);
    await invitationPage.bringToFront();
    await invitationPage.getByRole('button', { name: /Saya sudah verifikasi/ }).click({ timeout: 15000 }).catch(async error => {
      if (!await invitationPage.getByRole('button', { name: 'Buka interview' }).isVisible()) throw error;
    });
    const claimed = invitationPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/claim') && response.request().method() === 'POST');
    await invitationPage.getByRole('button', { name: 'Buka interview' }).click({ timeout: 15000 });
    assert.equal((await claimed).status(), 201);
    const invitationWithSession = await db.screeningInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    assert.ok(invitationWithSession.sessionId);
    assert.equal(invitationWithSession.claimedUserId, 'http-employee');
    report.steps.push('An invitation delivered by SMTP and Talentio opens after verification in a separate browser context with the original tab kept open.');
    const screening = { page: invitationPage, dashboard, drawer, db, worker, call, hr, foreign, sessionId: invitationWithSession.sessionId, invitationId: invitation.id, report, allowed, voiceEvents };
    if (voiceProbe) await voiceProbe.verifyVoice({ ...screening, interruptedVoice, timedVoice, taraClosesVoice });
    if (liveText || textUi) await require('./recruitment-text-live.cjs')({ ...screening, textUi });
    assert.deepEqual(report.exceptions, []);
    report.passed = true;
  } catch (error) {
    report.failure = redact(error.message);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, test + '.json'), JSON.stringify(report, null, 2));
    for (const context of contexts) await context.unrouteAll({ behavior: 'ignoreErrors' });
    await browser.close();
  }
};
