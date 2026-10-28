const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('apps/api/package.json'));
const db = new (req('@prisma/client').PrismaClient)();
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
const marker = `library-audit-${Date.now()}`, users = [], checks = [];
async function http(route, session, method = 'GET', body, status = 200) {
  const response = await fetch('http://localhost:4000/api' + route, { method, headers: { ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (status !== null) assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
  return { status: response.status, body: result };
}
async function register(suffix) {
  const { body: session } = await http('/auth/register', null, 'POST', { email: `${marker}-${suffix}@example.test`, password: 'Local-library-audit-2026!', fullName: marker, role: 'EMPLOYEE', locale: 'en', acceptTerms: true }, 201);
  users.push(session.user.id); return session;
}
async function main() {
  const employee = await register('owner'), other = await register('other');
  const profile = await db.employeeProfile.findUniqueOrThrow({ where: { userId: employee.user.id } });
  const initial = await Promise.all(Array.from({ length: 9 }, (_, i) => http('/profiles/me/resumes', employee, 'POST', { title: `CV ${i}`, isPrimary: true }, 201)));
  assert.equal(await db.resume.count({ where: { profileId: profile.id, deletedAt: null, isPrimary: true } }), 1);
  const race = await Promise.all([0, 1].map(i => http('/profiles/me/resumes', employee, 'POST', { title: `Race ${i}` }, null)));
  assert.deepEqual(race.map(r => r.status).sort(), [201, 400]);
  assert.equal(await db.resume.count({ where: { profileId: profile.id, deletedAt: null } }), 10);
  checks.push('concurrent create enforces 10-CV quota and exactly one primary CV');
  const ids = initial.slice(0, 2).map(r => r.body.id);
  await Promise.all(ids.map(id => http(`/profiles/me/resumes/${id}`, employee, 'PATCH', { isPrimary: true })));
  assert.equal(await db.resume.count({ where: { profileId: profile.id, deletedAt: null, isPrimary: true } }), 1);
  await http(`/profiles/me/resumes/${ids[0]}`, other, 'PATCH', { isPrimary: true }, 404);
  await http(`/profiles/me/resume-document?resumeId=${ids[0]}`, other, 'GET', undefined, 404);
  await http('/profiles/me/resume-document?resumeId=nonexistent-audit-cv', employee, 'GET', undefined, 404);
  checks.push('primary updates serialize; foreign and nonexistent CV document reads are rejected');
  const deleted = await db.resume.create({ data: { profileId: profile.id, title: 'Archived audit CV', deletedAt: new Date(), isPrimary: false } });
  await http(`/profiles/me/resumes/${deleted.id}/restore`, employee, 'POST', {}, 400);
  const primary = await db.resume.findFirstOrThrow({ where: { profileId: profile.id, isPrimary: true, deletedAt: null } });
  await http(`/profiles/me/resumes/${primary.id}`, employee, 'DELETE');
  const restoreRace = await Promise.all([
    http(`/profiles/me/resumes/${deleted.id}/restore`, employee, 'POST', {}, null),
    http('/profiles/me/resumes', employee, 'POST', { title: 'Concurrent restore/create' }, null),
  ]);
  assert.deepEqual(restoreRace.map(r => r.status).sort(), [201, 400]);
  assert.equal(await db.resume.count({ where: { profileId: profile.id, deletedAt: null } }), 10);
  assert.equal(await db.resume.count({ where: { profileId: profile.id, deletedAt: null, isPrimary: true } }), 1);
  if (restoreRace[0].status === 201) await http(`/profiles/me/resumes/${deleted.id}/restore`, employee, 'POST', {}, 201);
  checks.push('restore respects quota during concurrent create; deleting primary assigns another primary; restore retry is idempotent');
  console.log(JSON.stringify({ result: 'PASS', checks }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); });
