const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const web = 'http://127.0.0.1:3096';
const api = 'http://127.0.0.1:4096/api';
const out = path.resolve(__dirname, '../output/hr-package-preview');
const account = JSON.parse(readFileSync(path.join(out, 'account.json'), 'utf8'));
const amounts = { LITE: 49000, STANDARD: 149000, PREMIUM: 299000 };
const tiers = { LITE: 'Lite', STANDARD: 'Standard', PREMIUM: 'Premium' };
const report = path.join(out, 'browser-report.json');
const checks = { desktop: false, mobile: false, purchases: [], linkedIn: null };
try { Object.assign(checks, JSON.parse(readFileSync(report, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function request(route, session, options = {}) {
  const response = await fetch(api + route, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(session && { Authorization: 'Bearer ' + session.accessToken }), ...options.headers },
  });
  if (!response.ok) throw Error(route.split('?')[0] + ' HTTP ' + response.status);
  return response.json();
}

async function pricing(browser) {
  for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(web + '/id/pricing');
    const cards = page.locator('article[data-code]');
    await cards.last().waitFor();
    assert.equal(await cards.count(), 3);
    const comparison = page.getByText('Bandingkan semua fitur', { exact: true });
    await comparison.focus();
    await comparison.press('Enter');
    const table = page.getByRole('table');
    assert.equal(await table.getByRole('columnheader').count(), 4);
    assert.match(await table.innerText(), /Penilaian CV dan ranking.*AI/i);
    assert.match(await table.innerText(), /1[.\s]000/);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'pricing-' + size + '.png'), fullPage: true });
    const visibleWidth = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    assert.ok(visibleWidth.body <= visibleWidth.viewport + 1, 'Page does not overflow viewport at ' + size + ': ' + JSON.stringify(visibleWidth));
    checks[size] = true;
    await page.close();
  }
}

async function login(browser, email = account.email) {
  const session = await request('/auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password: account.password, expectedRole: 'RECRUITER' }),
  });
  assert.equal(session.user.role, 'RECRUITER');
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await context.addInitScript(({ session, web }) => {
    if (location.origin !== web) return;
    if (!localStorage.getItem('jt_session')) {
      localStorage.setItem('jt_session', JSON.stringify(session));
      localStorage.setItem('jt_token', session.accessToken);
      localStorage.setItem('jt_refresh', session.refreshToken);
    }
  }, { session, web });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    return target.hostname === '127.0.0.1' || target.hostname.endsWith('.sandbox.midtrans.com') ? route.continue() : route.abort();
  });
  return { session, context };
}

async function verifyEntryPoints(browser, page) {
  const {context} = await login(browser, 'onboarding@packages-preview.talentio.test');
  try {
    const onboarding = await context.newPage();
    await onboarding.goto(web + '/id/onboarding/recruiter');
    const checkout = onboarding.getByRole('heading', {name:'Periksa pesanan Anda'});
    await checkout.or(onboarding.getByRole('radio', {name:'Lite', exact:true})).first().waitFor();
    if (await checkout.isVisible()) await onboarding.getByRole('button', {name:'Ubah paket', exact:true}).click();
    for (const name of Object.values(tiers)) await onboarding.getByRole('radio', {name, exact:true}).waitFor();
    const standard = onboarding.getByRole('radio', {name:'Standard', exact:true});
    await standard.focus();
    await standard.press('Space');
    await onboarding.getByRole('button', {name:'Lanjut ke checkout', exact:true}).click();
    await checkout.waitFor();
    await checkout.evaluate(element => new Promise(resolve => requestAnimationFrame(() => resolve(element.getBoundingClientRect().top))));
    assert.ok((await checkout.boundingBox()).y > 64, 'Checkout title stays below the fixed header');
    assert.match(await onboarding.getByRole('main').innerText(), /149\.000/);
    await onboarding.screenshot({path:path.join(out,'checkout-standard.png')});
  } finally { await context.close(); }

  const lite = checks.purchases.find(order => order.package === 'LITE');
  await page.goto(web + '/id/dashboard/recruiter/jobs/' + lite.jobId + '/package');
  const cards = page.locator('article[data-code]');
  await cards.last().waitFor();
  assert.equal(await cards.count(), 3);
  assert.match(await page.locator('article[data-code="STANDARD"]').innerText(), /100\.000/);
  assert.ok((await page.locator('article[data-code="STANDARD"] button').isEnabled()));

  const admin = await browser.newPage();
  try {
    await admin.goto('http://127.0.0.1:3097/benefits');
    await admin.locator('input[name="email"]').fill('admin@packages-preview.talentio.test');
    await admin.locator('input[name="password"]').fill(account.password);
    await admin.getByRole('button', {name:'Sign in', exact:true}).click();
    const dropdown = admin.getByRole('combobox', {name:'Package', exact:true});
    await dropdown.locator('option').last().waitFor({state:'attached'});
    assert.deepEqual(new Set(await dropdown.locator('option').allTextContents()), new Set(Object.keys(tiers)));
    await dropdown.selectOption('LITE');
    const policy = JSON.parse(await admin.getByRole('textbox', {name:'Policy settings'}).inputValue());
    assert.equal(policy.featuredDays, 3);
    await admin.goto('http://127.0.0.1:3097/job-orders');
    for (const code of ['LITE', 'FREE']) {
      const response = admin.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/admin/job-orders') && url.searchParams.get('code') === code;
      });
      await admin.getByRole('combobox', {name:'Order package'}).selectOption(code);
      const orders = await (await response).json();
      assert.ok(orders.total > 0 && orders.items.every(order => order.code === code));
      await admin.getByRole('cell', {name: code === 'LITE' ? /^Lite\b/ : /^Free\b/}).first().waitFor();
    }
  } finally { await admin.close(); }
  checks.entryPoints = { onboarding: 'passed', upgrade: 'passed', admin: 'passed' };
  writeFileSync(report, JSON.stringify(checks, null, 2));
}

