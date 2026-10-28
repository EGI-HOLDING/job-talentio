// Regression: publish after the employee exists; scores are calculated live.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve('apps/api/package.json'));
const db = new (apiRequire('@prisma/client').PrismaClient)();
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
const marker = `live-match-${Date.now()}`;
let userId, companyId, token;
async function request(route, method = 'GET', body) {
  const response = await fetch('http://localhost:4000/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Locale': 'en', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}
async function main() {
  const session = await request('/auth/register', 'POST', { email: `${marker}@example.test`, password: 'Local-matching-2026!', fullName: 'Live Match Regression', role: 'EMPLOYEE', locale: 'en', acceptTerms: true });
  userId = session.user.id; token = session.accessToken;
  const country = await db.country.findFirstOrThrow({ where: { iso2: 'ID', isActive: true, archivedAt: null } });
  const title = await db.jobTitle.findFirstOrThrow({ where: { name: 'Full-stack Developer', archivedAt: null } });
  await request('/profiles/me', 'PATCH', { desiredPositions: ['Data Analyst', title.name], preferredCountryIds: [country.id] });
  const company = await db.company.create({ data: { name: marker, slug: marker } });
  companyId = company.id;
  const job = await db.jobPost.create({ data: { title: title.name, description: marker, companyId, jobTitleId: title.id, countryId: country.id, workMode: 'REMOTE', status: 'PUBLISHED', publishedAt: new Date() } });
  const detail = await request(`/jobs/${job.id}`);
  const list = await request(`/jobs?country=${country.slug}&sort=newest&limit=50`);
  const card = list.items.find(item => item.id === job.id);
  assert.ok(card, 'A newly published job must be visible');
  assert.equal(detail.matchBreakdown.title, 15, 'The second desired role counts even with no skills');
  assert.ok(detail.matchScore > 0);
  assert.equal(card.matchScore, detail.matchScore, 'List and detail must agree for a role-only employee');
  const recommended = await request('/jobs/recommended');
  assert.ok(recommended.some(item => item.job.id === job.id && item.matchScore === detail.matchScore));
  await request('/profiles/me', 'PATCH', { desiredPositions: ['Unrelated Marine Biologist'] });
  assert.equal((await request(`/jobs/${job.id}`)).matchScore, 0, 'A genuine role/skill mismatch returns zero');
  await request('/profiles/me', 'PATCH', { desiredPositions: [title.name] });
  assert.equal((await request(`/jobs/${job.id}`)).matchScore, detail.matchScore, 'Changing the profile immediately recalculates, with no queue or backfill');
  console.log(`PASS: new job immediately scores ${detail.matchScore}% across list/detail/recommendations; profile changes immediately recalculate to zero and back.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (companyId) await db.company.delete({ where: { id: companyId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
