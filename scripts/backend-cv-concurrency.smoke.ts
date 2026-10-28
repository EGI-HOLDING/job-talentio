// Controlled concurrency: real PostgreSQL locks and HTTP; export storage is
// deliberately paused so an edit during PDF generation is deterministic.
import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '../apps/api/node_modules/@prisma/client';
import { ProfilesService } from '../apps/api/src/profiles/profiles.service';
import { MatchingService } from '../apps/api/src/matching/matching.service';
const db = new PrismaClient();
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname));
const marker = `concurrency-audit-${Date.now()}`, users: string[] = [], companies: string[] = [], checks: string[] = [];
async function http(route: string, session: any, method = 'GET', body?: unknown, expected: number | null = 200) {
  const response = await fetch('http://localhost:4000/api' + route, { method, headers: { ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data: any = await response.json();
  if (expected !== null) assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return { status: response.status, data };
}
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function register(role: string) {
  const { data } = await http('/auth/register', null, 'POST', { email: `${marker}-${role}@example.test`, password: 'Local-concurrency-audit-2026!', fullName: marker, role, locale: 'en', acceptTerms: true, ...(role === 'RECRUITER' ? { companyName: marker } : {}) }, 201);
  users.push(data.user.id); companies.push(...data.user.memberships.map((m: any) => m.companyId)); return data;
}
async function main() {
  const employee = await register('EMPLOYEE'); await register('RECRUITER');
  const profile = await db.employeeProfile.findUniqueOrThrow({ where: { userId: employee.user.id } });
  const { data: resume } = await http('/profiles/me/resumes', employee, 'POST', { title: 'Original audit builder' }, 201);
  const uploadStarted = signal(), finishUpload = signal(), deleted: string[] = [];
  const fakeKey = `cvs/controlled-export-${marker}.pdf`;
  const storage = { upload: async () => { uploadStarted.resolve(); await finishUpload.promise; return { key: fakeKey, url: 'http://localhost/unused' }; }, delete: async (key: string) => { deleted.push(key); } };
  const service = new ProfilesService(db as any, storage as any, {} as any, new MatchingService(db as any), {} as any, {} as any, {} as any, null);
  const exportResult = service.exportResumePdf(employee.user, resume.id, 'en').then(() => ({ accepted: true }), (error: any) => ({ accepted: false, status: error.getStatus?.() }));
  await uploadStarted.promise;
  await http(`/profiles/me/resumes/${resume.id}`, employee, 'PATCH', { title: 'Changed while export was running' });
  finishUpload.resolve();
  const exported = await exportResult;
  assert.deepEqual(exported, { accepted: false, status: 409 });
  assert.deepEqual(deleted, [fakeKey], 'Rejected export must remove its orphan object');
  assert.equal((await db.resume.findUniqueOrThrow({ where: { id: resume.id } })).fileKey, null);
  checks.push('editing a CV during PDF export rejects stale output and cleans its orphan object');
  // Application writes must retry a PostgreSQL snapshot conflict transparently.
  await db.resume.update({ where: { id: resume.id }, data: { fileKey: `cvs/${marker}-fixture.pdf` } });
  const title = await db.jobTitle.findFirstOrThrow({ where: { name: 'Frontend Developer', archivedAt: null } });
  const job = await db.jobPost.create({ data: { companyId: companies[0], title: title.name, jobTitleId: title.id, description: marker, status: 'PUBLISHED' } });
  const writerReady = signal(), releaseWriter = signal();
  const replacedFileKey = `cvs/${marker}-replaced.pdf`;
  const writer = db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
    await tx.employeeProfile.update({ where: { id: profile.id }, data: { headline: title.name, desiredPosition: title.name, desiredPositions: [title.name] } });
    await tx.resume.update({ where: { id: resume.id }, data: { fileKey: replacedFileKey, parseGeneration: { increment: 1 } } });
    writerReady.resolve(); await releaseWriter.promise;
  }, { timeout: 15000 });
  await writerReady.promise;
  const applying = http(`/applications/jobs/${job.id}`, employee, 'POST', { resumeId: resume.id }, null);
  await new Promise(resolve => setTimeout(resolve, 150)); releaseWriter.resolve(); await writer;
  const applied = await applying;
  assert.equal(applied.status, 201, JSON.stringify(applied.data));
  assert.equal(applied.data.resumeSnapshot.headline, title.name);
  assert.equal(applied.data.matchBreakdown.title, 15);
  const storedApplication = await db.application.findUniqueOrThrow({ where: { id: applied.data.id } });
  assert.equal((storedApplication.resumeSnapshot as any).resume.fileKey, replacedFileKey, 'Application must snapshot the file committed with the concurrent profile edit');
  assert.equal(await db.pipelineEvent.count({ where: { applicationId: applied.data.id } }), 1);
  const raceJob = await db.jobPost.create({ data: { companyId: companies[0], title: title.name, description: marker, status: 'PUBLISHED' } });
  const submitRace = await Promise.all([0, 1].map(() => http(`/applications/jobs/${raceJob.id}`, employee, 'POST', { resumeId: resume.id }, null)));
  assert.deepEqual(submitRace.map(r => r.status).sort(), [201, 409]);
  assert.equal(await db.application.count({ where: { jobPostId: raceJob.id } }), 1);
  checks.push('apply waits for concurrent profile edits, retries snapshot conflicts, and stores coherent profile/score/event; parallel submission creates one application');
  async function applyDuringChange(change: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    const target = await db.jobPost.create({ data: { companyId: companies[0], title: title.name, description: marker, status: 'PUBLISHED' } });
    const ready = signal(), release = signal();
    const writing = db.$transaction(async tx => { await change(tx); ready.resolve(); await release.promise; }, { timeout: 15000 });
    await ready.promise;
    const request = http(`/applications/jobs/${target.id}`, employee, 'POST', { resumeId: resume.id }, null);
    await new Promise(resolve => setTimeout(resolve, 150)); release.resolve(); await writing;
    const response = await request;
    assert.equal(response.status, 404, JSON.stringify(response.data));
    assert.equal(await db.application.count({ where: { jobPostId: target.id } }), 0);
  }
  await applyDuringChange(tx => tx.jobPost.updateMany({ where: { companyId: companies[0] }, data: { status: 'CLOSED' } }));
  await applyDuringChange(tx => tx.company.update({ where: { id: companies[0] }, data: { isBanned: true } }));
  await db.company.update({ where: { id: companies[0] }, data: { isBanned: false } });
  checks.push('a vacancy closed or a company banned while apply is waiting cannot receive a new application');
  const removed = await http(`/profiles/me/resumes/${resume.id}`, employee, 'DELETE');
  assert.equal(removed.data.softDeleted, true);
  assert.equal((await service.purgeResumeIfOrphan(resume.id)).purged, false, 'Applied CV must not be purged');
  await http(`/profiles/me/resumes/${resume.id}/restore`, employee, 'POST', {}, 201);
  for (let n = 0; n < 4; n++) {
    const row = await db.resume.create({ data: { profileId: profile.id, title: 'Restore purge race', deletedAt: new Date(), isPrimary: false } });
    const [purged, restored] = await Promise.all([service.purgeResumeIfOrphan(row.id), http(`/profiles/me/resumes/${row.id}/restore`, employee, 'POST', {}, null)]);
    assert.ok((purged.purged && restored.status === 404) || (!purged.purged && restored.status === 201));
    assert.equal(Boolean(await db.resume.findUnique({ where: { id: row.id } })), restored.status === 201);
  }
  checks.push('applied CV remains recoverable; purge and restore serialize so a successfully restored CV cannot vanish');
  console.log(JSON.stringify({ result: 'PASS', checks }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.company.deleteMany({ where: { id: { in: companies } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); });