async function payCard(page) {
  assert.equal(new URL(page.url()).hostname, 'app.sandbox.midtrans.com');
  await page.getByText(/^(Kartu Kredit\/Debit|Kartu Kredit(?: \/ Debit)?|Credit\/Debit Card|Credit Card|Card Payment)$/i).first().click({ timeout: 12000 });
  // Public Midtrans Sandbox test credentials. All inputs stay on the Sandbox domain.
  await page.locator('input[name="cardnumber"], input[autocomplete="cc-number"], input[placeholder*="1111"]').first().fill('4811111111111114');
  await page.locator('input[name="expiry"], input[autocomplete="cc-exp"], input[placeholder*="MM / YY"], input[placeholder*="MM/YY"]').first().fill('0131');
  await page.locator('input[name="cvv"], input[autocomplete="cc-csc"], input[placeholder="123"]').first().fill('123');
  await page.getByText(/^(Bayar sekarang|Pay now|Bayar|Pay)$/i).last().click();
  const otp = page.frameLocator('iframe').first();
  const otpInput = otp.locator('input[type="password"], input[name*="otp" i], input[id*="otp" i]').first();
  if (await otpInput.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
    await otpInput.fill('112233');
    await otp.getByRole('button', { name: /^(OK|Submit|Confirm|Pay|Kirim|Lanjut)/i }).first().click();
  }
  const finish = page.getByText(/Kembali ke (website|merchant)|Back to merchant|Return to merchant|Selesai/i).last();
  if (await finish.waitFor({ timeout: 12000 }).then(() => true, () => false)) await finish.click();
}

async function publish(page, session, company, code) {
  const label = tiers[code];
  const workspace = '/id/dashboard/recruiter?tab=jobs&company=' + encodeURIComponent(company.id);
  const orderPath = '/job-commerce/orders?companyId=' + encodeURIComponent(company.id);
  const pendingOrder = orders => orders.find(item => item.catalogVersion === 2 && item.code === code
    && item.provider === 'midtrans-sandbox' && ['PENDING', 'PAID'].includes(item.status));
  let order = pendingOrder(await request(orderPath, session));
  if (!order || order.status === 'PENDING') {
    await page.goto(web + workspace + (order ? '&creationSession=' + encodeURIComponent(order.creationSessionId) : '&focus=create'));
    if (!order) {
      await page.getByRole('radio', { name: label, exact: true }).check();
      await page.getByRole('button', { name: 'Lanjut ke checkout', exact: true }).click();
    }
    await page.getByRole('heading', { name: 'Periksa pesanan Anda' }).waitFor();
    if (code === 'STANDARD') await page.screenshot({ path: path.join(out, 'checkout-standard.png'), fullPage: true });
    await Promise.all([
      page.waitForURL('https://app.sandbox.midtrans.com/**', { timeout: 22000 }),
      page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true }).click(),
    ]);
    order = pendingOrder(await request(orderPath, session));
    await payCard(page);
  }
  assert.equal(order?.amount, amounts[code]);
  assert.ok(order.creationSessionId);
  if (!page.url().startsWith(web + '/id/checkout/')) await page.goto(web + '/id/checkout/' + order.id);
  await page.getByRole('heading', { name: 'Pembayaran berhasil', exact: true }).waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: 'Lanjut membuat lowongan', exact: true }).click();
  await page.getByRole('heading', { name: 'Posisi & pengalaman' }).waitFor();
  await page.getByRole('button', { name: 'Ketik posisi manual' }).click();
  const title = 'Koordinator Operasional ' + label;
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="description"]').fill('Mengatur jadwal operasional, memastikan kelengkapan data pesanan, dan menyusun laporan mingguan untuk tim rekrutmen.');
  await page.getByRole('combobox', { name: 'Pola kerja' }).selectOption('REMOTE');
  const aiDraft = page.getByRole('button', { name: /AI.*Deskripsi posisi|Deskripsi posisi.*AI/i });
  assert.ok(await aiDraft.first().isEnabled(), 'AI drafting is enabled');
  const [publication] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/publish') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Publikasikan lowongan', exact: true }).click(),
  ]);
  if (!publication.ok()) throw Error('Publish HTTP ' + publication.status() + ' ' + await publication.text());
  const { jobId } = await publication.json();
  const paid = await request('/job-commerce/orders/' + order.id, session);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.provider, 'midtrans-sandbox');
  assert.equal(paid.jobId, jobId);
  assert.ok(paid.fulfilledAt && paid.providerTransactionId);
  const benefits = await request('/benefits/jobs/' + jobId, session);
  assert.equal(benefits.code, code);
  assert.ok(benefits.startsAt && benefits.expiresAt && benefits.featuredUntil);
  assert.equal((await request('/hr-flow/sessions/' + paid.creationSessionId, session)).phase, 'PUBLISHED');
  checks.purchases.push({ package: code, amount: order.amount, orderId: order.id, jobId, status: paid.status, title });
  writeFileSync(report, JSON.stringify(checks, null, 2));
  console.log(code + ' settled by Midtrans Sandbox and published.');
}

