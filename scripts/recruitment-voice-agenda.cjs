// Opt-in provider test through the actual candidate browser and the disposable Nest app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSyntheticAudio, processWork, until } = require('./recruitment-voice-live.cjs');

const cases = [
  { id: 'api', duty: 'Membuat endpoint API inventaris yang memvalidasi perubahan stok', clue: /\b(?:api|endpoint|stok|inventaris)\b/i },
  { id: 'incident', duty: 'Menangani insiden produksi dan memulihkan layanan dengan aman', clue: /\b(?:insiden|produksi|pulih\w*|rollback|gangguan)\b/i },
  { id: 'security', duty: 'Mengamankan akses akun admin dengan autentikasi dua faktor', clue: /\b(?:autentikasi|otentikasi|dua faktor|akun|keamanan|akses)\b/i },
  { id: 'documentation', duty: 'Menulis panduan operasional untuk serah terima kepada tim dukungan', clue: /\b(?:panduan|serah terima|dukungan|dokumentasi)\b/i },
];
const duties = [cases[0].duty, 'Merancang API inventaris untuk memeriksa input perubahan stok', ...cases.slice(1).map(row => row.duty)];
const timeLimit = () => process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-full' ? 900_000 : 90_000;

function reserveSpend() {
  const ledger = process.env.RELIABILITY_VOICE_LEDGER;
  const prior = Number(process.env.RELIABILITY_VOICE_PRIOR_USD);
  assert.ok(ledger && Number.isFinite(prior) && prior >= 0, 'Provide the cumulative test spend and ledger path');
  const directory = path.dirname(ledger);
  fs.mkdirSync(directory, { recursive: true });
  const scenario = process.env.RELIABILITY_VOICE_SCENARIO;
  const attempt = process.env.RELIABILITY_VOICE_ATTEMPT || scenario;
  assert.match(attempt, /^[a-z0-9-]+$/);
  const reservation = ledger + '.' + attempt;
  const reservations = fs.readdirSync(directory).filter(name => name.startsWith(path.basename(ledger) + '.'))
    .map(name => path.join(directory, name));
  assert.ok(!reservations.includes(reservation), 'This paid scenario has already reserved its attempt');
  const reserved = 0.1 + (timeLimit() + 30_000) / 60_000 * 0.05;
  const total = reservations.reduce((sum, file) => sum + JSON.parse(fs.readFileSync(file, 'utf8')).reserved, prior) + reserved;
  assert.ok(total <= 10, 'The cumulative US$10 testing cap does not cover this attempt');
  fs.writeFileSync(reservation, JSON.stringify({ scenario, reserved, prior, total, at: new Date().toISOString() }), { flag: 'wx' });
}

function loadAudio(dir) {
  assert.ok(dir, 'Set RELIABILITY_VOICE_WAV_DIR to a local synthetic fixture directory');
  return Object.fromEntries([...cases.flatMap(row => [row.id, row.id + '-detail']), 'hello', 'repeat', 'unrelated', 'pause'].map(id =>
    [id, loadSyntheticAudio(path.join(dir, id + '.wav'))]));
}

