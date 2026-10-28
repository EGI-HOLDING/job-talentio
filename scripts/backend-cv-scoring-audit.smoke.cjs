// Local HTTP + PostgreSQL + object storage + queue regression audit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const db = new (apiRequire('@prisma/client').PrismaClient)();
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
const prefix = `cv-audit-${Date.now()}`;
const users = [], keys = [], notes = [], createdSkills = [];
async function http(route, session, method = 'GET', body, expected = 200) {
  const response = await fetch('http://localhost:4000/api' + route, { method, headers: { 'X-Locale': 'en', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}
async function register(suffix) {
  const session = await http('/auth/register', null, 'POST', { email: `${prefix}-${suffix}@example.test`, password: 'Local-cv-audit-2026!', fullName: `CV Audit ${suffix}`, role: 'EMPLOYEE', locale: 'en', acceptTerms: true }, 201);
  users.push(session.user.id);
  return session;
}
async function upload(session, name, filename) {
  const form = new FormData();
  const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
  form.append('file', new Blob([fs.readFileSync(filename)], { type }), name);
  form.append('parse', 'true');
  return http('/profiles/me/resumes/upload', session, 'POST', form, 201);
}
async function ready(session, id) {
  const deadline = Date.now() + 190000;
  while (Date.now() < deadline) {
    const state = await http(`/profiles/me/resumes/${id}/parse-status`, session);
    if (state.parseStatus === 'READY') {
      assert.equal(state.parsedData.meta.provider, 'local');
      assert.equal(state.parsedData.meta.llmUsed, false);
      assert.ok(state.parsedData.textPreview.length > 20);
      return state;
    }
    if (state.parseStatus === 'FAILED') throw Error(state.parseError);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Error('Parsing deadline exceeded');
}
async function main() {
  const employee = await register('one');
  const country = await db.country.findFirstOrThrow({ where: { iso2: 'ID', isActive: true, archivedAt: null } });
  const pdf = path.resolve('node_modules/.cache/employee-onboarding/fixtures/employee-cv.pdf');
  const docx = path.resolve('node_modules/.cache/employee-onboarding/fixtures/employee-cv.docx');
  assert.ok(fs.existsSync(pdf) && fs.existsSync(docx), 'Generate real fixtures with employee-onboarding-cv.smoke.ts first');
  const resume = await upload(employee, 'audit.pdf', pdf);
  const parsed = await ready(employee, resume.id);
  assert.ok(parsed.parsedData.experiences.some(row => row.companyName === 'Apex Soft'));
  assert.equal((await http('/profiles/me', employee)).experiences.length, 0);
  await http('/profiles/me/onboarding', employee, 'PATCH', { desiredPositions: ['Frontend Developer'], preferredCountryIds: [country.id], residenceCountryId: country.id, step: 5 });
  const blank = { experiences: [], educations: [], skills: [], languages: [] };
  const newSkill = `Audit Pipeline ${Date.now().toString(36)}`;
  createdSkills.push(newSkill);
  const draft = { ...blank, skills: [newSkill], experiences: [{ title: 'Developer', companyName: prefix, startDate: '2020-01-01', endDate: '2020-04-01' }, { title: 'Developer', companyName: prefix, startDate: '2020-06-01', endDate: '2020-09-01' }] };
  // A failure AFTER the CV import must roll back catalog and profile writes.
  await http('/profiles/me/onboarding/complete', employee, 'POST', { resumeId: resume.id, resumeGeneration: parsed.parseGeneration, review: draft, manualExperiences: [{ title: 'Invalid manual', companyName: prefix, startDate: null }] }, 400);
  assert.equal(await db.skill.count({ where: { name: newSkill } }), 0);
  assert.equal((await http('/profiles/me', employee)).experiences.length, 0);
  notes.push('late onboarding failure rolls back imported skills, catalog, and experiences');
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', draft, 400);
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...draft, resumeGeneration: parsed.parseGeneration - 1 }, 409);
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...draft, resumeGeneration: parsed.parseGeneration, experiences: [{ title: 'Invalid', companyName: prefix, startDate: '2020-06-01', endDate: '2020-01-01' }] }, 400);
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...draft, resumeGeneration: parsed.parseGeneration, experiences: [{ title: 'Missing', companyName: prefix }] }, 400);
  assert.equal(await db.skill.count({ where: { name: newSkill } }), 0);
  notes.push('missing/stale parse generation and invalid/missing dates reject without writes');
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...blank, resumeGeneration: parsed.parseGeneration, languages: [{ code: 'en', name: 'English' }] }, 400);
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...draft, resumeGeneration: parsed.parseGeneration, languages: [{ code: 'missing-audit-language', name: 'Missing audit language', level: 'B1' }] }, 400);
  assert.equal(await db.skill.count({ where: { name: newSkill } }), 0, 'Unknown language must roll back the entire reviewed import');
  notes.push('language import requires an explicitly confirmed proficiency; no invented B1 default');
  const language = await db.language.findFirstOrThrow({ where: { code: 'en', archivedAt: null } });
  await http('/profiles/me/languages', employee, 'POST', { code: language.code, level: 'NATIVE' }, 201);
  const input = { ...draft, resumeGeneration: parsed.parseGeneration, languages: [{ code: language.code, name: language.name, level: 'B1' }] };
  const imports = await Promise.all([http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', input, 201), http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', input, 201)]);
  assert.deepEqual(imports.map(result => result.imported.experiences).sort(), [0, 2]);
  assert.deepEqual(imports.map(result => result.imported.skills).sort(), [0, 1]);
  assert.ok(imports.every(result => result.profile.resumes.every(row => !('fileKey' in row))));
  const profile = await http('/profiles/me', employee);
  assert.equal(profile.experiences.length, 2);
  assert.equal(profile.languages.find(row => row.language.code === 'en').level, 'NATIVE');
  notes.push('concurrent repeat import deduplicates; two stints in one year survive; no language downgrade or key leak');
  const other = await register('two');
  const otherResume = await upload(other, 'audit.docx', docx);
  const otherParsed = await ready(other, otherResume.id);
  await http(`/profiles/me/resumes/${resume.id}/import`, other, 'POST', { ...blank, resumeGeneration: parsed.parseGeneration }, 400);
  const sharedSkill = `Concurrent Pipeline ${Date.now().toString(36)}`;
  createdSkills.push(sharedSkill);
  await Promise.all([http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', { ...blank, skills: [sharedSkill], resumeGeneration: parsed.parseGeneration }, 201), http(`/profiles/me/resumes/${otherResume.id}/import`, other, 'POST', { ...blank, skills: [sharedSkill], resumeGeneration: otherParsed.parseGeneration }, 201)]);
  assert.equal(await db.skill.count({ where: { name: sharedSkill } }), 1);
  notes.push('cross-profile catalog creation race commits once; cross-owner import rejected');
  const replace = new FormData(); replace.append('file', new Blob([fs.readFileSync(docx)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'replacement.docx');
  await http(`/profiles/me/resumes/${resume.id}/file`, employee, 'POST', replace, 201);
  await http(`/profiles/me/resumes/${resume.id}/parse`, employee, 'POST', {}, 201);
  const replaced = await ready(employee, resume.id);
  assert.ok(replaced.parseGeneration > parsed.parseGeneration);
  await http(`/profiles/me/resumes/${resume.id}/import`, employee, 'POST', input, 409);
  notes.push('replacement parse cannot accept the previous review');
  // Simulate a dead process lease; the persistent recovery loop must finish it.
  const saved = await db.resume.findUniqueOrThrow({ where: { id: otherResume.id } });
  await db.resume.update({ where: { id: saved.id }, data: { parseStatus: 'PROCESSING', parseStartedAt: new Date(Date.now() - 600000), parseGeneration: { increment: 1 }, parsedData: apiRequire('@prisma/client').Prisma.DbNull } });
  await db.resume.update({ where: { id: resume.id }, data: { parseStatus: 'PENDING', parseStartedAt: null, updatedAt: new Date(Date.now() - 600000), parseGeneration: { increment: 1 }, parsedData: apiRequire('@prisma/client').Prisma.DbNull } });
  const recovered = await ready(other, saved.id);
  assert.ok(recovered.parseGeneration > saved.parseGeneration + 1);
  const lostQueue = await ready(employee, resume.id);
  assert.ok(lostQueue.parseGeneration > replaced.parseGeneration + 1);
  notes.push('dead worker lease recovers through persistent sweep with a new fenced generation');
  notes.push('lost PENDING queue job recovers through the same persistent sweep');
  console.log(JSON.stringify({ result: 'PASS', checks: notes }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const resumes = await db.resume.findMany({ where: { profile: { userId: { in: users } } }, select: { fileKey: true } });
  keys.push(...resumes.map(row => row.fileKey).filter(Boolean));
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.skill.deleteMany({ where: { name: { in: createdSkills }, profileSkills: { none: {} }, jobPostSkills: { none: {} }, jobAlertSkills: { none: {} } } });
  // Storage cleanup uses the same local Docker credentials without printing them.
  if (keys.length) {
    const { execFileSync } = require('node:child_process');
    const minio = JSON.parse(execFileSync('docker', ['inspect', 'jt-minio'], { encoding: 'utf8', windowsHide: true }))[0];
    const env = Object.fromEntries(minio.Config.Env.map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)]; }));
    const { S3Client, DeleteObjectCommand } = apiRequire('@aws-sdk/client-s3');
    const storage = new S3Client({ endpoint: `http://127.0.0.1:${minio.NetworkSettings.Ports['9000/tcp'][0].HostPort}`, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: env.MINIO_ROOT_USER, secretAccessKey: env.MINIO_ROOT_PASSWORD } });
    for (const Key of keys) await storage.send(new DeleteObjectCommand({ Bucket: 'job-talentio', Key }));
    storage.destroy();
  }
  await db.$disconnect();
});
