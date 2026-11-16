// Real Next pages with local synthetic recruitment, chat, and PDF fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const PDFDocument = apiRequire('pdfkit');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const base = new URL(process.env.CANDIDATE_REVIEW_WEB_URL || process.env.RECRUITMENT_WEB_URL || 'http://127.0.0.1:3147');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Use a local web server');
const out = path.resolve('output/candidate-review-local');
const root = '/id/dashboard/recruiter/candidates/candidate-1';
const company = { id: 'company', name: 'Studio Reka' };
const auth = { accessToken: 'review-local-only', user: {
  id: 'hr', fullName: 'Nadia Putri', email: 'nadia@example.test', emailVerified: true, role: 'RECRUITER',
  memberships: [{ companyId: company.id, role: 'OWNER' }], recruiterOnboarding: { status: 'COMPLETED' },
} };
const dates = { report: '2026-11-15T06:45:00Z', previous: '2026-11-12T03:21:00Z', interview: '2026-11-15T06:10:00Z' };
const cvEvidence = 'Membangun portal inventaris dari desain antarmuka hingga deployment.';
const skills = [
  ['web', 'Pengembangan aplikasi web end-to-end', 4, 'Proyek mencakup antarmuka hingga deployment.'],
  ['services', 'Integrasi layanan', 4, 'CV menyebut integrasi layanan inventaris.'],
  ['docs', 'Dokumentasi teknis', 4, 'CV menyebut dokumentasi tahap penerapan.'],
  ['verification', 'Pengujian dan verifikasi', 3, 'Kontribusi pada pengujian perlu didalami.'],
];
const candidate = {
  id: 'candidate-1', companyId: company.id, jobId: 'job', applicationId: null, fullName: 'Raka Pratama',
  email: 'raka@example.test', headline: 'AI Application Developer', filename: 'CV_Raka_Pratama.pdf',
  contentType: 'application/pdf', stage: 'NEW', cvScore: 93.8, scoreStatus: 'READY', revision: 3, createdAt: dates.previous,
  assignedTo: null, error: null, job: { id: 'job', title: 'AI Application Developer' },
  cvResult: { assessmentLanguage: 'id', summary: 'Pengalaman membangun aplikasi web dan mengintegrasikan layanan inventaris.',
    limitations: ['Kontribusi pribadi dalam satu proyek'],
    criteria: skills.map(([criterionId, ,level, reason], i) => ({ criterionId, level, reason, evidence: i === 0 ? [cvEvidence] : [] })),
    roleAssessment: { state: 'COMPLETE', criteria: skills.map(([id, name]) => ({ id, name })) },
    cvText: cvEvidence, sourceReferences: { fileKind: 'PDF', blocks: [{ id: 'p2-b1', page: 2, start: 0, end: cvEvidence.length }],
      criteria: [{ criterionId: 'web', blockIds: ['p2-b1'] }] },
  },
  activities: [
    { id: 'cv', createdAt: dates.report, kind: 'CV_ANALYZED' },
    { id: 'application', createdAt: dates.previous, kind: 'APPLICATION_RECEIVED' },
    { id: 'message', createdAt: '2026-11-15T07:20:00Z', kind: 'MESSAGE_QUEUED' },
  ],
};
const job = { ...candidate.job, companyId: company.id, company, description: 'Membangun aplikasi web dan integrasi layanan.',
  workMode: 'HYBRID', employmentType: 'FULL_TIME', status: 'PUBLISHED', _count: { applications: 2 } };
