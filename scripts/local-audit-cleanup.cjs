// Remove only the synthetic accounts created by local-core-audit.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const root = dotenv.parse(fs.readFileSync(path.join(repo, '.env')));
assert.ok(['localhost', '127.0.0.1'].includes(new URL(root.DATABASE_URL).hostname), 'Local database required');
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: root.DATABASE_URL } } });
const directory = path.join(repo, 'node_modules/.cache/local-audit');
const pattern = /^audit-([a-z0-9]+)-(employer|outsider|candidate|other-candidate|admin|teammate|erasure|security(?:-new)?)@example\.test$/;

async function main() {
  const known = new Set();
  const runs = new Set();
  for (const file of fs.readdirSync(directory).filter((name) => /^[a-z0-9]+\.json$/.test(name))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    if (!fixture.runId || !fixture.accounts) continue;
    for (const account of Object.values(fixture.accounts)) {
      const match = pattern.exec(account.email || '');
      if (match?.[1] === fixture.runId && account.user?.id) { known.add(account.user.id); runs.add(fixture.runId); }
    }
  }
  const users = await prisma.user.findMany({
    where: { OR: [{ id: { in: [...known] } }, { email: { startsWith: 'audit-', endsWith: '@example.test' }, fullName: { startsWith: 'Local Audit' } }] },
    select: { id: true, email: true, fullName: true, anonymizedAt: true },
  });
  for (const user of users) {
    const match = pattern.exec(user.email || '');
    assert.ok((match && user.fullName.startsWith('Local Audit')) || (known.has(user.id) && user.anonymizedAt), 'Unexpected user: abort cleanup');
    if (match) runs.add(match[1]);
  }
  const ids = users.map((user) => user.id);
  const companies = await prisma.company.findMany({ where: { name: { startsWith: 'Local Audit ' } }, include: { members: true } });
  const companyIds = companies.filter((company) => {
    const match = /^Local Audit ([a-z0-9]+) (?:employer|outsider|teammate)$/.exec(company.name);
    if (!match || !runs.has(match[1])) return false;
    assert.ok(company.members.every((member) => ids.includes(member.userId)), 'A test company has a non-test member: abort cleanup');
    return true;
  }).map((company) => company.id);
  assert.equal(await prisma.application.count({ where: { jobPost: { companyId: { in: companyIds } }, profile: { userId: { notIn: ids } } } }), 0, 'A test job has a non-test applicant');
  const resumes = await prisma.resume.findMany({ where: { profile: { userId: { in: ids } } }, select: { fileKey: true } });
  const jobs = await prisma.jobPost.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
  const reports = await prisma.report.findMany({ where: { reporterId: { in: ids } }, select: { id: true } });
  console.log(`Synthetic cleanup: ${ids.length} users, ${companyIds.length} companies, ${jobs.length} jobs, ${resumes.filter((row) => row.fileKey).length} CV files`);
  if (!process.argv.includes('--apply')) return;
  const inspect = (name) => JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0];
  const env = (info) => Object.fromEntries(info.Config.Env.map((value) => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
  const minio = inspect('jt-minio');
  const credentials = env(minio);
  const { S3Client, DeleteObjectCommand } = apiRequire('@aws-sdk/client-s3');
  const storage = new S3Client({
    endpoint: `http://localhost:${minio.NetworkSettings.Ports['9000/tcp'][0].HostPort}`,
    region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: credentials.MINIO_ROOT_USER, secretAccessKey: credentials.MINIO_ROOT_PASSWORD },
  });
  for (const row of resumes) {
    if (row.fileKey) await storage.send(new DeleteObjectCommand({ Bucket: 'job-talentio', Key: row.fileKey }));
  }
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { OR: [
      { actorId: { in: ids } },
      { entityId: { in: [...ids, ...companyIds, ...jobs.map((job) => job.id), ...reports.map((report) => report.id)] } },
    ] } });
    await tx.company.deleteMany({ where: { id: { in: companyIds } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
  assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0);
  assert.equal(await prisma.company.count({ where: { id: { in: companyIds } } }), 0);
  const meili = inspect('jt-meilisearch');
  const host = `http://localhost:${meili.NetworkSettings.Ports['7700/tcp'][0].HostPort}`;
  const { rebuildJobsIndex } = apiRequire(path.join(repo, 'apps/api/dist/search/jobs-index.sync.js'));
  await rebuildJobsIndex({ prisma, host, apiKey: env(meili).MEILI_MASTER_KEY, log: console.log });
  fs.writeFileSync(path.join(directory, 'cleanup.json'), JSON.stringify({ completedAt: new Date().toISOString(), userIds: ids, companyIds, jobIds: jobs.map((job) => job.id) }));
  console.log('Synthetic fixtures removed; local search index refreshed.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
