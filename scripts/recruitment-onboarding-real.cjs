const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function selectLocation(page) {
  const country = page.locator('select[name="countryId"]');
  await country.selectOption('ID');
  const city = page.getByRole('combobox', { name: /^Kota/ });
  await city.fill('Jakarta');
  await page.getByRole('option', { name: /Kota Jakarta/ }).click();
}

async function prepareCompany({ page, web, decision }) {
  await page.goto(web + '/id/onboarding/recruiter', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('heading', { name: 'Ceritakan perusahaan Anda' }).waitFor({ timeout: 60000 });
  await page.getByLabel(/Nama perusahaan/).fill(decision === 'skip' ? 'Studio Lewati Audit' : 'Studio Upload Audit');
  await selectLocation(page);
  await page.getByLabel(/Ukuran perusahaan/).selectOption('SIZE_11_50');
  await page.getByRole('button', { name: 'Buka pilihan industri' }).click();
  await page.locator('#hr-industry-options').getByRole('checkbox').first().check();
  await page.locator('#hr-industry-options').getByRole('button', { name: 'Selesai' }).click();
  await page.getByRole('radio', { name: 'Tulis deskripsi manual' }).check();
  await page.getByLabel(/Deskripsi perusahaan/).fill('Perusahaan sintetis yang mengembangkan sistem inventaris dan integrasi layanan digital.');
  await page.locator('button[form="hr-company-form"]').click();
  await page.getByRole('button', { name: 'Lanjut ke pilihan paket' }).click({ timeout: 20000 });
  await page.getByRole('radio', { name: 'Free', exact: true }).check();
  await page.getByRole('button', { name: 'Lanjut ke checkout' }).click();
  await page.getByRole('button', { name: 'Konfirmasi paket Free' }).click();
  await page.getByRole('heading', { name: 'Buat lowongan', exact: true }).waitFor({ timeout: 30000 });
}

async function reachUpload(page, title, draftWithAi) {
  const titleInput = page.locator('#hr-job-form input[name="title"]');
  await titleInput.fill(title);
  await page.locator('#hr-job-form textarea[name="description"]').fill('Mengembangkan API inventaris dengan Node.js, menulis pengujian integrasi, dan mendokumentasikan endpoint.');
  if (draftWithAi) {
    const dialog = page.getByRole('dialog', { name: /Tinjau hasil AI/ });
    const description = page.locator('#hr-job-form textarea[name="description"]');
    const original = await description.inputValue();
    for (const label of ['Deskripsi posisi', 'Tanggung jawab utama', 'KPI posisi', 'Keahlian']) {
      await page.getByRole('button', { name: 'Buat dengan AI: ' + label, exact: true }).click();
      await dialog.waitFor({ timeout: 50000 });
      if (label === 'Deskripsi posisi') assert.equal(await description.inputValue(), original);
      await dialog.getByRole('button', { name: 'Terapkan', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    assert.notEqual(await description.inputValue(), original);
    await page.getByRole('textbox', { name: 'Tanggung jawab utama 1', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'KPI posisi 1', exact: true }).waitFor();
    assert.ok(await page.getByRole('combobox', { name: /^Kebutuhan / }).count());
  }
  const submit = page.locator('button[form="hr-job-form"]');
  const scene = id => page.locator(`[data-hr-assistant][data-scene="${id}"]`);
  const story = page.locator('[data-hr-assistant]');
  await submit.click();
  await scene('taka-intro').waitFor({ timeout: 20000 });
  await story.getByRole('button', { name: 'Kembali', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await titleInput.waitFor({ timeout: 30000 });
  assert.equal(await titleInput.inputValue(), title);
  await page.getByText('Free | Paket dikonfirmasi', { exact: true }).waitFor();
  await submit.click();
  await scene('taka-intro').waitFor();
  for (const id of ['cv-sources', 'cv-ranking', 'tara-intro', 'chat-demo', 'voice-demo', 'cv-upload']) {
    await story.getByRole('button', { name: 'Lanjut', exact: true }).click();
    await scene(id).waitFor();
  }
  return scene('cv-upload');
}

module.exports = async function runOnboarding({ web, db, openContext, makeToken, makePdf, worker, report, onboardingDraft }) {
  await db.country.upsert({ where: { id: 'ID' }, create: { id: 'ID', name: 'Indonesia', slug: 'indonesia', iso2: 'ID', iso3: 'IDN', phoneCode: '+62', currencyCode: 'IDR' }, update: {} });
  if (!await db.industryTaxonomy.count({ where: { active: true } })) {
    await db.industryTaxonomy.create({ data: { version: 'onboarding-test', active: true, groups: { create: {
      id: 'onboarding-test-industry', code: 'ONBOARDING_TEST', name: 'Software', nameId: 'Perangkat lunak', nameUz: 'Dasturiy ta’minot', nameRu: 'Программное обеспечение', definition: 'Synthetic software industry', boundaries: 'Test data', sortOrder: 1,
    } } } });
  }
  const province = await db.province.create({ data: { name: 'DKI Jakarta', slug: 'dki-jakarta-test', countryId: 'ID' } });
  await db.city.create({ data: { name: 'Kota Jakarta', slug: 'kota-jakarta-test', provinceId: province.id } });
  const file = async index => ({ name: `Kandidat-Audit-${index}.pdf`, mimeType: 'application/pdf', buffer: await makePdf(`Kandidat sintetis ${index} mengembangkan API Node.js.`) });

  const uploadCount = Number(process.env.RELIABILITY_ONBOARDING_CV_COUNT || 10);
  assert.ok([1, 10, 100].includes(uploadCount), 'Use a bounded upload count');
  report.uploadCount = uploadCount;
  const temporaryFolders = new Map();
  try {
    for (const decision of ['skip', 'upload']) {
      const userId = 'http-onboarding-' + decision;
      await db.user.create({ data: { id: userId, fullName: 'HR Onboarding Audit', email: userId + '@synthetic.test', emailVerified: true, role: 'RECRUITER', recruiterOnboarding: { create: { status: 'IN_PROGRESS', step: 1 } } } });
      const page = await openContext(makeToken(userId));
      await prepareCompany({ page, web, decision });
      const title = decision === 'skip' ? 'Backend Engineer Skip Audit' : 'Backend Engineer Upload Audit';
      const draftWithAi = onboardingDraft && decision === 'skip';
      const uploadScene = await reachUpload(page, title, draftWithAi);
      const upload = uploadScene.getByRole('button', { name: 'Upload', exact: true });
      const skip = uploadScene.getByRole('button', { name: 'Lewati', exact: true });
      assert.equal(await upload.isEnabled(), false);
      const files = await Promise.all(Array.from({ length: decision === 'skip' ? 1 : uploadCount }, (_, index) => file(index + 1)));
      const picker = uploadScene.locator('button[data-dragging]:not(:disabled)');
      const list = uploadScene.getByRole('list', { name: 'CV yang dipilih' });
      async function choose(batch) {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'talentio-onboarding-cv-'));
        const paths = batch.map(item => path.join(folder, item.name));
        temporaryFolders.set(folder, paths);
        await Promise.all(paths.map((filePath, index) => fs.writeFile(filePath, batch[index].buffer)));
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), picker.click()]);
        await chooser.setFiles(paths);
        await list.getByText(batch[0].name, { exact: true }).waitFor({ timeout: 10000 });
      }
      try {
        await choose(files.slice(0, 3));
        if (files.length > 3) await choose(files.slice(3));
      } catch (error) {
        report.uploadSurface = await uploadScene.innerText({ timeout: 1000 }).catch(() => 'Scene no longer visible');
        throw error;
      }
      assert.equal(await list.getByRole('listitem').count(), files.length);
      for (const item of files) await list.getByText(item.name, { exact: true }).waitFor();

      let releaseUploads = () => {};
      let interrupted = false;
      try {
        if (decision === 'skip') {
          await skip.click();
          const dialog = page.getByRole('dialog', { name: 'Lewati upload CV?' });
          await dialog.getByRole('button', { name: 'Batal' }).click();
          await list.getByText(files[0].name, { exact: true }).waitFor();
          await skip.click();
          await dialog.getByRole('button', { name: 'Lanjut', exact: true }).click();
        } else {
          const gate = new Promise(resolve => { releaseUploads = resolve; });
          await page.context().route(process.env.S3_ENDPOINT + '/**', async route => {
            if (route.request().method() === 'PUT') {
              await gate;
              if (!interrupted) {
                interrupted = true;
                return route.abort('internetdisconnected');
              }
            }
            await route.fallback();
          });
          await upload.click();
        }
        await page.waitForURL(/\/dashboard\/recruiter/, { timeout: 30000 });
        const progress = await db.recruiterOnboarding.findUniqueOrThrow({ where: { userId } });
        assert.equal(progress.status, 'COMPLETE');
        const published = await db.jobPost.findMany({ where: { companyId: progress.companyId, title } });
        assert.equal(published.length, 1);
        assert.equal(published[0].status, 'PUBLISHED');
        if (draftWithAi) {
          const saved = await db.jobPost.findUniqueOrThrow({ where: { id: published[0].id }, include: { jobSkills: true } });
          assert.ok(saved.description.length > 40 && saved.responsibilities.length > 0 && saved.kpis.length > 0 && saved.jobSkills.length > 0);
          report.steps.push('All four GPT-6 Luna suggestions were previewed, applied in the real browser and persisted after the draft was reopened and published.');
        }
        const jobId = published[0].id;
        const where = { jobId };
        if (decision === 'skip') {
          assert.equal(await db.candidateImport.count({ where }), 0);
          assert.equal(await db.recruitmentCandidate.count({ where }), 0);
          report.steps.push('Company, Free checkout and draft publish through real APIs. Back/reload retains draft; cancel keeps selected CV; confirm Skip publishes once without an import.');
        } else {
          assert.equal(await db.candidateImport.count({ where }), 1);
          assert.equal(await db.recruitmentCandidate.count({ where: { ...where, scoreStatus: 'UPLOADING' } }), files.length);
          releaseUploads();
          const panel = page.getByRole('complementary', { name: 'Progres impor CV' });
          const incomplete = panel.getByRole('button', { name: /Impor CV perlu diperiksa|Menilai CV/ });
          await incomplete.waitFor({ timeout: 20000 });
          const pendingUntil = Date.now() + 20000;
          while (await db.recruitmentCandidate.count({ where: { ...where, scoreStatus: 'PENDING' } }) !== files.length - 1 && Date.now() < pendingUntil) await wait(100);
          assert.equal(await db.recruitmentCandidate.count({ where: { ...where, scoreStatus: 'PENDING' } }), files.length - 1);
          const missing = await db.recruitmentCandidate.findFirstOrThrow({ where: { ...where, scoreStatus: 'UPLOADING' } });
          assert.ok(interrupted);
          await page.waitForFunction(({ userId, id }) =>
            JSON.parse(localStorage.getItem('candidate-imports:' + userId) ?? '[]')
              .some(batch => batch.files.some(item => item.id === id && item.status === 'error')),
          { userId, id: missing.id });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await incomplete.click({ timeout: 20000 });
          const reselect = panel.getByLabel('Pilih kembali ' + missing.filename, { exact: true });
          await reselect.waitFor({ state: 'attached', timeout: 8000 });
          await page.evaluate(({ userId, id }) => {
            const key = 'candidate-imports:' + userId;
            const saved = JSON.parse(localStorage.getItem(key));
            for (const batch of saved) {
              const item = batch.files.find(file => file.id === id);
              if (item) delete item.needsReselect;
            }
            localStorage.setItem(key, JSON.stringify(saved));
          }, { userId, id: missing.id });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await incomplete.click({ timeout: 20000 });
          await reselect.waitFor({ state: 'attached', timeout: 8000 });
          await reselect.setInputFiles(files.find(item => item.name === missing.filename));
          await worker.onModuleInit();
          const until = Date.now() + 90000;
          while (await db.recruitmentCandidate.count({ where: { ...where, scoreStatus: 'READY' } }) !== files.length && Date.now() < until) await wait(250);
          assert.equal(await db.recruitmentCandidate.count({ where: { ...where, scoreStatus: 'READY', cvScore: 75 } }), files.length);
          assert.equal(await db.candidateImport.count({ where }), 1);
          assert.equal(await db.recruitmentCandidate.count({ where }), files.length);
          report.steps.push(uploadCount + ' CVs selected from filesystem folders reach MinIO. The dashboard opens before upload completion, and after one dropped PUT and reload HR reselects only that CV. Legacy saved metadata also resumes the same transfer. Each scores through the original import.');
        }
      } finally { releaseUploads(); }
    }
  } finally {
    for (const [folder, paths] of temporaryFolders) {
      await Promise.allSettled(paths.map(filePath => fs.unlink(filePath)));
      await fs.rmdir(folder);
    }
  }
};
