import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'standardwebhooks';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreeningWorker } from '../screening-worker.service';
import { enqueueCvAssessment } from './cv-score-recovery';
import { json } from '../screening.policy';
import { CvAssessmentService } from './cv-assessment.service';
import { CvScoringService } from './cv-scoring.service';
import { CvWebhookController } from './cv-webhook.controller';
import { RecruitmentService } from './recruitment.service';
import { CV_PROVIDER_TASK, CV_RECOVERY_VERSION, cvRequest, type CvSource } from './cv-assessment';
import { CV_RUBRIC, fileChecksum } from './cv-scoring.policy';
import { invalidateCvScores, scoringJob, scoreJobInclude } from './cv-job-context';
import { cvBackoff, cvRejection, type CvHttp } from './cv-provider';
import { prepareCvDocument, type CvProviderFile } from './cv-document';
const PDFDocument = require('pdfkit');
const db = new PrismaService();
const key = 'whsec_' + Buffer.alloc(32, 61).toString('base64');
const config = new ConfigService({ CV_SCORING_V2_RPM: 10000, CV_SCORING_V2_TPM: 100000000, OPENAI_CV_WEBHOOK_SECRET: key });
const objectStore = new Map<string, Buffer>();
const storage = { getObjectBuffer: async (path: string) => { const data = objectStore.get(path); assert.ok(data); return data; } };
const source: CvSource = {
  readable: true, fullName: 'Contoh Taka', email: null, phone: null, headline: 'Designer',
  summary: 'Desain grafis dan pengalaman kampanye.', limitations: [],
  pages: [{ page: 1, status: 'READ' }],
  blocks: [
    { page: 1, id: 'p1-b1', text: 'Keahlian: Adobe Photoshop, Illustrator, InDesign, Figma, Canva' },
    { page: 1, id: 'p1-b2', text: 'Graphic Designer di Studio Contoh, Januari 2020 sampai Maret 2024. Mendesain materi kampanye dan memeriksa ukuran produksi.' },
    { page: 1, id: 'p1-b3', text: 'S1 Desain Komunikasi Visual' },
  ],
};
const grades = CV_RUBRIC.map((row, i) => ({ criterionId: row.id, level: i === 2 ? 2 : 3,
  reason: 'Kutipan: “' + source.blocks[i].text + '”', blockIds: [source.blocks[i].id] }));
