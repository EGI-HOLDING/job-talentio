const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { processWork } = require('./recruitment-voice-live.cjs');

const pdf = 'application/pdf';
const inputs = [
  ['DOC', 'CV-Dinda-Synthetic.doc', 'application/msword'],
  ['DOCX', 'CV-Dinda-Synthetic.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['SCAN', 'CV-Dinda-Scan-Synthetic.pdf', pdf],
];

module.exports = async function verifyCvFormats({ db, worker, call, hr, makeToken, allowed }) {
  const fixtureDir = process.env.RELIABILITY_CV_FIXTURES;
  assert.ok(fixtureDir, 'The directory of synthetic CV fixtures is required');
  const only = process.env.RELIABILITY_CV_FORMAT;
  if (only) assert.ok(inputs.some(([format]) => format === only));
  const out = process.env.AI_RELIABILITY_OUTPUT || path.resolve('output/ai-reliability');
  fs.mkdirSync(out, { recursive: true });
  const report = { model: 'gpt-6-luna', test: 'concurrent-cv-formats', requests: [], maxLatencyMs: 180000 };
  const save = () => fs.writeFileSync(path.join(out, only ? 'live-cv-' + only.toLowerCase() + '.json' : 'live-cv-formats.json'), JSON.stringify(report, null, 2));

  const otherId = 'cv-format-other-hr';
  await db.user.create({ data: { id: otherId, role: 'RECRUITER', fullName: 'Synthetic Other HR' } });
  await db.company.create({ data: { id: 'cv-format-company', name: 'CV Format Studio', slug: 'cv-format-studio', members: { create: { userId: otherId, role: 'OWNER' } } } });
  await db.jobPost.create({ data: { id: 'cv-format-job', companyId: 'cv-format-company', title: 'Backend Developer', description: 'Mengembangkan API Node.js, pengujian integrasi, dan dokumentasi OpenAPI.', status: 'PUBLISHED', workMode: 'REMOTE' } });
  const other = makeToken(otherId);
  async function submit({ group, name, contentType, bytes, failure = false }) {
    assert.ok(bytes.length > 0 && bytes.length <= 5 * 1024 * 1024);
    const target = group === 1 ? { token: hr, companyId: 'http-co', jobId: 'http-job' } : { token: other, companyId: 'cv-format-company', jobId: 'cv-format-job' };
    const registered = await call('/recruitment/imports', target.token, { companyId: target.companyId, jobId: target.jobId, requestKey: `cv-format-${name}`, files: [{ clientId: name, filename: name, size: bytes.length, contentType }] });
    const file = registered.files[0];
    const upload = await fetch(file.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes, signal: AbortSignal.timeout(10000) });
    assert.ok(upload.ok);
    await call(`/recruitment/candidates/${file.id}/upload-complete`, target.token, {}, 'POST', failure ? 400 : 201);
    return { ...target, id: file.id };
  }

  try {
    const invalid = await submit({ group: 1, name: 'Invalid-Synthetic.pdf', contentType: pdf, bytes: Buffer.from('This synthetic file is not a PDF.'), failure: true });
    assert.equal(await db.aiScreeningWork.count({ where: { subjectId: invalid.id } }), 0);
    report.rejectedInvalidBeforeAi = true;

    const cases = await Promise.all(inputs.filter(([format]) => !only || only === format).map(async ([format, name, contentType], index) => ({ format, ...(await submit({ group: index === 0 ? 1 : 2, name, contentType, bytes: fs.readFileSync(path.join(fixtureDir, name)) })) })));
    const results = await Promise.allSettled(cases.map(async test => {
      const received = await db.candidateActivity.findFirstOrThrow({ where: { candidateId: test.id, kind: 'CV_RECEIVED' } });
      const item = { format: test.format };
      report.requests.push(item);
      try {
        await processWork(db, worker, 'CV_SCORE', test.id, allowed, 300000);
        const candidate = await call('/recruitment/candidates/' + test.id, test.token);
        const analyzed = await db.candidateActivity.findFirstOrThrow({ where: { candidateId: test.id, kind: 'CV_ANALYZED' } });
        item.readyAfterMs = +analyzed.createdAt - +received.createdAt;
        const rank = await call(`/recruitment/candidates?companyId=${test.companyId}&jobId=${test.jobId}`, test.token);
        assert.ok(rank.items.some(row => row.id === test.id && row.cvScore === candidate.cvScore));
        item.rankVisibleAfterMs = Date.now() - +received.createdAt;
        item.score = candidate.cvScore;
        assert.equal(candidate.scoreStatus, 'READY');
        assert.match(candidate.fullName, /Dinda Pramesti/i);
        assert.equal(candidate.cvResult.criteria.length, 3);
        assert.ok(Number.isFinite(candidate.cvScore));
        assert.ok(item.rankVisibleAfterMs <= report.maxLatencyMs);
      } catch (error) {
        item.failure = error.message;
        throw error;
      } finally {
        item.calls = await db.aiScreeningCall.findMany({ where: { subjectId: test.id }, select: { status: true, error: true, inputTokens: true, outputTokens: true, usage: true } });
        save();
      }
      assert.equal(item.calls.length, 1);
      assert.equal(item.calls[0].status, 'COMPLETED');
    }));
    const errors = results.filter(result => result.status === 'rejected');
    assert.equal(errors.length, 0, errors.map(result => result.reason.message).join('\n'));
    for (const test of cases) {
      const page = await call(`/recruitment/candidates?companyId=${test.companyId}&jobId=${test.jobId}`, test.token);
      assert.ok(page.items.some(item => item.id === test.id && item.cvScore !== null));
    }
    await call('/recruitment/candidates/' + cases[0].id, other, null, 'GET', 403);
    report.passed = true;
  } finally { save(); }
};