const answer = 'Saya membuat alur unggah dan menguji file yang ditolak.';
const evaluation = {
  status: 'READY', finalScore: 89.4, screeningScore: 87.5, result: { assessmentLanguage: 'id', summary: 'Kandidat menjelaskan tindakan dan hasil pengujiannya.',
    roleAssessment: { version: 'local-test', rubricRevision: 'test-rubric', state: 'COMPLETE', score: 89.4, missing: [],
      coverage: { assessed: 4, total: 4, interrupted: false }, components: { cv: 93.8, competency: 87.5, explanation: 87.5 },
      contributions: { cv: 28.14, competency: 52.5, explanation: 8.75 },
      weights: { cv: 30, competency: 60, explanation: 10 },
      criteria: ['Implementasi fitur', 'Verifikasi hasil', 'Keputusan teknis', 'Penanganan risiko'].map((name, index) => ({
        name, criterionId: 'role-' + index, state: 'ASSESSED', level: index < 2 ? 4 : 3, clarity: 3,
        reason: 'Kandidat menjelaskan pekerjaan yang ia lakukan sendiri.',
        questionRefs: ['turn-q'], evidence: index === 0 ? [{ questionId: 'turn-a', questionRef: 'turn-q', quote: answer }] : [],
      })),
    },
  },
};
const invitations = [['live', 'VOICE', dates.interview], ['chat', 'TEXT', dates.previous]].map(([id, mode, date]) => ({
  id, mode, createdAt: date, status: 'COMPLETED', expiresAt: '2026-11-22T00:00:00Z', emailStatus: 'SENT', messageStatus: 'SENT',
  session: { id: 'session-' + id, status: 'COMPLETED', startedAt: date, completedAt: date, evaluation },
}));
const bookings = [
  { id: 'history', scheduledAt: '2026-11-14T03:00:00Z', durationMins: 30, status: 'COMPLETED', revision: 1 },
  { id: 'next', scheduledAt: '2026-11-18T07:00:00Z', durationMins: 45, status: 'SCHEDULED', revision: 1,
    meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc', organizerName: 'Nadia Putri' },
];
const conversation = [
  { id: 'm1', senderId: 'hr', body: 'Halo Raka, terima kasih sudah melamar.', createdAt: '2026-11-15T07:12:00Z' },
  { id: 'm2', senderId: 'raka', body: 'Terima kasih, Kak Nadia. Saya siap lanjut.', createdAt: '2026-11-15T07:18:00Z' },
  { id: 'm3', senderId: 'hr', body: 'Apakah pukul 14.00 WIB cocok?', createdAt: '2026-11-15T07:20:00Z' },
];
const channels = { state: 'AVAILABLE', whatsapp: 'https://wa.me/6281210000000', telegram: 'https://t.me/+6281210000000',
  conversationId: 'thread', peerUserId: 'raka' };
const checks = [];

function makePdf() {
  return new Promise(resolve => {
    const doc = new PDFDocument({ autoFirstPage: false }), chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.addPage().rect(0, 0, 612, 99).fill('#363453');
    doc.fillColor('#ffffff').fontSize(32).font('Helvetica-Bold').text(candidate.fullName, 40, 27);
    doc.fillColor('#dfd9f7').fontSize(16).font('Helvetica').text(candidate.headline, 40, 65);
    doc.fillColor('#1d173e').fontSize(18).font('Helvetica-Bold').text('Ringkasan profesional', 40, 123);
    doc.fillColor('#37324a').fontSize(12).font('Helvetica').text('Pengembang aplikasi berfokus pada pemanfaatan AI untuk membangun solusi digital end-to-end yang bermanfaat.', 40, 151);
    doc.addPage().fontSize(21).text('Pengalaman proyek').moveDown().fontSize(13).text(cvEvidence);
    doc.addPage().fontSize(21).text('Pendidikan dan keahlian');
    doc.end();
  });
}

async function run() {
  const pdf = await makePdf();
  const browser = await playwright.chromium.launch({ headless: true });
  const writes = [];
  try {
    for (const [device, viewport] of [['desktop', { width: 1536, height: 1024 }], ['mobile', { width: 390, height: 782 }]]) {
      const seedMessages = conversation.length;
      const seedBookings = structuredClone(bookings);
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'Asia/Jakarta', acceptDownloads: true });
      await context.addInitScript(auth => {
        localStorage.setItem('jt_token', auth.accessToken);
        localStorage.setItem('jt_session', JSON.stringify(auth));
        localStorage.setItem('jt_country', 'ID');
      }, auth);
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-11-15T10:00:00Z'));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && /hydration|unique.*key|same key|cannot appear as a/i.test(message.text())) errors.push(message.text());
      });
      await context.route('https://private.test/**', async route => route.fulfill({
        headers: { 'access-control-allow-origin': '*', 'content-disposition': 'attachment; filename="synthetic.pdf"' },
        contentType: 'application/pdf', body: pdf,
      }));
      await context.route(/^https:\/\/(wa\.me|t\.me)\//, async route => route.fulfill({ body: 'Synthetic external chat destination' }));
      await context.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const p = url.pathname.replace(/^\/api/, ''), method = request.method();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (method !== 'GET') writes.push({ path: p, body: request.postDataJSON() });
        let body = [];
        if (p === '/auth/me') body = auth;
        else if (p === '/recruiter-onboarding') body = { status: 'COMPLETED' };
        else if (p === '/companies/mine') body = [{ companyId: company.id, role: 'OWNER', company }];
        else if (p === '/jobs/job') body = job;
        else if (p.endsWith('/candidate-1/cv')) body = { url: 'https://private.test/cv.pdf' };
        else if (p.endsWith('/candidate-1/cv-report')) {
          assert.equal(url.searchParams.get('revision'), '3');
          return route.fulfill({ headers, contentType: 'application/pdf', body: pdf });
        } else if (p.endsWith('/candidate-1/invitations')) body = invitations;
        else if (p.endsWith('/candidate-1/interviews')) body = bookings;
        else if (p.endsWith('/candidate-1/interviews/next') && method === 'PATCH') {
          const next = bookings.find(row => row.id === 'next');
          assert.equal(request.postDataJSON().revision, next.revision);
          Object.assign(next, request.postDataJSON(), { revision: next.revision + 1 });
          body = next;
        } else if (p.endsWith('/candidate-1/contact-channels')) body = channels;
        else if (p.endsWith('/candidate-2/contact-channels')) body = { ...channels, whatsapp: null, telegram: null, conversationId: null, peerUserId: null };
        else if (p === '/chat/conversations/thread/messages') {
          if (method === 'POST') {
            const message = { id: 'sent-' + conversation.length, senderId: 'hr', body: request.postDataJSON().body, createdAt: '2026-11-15T07:21:00Z' };
            conversation.push(message);
            body = message;
          } else body = conversation;
        } else if (p === '/recruitment/invitations/live/report') {
          assert.equal(url.searchParams.get('candidateId'), candidate.id);
          body = { invitation: invitations[0], evaluation, resultRevision: 'rev-a', pdfStatus: 'READY', pdfUrl: 'https://private.test/interview.pdf', questions: [],
            voice: { transcriptComplete: true, transcript: [
              { id: 'turn-q', speaker: 'TARA', text: 'Bagian apa yang lo kerjain sendiri?', startMs: 266000 },
              { id: 'turn-a', speaker: 'CANDIDATE', text: answer, startMs: 272000 },
            ] } };
        } else if (p === '/recruitment/candidates/candidate-1') body = candidate;
        else if (p === '/recruitment/candidates/candidate-2') body = {
          ...candidate, id: 'candidate-2', fullName: 'Ayu Rahayu', scoreStatus: 'PROCESSING', cvScore: null, cvResult: null,
        };
        else if (p === '/recruitment/candidates') body = { items: [candidate, { ...candidate, id: 'candidate-2', fullName: 'Ayu Rahayu' }],
          page: 1, total: 2, counts: { all: 2, review: 2, progress: 0, finished: 0 } };
        return route.fulfill({ headers, json: body });
      });
      const screenshots = path.join(out, device);
      fs.mkdirSync(screenshots, { recursive: true });
      async function capture(file, expected) {
        await expected.waitFor({ timeout: 60_000 });
        await page.locator('main').evaluate(node => { node.scrollTop = 0; });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('[data-candidate-review]').count(), 1);
        const bounds = await page.locator('main').evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth }));
        assert.ok(bounds.content <= bounds.width + 1, device + ' horizontal page overflow for ' + file);
        await page.screenshot({ path: path.join(screenshots, file + '.png'), animations: 'disabled', style: 'nextjs-portal{display:none}' });
      }
      async function choose(name) {
        await page.getByRole('navigation', { name: 'Detail kandidat' }).getByRole('link', { name, exact: true }).click();
      }

      if (device === 'desktop') {
        await page.goto(new URL('/id/dashboard/recruiter/jobs/job?company=company', base).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.getByRole('link', { name: 'Raka Pratama', exact: true }).click({ timeout: 60_000 });
      } else {
        await page.goto(new URL(root, base).href, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      }
      const canvas = page.locator('canvas[data-rendered="true"]');
      await capture('01-cv', canvas);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: 'Halaman CV berikutnya' }).click();
      await page.getByRole('img', { name: 'Halaman CV 2 · Raka Pratama' }).waitFor();
      await page.getByRole('link', { name: 'Buka laporan Taka' }).click();
      await capture('06-laporan-cv', page.getByText(cvEvidence, { exact: true }));
      assert.match(page.url(), /\/reports\/cv$/);
      await page.getByRole('button', { name: 'Buka CV · Halaman 2' }).click();
      await page.locator('canvas[data-rendered="true"]').and(page.getByRole('img', { name: 'Halaman CV 2 · Raka Pratama' })).waitFor();
      const cvDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Unduh PDF' }).click();
      assert.equal((await cvDownload).suggestedFilename(), 'Laporan-CV-Taka.pdf');
      await page.getByRole('link', { name: 'Kembali ke kandidat' }).click();

      await choose(device === 'desktop' ? 'Screening Tara' : 'Screening');
      await capture('02-screening', page.getByText('89,4/100', { exact: true }));
      await page.getByRole('link', { name: 'Buka hasil wawancara' }).click();
      await capture('07-laporan-wawancara', page.getByText(answer, { exact: true }));
      assert.match(page.url(), /\/reports\/interviews\/live$/);
      await page.getByRole('button', { name: 'Buka transkrip · 04:32' }).click();
      assert.equal(await page.locator('[data-turn="turn-a"]').getAttribute('data-highlight'), 'true');
      const interviewDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Unduh PDF' }).click();
      assert.equal((await interviewDownload).suggestedFilename(), 'synthetic.pdf');
      await page.getByRole('link', { name: 'Kembali ke kandidat' }).click();

      await choose('Jadwal');
      await capture('03-jadwal', page.getByRole('link', { name: 'Buka tautan meeting' }));
      await page.getByRole('button', { name: 'Ubah jadwal', exact: true }).click();
      await page.getByLabel('Durasi (menit)').fill('45');
      await page.getByRole('button', { name: 'Simpan & kirim jadwal' }).click();
      await page.getByText('Jadwal tersimpan. Pemberitahuan sedang disiapkan.').waitFor();

      await choose('Pesan');
      const messageInput = page.getByRole('textbox', { name: 'Tulis pesan Talentio' });
      await capture('04-pesan', page.getByText('Terima kasih, Kak Nadia. Saya siap lanjut.'));
      await messageInput.fill('Draf Talentio tetap di sini');
      const beforeExternal = writes.length;
      for (const [label, url] of [['WhatsApp', channels.whatsapp], ['Telegram', channels.telegram]]) {
        const button = page.getByRole('link', { name: 'Buka chat ' + label });
        assert.equal(await button.getAttribute('href'), url);
        const popup = page.waitForEvent('popup');
        await button.click();
        const external = await popup;
        await external.waitForLoadState();
        assert.equal(external.url(), url);
        await external.close();
      }
      assert.equal(writes.length, beforeExternal);
      assert.equal(await messageInput.inputValue(), 'Draf Talentio tetap di sini');
      if (device === 'desktop') {
        await page.getByRole('button', { name: 'Kirim via Talentio' }).click();
        await page.getByText('Draf Talentio tetap di sini', { exact: true }).waitFor();
        assert.equal(writes.at(-1)?.path, '/chat/conversations/thread/messages');
      }

      await choose('Aktivitas');
      await capture('05-aktivitas', page.getByText('Wawancara Live bersama Tara selesai', { exact: true }));
      const filter = page.getByRole('combobox', { name: 'Filter aktivitas' });
      await filter.selectOption('assessment');
      assert.equal(await page.getByText('Lamaran diterima', { exact: true }).count(), 0);
      if (device === 'desktop') {
        await page.getByRole('link', { name: 'Kandidat berikutnya' }).click();
        await page.getByRole('heading', { name: 'Ayu Rahayu' }).waitFor();
        await choose('CV & Ulasan Taka');
        const taka = page.locator('[data-character="taka"][data-working="true"] img');
        await taka.waitFor();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.notEqual(await taka.evaluate(element => getComputedStyle(element).animationName), 'none');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await taka.evaluate(element => getComputedStyle(element).animationName), 'none');
        await choose('Pesan');
        await page.getByText('Nomor kontak internasional kandidat belum tersedia.').waitFor();
        assert.ok(await page.getByRole('button', { name: 'WhatsApp' }).isDisabled());
        await page.getByRole('link', { name: 'Daftar kandidat' }).click();
        await page.getByRole('link', { name: 'Raka Pratama', exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      checks.push({ device, screens: 7, flows: ['navigation', 'CV pages and evidence', 'PDF downloads', 'Tara evidence',
        'appointment edit', 'external handoff without draft or send', 'activity filter',
        ...(device === 'desktop' ? ['working animation and reduced motion'] : [])] });
      await context.close();
      conversation.length = seedMessages;
      bookings.splice(0, bookings.length, ...seedBookings);
    }
  } finally {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ checks, writes }, null, 2));
    await browser.close();
  }
}

run().then(() => console.log('Candidate review: 14 browser views and workflows verified.')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
