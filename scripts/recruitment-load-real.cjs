const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(test, label, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await test()) return;
    await pause(200);
  }
  throw Error('Timed out waiting for ' + label);
}

module.exports = async function runConcurrentImports({ db, call, makeToken, makePdf, worker, setScoreHook }) {
  const redisName = process.env.RECRUITMENT_TEST_REDIS_NAME;
  assert.match(redisName, /^talentio-http-it-\d+-redis$/);
  assert.equal(new URL(process.env.REDIS_URL).hostname, '127.0.0.1');
  const dir = process.env.AI_RELIABILITY_OUTPUT || path.resolve('output/ai-reliability');
  fs.mkdirSync(dir, { recursive: true });
  const report = { steps: [], providers: 'simulated', test: 'concurrent-imports-redis-fallback' };
  const measures = [1, 10, 100];
  const runRedis = command => execFileSync('docker', [command, redisName], { windowsHide: true, stdio: 'ignore' });
  const calls = new Map();
  let unlock = () => {};
  const hold = new Promise(resolve => { unlock = resolve; });
  let interrupted = false;
  try {
    const batches = await Promise.all(measures.map(async count => {
      const hr = 'load-hr-' + count, companyId = 'load-company-' + count, jobId = 'load-job-' + count;
      await db.user.create({ data: { id: hr, role: 'RECRUITER', fullName: 'Synthetic HR ' + count } });
      await db.company.create({ data: { id: companyId, name: 'Synthetic Studio ' + count, slug: companyId, members: { create: { userId: hr, role: 'OWNER' } } } });
      await db.jobPost.create({ data: { id: jobId, companyId, title: 'Backend Engineer', description: 'Mengembangkan API inventaris dengan Node.js dan menguji integrasi.', status: 'PUBLISHED', workMode: 'REMOTE' } });
      const token = makeToken(hr);
      const documents = await Promise.all(Array.from({ length: count }, (_, index) => makePdf(`CV sintetis perusahaan ${count}, nomor ${index + 1}. Mengembangkan API Node.js.`)));
      const payload = { companyId, jobId, requestKey: 'load-import-' + count, files: documents.map((doc, index) => ({ clientId: String(index), filename: `CV-Audit-${count}-${index + 1}.pdf`, size: doc.length, contentType: 'application/pdf' })) };
      const imported = await call('/recruitment/imports', token, payload);
      assert.equal((await call('/recruitment/imports', token, payload)).id, imported.id, 'replayed import registration retains its identity');
      return { count, companyId, jobId, token, documents, imported };
    }));

    await Promise.all(batches.map(async ({ imported, documents, token }) => {
      for (const file of imported.files) {
        const upload = await fetch(file.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: documents[Number(file.clientId)], signal: AbortSignal.timeout(10000) });
        assert.equal(upload.status, 200);
        await call('/recruitment/candidates/' + file.id + '/upload-complete', token, {});
      }
    }));
    const candidateIds = batches.flatMap(batch => batch.imported.files.map(file => file.id));
    const bulk = batches.find(batch => batch.count === 100);
    const abandonedId = bulk.imported.files[0].id;
    const changed = await db.aiScreeningWork.updateMany({ where: { kind: 'CV_SCORE', subjectId: abandonedId, status: 'PENDING' }, data: { status: 'RUNNING', leaseOwner: 'terminated-worker-fixture', leaseUntil: new Date(Date.now() - 1000) } });
    assert.equal(changed.count, 1);
    const subjects = new Set(candidateIds);
    setScoreHook(async subjectId => {
      if (!subjects.has(subjectId)) return;
      calls.set(subjectId, (calls.get(subjectId) ?? 0) + 1);
      await hold;
      await pause(60);
    });
    await worker.onModuleInit();
    await waitUntil(() => calls.size >= 2, 'the first two Redis worker calls');
    report.steps.push('Real BullMQ dispatch and the durable database worker started two jobs before fault injection.');
    runRedis('stop');
    interrupted = true;
    unlock();
    const where = { id: { in: candidateIds }, scoreStatus: 'READY' };
    await waitUntil(async () => await db.recruitmentCandidate.count({ where }) > 2, 'continued scoring while Redis is offline');
    const finishedDuringOutage = await db.recruitmentCandidate.count({ where });
    assert.ok(finishedDuringOutage < candidateIds.length);
    report.finishedDuringOutage = finishedDuringOutage;
    report.steps.push('Database fallback completed additional jobs during the Redis outage.');
    runRedis('start');
    interrupted = false;
    await waitUntil(() => worker.redis?.status === 'ready' && worker.workerRedis?.status === 'ready', 'worker reconnection to the original Redis endpoint');
    report.steps.push('The producer and consumer reconnected to the same Redis endpoint.');

    await waitUntil(async () => await db.recruitmentCandidate.count({ where }) === candidateIds.length, 'all scores after Redis restarts', 150000);
    assert.equal(calls.size, candidateIds.length);
    assert.ok([...calls.values()].every(count => count === 1));
    assert.equal(await db.aiScreeningWork.count({ where: { kind: 'CV_SCORE', subjectId: { in: candidateIds }, status: 'DONE' } }), candidateIds.length);
    assert.equal(await db.aiScreeningCall.count(), 0);
    await call('/recruitment/candidates/' + abandonedId, batches.find(batch => batch.count === 1).token, null, 'GET', 403);
    const activities = await db.candidateActivity.findMany({ where: { candidateId: { in: candidateIds }, kind: { in: ['CV_RECEIVED', 'CV_ANALYZED'] } }, select: { candidateId: true, kind: true, createdAt: true } });
    report.batches = [];
    for (const batch of batches) {
      const hr = await call('/recruitment/candidates?companyId=' + batch.companyId + '&jobId=' + batch.jobId, batch.token);
      assert.equal(hr.overallTotal, batch.count);
      const durations = batch.imported.files.map(file => {
        const rows = activities.filter(activity => activity.candidateId === file.id);
        assert.equal(rows.length, 2);
        return +rows.find(row => row.kind === 'CV_ANALYZED').createdAt - +rows.find(row => row.kind === 'CV_RECEIVED').createdAt;
      }).sort((a, b) => a - b);
      const percentile = p => durations[Math.ceil(durations.length * p) - 1];
      report.batches.push({ count: batch.count, medianMs: percentile(.5), p95Ms: percentile(.95), maxMs: durations.at(-1) });
    }
    assert.ok(report.batches.every(batch => batch.maxMs <= 180000));
    report.steps.push('One, ten and one hundred CVs complete with one score each, including one expired worker lease and no cross-company access.');
    report.passed = true;
  } catch (error) {
    report.failure = error.message;
    throw error;
  } finally {
    unlock();
    if (interrupted) runRedis('start');
    fs.writeFileSync(path.join(dir, 'concurrent-imports-redis.json'), JSON.stringify(report, null, 2));
  }
};
