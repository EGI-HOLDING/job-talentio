// Integration checks use only generated audit accounts in the local database.
// Keep fixtures for browser review; their IDs and sessions stay in ignored cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const { PrismaClient } = apiRequire('@prisma/client');
const bcrypt = apiRequire('bcryptjs');
const PDFDocument = apiRequire('pdfkit');
const pdfParse = apiRequire('pdf-parse');
const root = dotenv.parse(fs.readFileSync(path.join(repo, '.env')));
if (!['localhost', '127.0.0.1'].includes(new URL(root.DATABASE_URL).hostname)) {
  throw new Error('Audit refuses a non-local database');
}
const prisma = new PrismaClient({ datasources: { db: { url: root.DATABASE_URL } } });
const base = 'http://localhost:4000/api';
const runId = Date.now().toString(36);
const password = 'LocalAudit!2026Only';
const state = { runId, password, accounts: {}, checks: [] };
const directory = path.join(repo, 'node_modules/.cache/local-audit');
fs.mkdirSync(directory, { recursive: true });
function persist() {
  const data = JSON.stringify(state, null, 2);
  fs.writeFileSync(path.join(directory, `${runId}.json`), data);
  fs.writeFileSync(path.join(directory, 'fixtures.json'), data);
}

async function request(route, session, method = 'GET', body, expected = [200, 201]) {
  const headers = { 'X-Locale': 'en' };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, {
    method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  assert.ok(expected.includes(response.status),
    `${method} ${route}: expected ${expected.join('/')}, got ${response.status}: ${typeof data?.message === 'string' ? data.message : 'unexpected response'}${data?.errors ? ` ${JSON.stringify(data.errors)}` : ''}`);
  return data;
}
async function check(name, action) {
  try { await action(); state.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { state.checks.push({ name, passed: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  persist();
}
async function register(key, role, extra = {}) {
  const email = `audit-${runId}-${key}@example.test`;
  const session = await request('/auth/register', null, 'POST', {
    email, password, fullName: `Local Audit ${key}`, role, locale: 'en', acceptTerms: true,
    ...(role === 'RECRUITER' ? { companyName: `Local Audit ${runId} ${key}` } : {}),
    ...extra,
  });
  state.accounts[key] = { ...session, email };
  persist();
  return state.accounts[key];
}
async function invitationToken(email) {
  const inbox = await fetch('http://localhost:8025/api/v1/messages?limit=100').then((r) => r.json());
  for (const message of inbox.messages.filter((m) => m.To.some((to) => to.Address === email))) {
    const detail = await fetch(`http://localhost:8025/api/v1/message/${message.ID}`).then((r) => r.json());
    const match = `${detail.HTML} ${detail.Text}`.match(/register\?invite=([a-zA-Z0-9]+)/);
    if (match) return match[1];
  }
  throw new Error('Invitation must reach local Mailpit with a usable token');
}
async function mailActionToken(email, route = 'reset-password') {
  const inbox = await fetch('http://localhost:8025/api/v1/messages?limit=100').then((r) => r.json());
  for (const message of inbox.messages.filter((m) => m.To.some((to) => to.Address === email))) {
    const detail = await fetch(`http://localhost:8025/api/v1/message/${message.ID}`).then((r) => r.json());
    const match = `${detail.HTML} ${detail.Text}`.match(new RegExp(route + '\\?token=([a-zA-Z0-9]+)'));
    if (match) return match[1];
  }
  throw new Error(`${route} must reach local Mailpit with a usable token`);
}
async function verify(session) {
  await request('/auth/request-verification', session, 'POST');
  const inbox = await fetch('http://localhost:8025/api/v1/messages?limit=100').then((r) => r.json());
  const message = inbox.messages.find((m) => m.To.some((to) => to.Address === session.email));
  assert.ok(message, 'verification email must reach local Mailpit');
  const detail = await fetch(`http://localhost:8025/api/v1/message/${message.ID}`).then((r) => r.json());
  const match = `${detail.HTML} ${detail.Text}`.match(/verify-email\?token=([a-zA-Z0-9]+)/);
  assert.ok(match, 'verification email must contain a usable token');
  const attempts = await Promise.allSettled([1, 2].map(() => request('/auth/verify-email', null, 'POST', { token: match[1] })));
  const successes = attempts.filter((result) => result.status === 'fulfilled');
  assert.equal(successes.length, 1, 'verification token must be single use even for concurrent submissions');
  Object.assign(session, successes[0].value);
}

async function testPdf() {
  const doc = new PDFDocument();
  const chunks = [];
  const finished = new Promise((resolve) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  doc.fontSize(18).text('Local Audit Candidate');
  doc.fontSize(12).text('Synthetic CV for local integration tests only.');
  doc.end();
  return finished;
}

async function uploadResume(session, title, bytes) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'audit-cv.pdf');
  form.set('title', title); form.set('parse', 'false');
  return request('/profiles/me/resumes/upload', session, 'POST', form);
}

async function main() {
  await request('/health');
  const employer = await register('employer', 'RECRUITER');
  const outsider = await register('outsider', 'RECRUITER');
  const candidate = await register('candidate', 'EMPLOYEE');
  const otherCandidate = await register('other-candidate', 'EMPLOYEE');
  const adminEmail = `audit-${runId}-admin@example.test`;
  const adminUser = await prisma.user.create({ data: {
    email: adminEmail, fullName: 'Local Audit Admin', role: 'SUPER_ADMIN',
    passwordHash: await bcrypt.hash(password, 10), emailVerified: true, locale: 'en',
  } });
  state.accounts.admin = { ...await request('/auth/login', null, 'POST', { email: adminEmail, password }), email: adminEmail };
  state.adminFixtureId = adminUser.id;
  persist();
  const admin = state.accounts.admin;
  const companyId = employer.user.memberships[0].companyId;
  state.companyId = companyId;

  await check('anonymous access cannot read private account', () => request('/auth/me', null, 'GET', undefined, [401]));
  await check('candidate cannot access admin', () => request('/admin/metrics', candidate, 'GET', undefined, [403]));
  await check('employer cannot use candidate profile endpoint', () => request('/profiles/me', employer, 'GET', undefined, [403]));
  await check('candidate cannot access company jobs', () => request(`/jobs/company/${companyId}`, candidate, 'GET', undefined, [403]));
  await check('other employer cannot read company', () => request(`/companies/${companyId}`, outsider, 'GET', undefined, [403]));
  await check('other employer cannot edit company', () => request(`/companies/${companyId}`, outsider, 'PATCH', { description: 'Cross-company edit must be rejected.' }, [403]));
  await check('wrong login role is rejected', () => request('/auth/login', null, 'POST', { email: candidate.email, password, expectedRole: 'RECRUITER' }, [403]));
  await check('email login ignores casing and surrounding spaces', () => request('/auth/login', null, 'POST', { email: ` ${employer.email.toUpperCase()} `, password, expectedRole: 'RECRUITER' }));
  await check('me reads do not create refresh tokens', async () => {
    const before = await prisma.refreshToken.count({ where: { userId: employer.user.id } });
    await request('/auth/me', employer);
    assert.equal(await prisma.refreshToken.count({ where: { userId: employer.user.id } }), before);
  });
  await check('local employer email verification', () => verify(employer));
  await check('local candidate email verification', () => verify(candidate));
  await check('owner updates company', () => request(`/companies/${companyId}`, employer, 'PATCH', { description: 'Local audit company description with sufficient detail for testing.' }));
  await check('admin dashboard and lists load', async () => {
    for (const route of ['/admin/metrics', '/admin/users?limit=5', '/admin/companies?limit=5', '/admin/jobs?limit=5', '/admin/reports?limit=5', '/admin/verifications?limit=5', '/admin/catalog/i18n/summary', '/admin/flags', '/admin/audit-logs?limit=5']) await request(route, admin);
  });
  await check('admin invalid date filter is a validation error', () => request('/admin/users?createdFrom=not-a-date', admin, 'GET', undefined, [400]));
  await check('admin invalid ban boolean is rejected', () => request(`/admin/users/${otherCandidate.user.id}/ban`, admin, 'POST', { banned: 'false' }, [400]));
  const titles = await request('/meta/job-titles?limit=1');
  const title = titles.items?.[0] ?? titles[0];
  assert.ok(title?.name, 'local job-title catalog must be populated');
  const skills = await request('/meta/skills?take=1');
  const skill = skills[0];
  const jobData = {
    title: title.name, jobTitleSlug: title.slug, description: `Local audit ${runId}. Join our team to design, implement, and maintain reliable software products. Work with the engineering team on delivery and quality.`,
    workMode: 'REMOTE', locale: 'en', isAnonymous: true,
    skills: skill ? [{ slug: skill.slug, isRequired: true }] : [],
  };
  const job = await request(`/jobs/company/${companyId}`, employer, 'POST', jobData);
  state.jobId = job.id;
  persist();
  await check('editing job currency persists the new currency', async () => {
    const updated = await request(`/jobs/${job.id}`, employer, 'PATCH', { currency: 'USD' });
    assert.equal(updated.currency, 'USD');
    await request(`/jobs/${job.id}`, employer, 'PATCH', { currency: 'UZS' });
  });
  await check('draft is hidden from public', () => request(`/jobs/${job.id}`, null, 'GET', undefined, [404]));
  await check('admin rejects an invalid job transition', () => request(`/admin/jobs/${job.id}/status`, admin, 'POST', { status: 'PAUSED' }, [400]));
  await check('candidate cannot save an unpublished draft', () => request(`/profiles/me/saved-jobs/${job.id}`, candidate, 'POST', undefined, [404]));
  await check('saving a nonexistent job is a validation error', () => request('/profiles/me/saved-jobs/missing-audit-job', candidate, 'POST', undefined, [404]));
  await check('API rejects an inverted salary range', () => request(`/jobs/${job.id}`, employer, 'PATCH', { salaryMin: 100, salaryMax: 50 }, [400]));
  await request(`/jobs/${job.id}`, employer, 'PATCH', { salaryMin: 100, salaryMax: 200 });
  await check('partial salary update validates the existing minimum', () => request(`/jobs/${job.id}`, employer, 'PATCH', { salaryMax: 50 }, [400]));
  await request(`/jobs/${job.id}`, employer, 'PATCH', { salaryMin: null, salaryMax: null });
  await check('other employer cannot edit a draft', () => request(`/jobs/${job.id}`, outsider, 'PATCH', { description: 'This unauthorized description edit must not succeed.' }, [403, 404]));
  const question = await request(`/jobs/${job.id}/questions`, employer, 'POST', { question: 'Can you work with the team?', isRequired: true });
  await request(`/companies/${companyId}/follow`, otherCandidate, 'POST');
  await check('owner publishes job', () => request(`/jobs/${job.id}/status`, employer, 'POST', { status: 'PUBLISHED' }));
  await check('confidential publication does not notify company followers', async () => {
    const notifications = await request('/notifications', otherCandidate);
    assert.ok(!notifications.items.some((row) => row.linkUrl === `/jobs/${job.id}`));
  });
  await check('public confidential job conceals company', async () => {
    const row = await request(`/jobs/${job.id}`);
    assert.equal(row.company.anonymous, true);
    assert.ok(!row.companyId && !row.company.id && !row.company.slug);
  });
  await check('job search finds published fixture', async () => {
    const results = await request(`/jobs?q=${encodeURIComponent(runId)}`);
    assert.ok(results.items.some((row) => row.id === job.id));
  });
  await check('company filters cannot identify a confidential employer', async () => {
    const company = await request(`/companies/${companyId}`, employer);
    for (const filter of [`companySlug=${encodeURIComponent(company.slug)}`, `company=${encodeURIComponent(company.name)}`, `q=${encodeURIComponent(company.name)}`]) {
      const rows = await request(`/jobs?${filter}`);
      assert.ok(!rows.items.some((row) => row.id === job.id), 'confidential job must not match its employer identity');
    }
  });
  await check('invalid public job enum is a validation error', () => request('/jobs?workMode=invalid', null, 'GET', undefined, [400]));
  await check('candidate edits own profile', () => request('/profiles/me', candidate, 'PATCH', { headline: 'Audit software specialist', summary: 'A synthetic profile used for local integration testing.', visibility: 'PRIVATE' }));
  await check('invalid experience date is a validation error', () => request('/profiles/me/experiences', candidate, 'POST', { companyName: 'Audit company', title: 'Engineer', startDate: 'not-a-date' }, [400]));
  if (skill) await check('candidate adds profile skill', () => request('/profiles/me/skills', candidate, 'POST', { slug: skill.slug, level: 'ADVANCED' }));
  const pdf = await testPdf();
  const resume = await uploadResume(candidate, 'Local Audit CV', pdf);
  state.resumeId = resume.id;
  await check('CV upload returns no storage key', async () => {
    assert.ok(!resume.fileKey && !resume.fileUrl);
    assert.equal(resume.parseStatus, 'NONE');
  });
  await check('owner downloads a private CV using a signed local URL', async () => {
    const download = await request(`/profiles/me/resumes/${resume.id}/download`, candidate);
    const url = new URL(download.url);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    const file = await fetch(download.url);
    assert.equal(file.status, 200);
    assert.ok((await file.arrayBuffer()).byteLength > 100);
    url.search = '';
    assert.equal((await fetch(url)).status, 403, 'CV must not be publicly readable');
  });
  await check('other candidate cannot download or edit a CV', async () => {
    await request(`/profiles/resumes/${resume.id}/download`, otherCandidate, 'GET', undefined, [403]);
    await request(`/profiles/me/resumes/${resume.id}`, otherCandidate, 'PATCH', { title: 'Stolen' }, [404]);
  });
  await check('recruiter cannot download a CV before it is shared in an application', () => request(`/profiles/resumes/${resume.id}/download`, employer, 'GET', undefined, [403]));
  await check('deleting an unused primary CV promotes the remaining CV', async () => {
    const newest = await uploadResume(candidate, 'Temporary Audit CV', pdf);
    await request(`/profiles/me/resumes/${newest.id}`, candidate, 'DELETE');
    const profile = await request('/profiles/me', candidate);
    assert.equal(profile.resumes.find((row) => row.id === resume.id).isPrimary, true);
  });
  await check('private candidate hidden from unrelated recruiter', () => request(`/profiles/candidates/${candidate.user.employeeProfileId}`, outsider, 'GET', undefined, [403, 404]));
  await check('candidate can save and list a job', async () => {
    await request(`/profiles/me/saved-jobs/${job.id}`, candidate, 'POST');
    const rows = await request('/profiles/me/saved-jobs', candidate);
    assert.ok(rows.some((row) => row.jobPostId === job.id || row.id === job.id || row.jobPost?.id === job.id));
  });
  await check('application requires screening answer', () => request(`/applications/jobs/${job.id}`, candidate, 'POST', {}, [400]));
  await check('foreign screening answer rejected', () => request(`/applications/jobs/${job.id}`, candidate, 'POST', { answers: [{ questionId: 'foreign-question', answer: 'Yes' }] }, [400]));
  const application = await request(`/applications/jobs/${job.id}`, candidate, 'POST', { coverLetter: 'Local test application', resumeId: resume.id, answers: [{ questionId: question.id, answer: 'Yes' }] });
  state.applicationId = application.id;
  persist();
  await check('application submit response conceals confidential employer', async () => {
    assert.equal(application.jobPost.company.anonymous, true);
    assert.ok(!application.jobPost.companyId && !application.jobPost.company.id);
  });
  await check('duplicate application is rejected', () => request(`/applications/jobs/${job.id}`, candidate, 'POST', { answers: [{ questionId: question.id, answer: 'Yes' }] }, [409]));
  await check('other employer cannot read applicants', () => request(`/applications/jobs/${job.id}`, outsider, 'GET', undefined, [403]));
  await check('invalid applicant filter is a validation error', () => request(`/applications/jobs/${job.id}?status=invalid`, employer, 'GET', undefined, [400]));
  await check('other candidate cannot move application', () => request(`/applications/${application.id}/status`, otherCandidate, 'POST', { status: 'WITHDRAWN' }, [403]));
  await check('own candidate cannot hire themselves', () => request(`/applications/${application.id}/status`, candidate, 'POST', { status: 'HIRED' }, [403]));
  await check('employer sees own applicant and private profile after application', async () => {
    const rows = await request(`/applications/jobs/${job.id}`, employer);
    assert.ok(rows.some((row) => row.id === application.id));
    await request(`/profiles/candidates/${candidate.user.employeeProfileId}?matchJobId=${job.id}`, employer);
  });
  await check('only the applicant company can download the submitted CV', async () => {
    await request(`/applications/${application.id}/resume-download`, employer);
    await request(`/profiles/resumes/${resume.id}/download`, outsider, 'GET', undefined, [403]);
  });
  await check('deleting a submitted CV preserves the application file and supports restore', async () => {
    const removed = await request(`/profiles/me/resumes/${resume.id}`, candidate, 'DELETE');
    assert.equal(removed.softDeleted, true);
    await request(`/applications/${application.id}/resume-download`, employer);
    await request(`/profiles/me/resumes/${resume.id}/restore`, candidate, 'POST');
    const profile = await request('/profiles/me', candidate);
    assert.equal(profile.resumes.find((row) => row.id === resume.id).isPrimary, true);
  });
  await check('CV builder exports a readable private PDF', async () => {
    const builder = await request('/profiles/me/resumes/from-builder', candidate, 'POST', {
      title: 'Local Builder Audit CV', jobTitleSlug: title.slug, isPrimary: false, templateKey: 'classic',
    });
    const exported = await request(`/profiles/me/resumes/${builder.id}/export`, candidate, 'POST');
    assert.ok(!exported.fileKey && exported.downloadUrl);
    const response = await fetch(exported.downloadUrl);
    assert.equal(response.status, 200);
    const parsed = await pdfParse(Buffer.from(await response.arrayBuffer()));
    assert.ok(parsed.text.includes('Local Audit candidate'));
    assert.ok(parsed.text.includes('Audit software specialist'));
    await request(`/profiles/me/resumes/${builder.id}`, candidate, 'DELETE');
    assert.equal((await fetch(exported.downloadUrl)).status, 404);
  });
  await check('employer moves applicant to review', () => request(`/applications/${application.id}/status`, employer, 'POST', { status: 'IN_REVIEW' }));
  await check('repeated pipeline action does not expose candidate account data', async () => {
    const row = await request(`/applications/${application.id}/status`, employer, 'POST', { status: 'IN_REVIEW' });
    assert.ok(!row.profile && !row.jobPost, 'status response must not include nested account or company records');
    assert.ok(!JSON.stringify(row).includes('passwordHash'), 'password hash must never leave the API');
  });
  await check('candidate applications still conceal employer in review', async () => {
    const rows = await request('/applications/mine', candidate);
    assert.equal(rows.find((row) => row.id === application.id).jobPost.company.anonymous, true);
  });
  await check('invalid interview date rejected as validation error', () => request(`/applications/${application.id}/interviews`, employer, 'POST', { scheduledAt: 'not-a-date' }, [400]));
  await check('employer schedules interview', () => request(`/applications/${application.id}/interviews`, employer, 'POST', { scheduledAt: new Date(Date.now() + 86400000).toISOString(), durationMins: 30, meetingUrl: 'https://example.test/interview' }));
  await check('interview reveals employer to applicant', async () => {
    const rows = await request('/applications/mine', candidate);
    const row = rows.find((item) => item.id === application.id);
    assert.equal(row.status, 'INTERVIEW');
    assert.equal(row.jobPost.company.id, companyId);
  });
  await check('hired candidate cannot withdraw a finalized application', async () => {
    await request(`/applications/${application.id}/status`, employer, 'POST', { status: 'HIRED' });
    try {
      await request(`/applications/${application.id}/status`, candidate, 'POST', { status: 'WITHDRAWN' }, [400]);
    } finally {
      await request(`/applications/${application.id}/status`, employer, 'POST', { status: 'INTERVIEW' });
    }
  });
  await check('unrelated candidate cannot view interviews', () => request(`/applications/${application.id}/interviews`, otherCandidate, 'GET', undefined, [403]));
  await check('candidate creates and manages job alert', async () => {
    const alert = await request('/alerts', candidate, 'POST', { name: 'Audit alert', query: runId, notifyEmail: false });
    state.alertId = alert.id;
    await request(`/alerts/${alert.id}`, candidate, 'PATCH', { isActive: false });
    await request(`/alerts/${alert.id}`, otherCandidate, 'PATCH', { name: 'Stolen' }, [403, 404]);
  });
  await check('candidate communication opt-out persists', async () => {
    await request('/bulk-comms/opt-out', candidate, 'PATCH', { optedOut: true });
    assert.equal((await request('/bulk-comms/opt-out', candidate)).optedOut, true);
  });
  await check('bulk messaging honors candidate opt-out', async () => {
    const campaign = await request('/bulk-comms/campaigns', employer, 'POST', {
      companyId, jobPostId: job.id, applicationIds: [application.id], messageBody: 'Synthetic local bulk message.',
      channels: { app: true, email: false, telegram: false },
    });
    assert.equal(campaign.recipients[0].deliveryStatus, 'SKIPPED_OPTED_OUT');
  });
  await check('application chat participants can communicate', async () => {
    const conversation = await request('/chat/conversations', employer, 'POST', { peerUserId: candidate.user.id, jobPostId: job.id, companyId });
    state.conversationId = conversation.id;
    await request(`/chat/conversations/${conversation.id}/messages`, employer, 'POST', { body: '   ' }, [400]);
    await request(`/chat/conversations/${conversation.id}/messages`, employer, 'POST', { body: 'Local audit interview invitation.' });
    const messages = await request(`/chat/conversations/${conversation.id}/messages`, candidate);
    assert.ok(Array.isArray(messages) && messages.length);
    await request(`/chat/conversations/${conversation.id}/messages`, outsider, 'GET', undefined, [403]);
  });
  await check('candidate report reviewed once by admin', async () => {
    const report = await request('/reports', candidate, 'POST', { entityType: 'JOB_POST', entityId: job.id, reason: 'Local audit test report only.' });
    await request(`/reports/${report.id}/resolve`, candidate, 'POST', { status: 'RESOLVED' }, [403]);
    await request(`/admin/reports/${report.id}/resolve`, admin, 'POST', { status: 'DISMISSED', resolution: 'Synthetic local audit report.' });
    await request(`/admin/reports/${report.id}/resolve`, admin, 'POST', { status: 'RESOLVED' }, [400]);
  });
  await check('company verification request and admin review', async () => {
    const form = new FormData(); form.set('legalName', `Audit Legal ${runId}`); form.set('taxId', '123456789');
    const verification = await request(`/companies/${companyId}/verification`, employer, 'POST', form);
    const requestId = verification.id ?? verification.request?.id;
    assert.ok(requestId, 'verification request must have an id');
    await request(`/admin/verifications/${requestId}/decide`, admin, 'POST', { status: 'APPROVED' });
    const company = await request(`/companies/${companyId}`, employer);
    assert.equal(company.isVerified, true);
    await request(`/admin/verifications/${requestId}/decide`, admin, 'POST', { status: 'REJECTED' }, [400]);
  });
  await check('notifications load for each role', async () => {
    for (const account of [employer, candidate, admin]) {
      await request('/notifications', account);
      await request('/notifications/unread-count', account);
    }
  });
  await check('invalid notifications page is a validation error', () => request('/notifications?page=invalid', candidate, 'GET', undefined, [400]));
  await check('job pause blocks new applications', async () => {
    await request(`/jobs/${job.id}/status`, employer, 'POST', { status: 'PAUSED' });
    try {
      await request(`/applications/jobs/${job.id}`, otherCandidate, 'POST', { answers: [{ questionId: question.id, answer: 'Yes' }] }, [404]);
      const saved = await request('/profiles/me/saved-jobs', candidate);
      const unavailable = saved.find((row) => row.jobPostId === job.id);
      assert.ok(unavailable, 'unavailable bookmarks must remain removable');
      assert.deepEqual(Object.keys(unavailable.jobPost).sort(), ['company', 'id', 'status', 'title']);
      assert.equal(unavailable.jobPost.company, null);
      assert.equal(unavailable.jobPost.title, '');
      assert.equal(unavailable.jobPost.status, 'CLOSED');
    } finally {
      await request(`/jobs/${job.id}/status`, employer, 'POST', { status: 'PUBLISHED' });
    }
  });
  await check('company owner must close or transfer company before deleting account', () => request('/auth/me', outsider, 'DELETE', { confirmation: outsider.email, currentPassword: password }, [409]));
  await check('admin ban invalidates sessions and blocks login until lifted', async () => {
    await request(`/admin/users/${otherCandidate.user.id}/ban`, admin, 'POST', { banned: true });
    await request('/profiles/me', otherCandidate, 'GET', undefined, [401, 403]);
    await request('/auth/login', null, 'POST', { email: otherCandidate.email, password }, [403]);
    await request(`/admin/users/${otherCandidate.user.id}/ban`, admin, 'POST', { banned: false });
    Object.assign(otherCandidate, await request('/auth/login', null, 'POST', { email: otherCandidate.email, password }));
  });
  const erased = await register('erasure', 'EMPLOYEE');
  const erasedResume = await uploadResume(erased, 'Erasure Audit CV', pdf);
  const erasedDownload = await request(`/profiles/me/resumes/${erasedResume.id}/download`, erased);
  const erasedApp = await request(`/applications/jobs/${job.id}`, erased, 'POST', { resumeId: erasedResume.id, answers: [{ questionId: question.id, answer: 'Yes' }] });
  await check('account deletion requires correct confirmation and password', async () => {
    await request('/auth/me', erased, 'DELETE', { confirmation: 'wrong confirmation', currentPassword: password }, [400]);
    await request('/auth/me', erased, 'DELETE', { confirmation: erased.email, currentPassword: 'wrong-password' }, [401]);
  });
  await check('account deletion anonymizes history, withdraws applications, revokes sessions and removes CV file', async () => {
    await request('/auth/me', erased, 'DELETE', { confirmation: erased.email, currentPassword: password });
    await request('/profiles/me', erased, 'GET', undefined, [401, 403]);
    const row = await prisma.user.findUnique({ where: { id: erased.user.id } });
    assert.ok(row.anonymizedAt && !row.email && !row.passwordHash && !row.googleId && !row.telegramId);
    const history = await prisma.application.findUnique({ where: { id: erasedApp.id } });
    assert.equal(history.status, 'WITHDRAWN');
    assert.deepEqual(history.resumeSnapshot, { anonymized: true });
    assert.equal((await fetch(erasedDownload.url)).status, 404);
  });
  await check('withdrawn application cannot be reopened or scheduled for interview', async () => {
    await request(`/applications/${erasedApp.id}/status`, employer, 'POST', { status: 'IN_REVIEW' }, [400]);
    await request(`/applications/${erasedApp.id}/interviews`, employer, 'POST', { scheduledAt: new Date(Date.now() + 86400000).toISOString() }, [400]);
  });
  await check('new recruiter accepts company invitation without creating another company', async () => {
    const email = `audit-${runId}-teammate@example.test`;
    await request(`/companies/${companyId}/invite`, employer, 'POST', { email, role: 'ADMIN', locale: 'en' });
    const token = await invitationToken(email);
    await request(`/companies/invites/${token}`);
    const teammate = await register('teammate', 'RECRUITER', { inviteToken: token });
    assert.equal(teammate.user.memberships.length, 1);
    assert.equal(teammate.user.memberships[0].companyId, companyId);
  });
  await check('existing password account accepts invitation when signing in', async () => {
    const invite = await request(`/companies/${companyId}/invite`, employer, 'POST', { email: outsider.email, role: 'RECRUITER', locale: 'en' });
    assert.equal(invite.status, 'invited');
    const token = await invitationToken(outsider.email);
    const session = await request('/auth/login', null, 'POST', { email: outsider.email, password, expectedRole: 'RECRUITER', inviteToken: token });
    assert.ok(session.user.memberships.some((membership) => membership.companyId === companyId));
    assert.equal(session.joinedCompanyId, companyId, 'login must open the company that sent the invitation');
    assert.equal(session.user.emailVerified, true, 'the invitation token proves the matching mailbox');
    Object.assign(outsider, session);
    await request('/auth/login', null, 'POST', { email: outsider.email, password, expectedRole: 'RECRUITER', inviteToken: token }, [400]);
  });
  await check('concurrent publishes and admin actions have no package limit', async () => {
    const catalog = await request('/meta/job-titles?limit=4');
    const drafts = [];
    try {
      for (const [index, item] of catalog.items.slice(1).entries()) {
        drafts.push(await request(`/jobs/company/${companyId}`, employer, 'POST', {
          ...jobData, title: item.name, jobTitleSlug: item.slug,
          description: `Additional local audit opening ${runId} role ${index}. This description is specific to ${item.name} and covers its responsibilities, collaboration, technical delivery and review.`,
        }));
      }
      const results = await Promise.allSettled(drafts.map((draft) => request(`/jobs/${draft.id}/status`, employer, 'POST', { status: 'PUBLISHED' })));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, drafts.length);
      assert.equal(await prisma.jobPost.count({ where: { companyId, status: 'PUBLISHED' } }), drafts.length + 1);
      for (const draft of drafts) await request(`/jobs/${draft.id}/status`, employer, 'POST', { status: 'PAUSED' });
      await request(`/admin/jobs/${drafts[0].id}/status`, admin, 'POST', { status: 'PUBLISHED' });
      const bulk = await request('/admin/jobs/bulk/status', admin, 'POST', { ids: drafts.slice(1).map(item => item.id), status: 'PUBLISHED' });
      assert.equal(bulk.applied, drafts.length - 1);
    } finally {
      for (const draft of drafts) await request(`/jobs/${draft.id}/status`, employer, 'POST', { status: 'CLOSED' });
    }
  });
  await check('admin status changes keep publication and closure timestamps consistent', async () => {
    const before = (await request(`/jobs/company/${companyId}`, employer)).find((row) => row.id === job.id);
    const closed = await request(`/admin/jobs/${job.id}/status`, admin, 'POST', { status: 'CLOSED' });
    assert.ok(closed.closedAt);
    const reopened = await request(`/jobs/${job.id}/status`, employer, 'POST', { status: 'PUBLISHED' });
    assert.equal(reopened.closedAt, null);
    assert.equal(reopened.publishedAt, before.publishedAt);
    await request(`/admin/jobs/${job.id}/status`, admin, 'POST', { status: 'EXPIRED' });
    await request(`/jobs/${job.id}/status`, employer, 'POST', { status: 'PUBLISHED' });
  });
  const security = await register('security', 'EMPLOYEE');
  await check('password reset does not reveal whether an email exists', async () => {
    const known = await request('/auth/forgot-password', null, 'POST', { email: security.email });
    const unknown = await request('/auth/forgot-password', null, 'POST', { email: `missing-${runId}@example.test` });
    assert.deepEqual(known, unknown);
  });
  const reset = await mailActionToken(security.email);
  await check('password reset token is single use even for concurrent submissions', async () => {
    const nextPassword = 'LocalAudit!Reset2026Only';
    const attempts = await Promise.allSettled([1, 2].map(() => request('/auth/reset-password', null, 'POST', { token: reset, newPassword: nextPassword })));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    await request('/profiles/me', security, 'GET', undefined, [401, 403]);
    await request('/auth/login', null, 'POST', { email: security.email, password }, [401]);
    Object.assign(security, await request('/auth/login', null, 'POST', { email: security.email, password: nextPassword }));
    await request('/auth/reset-password', null, 'POST', { token: reset, newPassword: nextPassword }, [400]);
  });
  await check('email change confirms the new inbox once and invalidates old sessions and links', async () => {
    const oldEmail = security.email;
    const nextEmail = `audit-${runId}-security-new@example.test`;
    const currentPassword = 'LocalAudit!Reset2026Only';
    await request('/auth/change-email', security, 'POST', { newEmail: nextEmail, currentPassword: 'wrong-password' }, [401]);
    await request('/auth/change-email', security, 'POST', { newEmail: candidate.email, currentPassword }, [409]);
    await request('/auth/request-verification', security, 'POST');
    const oldVerification = await mailActionToken(oldEmail, 'verify-email');
    await request('/auth/change-email', security, 'POST', { newEmail: nextEmail, currentPassword });
    const token = await mailActionToken(nextEmail, 'confirm-email-change');
    const attempts = await Promise.allSettled([1, 2].map(() => request('/auth/confirm-email-change', null, 'POST', { token })));
    const successes = attempts.filter((result) => result.status === 'fulfilled');
    assert.equal(successes.length, 1);
    await request('/profiles/me', security, 'GET', undefined, [401, 403]);
    Object.assign(security, successes[0].value, { email: nextEmail });
    assert.equal(security.user.email, nextEmail);
    assert.equal(security.user.emailVerified, true);
    await request('/auth/verify-email', null, 'POST', { token: oldVerification }, [400]);
    await request('/auth/login', null, 'POST', { email: oldEmail, password: currentPassword }, [401]);
    await request('/auth/login', null, 'POST', { email: nextEmail, password: currentPassword });
  });
  await check('changing password invalidates prior sessions and logout revokes the new session', async () => {
    const prior = { ...security };
    const changed = await request('/auth/change-password', security, 'POST', { currentPassword: 'LocalAudit!Reset2026Only', newPassword: 'LocalAudit!Final2026Only' });
    await request('/profiles/me', prior, 'GET', undefined, [401, 403]);
    Object.assign(security, changed);
    await request('/profiles/me', security);
    await request('/auth/login', null, 'POST', { email: security.email, password: 'LocalAudit!Reset2026Only' }, [401]);
    await request('/auth/logout', null, 'POST', { refreshToken: security.refreshToken });
    await request('/profiles/me', security, 'GET', undefined, [401, 403]);
    await request('/auth/refresh', null, 'POST', { refreshToken: security.refreshToken }, [401]);
  });
  const failed = state.checks.filter((row) => !row.passed);
  console.log(`Audit: ${state.checks.length - failed.length}/${state.checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((error) => { console.error(`Audit setup failed: ${error.message}`); process.exitCode = 1; })
  .finally(async () => { persist(); await prisma.$disconnect(); });
