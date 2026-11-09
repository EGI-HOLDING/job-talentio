const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(400);
  }
  throw Error('Timed out waiting for ' + description);
}

async function processWork(db, worker, kind, subjectId, allowed, timeoutMs = 100000) {
  const work = await db.aiScreeningWork.findFirstOrThrow({ where: { kind, subjectId }, orderBy: { createdAt: 'desc' } });
  allowed?.add(work.id);
  await until(async () => {
    const current = await db.aiScreeningWork.findUniqueOrThrow({ where: { id: work.id } });
    if (current.status === 'DONE') return true;
    // Poll the existing provider response. Stop this bounded probe before any paid retry.
    if (current.status === 'FAILED' || current.attempts) {
      const last = await db.aiScreeningCall.findFirst({ where: { workId: work.id }, orderBy: { createdAt: 'desc' }, select: { status: true, error: true, result: true } });
      throw Error(kind + ' failed: ' + current.error + '. Synthetic provider result: ' + JSON.stringify(last));
    }
    if (current.status === 'PENDING' && current.availableAt <= new Date()) await worker.process(work.id);
    return false;
  }, kind, timeoutMs);
  return work.id;
}

function loadSyntheticAudio(file) {
  assert.ok(file, 'A local synthetic WAV is required');
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 44 && bytes.length <= 1024 * 1024);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  return bytes.toString('base64');
}

async function useSyntheticMicrophone(context, audio) {
  await context.addInitScript(wav => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) return getUserMedia(constraints);
      const graph = new AudioContext();
      const destination = graph.createMediaStreamDestination();
      const source = graph.createBufferSource();
      const data = Uint8Array.from(atob(wav), byte => byte.charCodeAt(0));
      source.buffer = await graph.decodeAudioData(data.buffer);
      source.connect(destination);
      await graph.resume();
      window.playRecruitmentTestAudio = () => source.start();
      return destination.stream;
    };
  }, audio);
}

async function verifyVoice({ page, dashboard, drawer, db, worker, call, hr, foreign, sessionId, invitationId, report, allowed }) {
  const invitation = await db.screeningInvitation.findUniqueOrThrow({ where: { id: invitationId } });
  const plan = await db.aiCandidatePlan.findFirstOrThrow({ where: { sessionId } });
  const prepWork = await processWork(db, worker, 'PREPARE', invitation.packageId, allowed);
  const planWork = await processWork(db, worker, 'CANDIDATE', plan.id, allowed);
  report.steps.push('A real GPT-6 Luna rubric and grounded CV questions were prepared through the durable worker.');
  const started = Date.now();
  await page.getByRole('button', { name: 'Gabung interview', exact: true }).click({ timeout: 25000 });
  await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 30000 });
  const voice = await db.voiceInterview.findUniqueOrThrow({ where: { sessionId } });
  assert.ok(voice.providerId);
  const fragments = speaker => db.voiceFragment.findMany({ where: { voiceId: voice.id, speaker }, orderBy: { id: 'asc' } });
  await until(async () => {
    const turns = await fragments('TARA');
    return turns.map(turn => turn.text).join('').includes('?');
  }, 'Tara opening question');
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return audio && !audio.paused && audio.currentTime > 0.5 && audio.srcObject?.getAudioTracks().length;
  }, undefined, { timeout: 10000 });
  const oldTara = (await fragments('TARA')).length;
  await page.evaluate(() => window.playRecruitmentTestAudio());
  await until(async () => (await fragments('CANDIDATE')).map(turn => turn.text).join('').trim().length > 15, 'transcribed candidate audio', 25000);
  await until(async () => (await fragments('TARA')).length > oldTara, 'Tara response to the candidate audio', 15000);
  report.steps.push('Browser connected with WebRTC, received Tara audio, sent a synthetic WAV and persisted audio transcripts for both speakers.');

  await page.getByRole('button', { name: 'Akhiri', exact: true }).click();
  await page.getByRole('button', { name: 'Akhiri interview', exact: true }).click();
  await page.getByRole('heading', { name: 'Terima kasih sudah berbagi' }).waitFor({ timeout: 20000 });
  const closed = await db.voiceInterview.findUniqueOrThrow({ where: { sessionId } });
  assert.equal(closed.status, 'ENDED');
  assert.equal(closed.closeReason, 'CANDIDATE_ENDED');
  report.connectedToClosedMs = Date.now() - started;

  const evalWork = await processWork(db, worker, 'VOICE_EVALUATE', sessionId, allowed);
  const endpoint = '/recruitment/invitations/' + invitationId + '/report';
  const result = await call(endpoint, hr);
  assert.equal(result.evaluation.status, 'NEEDS_REVIEW');
  assert.ok(result.evaluation.result.summary);
  assert.ok(result.voice.transcript.some(turn => turn.speaker === 'CANDIDATE'));
  assert.ok(result.voice.transcript.some(turn => turn.speaker === 'TARA'));
  assert.equal(result.evaluation.result.voice.partial, true);
  const evidence = result.evaluation.result.claims.flatMap(claim => claim.evidence);
  assert.ok(evidence.every(entry => result.voice.transcript.some(turn => turn.id === entry.questionId && turn.text.includes(entry.quote))));
  await processWork(db, worker, 'PDF', sessionId);
  assert.equal(await db.aiScreeningWork.count({ where: { kind: 'PDF', subjectId: sessionId } }), 1);
  const ready = await call(endpoint, hr);
  assert.equal(ready.pdfStatus, 'READY');
  await call(endpoint, foreign, null, 'GET', 403);
  const pdf = await fetch(ready.pdfUrl, { signal: AbortSignal.timeout(10000) });
  assert.ok(pdf.ok);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  report.steps.push('The real evaluation and partial-session report were persisted, with access denied to a foreign recruiter.');

  await dashboard.reload({ waitUntil: 'domcontentloaded' });
  await dashboard.getByRole('button', { name: 'HTTP Candidate', exact: true }).click({ timeout: 30000 });
  await drawer.getByRole('button', { name: 'Screening', exact: true }).click();
  await drawer.getByRole('button', { name: /^Lihat Interview suara/ }).click({ timeout: 15000 });
  await drawer.getByRole('heading', { name: 'Ringkasan', exact: true }).waitFor({ timeout: 15000 });
  await drawer.getByRole('tab', { name: 'Percakapan', exact: true }).click();
  await drawer.locator('article[data-speaker="TARA"]').first().waitFor();
  await drawer.locator('article[data-speaker="CANDIDATE"]').first().waitFor();
  await drawer.getByRole('tab', { name: 'Laporan', exact: true }).click();
  await drawer.getByRole('heading', { name: 'Laporan screening' }).waitFor();
  assert.equal(await drawer.getByRole('button', { name: 'Unduh PDF', exact: true }).last().isEnabled(), true);
  report.steps.push('HR browser renders the voice result, both transcript speakers and the downloadable PDF.');
  report.providerCalls = await db.aiScreeningCall.findMany({
    where: { workId: { in: [prepWork, planWork, evalWork] } },
    select: { task: true, model: true, status: true, inputTokens: true, outputTokens: true },
  });
  assert.equal(report.providerCalls.length, 3);
  assert.ok(report.providerCalls.every(row => row.status === 'COMPLETED'));
  report.voice = { model: closed.model, closeReason: closed.closeReason, completeTranscript: closed.transcriptComplete, turns: ready.voice.transcript.length, score: ready.evaluation.score, evidenceCount: evidence.length };
}

module.exports = { loadSyntheticAudio, useSyntheticMicrophone, verifyVoice, until, processWork };