function bound(request: ReturnType<typeof cvRequest>, snapshot?: CvSource, assessments: typeof grades = grades) {
  const newIds = new Set(snapshot?.blocks.map(item => item.id));
  const stored = request.data.blocks ?? request.data.retainedBlocks;
  return {
    ...(snapshot ? { source: { ...snapshot, blocks: snapshot.blocks.map(({ id, ...block }) => ({ ...block,
      supports: assessments.filter(row => row.blockIds.includes(id)).map(row => row.criterionId) })) } } : {}),
    grades: Object.fromEntries(request.data.rubric.map(({ id }) => {
      const result = assessments.find(item => item.criterionId === id);
      return [id, result ? { level: result.level, reason: result.reason,
        ...(stored?.length ? { blockIds: result.blockIds.filter(ref => !newIds.has(ref)) } : {}) } : null];
    })),
  };
}
const history = new Map<string, Array<{ stage: string; ids: string[]; file: boolean }>>();
const replies = new Map<string, CvHttp>();
const pollFailures = new Set<string>();
let changed = 0;
const ready = (id: string, attempt: string, result: unknown): CvHttp => ({ status: 200, body: { id, status: 'completed',
  metadata: { talentio_cv_attempt: attempt }, created_at: 100, completed_at: 496,
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } });
const provider = {
  configured: true,
  async create(attempt: string, _model: string, request: ReturnType<typeof cvRequest>, file?: CvProviderFile): Promise<CvHttp> {
    const name = (request.data.job as {title: string}).title, id = 'resp_' + attempt;
    const { stage } = request;
    const sent = history.get(name) ?? [];
    sent.push({ stage, ids: request.data.rubric.map(x => x.id), file: Boolean(file) });
    history.set(name, sent);
    if (stage === 'INITIAL') assert.equal(file?.detail, 'auto');
    if (name === 'rate' && sent.length === 1) return { status: 429, retryAfter: '2', body: { error: { code: 'rate_limit_exceeded' } } };
    if (name === 'overload' && sent.length === 1) return { status: 503, retryAfter: '2', body: { error: { code: 'server_is_overloaded' } } };
    if (name === 'truncated' && sent.length === 1) return { status: 200, body: { id, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } };
    if (name === 'malformed' && sent.length === 1) return { status: 200, body: { id, status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{ invalid' }] }] } };
    if (name === 'broken' && sent.length <= 3) return { status: 200, body: { id, status: 'failed' } };
    if (['unreadable', 'empty'].includes(name)) return ready(id, attempt, bound(request, { ...source, readable: false,
      pages: [{ page: 1, status: name === 'empty' ? 'EMPTY' : 'UNREADABLE' }], blocks: [] }, []));
    if (name === 'short') return ready(id, attempt, bound(request, { ...source,
      blocks: [{ id: 'p1-b1', page: 1, text: 'Figma, Illustrator.' }] },
    [grades[0], ...grades.slice(1).map(row => ({ ...row, reason: 'Bukti belum ditemukan.', level: 0, blockIds: [] }))]));
    if (['stale', 'lost', 'slow', 'changed-cv'].includes(name) && sent.length === 1) {
      replies.set(id, ready(id, attempt, bound(request, source, grades.map((row, i) => ({ ...row, level: i === 2 ? 3 : 4 })))));
      return name === 'lost' ? { status: 0 } : { status: 200, body: { id, status: 'in_progress', created_at: 100 } };
    }
    if (name === 'partial' && stage === 'INITIAL') return ready(id, attempt, bound(request, { ...source, pages: [{ page: 1, status: 'PARTIAL' }] }, []));
    if (name === 'missing-page' && stage === 'INITIAL') return ready(id, attempt, bound(request, source, []));
    if (name === 'long') {
      assert.equal(request.data.expectedPages, 9);
      const more = Array.from({ length: 8 }, (_, index) => index + 2);
      return ready(id, attempt, bound(request, { ...source, pages: [...source.pages, ...more.map(page => ({ page, status: 'READ' as const }))],
        blocks: [...source.blocks, ...more.map(page => ({ id: 'p' + page + '-b1', page, text: 'Project ' + page + '. Created bilingual brand guidelines and reviewed artwork.' }))] }));
    }
    if (stage === 'READ') {
      if (name === 'missing-page') {
        assert.deepEqual(request.data.targetPages, [2]);
        assert.deepEqual(request.data.pagesInFile, [2]);
        assert.equal(request.data.retainedBlocks?.length, 3);
        const extracted = Buffer.from(file!.file_data.split(',')[1], 'base64');
        assert.equal((await prepareCvDocument(extracted, 'cv.pdf', 'cv.pdf')).pages, 1);
        return ready(id, attempt, bound(request, { ...source, pages: [{ page: 2, status: 'READ' }],
          blocks: [{ id: 'p2-b1', page: 2, text: 'Sertifikasi contoh UI desain; materi tambahan disertakan.' }] },
        [...grades.slice(0, 2), { ...grades[2], blockIds: ['p2-b1'] }]));
      }
      assert.deepEqual(request.data.targetPages, name === 'partial' ? [1] : []);
      return ready(id, attempt, bound(request, source));
    }
    if (stage === 'GRADE') {
      assert.equal(file, undefined, 'grading repair only sends frozen text');
      assert.equal(request.data.blocks?.[0].text, source.blocks[0].text);
      if (name === 'bad-repair') return ready(id, attempt, bound(request, undefined, [{ ...grades[0], blockIds: ['p1-b999'] }]));
      return ready(id, attempt, bound(request));
    }
    const noProof = ['missing', 'bad-repair'].includes(name);
    const reason = name === 'comment' ? 'Keahlian relevan tercantum. Sertifikasi bahasa belum ditemukan.' : grades[0].reason;
    return ready(id, attempt, bound(request, source, [
      { ...grades[0], reason, ...(noProof ? { blockIds: [] } : {}) }, ...grades.slice(1),
    ]));
  },
  async get(id: string): Promise<CvHttp> {
    if (pollFailures.delete(id)) return { status: 503, retryAfter: '3' };
    return replies.get(id) ?? { status: 404 };
  },
  async delete() { changed++; return { status: 204 }; },
};
const recovery = new CvAssessmentService(db, storage as never, config, provider as never);
const scorer = new CvScoringService(db, recovery);
const worker = () => new ScreeningWorker(db, config, storage as never, {} as never, {} as never, {} as never, {} as never,
  {} as never, scorer, undefined, undefined, undefined, undefined, recovery);
const hr = { id: 'cv-hr', fullName: 'HR', role: 'RECRUITER', email: null, isBanned: false } as const;
const operator = { ...hr, id: 'cv-operator', role: 'SUPER_ADMIN' } as const;
const candidates = new RecruitmentService(db, storage as never, { assertMember: async (_: unknown, id: string) => {
  if (id !== 'cv-company') throw Error('Forbidden');
  return { company: {} };
}, assertOpen() {} } as never);

function pdf(extraPages = 0, replacement = false) {
  return new Promise<Buffer>(resolve => {
    const doc = new PDFDocument(), chunks: Buffer[] = [];
    doc.on('data', (value: Buffer) => chunks.push(value));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text(source.blocks[1].text, 50, 75, { width: 255 });
    doc.text(source.blocks[0].text, 335, 75, { width: 180 });
    doc.text(source.blocks[2].text, 335, 160, { width: 180 });
    if (replacement) doc.text('Revisi CV sintetis.', 50, 330);
    for (let i = 0; i < extraPages; i++) doc.addPage().text(extraPages === 1 ? 'Sertifikasi contoh UI desain; materi tambahan disertakan.' :
      'Project ' + (i + 2) + '. Created bilingual brand guidelines and reviewed artwork.');
    doc.end();
  });
}

async function main() {
  assert.match(process.env.DATABASE_URL ?? '', /@127\.0\.0\.1:5434\/talentio_recruitment_it_\d+/);
  assert.equal(cvBackoff(1, '10', 0, 0), 10000);
  assert.equal(cvRejection({ status: 429, body: { error: { code: 'insufficient_quota' } } }), 'BLOCKED');
  assert.equal(cvRejection({ status: 502 }), 'UNCONFIRMED');
  const bytes = await pdf();
  const twoPages = await pdf(1), longCv = await pdf(8);
  const pdfDoc = await prepareCvDocument(bytes, 'cv.pdf', 'cv.pdf');
  assert.equal(pdfDoc.pages, 1);
  assert.equal(pdfDoc.file.detail, 'auto');
  await db.user.createMany({ data: [hr, operator] });
  for (let n = 0; n < 3; n++) await db.company.create({ data: { id: n ? 'cv-company-' + n : 'cv-company', slug: 'taka-cv-fixture-' + n, name: 'Taka CV Fixture ' + n } });
  async function create(title: string, id = title, companyId = 'cv-company') {
    const job = await db.jobPost.upsert({ where: { id: 'cv-job-' + title }, update: {},
      create: { id: 'cv-job-' + title, title, companyId, description: 'Kriteria sintetis untuk validasi Taka.' }, include: scoreJobInclude });
    const fileKey = 'cv-test/' + id + '.pdf';
    const document = title === 'missing-page' ? twoPages : title === 'long' ? longCv : bytes;
    objectStore.set(fileKey, document);
    const row = await db.recruitmentCandidate.create({ data: { id, companyId, jobId: job.id, fullName: 'Contoh Taka', filename: 'cv.pdf',
      contentType: 'application/pdf', sizeBytes: document.length, fileKey, checksum: fileChecksum(document), scoreStatus: 'PENDING',
      jobSnapshot: json(scoringJob(job)) } });
    const work = await enqueueCvAssessment(db, row);
    assert.equal(work.cvPolicy, CV_RECOVERY_VERSION);
    return { row, work, job };
  }
  async function turn(workId: string, runner = worker()) {
    await db.aiScreeningWork.updateMany({ where: { id: workId, status: 'PENDING' }, data: { availableAt: new Date(0) } });
    await runner.process(workId);
  }
  async function state(id: string) { return db.recruitmentCandidate.findUniqueOrThrow({ where: { id } }); }
  async function untilDone(id: string, workId: string, max = 5) {
    for (let i = 0; i < max; i++) {
      await turn(workId);
      const current = await state(id);
      if (!['PENDING', 'PROCESSING'].includes(current.scoreStatus)) return current;
    }
    throw Error('CV work still pending: ' + id);
  }
  const traces: Record<string, unknown> = {};
  for (const kind of ['missing', 'wrapped', 'comment', 'partial', 'missing-page', 'rate', 'overload', 'truncated', 'malformed']) {
    const { row, work } = await create(kind);
    if (kind === 'rate' || kind === 'overload') {
      await turn(work.id);
      const throttled = await db.aiScreeningCall.findFirstOrThrow({ where: { workId: work.id } });
      assert.ok(throttled.cvCooldownUntil && +throttled.cvCooldownUntil - +throttled.updatedAt >= 1900);
      // The virtual wait must advance both the work timer and the shared provider window.
      await db.aiScreeningCall.update({ where: { id: throttled.id }, data: { cvCooldownUntil: new Date(0) } });
    }
    if (kind === 'missing') {
      await turn(work.id);
      assert.equal((await state(row.id)).cvScore, null, 'invalid citation cannot publish a score');
    }
    const result = await untilDone(row.id, work.id);
    assert.equal(result.cvScore, 68.8, kind);
    assert.equal(result.scoreStatus, 'READY', kind);
    assert.deepEqual((result.cvResult as { criteria: { evidence: string[] }[] }).criteria[0].evidence, [source.blocks[0].text]);
    const audit = result.cvResult as unknown as { cvText: string; sourceReferences: { blocks: Array<{ id: string; start: number; end: number }> } };
    const span = audit.sourceReferences.blocks.find(item => item.id === 'p1-b1')!;
    assert.equal(audit.cvText.slice(span.start, span.end), source.blocks[0].text);
    assert.equal(await db.candidateActivity.count({ where: { candidateId: row.id, kind: 'CV_ANALYZED' } }), 1);
    const steps = history.get(kind)!;
    assert.equal(steps.length, ['wrapped', 'comment'].includes(kind) ? 1 : 2);
    if (kind === 'missing') assert.deepEqual(steps[1], { stage: 'GRADE', ids: ['skills'], file: false });
    if (kind === 'missing-page') assert.deepEqual((result.cvResult as { criteria: { evidence: string[] }[] }).criteria[2].evidence,
      ['Sertifikasi contoh UI desain; materi tambahan disertakan.']);
    traces[kind] = steps;
  }
  const slow = await create('slow');
  await Promise.all([turn(slow.work.id), worker().process(slow.work.id)]);
  const call = await db.aiScreeningCall.findFirstOrThrow({ where: { workId: slow.work.id } });
  pollFailures.add(call.responseId!);
  await db.aiScreeningCall.update({ where: { id: call.id }, data: { createdAt: new Date(Date.now() - 180001) } });
  await turn(slow.work.id);
  assert.equal(((await state(slow.row.id)).cvProgress as { phase: string }).phase, 'DELAYED');
  assert.ok(+((await db.aiScreeningWork.findUniqueOrThrow({ where: { id: slow.work.id } })).availableAt) > Date.now());
  await db.aiScreeningCall.update({ where: { id: call.id }, data: { createdAt: new Date(Date.now() - 396000) } });
  assert.equal((await untilDone(slow.row.id, slow.work.id)).cvScore, 93.8);
  assert.equal(history.get('slow')!.length, 1, 'polling through a restart and overload does not create again');
  const lost = await create('lost');
  await turn(lost.work.id);
  const lostCall = await db.aiScreeningCall.findFirstOrThrow({ where: { workId: lost.work.id } });
  assert.equal(lostCall.responseId, null);
  const eventId = 'wh_test_taka_lost', timestamp = new Date();
  const body = Buffer.from(JSON.stringify({ type: 'response.completed', data: { id: 'resp_' + lostCall.id } }));
  const headers = { 'webhook-id': eventId, 'webhook-timestamp': String(Math.floor(+timestamp / 1000)),
    'webhook-signature': new Webhook(key).sign(eventId, timestamp, body) };
  const webhook = new CvWebhookController(config, db);
  await assert.rejects(webhook.receive({ rawBody: body } as never, { ...headers, 'webhook-signature': 'v1,invalid' }));
  await Promise.all([webhook.receive({ rawBody: body } as never, headers), webhook.receive({ rawBody: body } as never, headers)]);
  const event = await db.aiScreeningWork.findUniqueOrThrow({ where: { key: 'CV_PROVIDER_EVENT:' + eventId } });
  assert.equal(await db.aiScreeningWork.count({ where: { kind: 'CV_PROVIDER_EVENT', subjectId: 'resp_' + lostCall.id } }), 1);
  await turn(event.id);
  assert.equal((await untilDone(lost.row.id, lost.work.id)).cvScore, 93.8);
  assert.equal(history.get('lost')!.length, 1);
  const clean = await db.aiScreeningWork.findUniqueOrThrow({ where: { key: 'CV_PROVIDER_DELETE:resp_' + lostCall.id } });
  await turn(clean.id);
  assert.equal(changed, 1);

  const broken = await create('broken');
  assert.equal((await untilDone(broken.row.id, broken.work.id)).scoreStatus, 'FAILED');
  assert.equal(history.get('broken')!.length, 3);
  assert.ok((await candidates.cvRecoveryQueue(operator)).some(item => item.id === broken.work.id));
  await assert.rejects(candidates.cvRecoveryQueue(hr));
  assert.equal((await candidates.retry(hr, broken.row.id)).status, 'RECOVERING');
  assert.equal((await candidates.recoverCv(operator, broken.row.id, { action: 'RESUME' })).status, 'PENDING');
  assert.equal((await untilDone(broken.row.id, broken.work.id)).cvScore, 68.8);
  const badDoc = await create('unreadable');
  assert.equal((await untilDone(badDoc.row.id, badDoc.work.id)).scoreStatus, 'UNREADABLE');
  const empty = await create('empty');
  assert.equal((await untilDone(empty.row.id, empty.work.id)).scoreStatus, 'UNREADABLE');
  assert.equal(history.get('empty')!.length, 1);
  const short = await create('short');
  assert.equal((await untilDone(short.row.id, short.work.id)).cvScore, 30);
  assert.equal(history.get('short')!.length, 1);
  const badRepair = await create('bad-repair');
  const rejected = await untilDone(badRepair.row.id, badRepair.work.id);
  assert.equal(rejected.scoreStatus, 'FAILED');
  assert.equal(rejected.cvScore, null);
  assert.equal(history.get('bad-repair')!.length, 2);
  assert.equal((await db.aiScreeningWork.findUniqueOrThrow({ where: { id: badRepair.work.id } })).error, 'CV_GRADE_REPAIR_NO_PROGRESS');
  const stale = await create('stale');
  await turn(stale.work.id);
  await db.$transaction(async tx => {
    await tx.jobPost.update({ where: { id: stale.job.id }, data: { description: 'Kriteria baru yang menggantikan snapshot.' } });
    await invalidateCvScores(tx, stale.job.id, hr.id, scoringJob(stale.job));
  });
  await turn(stale.work.id);
  assert.equal((await state(stale.row.id)).scoreStatus, 'STALE');
  assert.equal((await state(stale.row.id)).cvScore, null);
  const oldFile = await create('changed-cv');
  await turn(oldFile.work.id);
  const oldResponse = await db.aiScreeningCall.findFirstOrThrow({ where: { workId: oldFile.work.id } });
  const changedKey = 'cv-test/replacement.pdf';
  const replacement = await pdf(0, true);
  objectStore.set(changedKey, replacement);
  const updated = await db.recruitmentCandidate.update({ where: { id: oldFile.row.id }, data: {
    fileKey: changedKey, checksum: fileChecksum(replacement), revision: { increment: 1 }, scoreStatus: 'PENDING',
  } });
  const newFileWork = await enqueueCvAssessment(db, updated);
  await turn(oldFile.work.id);
  await recovery.receiveProviderEvent(oldResponse.responseId!);
  assert.equal((await state(oldFile.row.id)).cvScore, null);
  assert.equal((await untilDone(oldFile.row.id, newFileWork.id)).cvScore, 68.8);
  const long = await create('long');
  const longResult = await untilDone(long.row.id, long.work.id);
  assert.equal(longResult.scoreStatus, 'READY');
  assert.match((longResult.cvResult as { cvText: string }).cvText, /Project 9\. Created bilingual/);
  assert.equal(history.get('long')!.length, 1);
  const privateRow = await create('other-tenant', 'other-tenant', 'cv-company-1');
  assert.deepEqual((await candidates.cvStatus(hr, 'cv-company', [slow.row.id, privateRow.row.id])).map(x => x.id), [slow.row.id]);
  await assert.rejects(candidates.cvStatus(hr, 'cv-company-1', [privateRow.row.id]));

  const throttle = await create('throttle', 'throttle-a');
  const throttleOther = await create('throttle-other', 'throttle-b', 'cv-company-1');
  await db.aiScreeningCall.updateMany({ where: { task: CV_PROVIDER_TASK }, data: { createdAt: new Date(0) } });
  config.set('CV_SCORING_V2_RPM', 1);
  await Promise.all([turn(throttle.work.id), turn(throttleOther.work.id)]);
  assert.equal(await db.aiScreeningCall.count({ where: { workId: { in: [throttle.work.id, throttleOther.work.id] } } }), 1);
  config.set('CV_SCORING_V2_RPM', 10000);
  for (const task of [throttle, throttleOther]) {
    assert.equal((await untilDone(task.row.id, task.work.id)).cvScore, 68.8);
  }

  const loads = [];
  const orderedWork: string[] = [];
  for (const [index, count] of [1, 10, 1000].entries()) {
    const name = 'load-' + count, company = index ? 'cv-company-' + index : 'cv-company';
    const tasks = [];
    for (let i = 0; i < count; i++) tasks.push(await create(name, name + '-' + i, company));
    loads.push({ count, ids: tasks.map(task => task.row.id), workIds: tasks.map(task => task.work.id) });
  }
  for (let index = 0; index < Math.max(...loads.map(group => group.count)); index++) for (const group of loads) {
    if (group.workIds[index]) orderedWork.push(group.workIds[index]);
  }
  const started = Date.now(), runner = worker();
  for (let i = 0; i < orderedWork.length; i += 2) await Promise.all(orderedWork.slice(i, i + 2).map(id => turn(id, runner)));
  const measurements = [];
  for (const { count, ids, workIds } of loads) {
    const scored = await db.recruitmentCandidate.count({ where: { id: { in: ids }, scoreStatus: 'READY' } });
    const submissions = await db.aiScreeningCall.count({ where: { workId: { in: workIds }, task: CV_PROVIDER_TASK } });
    assert.equal(scored, count); assert.equal(submissions, count);
    measurements.push({ scored, submissions });
  }
  console.log(JSON.stringify({ suite: 'taka-cv-recovery', traces, slow: { providerSeconds: 396, submissions: 1 },
    lost: { webhookReceipts: 1, submissions: 1 }, loads: measurements, mockedElapsedMs: Date.now() - started, paidCalls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