async function useSyntheticMicrophone(context, files) {
  await context.addInitScript(wavs => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) return getUserMedia(constraints);
      const graph = new AudioContext();
      await graph.resume();
      const mic = graph.createMediaStreamDestination();
      const idle = graph.createConstantSource();
      idle.offset.value = 0;
      idle.connect(mic);
      idle.start();
      const buffers = new Map();
      await Promise.all(Object.entries(wavs).map(async ([id, base64]) => {
        const bytes = Uint8Array.from(atob(base64), byte => byte.charCodeAt(0));
        buffers.set(id, await graph.decodeAudioData(bytes.buffer));
      }));
      const sent = [];
      const heard = [];
      const analyser = graph.createAnalyser();
      analyser.fftSize = 1024;
      const samples = new Float32Array(analyser.fftSize);
      let playerStream, source, activity;
      const timer = setInterval(() => {
        const player = document.querySelector('audio');
        if (player?.srcObject !== playerStream) {
          source?.disconnect();
          playerStream = player?.srcObject;
          if (playerStream?.getAudioTracks().length) {
            source = graph.createMediaStreamSource(playerStream);
            source.connect(analyser);
          } else source = undefined;
        }
        if (source && !player.paused && !player.muted && player.volume && player.readyState >= 2) {
          analyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          if (Math.sqrt(energy / samples.length) >= 0.0025) {
            const now = performance.now();
            if (!activity || now - activity.end > 500) { activity = { start: now, end: now }; heard.push(activity); }
            else activity.end = now;
          }
        }
      }, 20);
      window.taraAgendaTest = {
        play(id) {
          const buffer = buffers.get(id);
          const data = buffer.getChannelData(0);
          // Trim silence from the end-of-speech measurement, not from the input.
          const size = Math.ceil(buffer.sampleRate / 100);
          let last = data.length;
          for (; last > size; last -= size) {
            let energy = 0;
            for (let index = last - size; index < last; index++) energy += data[index] ** 2;
            if (Math.sqrt(energy / size) >= 0.005) break;
          }
          const start = performance.now();
          const input = graph.createBufferSource();
          input.buffer = buffer;
          input.connect(mic);
          input.start();
          const turn = { id, start, end: start + 1000 * last / buffer.sampleRate };
          sent.push(turn);
          return turn;
        },
        readings: () => {
          const player = document.querySelector('audio');
          return { now: performance.now(), origin: performance.timeOrigin, sent, heard, state: graph.state,
            player: player && { currentTime: player.currentTime, paused: player.paused, ready: player.readyState,
              track: player.srcObject?.getAudioTracks()[0]?.readyState } };
        },
        dispose: () => { clearInterval(timer); void graph.close(); },
      };
      return mic.stream;
    };
  }, files);
}

function observeProvider(provider, screening, events) {
  const create = provider.create.bind(provider);
  const attach = provider.attach.bind(provider);
  const hangup = provider.hangup.bind(provider);
  const request = screening.request.bind(screening);
  let active = false;
  let created = false;
  let watchdog;
  let outputObserved = false;
  let inputObserved = false;
  provider.create = async body => {
    assert.equal(created, false, 'The scenario may create only one provider session');
    created = true;
    active = true;
    const requestedAt = Date.now();
    events.push({ type: 'create', at: Date.now(), model: body.session.model, delegation: body.session.delegation });
    try {
      const response = await create(body);
      watchdog = setTimeout(() => { void provider.hangup(response.session.id).catch(() => undefined); },
        Math.max(1, timeLimit() - 5000 - (Date.now() - requestedAt)));
      watchdog.unref();
      return response;
    } catch (error) {
      active = false;
      throw error;
    }
  };
  provider.hangup = async id => {
    events.push({ type: 'hangup', at: Date.now() });
    await hangup(id);
    clearTimeout(watchdog);
    active = false;
  };
  provider.attach = (id, onEvent, onLost) => {
    const channel = attach(id, event => {
      if (event.type === 'session.closed') {
        active = false;
        clearTimeout(watchdog);
      }
      if (event.type === 'session.output_audio.delta' && !outputObserved) {
        outputObserved = true;
        events.push({ type: 'first_output_audio', at: Date.now(), from: event.start_ms });
      }
      if (event.type === 'session.input_transcript.delta' && !inputObserved) {
        inputObserved = true;
        events.push({ type: 'first_input_transcript', at: Date.now(), from: event.start_ms });
      }
      if (['session.started', 'session.commentary.appended', 'session.closed', 'session.delegation.created', 'error'].includes(event.type))
        events.push({ type: event.type, at: Date.now(), key: event.client_event_id,
          reason: event.reason, usage: event.usage, code: event.error?.code });
      onEvent(event);
    }, onLost);
    return { ...channel, send: event => {
      events.push({ type: event.type, at: Date.now(), key: event.event_id });
      channel.send(event);
    } };
  };
  screening.request = async (...args) => {
    events.push({ type: 'responses', at: Date.now(), active, method: args[1]?.method || 'GET' });
    assert.equal(active, false, 'Responses API cannot be on the Live path');
    return request(...args);
  };
}