async function verifyBenefits(page, session, companies) {
  const featured = await request('/companies?sort=featured');
  const activeSlugs = featured.items.map(row => row.slug).filter(slug => slug.startsWith('package-preview-'));
  assert.deepEqual(activeSlugs, ['package-preview-premium', 'package-preview-standard', 'package-preview-lite']);
  await page.goto(web + '/id?audience=seekers');
  const companyCards = page.locator('a[href*="/companies/package-preview-"]');
  await companyCards.first().waitFor();
  const visibleSlugs = await companyCards.evaluateAll(cards => cards.map(card => new URL(card.href).pathname.split('/').pop()));
  assert.deepEqual([...new Set(visibleSlugs)], activeSlugs);

  for (const purchase of checks.purchases) {
    const jobId = purchase.jobId;
    const company = companies.find(row => row.slug === 'package-preview-' + purchase.package.toLowerCase());
    const details = '/id/dashboard/recruiter/jobs/' + jobId + '?section=details&company=' + encodeURIComponent(company.id);
    await page.goto(web + details);
    await page.getByRole('heading', { name: purchase.title, exact: true }).waitFor();
    const benefits = await request('/benefits/jobs/' + jobId, session);
    assert.equal(benefits.conversions, purchase.package !== 'LITE');
    assert.equal(benefits.reports, purchase.package === 'PREMIUM');
    await page.locator('time[datetime="' + benefits.expiresAt + '"]').first().waitFor();
    await page.locator('time[datetime="' + benefits.featuredUntil + '"]').first().waitFor();
    if (purchase.package === 'LITE' && !benefits.activeBoost) {
      await page.locator('summary').filter({ hasText: /boost/i }).click();
      await page.getByRole('button', { name: 'Aktifkan boost' }).click();
      await page.waitForFunction(() => /Boost aktif hingga/i.test(document.body.innerText));
      const boosted = await request('/benefits/jobs/' + jobId, session);
      assert.ok(boosted.activeBoost);
      assert.equal(new Date(boosted.activeBoost.endsAt) - new Date(boosted.activeBoost.startsAt), 86400_000);
    }
    const csv = await fetch(api + '/hr-reports/csv?' + new URLSearchParams({companyId: company.id, jobId}), {
      headers: { Authorization: 'Bearer ' + session.accessToken },
    });
    assert.equal(csv.status, purchase.package === 'PREMIUM' ? 200 : 403);
    if (purchase.package === 'PREMIUM') {
      await verifyLinkedIn(page, session, details, company, jobId);
      await page.locator('#linkedin-share-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'lowongan-premium.png'), fullPage: true });
    } else {
      assert.equal(await page.getByRole('heading', { name: 'Posting ke halaman perusahaan LinkedIn' }).count(), 0);
      const rejected = await fetch(api + '/jobs/' + jobId + '/linkedin/preview', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'id' }),
      });
      assert.equal(rejected.status, 403);
    }
  }
  checks.benefits = { featured: activeSlugs, boost: 'activated in browser', conversions: 'Standard and Premium', premiumCsv: true };
  writeFileSync(report, JSON.stringify(checks, null, 2));
}

