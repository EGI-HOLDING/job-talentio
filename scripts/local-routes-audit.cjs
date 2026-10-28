const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://localhost:3000';
const assets = new Set();
const results = [];

async function page(url, expected = 200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, expected, `HTTP ${response.status}`);
    const html = await response.text();
    if (expected === 200) {
      assert.ok(!html.includes('Internal Server Error'), 'server error page');
      assert.ok(html.includes('<html'), 'missing HTML document');
      for (const match of html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)) {
        assets.add(new URL(match[1].replaceAll('&amp;', '&'), url).href);
      }
    }
    results.push({ url, passed: true });
  } catch (error) { results.push({ url, passed: false, error: error.message }); }
}

async function main() {
  const paths = [
    '', '/jobs', '/employers', '/talent', '/news', '/terms', '/privacy',
    '/explore/titles', '/explore/cities', '/explore/companies', '/explore/categories', '/explore/industries',
    '/login?role=EMPLOYEE', '/login?role=RECRUITER', '/register?role=EMPLOYEE', '/register?role=RECRUITER',
    '/forgot-password', '/reset-password', '/verify-email', '/confirm-email-change', '/settings', '/messages',
    '/dashboard/employee?tab=applications', '/dashboard/employee?tab=profile', '/dashboard/employee?tab=saved',
    '/dashboard/employee/resume-builder', '/dashboard/recruiter?tab=jobs', '/dashboard/recruiter?tab=company',
    '/dashboard/recruiter?tab=analytics',
  ];
  for (const locale of ['en', 'ru', 'uz', 'id']) {
    for (let start = 0; start < paths.length; start += 4) {
      await Promise.all(paths.slice(start, start + 4).map((route) => page(`${base}/${locale}${route}`)));
    }
  }
  for (const route of ['', '/users', '/companies', '/jobs', '/reports', '/verifications', '/catalog', '/catalog/translations', '/flags', '/audit']) {
    await page(`http://localhost:3001${route}`);
  }
  await page(`${base}/en/not-a-real-audit-route`, 404);
  const cache = path.join(__dirname, '../node_modules/.cache/local-audit');
  fs.mkdirSync(cache, { recursive: true });
  const fixturePath = path.join(cache, 'fixtures.json');
  const cleanupPath = path.join(cache, 'cleanup.json');
  const removed = fs.existsSync(cleanupPath) ? JSON.parse(fs.readFileSync(cleanupPath, 'utf8')).jobIds : [];
  const fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
  if (fixture?.jobId && !removed.includes(fixture.jobId)) await page(`${base}/en/jobs/${fixture.jobId}`);
  const jobs = await fetch('http://localhost:4000/api/jobs?limit=1').then((response) => response.json());
  if (jobs.items[0]?.id) await page(`${base}/en/jobs/${jobs.items[0].id}`);
  for (const asset of assets) {
    try {
      const response = await fetch(asset, { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200, `HTTP ${response.status}`);
      assert.ok(!response.headers.get('Content-Type')?.includes('text/html'), 'static asset returned HTML');
      results.push({ url: asset, passed: true });
    } catch (error) { results.push({ url: asset, passed: false, error: error.message }); }
  }
  const failed = results.filter((row) => !row.passed);
  for (const row of failed) console.log(`FAIL ${row.url}: ${row.error}`);
  console.log(`HTTP routes/assets: ${results.length - failed.length}/${results.length} passed (${assets.size} static assets)`);
  fs.writeFileSync(path.join(__dirname, '../node_modules/.cache/local-audit/routes.json'), JSON.stringify(results, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
