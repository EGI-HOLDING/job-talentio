const assert = require('node:assert/strict');

module.exports = async function verifyCvRecovery({ db, worker, call, hr, row, dashboard, drawer, allowed, report }) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-transport-fixture-only';
  const work = await db.aiScreeningWork.findFirstOrThrow({ where: { subjectId: row.id, kind: 'CV_SCORE' } });
  const source = await db.recruitmentCandidate.findUniqueOrThrow({ where: { id: row.id } });
  const revision = source.revision;
  let ready = false;
  let creates = 0;
  let retrieves = 0;
  const responseId = 'resp_synthetic_cv_browser_recovery';
  const result = {
    readable: true, fullName: 'HTTP Candidate', email: row.email, phone: null,
    headline: 'Developer', summary: 'Pengalaman API.', cvText: source.cvResult.cvText,
    criteria: source.cvResult.criteria.map(criterion => ({
      criterionId: criterion.criterionId, level: criterion.level, reason: criterion.reason, evidence: criterion.evidence,
    })), limitations: [],
  };
  const endpoint = 'https://api.openai.com/v1/responses';
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(endpoint)) return originalFetch(url, init);
    if (init?.method === 'POST') {
      creates++;
      return new Response(JSON.stringify({ id: responseId, status: 'queued' }));
    }
    assert.equal(String(url), endpoint + '/' + responseId);
    if (init?.method === 'DELETE') return new Response('{}');
    retrieves++;
    return new Response(JSON.stringify(ready ? {
      id: responseId, status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    } : { id: responseId, status: 'in_progress' }));
  };
  allowed.add(work.id);
  try {
    await db.recruitmentCandidate.update({ where: { id: row.id }, data: { scoreStatus: 'PENDING' } });
    await db.aiScreeningWork.update({ where: { id: work.id }, data: { status: 'PENDING', availableAt: new Date(), leaseOwner: null, leaseUntil: null } });
    await worker.process(work.id);
    assert.equal(creates, 1);
    const saved = await db.aiScreeningCall.findFirstOrThrow({ where: { workId: work.id, status: 'RUNNING' } });
    assert.equal(saved.responseId, responseId);
    await db.aiScreeningWork.update({ where: { id: work.id }, data: { status: 'FAILED', error: 'LEGACY_POLL_INTERRUPTED' } });
    await db.recruitmentCandidate.update({ where: { id: row.id }, data: { scoreStatus: 'FAILED', error: 'Proses AI memerlukan pemeriksaan operator.' } });
    await dashboard.reload({ waitUntil: 'domcontentloaded' });
    await dashboard.getByRole('button', { name: 'HTTP Candidate', exact: true }).click();
    await drawer.getByRole('button', { name: 'Coba nilai ulang', exact: true }).click();
    const deadline = Date.now() + 10000;
    while ((await db.aiScreeningWork.findUniqueOrThrow({ where: { id: work.id } })).status !== 'PENDING' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await db.aiScreeningWork.findUniqueOrThrow({ where: { id: work.id } })).status, 'PENDING');
    ready = true;
    await worker.process(work.id);
    const recovered = await call('/recruitment/candidates/' + row.id, hr);
    assert.equal(recovered.cvScore, 75);
    assert.equal(recovered.scoreStatus, 'READY');
    assert.equal(recovered.revision, revision);
    assert.equal(await db.aiScreeningWork.count({ where: { subjectId: row.id, kind: 'CV_SCORE' } }), 1);
    assert.equal(await db.aiScreeningCall.count({ where: { workId: work.id } }), 1);
    assert.equal(creates, 1);
    assert.equal(retrieves, 1);
    await dashboard.reload({ waitUntil: 'domcontentloaded' });
    await dashboard.getByRole('button', { name: 'HTTP Candidate', exact: true }).click();
    await drawer.getByText('75%', { exact: true }).waitFor();
    report.steps.push('HR retries a legacy failed CV in the browser. The worker retrieves the existing response, preserving the revision, one work and one provider creation. The original score returns after refresh.');
  } finally {
    allowed.delete(work.id);
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
};
