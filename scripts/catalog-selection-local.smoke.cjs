// Real local HTTP/DB checks. All synthetic records are removed in finally.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local database only');
const db = new PrismaClient();
const origin = 'http://localhost:4000/api';
const marker = `catalog-check-${Date.now()}`;
let userId, companyId;
async function request(route, { method = 'GET', body, token, status = 200, locale = 'en' } = {}) {
  const response = await fetch(origin + route, {
    method,
    headers: { 'X-Locale': locale, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
  return result;
}
async function main() {
  const countries = await request('/meta/countries');
  const id = countries.find(country => country.iso2 === 'ID');
  const uz = countries.find(country => country.iso2 === 'UZ');
  assert.ok(id && uz);
  const cities = await request('/meta/cities');
  assert.ok(cities.length > 600);
  assert.ok(cities.every(city => ['CITY', 'REGENCY'].includes(city.kind) && city.province?.country));
  const cityId = cities.find(city => city.province.country.id === id.id);
  const cityUz = cities.find(city => city.province.country.id === uz.id);
  assert.ok(cityId && cityUz);
  const idProvinces = await request('/meta/provinces?country=ID');
  const allProvinces = await request('/meta/provinces');
  assert.ok(idProvinces.length >= 38 && allProvinces.length > idProvinces.length);
  assert.ok(idProvinces.every(province => province.country.iso2 === 'ID'));

  const catalogCount = await db.jobTitle.count();
  const role = await db.jobTitle.findFirstOrThrow({ where: { archivedAt: null, nameId: { not: null }, aliases: { some: {} } }, include: { aliases: true } });
  const translated = await request(`/meta/job-titles?q=${encodeURIComponent(role.nameId)}&limit=100`, { locale: 'id' });
  const option = translated.items.find(item => item.id === role.id);
  assert.equal(option.canonicalName, role.name);
  assert.equal(option.name, role.nameId);
  const aliasOptions = await request(`/meta/job-titles?q=${encodeURIComponent(role.aliases[0].alias)}&limit=100`);
  assert.ok(aliasOptions.items.some(item => item.id === role.id));

  const session = await request('/auth/register', { method: 'POST', status: 201, body: { email: `${marker}@example.test`, password: 'Local-catalog-check-2026!', fullName: 'Catalog Local Check', locale: 'id', role: 'EMPLOYEE', acceptTerms: true } });
  userId = session.user.id;
  const token = session.accessToken;
  const patch = body => request('/profiles/me', { method: 'PATCH', token, body });
  await patch({ desiredPositions: [role.nameId, role.aliases[0].alias, 'Custom Interplanetary Role'] });
  let profile = await request('/profiles/me', { token });
  assert.deepEqual(profile.desiredPositions, [role.name, 'Custom Interplanetary Role']);
  assert.equal(profile.desiredPosition, role.name);
  assert.equal(await db.jobTitle.count(), catalogCount, 'Employee roles must never create catalog rows');
  await request('/profiles/me', { method: 'PATCH', token, status: 400, body: { residenceCountryId: id.id, citySlug: cityUz.slug } });
  await request('/profiles/me', { method: 'PATCH', token, status: 400, body: { citySlug: marker } });
  await patch({ citySlug: cityId.slug });
  profile = await request('/profiles/me', { token });
  assert.equal(profile.residenceCountryId, id.id);
  assert.equal(profile.city.slug, cityId.slug);
  await patch({ residenceCountryId: uz.id });
  profile = await request('/profiles/me', { token });
  assert.equal(profile.city, null, 'Changing country clears the old city');
  assert.equal(profile.residenceCountryId, uz.id);
  await request('/profiles/me/onboarding', { method: 'PATCH', token, body: { desiredPositions: [role.nameId, role.name], step: 2 } });
  assert.deepEqual((await request('/profiles/me', { token })).desiredPositions, [role.name]);

  const alert = await request('/alerts', { method: 'POST', token, status: 201, body: { name: marker, query: role.name, countryId: id.id, notifyEmail: false } });
  assert.equal(alert.countryId, id.id);
  assert.equal(alert.cityId, null);
  assert.equal(alert.country.iso2, 'ID');
  await request(`/alerts/${alert.id}`, { method: 'PATCH', token, status: 400, body: { countryId: id.id, citySlug: cityUz.slug } });
  const updatedAlert = await request(`/alerts/${alert.id}`, { method: 'PATCH', token, body: { citySlug: cityUz.slug } });
  assert.equal(updatedAlert.countryId, uz.id);
  assert.ok((await request('/alerts', { token })).some(item => item.id === alert.id && item.country.iso2 === 'UZ'));

  const company = await db.company.create({ data: { name: marker, slug: marker } });
  companyId = company.id;
  const jobs = [];
  for (const country of [id, uz]) jobs.push(await db.jobPost.create({ data: { companyId, title: `${marker}-${country.iso2}`, description: 'Local catalog regression fixture', workMode: 'REMOTE', countryId: country.id, status: 'PUBLISHED', publishedAt: new Date() } }));
  const idJobs = await request(`/jobs?country=${id.slug}&limit=50&sort=newest`);
  const uzJobs = await request(`/jobs?country=${uz.slug}&limit=50&sort=newest`);
  assert.ok(idJobs.items.some(job => job.id === jobs[0].id), 'Country-only remote job must be searchable');
  assert.ok(!idJobs.items.some(job => job.id === jobs[1].id), 'Other country remote jobs must be excluded');
  assert.ok(uzJobs.items.some(job => job.id === jobs[1].id));
  const seo = await request(`/jobs/${jobs[0].id}/seo`);
  assert.equal(seo.country.iso2, 'ID', 'SEO payload must retain the actual country');
  console.log(`PASS: localized/canonical roles, aliases, no catalog writes, validated hierarchy, country alerts, country-only remote search (${countries.length} countries, ${cities.length} cities/regencies).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (companyId) await db.company.delete({ where: { id: companyId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