async function verifyLinkedIn(page, session, details, company, jobId) {
  const list = '/jobs/' + encodeURIComponent(jobId) + '/social-posts';
  const existing = await request(list, session);
  if (existing.some(post => post.status === 'PUBLISHED')) {
    assert.equal(existing.length, 1);
    const [post] = existing;
    let pendingReads = 0;
    let realReads = 0;
    let hold = true;
    const matches = '**' + list;
    const pending = async route => {
      if (route.request().method() !== 'GET') return route.continue();
      if (!hold) { realReads++; return route.continue(); }
      pendingReads++;
      // Keep the initial reads queued until the dashboard has shown that state.
      return route.fulfill({json: [{...post, status: 'PENDING', providerPostUrn: null, publishedAt: null}]});
    };
    await page.route(matches, pending);
    await page.reload();
    await page.locator('[data-status="PENDING"] strong').waitFor({timeout: 12000});
    hold = false;
    await page.locator('[data-status="PUBLISHED"] code').waitFor({timeout: 16000});
    assert.ok(pendingReads > 0 && realReads > 0, 'Posting status refreshed from the API');
    await page.unroute(matches, pending);
    checks.linkedIn = { jobId, status: post.status, simulation: true, posts: 1, polling: 'passed' };
    return;
  }
  const link = page.getByRole('button', { name: 'Hubungkan LinkedIn', exact: true });
  const choose = page.getByRole('button', { name: 'Pilih halaman perusahaan', exact: true });
  if (await link.or(choose).first().waitFor({timeout: 20000}).then(() => link.isVisible(), () => false)) {
    await link.click();
    await page.waitForURL(url => url.origin === web && url.searchParams.get('linkedin') === 'connected', { timeout: 16000 });
    await page.goto(web + details);
  }
  const connection = await request('/integrations/linkedin/companies/' + company.id, session);
  assert.equal(connection.simulated, true);
  if (!connection.page) {
    await choose.click();
    await page.getByRole('combobox', { name: 'Halaman perusahaan', exact: true })
      .selectOption({ label: 'Talentio Company Page Sandbox' });
    await page.getByRole('button', { name: 'Simpan halaman', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Pratinjau posting', exact: true }).click();
  const approve = page.getByRole('button', { name: 'Setujui dan posting', exact: true });
  await approve.waitFor();
  await page.screenshot({ path: path.join(out, 'linkedin-preview.png'), fullPage: true });
  const [approval] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(list) && response.request().method() === 'POST'),
    approve.click(),
  ]);
  if (!approval.ok()) throw Error('LinkedIn local approval HTTP ' + approval.status());
  const accepted = await approval.json();
  const repeated = await request(list, session, { method: 'POST', body: approval.request().postData() });
  assert.equal(repeated.id, accepted.id, 'Duplicate approval resolves to the existing post');
  await page.locator('[data-status="PUBLISHED"] code').waitFor({timeout: 30000});
  const [post] = await request(list, session);
  assert.equal(post.status, 'PUBLISHED');
  assert.match(post.providerPostUrn, /^urn:li:share:\d+$/);
  assert.equal((await request(list, session)).length, 1);
  checks.linkedIn = { jobId, status: post.status, simulation: true, posts: 1 };
  writeFileSync(report, JSON.stringify(checks, null, 2));
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  let page;
  try {
    if (!process.argv.includes('--checkout-only') && !process.argv.includes('--benefits')) await pricing(browser);
    writeFileSync(report, JSON.stringify(checks, null, 2));
    if (process.argv.includes('--pricing')) return;
    const catalog = await request('/job-commerce/catalog');
    assert.equal(catalog.version, 2);
    assert.equal(catalog.sandbox, true);
    assert.equal(catalog.testMode, false);
    assert.equal(catalog.paymentAvailable, true);
    const { session, context } = await login(browser);
    const companies = (await request('/companies/mine', session)).map(membership => membership.company);
    page = await context.newPage();
    page.setDefaultTimeout(16000);
    for (const code of Object.keys(tiers).filter(code => (process.argv.length <= 2 || process.argv.includes(code))
      && !checks.purchases.some(purchase => purchase.package === code))) {
      await publish(page, session, companies.find(company => company.slug === 'package-preview-' + code.toLowerCase()), code);
    }
    if (!process.argv.includes('--checkout-only') && checks.purchases.length === 3) {
      await verifyBenefits(page, session, companies);
      await verifyEntryPoints(browser, page);
    }
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(out, 'browser-progress.png'), fullPage: true }).catch(() => undefined);
      const address = new URL(page.url());
      console.error('Browser origin:', address.origin);
      console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
    }
    throw error;
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