function percentile95(values) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
}

function heardQuestion(meter, transcript, offset, input) {
  const after = input?.start ?? -1;
  const range = meter.heard.find(row => row.end >= after);
  const last = meter.heard.at(-1);
  if (!range || input && meter.now < input.end || meter.now - last.end < 700) return;
  // Align provider timestamps to the first sound in the browser. An overlapping
  // question is returned as a measurement, so the test can report the overlap.
  const firstAudio = meter.heard[0].start;
  const rows = transcript.filter(row => row.speaker === 'TARA' && row.endMs >= offset + range.start - firstAudio - 450 &&
    row.startMs <= offset + last.end - firstAudio + 450);
  const substantive = rows.find(row => /\?|wawancara kita selesai/i.test(row.text));
  if (!substantive) return;
  const projected = firstAudio + substantive.startMs - offset;
  const window = meter.heard.find(row => row.end >= after && row.end >= projected - 250);
  return { start: window ? Math.max(window.start, projected) : range.start, end: last.end,
    text: rows.map(row => row.text).join(' ').trim(), rows: rows.map(row => row.id) };
}

async function verifyVoice({ page, db, worker, call, hr, foreign, sessionId, invitationId, report, allowed, voiceEvents }) {
  const invitation = await db.screeningInvitation.findUniqueOrThrow({ where: { id: invitationId } });
  const plan = await db.aiCandidatePlan.findFirstOrThrow({ where: { sessionId } });
  const prep = await processWork(db, worker, 'PREPARE', invitation.packageId, allowed);
  const packet = await db.aiScreeningPackage.findUniqueOrThrow({ where: { id: invitation.packageId } });
  const { liveAgenda, criteria } = packet.payload;
  report.agenda = liveAgenda;
  report.agendaProposal = (await db.aiScreeningCall.findFirst({ where: { workId: prep, task: 'live-agenda' }, select: { result: true } }))?.result;
  assert.equal(liveAgenda?.source, 'JOB_REQUIREMENTS');
  assert.equal(criteria.length, 4);
  assert.deepEqual(liveAgenda.topics.map(row => row.equivalentIds.length).sort(), [0, 0, 0, 1]);
  const expected = criteria.map(row => {
    const id = cases.find(item => row.name === item.duty || item.id === 'api' && row.name === duties[1])?.id;
    assert.ok(id);
    return id;
  });
  assert.equal(new Set(expected).size, 4);
  const candidate = await processWork(db, worker, 'CANDIDATE', plan.id, allowed);
  const prepared = await db.aiCandidatePlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.deepEqual(prepared.payload.roleTopics.map(row => row.criterionId), liveAgenda.topics.map(row => row.criterionId));

  const scenario = process.env.RELIABILITY_VOICE_SCENARIO;
  const duration = timeLimit();
  const started = Date.now();
  const read = () => page.evaluate(() => window.taraAgendaTest.readings());
  const play = id => page.evaluate(file => window.taraAgendaTest.play(file), id);
  const getReport = () => call('/recruitment/invitations/' + invitationId + '/report', hr);
  const inspectVoice = async () => {
    const current = await getReport();
    report.transcript = current.voice?.transcript || [];
    report.voice = { status: current.voice?.status, startedAt: current.voice?.startedAt,
      endedAt: current.voice?.endedAt, reason: current.voice?.closeReason, complete: current.voice?.transcriptComplete };
    return current.voice;
  };
  async function hear(input, timeout = 18_000) {
    return until(async () => {
      const meter = await read();
      if (!meter.heard.length) return false;
      const voice = await inspectVoice();
      const offset = report.audioOffset ?? voice?.transcript.find(row => row.speaker === 'TARA')?.startMs;
      if (offset === undefined) return false;
      report.audioOffset = offset;
      return heardQuestion(meter, voice.transcript, offset, input);
    }, 'audible question or farewell', Math.max(1, Math.min(timeout, started + duration - 4500 - Date.now())));
  }
  function currentTopic(text, permitted = expected) {
    const question = text.match(/[^?]+\?/g)?.at(-1) ?? text;
    return permitted.find(id => cases.find(row => row.id === id).clue.test(question));
  }
  async function manualEnd() {
    const end = page.getByRole('button', { name: 'Akhiri', exact: true });
    if (await end.isEnabled().catch(() => false)) {
      await end.click({ timeout: 2500 });
      await page.getByRole('button', { name: 'Akhiri interview', exact: true }).click({ timeout: 2500 });
      await page.getByRole('heading', { name: 'Terima kasih sudah berbagi' }).waitFor({ timeout: 14000 });
    }
  }

  report.turns = [];
  report.topics = [];
  report.dialogueFailures = [];
  let audio, conversationError;
  try {
    await page.getByRole('button', { name: 'Gabung interview', exact: true }).click({ timeout: 20000 });
    await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 26000 });
    try {
      audio = await hear();
    } catch (error) {
      if (scenario !== 'agenda-full' || (await read()).heard.length) throw error;
      const hint = await page.getByText(/coba bilang “Halo” lewat mikrofon/).isVisible();
      assert.ok(hint, 'A silent model must give the candidate a clear way to start the interview');
      report.openingNeededCandidate = true;
      const hello = await play('hello');
      audio = await hear(hello);
    }
    report.opening = audio.text;
    assert.match(audio.text, /\b(?:gue|gua) Tara\b/i);
    let topic = currentTopic(audio.text);
    assert.ok(topic, 'Opening must ask a concrete task from the agenda');
    report.topics.push({ id: topic, heardMs: 0, text: audio.text });
    async function answer(id) {
      const input = await play(id);
      const next = await hear(input, Math.max(18000, input.end - input.start + 16000));
      const meter = await read();
      const observation = { input: id, fromSpeechEndMs: Math.round(next.start - input.end), text: next.text, heard: next,
        overlap: meter.heard.some(row => row.start > input.start && row.start < input.end) };
      report.turns.push(observation);
      audio = next;
      return observation;
    }
    if (scenario === 'agenda-pace') {
      await answer('repeat');
      assert.equal(currentTopic(audio.text, [topic]), topic, 'Requested repetition should clarify the current question');
      const next = await answer(topic === 'api' ? 'pause' : topic);
      assert.ok(next.text.length > 25);
    } else if (scenario === 'agenda-redirect') {
      const redirected = await answer('unrelated');
      assert.equal(redirected.overlap, false, 'Redirect waits until the candidate stops');
      assert.equal(currentTopic(audio.text, [topic]), topic, 'Redirect supplies a concrete question on the same topic');
      const moved = await answer('unrelated');
      assert.equal(moved.overlap, false, 'Moving topics waits for the candidate to stop');
      assert.ok(currentTopic(audio.text, expected.filter(id => id !== topic)), 'A second off-topic answer must move forward');
    } else {
      const answered = new Set();
      const clarifications = new Set();
      await answer('repeat');
      if (!currentTopic(audio.text, [topic])) report.dialogueFailures.push('A request to repeat changed the active question.');
      topic = currentTopic(audio.text) || topic;
      for (let index = 0; index < 12; index++) {
        const response = await answer(clarifications.has(topic) ? topic + '-detail' : topic === 'api' ? 'pause' : topic);
        answered.add(topic);
        if (/wawancara kita selesai[.!]?\s*$/i.test(audio.text)) break;
        const next = currentTopic(audio.text, expected.filter(id => !answered.has(id))) ?? currentTopic(audio.text);
        assert.ok(next, 'Each response must give one concrete next step');
        if (answered.has(next)) {
          if (next !== topic || clarifications.has(next)) report.dialogueFailures.push('Tara reopened a covered competency or repeated a clarification: ' + next);
          clarifications.add(next);
        } else report.topics.push({ id: next, heardMs: response.heard.start - (await read()).heard[0].start, text: audio.text });
        topic = next;
      }
      assert.match(audio.text, /wawancara kita selesai[.!]?\s*$/i);
      assert.equal(answered.size, 4, 'Every distinct competency gets a first opportunity');
      assert.ok(report.topics.every(row => row.heardMs <= 660_000));
      await page.getByRole('heading', { name: 'Terima kasih sudah berbagi' }).waitFor({ timeout: 12000 });
      await page.waitForTimeout(1000);
    }
  } catch (error) {
    conversationError = error;
  } finally {
    if (scenario !== 'agenda-full' || conversationError) await manualEnd().catch(() => undefined);
    report.audio = await read().catch(() => null);
    await page.evaluate(() => window.taraAgendaTest?.dispose()).catch(() => undefined);
    await inspectVoice().catch(() => undefined);
    report.voiceEvents = voiceEvents;
    report.voiceElapsedMs = Date.now() - started;
    if (report.turns.length) report.p95SpeechStartMs = percentile95(report.turns.map(row => row.fromSpeechEndMs));
  }
  if (conversationError) throw conversationError;
  assert.equal(voiceEvents.filter(event => event.type === 'create').length, 1);
  assert.equal(voiceEvents.find(event => event.type === 'create').model, 'gpt-live-1');
  assert.equal(voiceEvents.filter(event => event.type === 'responses' && event.active).length, 0);
  assert.equal(voiceEvents.filter(event => event.type === 'session.delegation.created').length, 0);
  const commands = voiceEvents.filter(event => event.type === 'session.commentary.append');
  assert.ok(commands.length <= 1 && commands.every(event => event.key === 'tara-opening'));
  assert.equal(report.voice.status, 'ENDED');
  assert.equal(report.voice.reason, scenario === 'agenda-full' ? 'TARA_FINISHED' : 'CANDIDATE_ENDED');
  assert.ok(Date.parse(report.voice.endedAt) - Date.parse(report.voice.startedAt) <= duration);
  assert.equal(report.transcript.filter(row => row.speaker === 'TARA').flatMap(row => [...row.text.matchAll(/\b(?:gue|gua) Tara\b/gi)]).length, 1);
  if (scenario === 'agenda-full') {
    assert.ok(report.audio.heard.at(-1).end <= audio.end + 250, 'Audio must stop after the heard farewell');
    const evalWork = await processWork(db, worker, 'VOICE_EVALUATE', sessionId, allowed);
    const result = await getReport();
    const role = result.evaluation.result.roleAssessment;
    assert.equal(role.coverage.total, 4);
    assert.equal(role.coverage.assessed, 4);
    assert.equal(role.components.cv, 75);
    assert.equal(result.evaluation.finalScore, role.score);
    assert.ok(role.criteria.every(row => row.evidence.every(entry => result.voice.transcript.some(turn =>
      turn.id === entry.questionId && turn.speaker === 'CANDIDATE' && turn.text.includes(entry.quote)))));
    await processWork(db, worker, 'PDF', sessionId);
    await call('/recruitment/invitations/' + invitationId + '/report', foreign, null, 'GET', 403);
    const ready = await getReport();
    assert.equal(ready.pdfStatus, 'READY');
    const pdf = await fetch(ready.pdfUrl, { signal: AbortSignal.timeout(10000) });
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    report.evaluation = role;
    assert.ok(await db.aiScreeningCall.count({ where: { workId: evalWork } }) >= 1);
  }
  report.providerCalls = await db.aiScreeningCall.findMany({ where: { OR: [{ workId: { in: [prep, candidate] } }, { subjectId: sessionId }] },
    select: { task: true, model: true, status: true, inputTokens: true, outputTokens: true, costUsd: true } });
  assert.ok(!report.openingNeededCandidate, 'The automatic opening still requires provider verification');
  assert.deepEqual(report.dialogueFailures, []);
  assert.ok(report.turns.every(row => row.fromSpeechEndMs >= 0 && !row.overlap), 'Tara must allow the candidate to finish');
  assert.ok(report.p95SpeechStartMs <= 1500, 'Measured speech-end to browser playback p95 exceeds 1.5 seconds');
  report.steps.push('One GPT-Live session reached the browser with the frozen distinct agenda and retained the actual conversation.');
}

module.exports = { duties, loadAudio, useSyntheticMicrophone, observeProvider, verifyVoice, reserveSpend, heardQuestion };
