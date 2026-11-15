// Opt-in provider test through the actual candidate browser and the disposable Nest app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { loadSyntheticAudio, processWork, until } = require('./recruitment-voice-live.cjs');

const cases = [
  { id: 'api', duty: 'Membuat endpoint API inventaris yang memvalidasi perubahan stok', clue: /\b(?:api|endpoint|stok|inventaris|validasi(?:nya)?)\b/i },
  { id: 'incident', duty: 'Menangani insiden produksi dan memulihkan layanan dengan aman', clue: /\b(?:insiden|produksi|pulih\w*|rollback|gangguan)\b/i },
  { id: 'security', duty: 'Mengamankan akses akun admin dengan autentikasi dua faktor', clue: /\b(?:autentikasi|otentikasi|dua faktor|akun|keamanan|akses|totp|kode cadangan|second factor)\b/i },
  { id: 'documentation', duty: 'Menulis panduan operasional untuk serah terima kepada tim dukungan', clue: /\b(?:panduan|serah terima|dukungan|dokumentasi|recovery steps)\b/i },
];
const duties = [cases[0].duty, 'Merancang API inventaris untuk memeriksa input perubahan stok', ...cases.slice(1).map(row => row.duty)];
const fullDurationProbe = () => process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-completion-full';
const completionProbe = () => /^agenda-completion-(?:response|close|coverage|resume|full|skill-gap|redirect|clarify|pause)$/.test(process.env.RELIABILITY_VOICE_SCENARIO || '');
const coverageProbe = () => fullDurationProbe() || process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-completion-coverage';
const requiredSkillProbe = () => coverageProbe() || process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-completion-skill-gap';
const resumeProbe = () => process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-completion-resume';
const isAlignedProbe = () => ['agenda-aligned', 'agenda-completion-response'].includes(process.env.RELIABILITY_VOICE_SCENARIO);
const isClosingProbe = () => ['agenda-aligned-close', 'agenda-completion-close'].includes(process.env.RELIABILITY_VOICE_SCENARIO);
const focusedBehaviour = () => /^agenda-completion-(?:skill-gap|redirect|clarify|pause)$/.test(process.env.RELIABILITY_VOICE_SCENARIO || '');
const focusedProbe = () => isAlignedProbe() || isClosingProbe() || coverageProbe() || resumeProbe() || focusedBehaviour();
const dutiesForScenario = () => isClosingProbe() ? [duties[0], duties[0]] :
  focusedBehaviour() ? [duties[0], duties[2], duties[3]] : isAlignedProbe() || resumeProbe() ? [duties[0], duties[0], duties[2]] : duties;
const timeLimit = () => {
  if (fullDurationProbe()) return 910_000;
  if (process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-full' && process.env.TAKA_ALIGNED_ROLE_RUBRIC_ENABLED !== 'true') return 900_000;
  return 90_000;
};

function textSpend(directory, file) {
  const { cap, closedLedgerSha256 } = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  assert.ok(Number.isFinite(cap) && cap >= 0, 'Invalid text test reservation');
  if (!closedLedgerSha256) return cap;
  const charges = path.join(directory, file.slice('text-budget.'.length), 'spend.jsonl');
  if (!fs.existsSync(charges)) return cap;
  const recorded = fs.readFileSync(charges, 'utf8');
  if (createHash('sha256').update(recorded).digest('hex') !== closedLedgerSha256) return cap;
  const entries = recorded.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  const reserved = entries.filter(row => Number.isFinite(row.reservedUsd));
  const billed = entries.filter(row => Number.isFinite(row.costUsd) && row.costUsd >= 0);
  const reservedIds = new Set(reserved.map(row => row.key));
  const billedIds = new Set(billed.map(row => row.key));
  if (!reserved.length || reserved.length !== billed.length || billed.length !== billedIds.size ||
      reserved.length !== reservedIds.size || !reserved.every(row => typeof row.key === 'string' && billedIds.has(row.key))) return cap;
  return billed.reduce((total, row) => total + row.costUsd, 0);
}

function reserveSpend() {
  const ledger = process.env.RELIABILITY_VOICE_LEDGER;
  const prior = Number(process.env.RELIABILITY_VOICE_PRIOR_USD);
  const limit = Number(process.env.RELIABILITY_VOICE_BUDGET_USD ?? 10);
  assert.ok(ledger && Number.isFinite(prior) && prior >= 0 && Number.isFinite(limit) && limit > 0,
    'Provide the cumulative test spend, authorized cap and ledger path');
  const directory = path.dirname(ledger);
  fs.mkdirSync(directory, { recursive: true });
  const scenario = process.env.RELIABILITY_VOICE_SCENARIO;
  const attempt = process.env.RELIABILITY_VOICE_ATTEMPT || scenario;
  assert.match(attempt, /^[a-z0-9-]+$/);
  const reservation = ledger + '.' + attempt;
  const reservations = fs.readdirSync(directory).filter(name => name.startsWith(path.basename(ledger) + '.'))
    .map(name => path.join(directory, name));
  assert.ok(!reservations.includes(reservation), 'This paid scenario has already reserved its attempt');
  const textReserve = !completionProbe() || process.env.RELIABILITY_VOICE_REAL_EVAL === '1' ? 0.1 : 0;
  const reserved = textReserve + (timeLimit() + 30_000) / 60_000 * 0.05;
  function spentOrReserved(file) {
    const hold = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(Number.isFinite(hold.reserved) && hold.reserved >= 0, 'Invalid voice test reservation');
    const proof = file.slice(ledger.length + 1) + '.json';
    const reportPath = path.join(directory, proof);
    if (hold.scenario === undefined || !fs.existsSync(reportPath)) return hold.reserved;

    const { voiceEvents, providerCalls } = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!Array.isArray(voiceEvents)) return hold.reserved;
    const created = voiceEvents.filter(row => row.type === 'create');
    const closed = voiceEvents.filter(row => row.type === 'session.closed');
    if (!closed.length || closed.length !== (created.length || 1) ||
        closed.some(row => !Number.isFinite(row.usage?.seconds) || row.usage.seconds < 0)) return hold.reserved;
    // Trials against the provider directly can have one close receipt and no
    // application create event. A missing Responses receipt keeps the full hold.
    const submissions = voiceEvents.filter(row => row.type === 'responses' && row.method === 'POST').length;
    const costs = (providerCalls ?? []).filter(row => row.status === 'COMPLETED' && typeof row.costUsd === 'number');
    if (submissions !== costs.length || costs.some(row => !Number.isFinite(row.costUsd) || row.costUsd < 0)) return hold.reserved;

    return closed.reduce((sum, row) => sum + row.usage.seconds * .05 / 60, 0) +
      costs.reduce((sum, row) => sum + row.costUsd, 0);
  }
  const textReservations = fs.readdirSync(directory).filter(name => name.startsWith('text-budget.'));
  const textBudget = textReservations.reduce((sum, file) => sum + textSpend(directory, file), 0);
  const total = reservations.reduce((sum, file) => sum + spentOrReserved(file), prior) + reserved + textBudget;
  assert.ok(total <= limit, 'The authorized cumulative testing cap does not cover this attempt');
  fs.writeFileSync(reservation, JSON.stringify({ scenario, reserved, prior, total, limit, at: new Date().toISOString() }), { flag: 'wx' });
}

function loadAudio(dir, readinessAudio) {
  assert.ok(dir, 'Set RELIABILITY_VOICE_WAV_DIR to a local synthetic fixture directory');
  const files = [...cases.flatMap(row => [row.id, row.id + '-detail']), 'hello', 'ready', 'repeat', 'unrelated', 'pause'].map(id =>
    [id, loadSyntheticAudio(id === 'ready' && readinessAudio ? readinessAudio : path.join(dir, id + '.wav'))]);
  if (focusedProbe()) for (const cue of ['api', 'api-detail', 'incident', 'incident-detail', 'finished', ...(isClosingProbe() ? ['complete'] : [])])
    files.push([cue, loadSyntheticAudio(path.join(process.env.RELIABILITY_VOICE_SHORT_DIR, cue + '.wav'))]);
  if (coverageProbe() || focusedBehaviour()) for (const cue of ['security', 'documentation']) {
    const filename = path.join(process.env.RELIABILITY_VOICE_SHORT_DIR, cue + '.wav');
    if (fs.existsSync(filename)) files.push([cue, loadSyntheticAudio(filename)]);
  }
  if (fullDurationProbe() || focusedBehaviour()) {
    const full = process.env.RELIABILITY_VOICE_FULL_DIR;
    assert.ok(full, 'Provide the synthetic answers for a real-duration test');
    const names = ['no-such-skill', 'clarification-short', 'off-topic-first', 'off-topic-second', 'candidate-stop', 'held-floor'];
    if (process.env.RELIABILITY_VOICE_SCENARIO === 'agenda-completion-skill-gap') names.push('security-scenario');
    for (const name of names) files.push([name, loadSyntheticAudio(path.join(full, name + '.wav'))]);
    if (fullDurationProbe()) {
      for (const { id } of cases) {
        const clips = fs.readdirSync(full).filter(name => new RegExp('^' + id + '-[0-9]+\\.wav$').test(name)).sort();
        assert.ok(clips.length >= 5, 'A real-duration test needs distinct examples for ' + id);
        for (const name of clips) files.push([name.slice(0, -4), loadSyntheticAudio(path.join(full, name))]);
      }
    }
  }
  return Object.fromEntries(files);
}

function validateReadinessAudio(file = process.env.RELIABILITY_VOICE_READY_WAV || path.join(process.env.RELIABILITY_VOICE_WAV_DIR, 'ready.wav')) {
  const wav = Buffer.from(loadSyntheticAudio(file), 'base64');
  let pcm, blockSamples;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + length <= wav.length, 'The synthetic readiness WAV is truncated');
    if (name === 'fmt ' && length >= 16) {
      assert.equal(wav.readUInt16LE(start), 1, 'Use a PCM readiness fixture');
      assert.equal(wav.readUInt16LE(start + 14), 16, 'Use a 16-bit readiness fixture');
      blockSamples = Math.ceil(wav.readUInt32LE(start + 4) / 100) * wav.readUInt16LE(start + 2);
    }
    if (name === 'data') pcm = wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  assert.ok(blockSamples && pcm, 'The synthetic readiness WAV needs a format and PCM samples');
  for (let offset = 0; offset + blockSamples * 2 <= pcm.length; offset += blockSamples * 2) {
    let energy = 0;
    for (let index = offset; index < offset + blockSamples * 2; index += 2) energy += pcm.readInt16LE(index) ** 2;
    if (Math.sqrt(energy / blockSamples) >= 0.005 * 32768) return;
  }
  assert.fail('The synthetic readiness WAV contains no speech at the measurement threshold');
}

async function useSyntheticMicrophone(context, files) {
  await context.addInitScript(({ wavs, tightPlayout, recordOutput }) => {
    const PeerConnection = window.RTCPeerConnection;
    const recordings = new Set();
    window.RTCPeerConnection = class extends PeerConnection {
      constructor(...options) {
        super(...options);
        window.taraTestPeer = this;
        if (tightPlayout) this.addEventListener('track', ({ receiver }) => {
          if ('jitterBufferTarget' in receiver && receiver.track.kind === 'audio') receiver.jitterBufferTarget = 0;
        });
        if (recordOutput && typeof MediaRecorder !== 'undefined') this.addEventListener('track', ({ track }) => {
          if (track.kind !== 'audio') return;
          const recorder = new MediaRecorder(new MediaStream([track]), { mimeType: 'audio/webm' });
          const chunks = [];
          const complete = new Promise(resolve => recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType })), { once: true }));
          recorder.addEventListener('dataavailable', event => chunks.push(event.data));
          recordings.add({ recorder, complete });
          recorder.start(1000);
        });
      }
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) return getUserMedia(constraints);
      const previous = window.taraAgendaTest?.readings();
      window.taraAgendaTest?.dispose();
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
      const sent = previous?.sent ?? [];
      const heard = previous?.heard ?? [];
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
      function speechBounds(id) {
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
        if (last <= size) throw Error('Synthetic input contains no measurable speech: ' + id);
        return 1000 * last / buffer.sampleRate;
      }
      window.taraAgendaTest = {
        speechBounds,
        play(id) {
          const speechMs = speechBounds(id);
          const start = performance.now();
          const input = graph.createBufferSource();
          input.buffer = buffers.get(id);
          input.connect(mic);
          input.start();
          const turn = { id, start, end: start + speechMs };
          sent.push(turn);
          return turn;
        },
        readings: () => {
          const player = document.querySelector('audio');
          return { now: performance.now(), origin: performance.timeOrigin, sent, heard, state: graph.state,
            player: player && { currentTime: player.currentTime, paused: player.paused, ready: player.readyState,
              track: player.srcObject?.getAudioTracks()[0]?.readyState } };
        },
        receiverStats: async () => {
          const receiver = window.taraTestPeer?.getReceivers().find(item => item.track.kind === 'audio');
          const stats = receiver && [...(await receiver.getStats()).values()].find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
          if (!stats?.jitterBufferEmittedCount) return;
          return { jitterMs: 1000 * stats.jitter, jitterBufferMs: 1000 * stats.jitterBufferDelay / stats.jitterBufferEmittedCount,
            jitterBufferMinimumMs: 1000 * stats.jitterBufferMinimumDelay / stats.jitterBufferEmittedCount, packetsLost: stats.packetsLost };
        },
        takeRecordings: async () => Promise.all([...recordings].map(async ({recorder, complete}) => {
          if (recorder.state !== 'inactive') recorder.stop();
          const blob = await complete;
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })),
        dispose: () => { clearInterval(timer); void graph.close(); },
      };
      return mic.stream;
    };
  }, { wavs: files, tightPlayout: process.env.RELIABILITY_VOICE_LOW_LATENCY_PLAYOUT === '1',
    recordOutput: fullDurationProbe() || process.env.RELIABILITY_VOICE_CAPTURE === '1' });
}

function observeProvider(provider, screening, events) {
  const create = provider.create.bind(provider);
  const attach = provider.attach.bind(provider);
  const request = screening.request.bind(screening);
  let active = false;
  let created = 0;
  let watchdog;
  let liveId;
  let outputObserved = false;
  let inputObserved = false;
  const outputSignal = completionProbe() ? require('../apps/api/dist/ai-screening/voice/voice-native').reflectedVoiceSignal : undefined;
  let lastProviderSoundAt = 0;
  let probeStarted;
  provider.create = async (body, timeoutMs) => {
    assert.ok(created < (resumeProbe() ? 2 : 1), 'The scenario may open only its planned provider connections');
    assert.equal(active, false, 'The previous provider connection must be closed before opening another');
    created++;
    active = true;
    const requestedAt = Date.now();
    probeStarted ??= requestedAt;
    events.push({ type: 'create', at: Date.now(), model: body.session.model, delegation: body.session.delegation,
      ...(process.env.RELIABILITY_VOICE_DIRECT_COMPARISON === '1' ? { syntheticSession: body.session } : {}) });
    try {
      const response = await create(body, timeoutMs);
      liveId=response.session.id;
      watchdog = setTimeout(() => { void provider.closeWebRtc(response.session.id, observeClose).catch(() => undefined); },
        Math.max(1, timeLimit() - 5000 - (Date.now() - probeStarted)));
      watchdog.unref();
      return response;
    } catch (error) {
      active = false;
      throw error;
    }
  };
  function observeClose(event) {
    if (event.type !== 'session.closed' || !active) return;
    active = false;
    clearTimeout(watchdog);
    events.push({ type: event.type, at: Date.now(), reason: event.reason, usage: event.usage });
  }
  provider.attach = (id, onEvent, onLost) => {
    const channel = attach(id, event => {
      if (event.type === 'session.closed') observeClose(event);
      if (event.type === 'session.usage.updated' && Number.isFinite(event.usage?.seconds)) {
        const previous = events.findLast(row => row.type === 'session.usage.updated' || row.type === 'create');
        if (previous?.type !== 'session.usage.updated' || event.usage.seconds > previous.usage.seconds)
          events.push({ type: event.type, at: Date.now(), usage: { seconds: event.usage.seconds } });
      }
      if (event.type === 'session.output_audio.delta' && !outputObserved) {
        outputObserved = true;
        events.push({ type: 'first_output_audio', at: Date.now(), from: event.start_ms });
      }
      if (event.type === 'session.output_audio.delta' && outputSignal?.(event.delta)) {
        const now = Date.now();
        if (now - lastProviderSoundAt > 500)
          events.push({ type: 'provider_audio_onset', at: now, from: event.start_ms });
        lastProviderSoundAt = now;
      }
      if (event.type === 'session.input_transcript.delta' && !inputObserved) {
        inputObserved = true;
        events.push({ type: 'first_input_transcript', at: Date.now(), from: event.start_ms });
      }
      if (['session.started', 'session.commentary.appended', 'session.delegation.created', 'error'].includes(event.type))
        events.push({ type: event.type, at: Date.now(), key: event.client_event_id,
          reason: event.reason, usage: event.usage, code: event.error?.code });
      onEvent(event);
    }, onLost);
    return {
      ...channel,
      requestOpening: opening => {
        events.push({ type: 'session.commentary.append', at: Date.now(), key: 'tara-opening' });
        channel.requestOpening(opening);
      },
      closeSession: () => {
        events.push({ type: 'session.close', at: Date.now() });
        channel.closeSession();
      },
    };
  };
  screening.request = async (...args) => {
    const method = args[1]?.method || 'GET';
    if (args[0] === '/resp_synthetic_http' && method === 'GET') return new Response(null, { status: 404 });
    if (completionProbe() && !process.env.OPENAI_API_KEY) throw Error('Unexpected network request during the no-cost browser preflight');
    events.push({ type: 'responses', at: Date.now(), active, method });
    assert.equal(active, false, 'Responses API cannot be on the Live path');
    return request(...args);
  };
  return async () => {
    if (liveId && active) await provider.closeWebRtc(liveId, observeClose);
    clearTimeout(watchdog);
    return !!liveId && active;
  };
}

function percentile95(values) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
}

const readyQuestion = /\b(?:(?:bisa|boleh)\s+(?:kita\s+)?mulai|(?:lo|lu|kamu|anda)\s+(?:udah\s+|sudah\s+)?siap|siap\s+(?:untuk\s+)?mulai|(?:kita\s+)?mulai\s+ya)\b/i;
const repeatedPersonalAction = /\b(?:apa (?:aja )?yang|(?:bagian|hal)(?: [^?]{1,28})? (?:mana|apa) yang|(?:satu |bagian )?hal yang) (?:lo|lu) (?:lakuin|kerjain|bangun|bikin|ambil)(?: (?:sendiri|secara langsung|di situ)){0,2}(?: apa)?[.?\s]*$/iu;
const spokenFarewell = /\b(?:wawancara (?:kita )?(?:(?:sudah|udah) )?selesai|sekian untuk wawancara|(?:gua|gue) pamit)\b/iu;
const acknowledgment = /^(?:(?:oke|okay|ok|sip|iya|ya|baik|siap|h+m+|m+h+m+|got it|right|sure)\s*[,.!…]+\s*)+/iu;

function fullDurationAnswers() {
  const directory = process.env.RELIABILITY_VOICE_FULL_DIR;
  return new Map(cases.map(({id}) => [id, fs.readdirSync(directory)
    .filter(name => new RegExp('^' + id + '-[0-9]+\\.wav$').test(name))
    .sort().map(name => name.slice(0, -4))]));
}

function heardQuestion(meter, transcript, offset, input, seen = new Set()) {
  const after = input?.start ?? -1;
  const range = meter.heard.find(row => row.end >= after);
  const last = meter.heard.at(-1);
  if (!range || input && meter.now < input.end || meter.now - last.end < 700) return;
  // Align provider timestamps to the first sound in the browser. An overlapping
  // question is returned as a measurement, so the test can report the overlap.
  const firstAudio = meter.heard[0].start;
  const rows = transcript.filter(row => row.speaker === 'TARA' && !seen.has(row.id) && row.endMs >= offset + range.start - firstAudio - 450 &&
    row.startMs <= offset + last.end - firstAudio + 450);
  const substantive = rows.find(row => /\?|wawancara kita selesai/i.test(row.text) || readyQuestion.test(row.text));
  if (!substantive) return;
  const projected = firstAudio + substantive.startMs - offset;
  const window = meter.heard.find(row => row.end >= after && row.end >= projected - 250);
  return { start: window ? Math.max(window.start, projected) : range.start, end: last.end,
    text: rows.map(row => row.text).join(' ').trim(), rows: rows.map(row => row.id) };
}

// This probe submits a new recording only once the preceding browser playback
// is quiet. Measure the next turn on the browser clock and use the transcript
// to verify its content. Provider timestamps can drift relative to playback.
function heardSequentialTurn(meter, transcript, input, seen) {
  const windows = meter.heard.filter(row => row.end >= (input?.start ?? -1));
  if (!windows.length || input && meter.now < input.end || meter.now - windows.at(-1).end < 700) return;
  const rows = transcript.filter(row => row.speaker === 'TARA' && !seen.has(row.id));
  const meaningful = rows.filter(row => /\?/u.test(row.text) || spokenFarewell.test(row.text) || readyQuestion.test(row.text));
  if (!meaningful.length) return;
  const spoken = rows.map(row => row.text).join(' ').trim();
  const first = windows[0];
  // The meter starts a new window after 500 ms of silence. A short standalone
  // acknowledgment before that gap cannot satisfy the substantive reply target.
  const separateAck = first.end - first.start < 400 && acknowledgment.test(spoken);
  if (separateAck && !windows[1]) return;
  return { start: (separateAck ? windows[1] : first).start, firstAudioStart: first.start,
    end: windows.at(-1).end, text: spoken, rows: rows.map(row => row.id) };
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
  const numCompetencies = isClosingProbe() ? 1 : focusedBehaviour() ? 3 : isAlignedProbe() || resumeProbe() ? 2 : 4;
  assert.equal(criteria.length, numCompetencies);
  if(packet.payload.roleRubric){
    if (focusedProbe() && !coverageProbe()) {
      assert.equal(criteria.filter(row => row.name === duties[0]).length, 1);
    } else if (coverageProbe()) {
      assert.equal(new Set(criteria.map(row => row.name)).size, 4);
      const mandatory = criteria.flatMap(row => row.sources ?? []).find(row => row.kind === 'SKILL');
      assert.equal(mandatory?.text, 'Autentikasi dua faktor');
    } else {
      const [merged] = criteria.filter(row => row.sources?.length === 2);
      assert.ok(merged && merged.sources.some(source => source.text === duties[0]) && merged.sources.some(source => source.text === duties[1]));
    }
    assert.equal(packet.payload.roleRubric.criteria.length, numCompetencies);
    assert.equal(invitation.snapshot.cvResult.roleAssessment.rubricRevision, packet.payload.roleRubric.revision);
  } else assert.deepEqual(liveAgenda.topics.map(row => row.equivalentIds.length).sort(), [0, 0, 0, 1]);
  const expected = criteria.map(row => {
    const id = cases.find(item => row.name === item.duty || item.id === 'api' && row.name === duties[1])?.id;
    assert.ok(id);
    return id;
  });
  assert.equal(new Set(expected).size, numCompetencies);
  const candidate = await processWork(db, worker, 'CANDIDATE', plan.id, allowed);
  const prepared = await db.aiCandidatePlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.deepEqual(prepared.payload.roleTopics.map(row => row.criterionId).sort(), liveAgenda.topics.map(row => row.criterionId).sort());
  const apiCriterion = criteria[expected.indexOf('api')];
  const cvTopic = prepared.payload.roleTopics.find(row => row.criterionId === apiCriterion.id);
  const cvClaim = prepared.payload.claims.find(row => row.id === cvTopic?.cvClaimId);
  assert.ok(cvClaim?.skill, 'The synthetic CV must have a grounded claim before opening a paid voice session');
  if (requiredSkillProbe()) {
    const gap = prepared.payload.roleTopics.find(row => row.requiredSkill?.cvEvidence === 'NOT_ATTESTED');
    assert.equal(gap?.requiredSkill?.name, 'Autentikasi dua faktor');
    assert.match(gap.question, /autentikasi dua faktor/i);
    report.mandatorySkillProbe = gap.requiredSkill.name;
  }
  if (completionProbe() && process.argv.includes('--live-preflight')) {
    assert.equal(invitation.snapshot.liveCompletionVersion, 'tara-live-completion-v1');
    await page.getByRole('button', { name: 'Gabung interview', exact: true }).waitFor();
    assert.deepEqual(voiceEvents, [], 'Preflight stops before creating a voice connection');
    report.steps.push('Disposable HR, CV, invitation, browser and agenda verified before any request to a voice provider.');
    return;
  }
  const { fullName } = await db.user.findUniqueOrThrow({ where: { id: invitation.claimedUserId }, select: { fullName: true } });
  const firstName = fullName.trim().split(/\s+/)[0];

  const scenario = process.env.RELIABILITY_VOICE_SCENARIO;
  const autoClosing = fullDurationProbe() || scenario === 'agenda-full' || isClosingProbe() && !completionProbe();
  const duration = timeLimit();
  const started = Date.now();
  const read = () => page.evaluate(() => window.taraAgendaTest.readings());
  const play = id => page.evaluate(file => window.taraAgendaTest.play(file), id);
  const getReport = () => call('/recruitment/invitations/' + invitationId + '/report', hr);
  const seen = new Set();
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
      const heard = focusedProbe() ? heardSequentialTurn(meter, voice.transcript, input, seen) :
        heardQuestion(meter, voice.transcript, offset, input, seen);
      if (heard) heard.rows.forEach(id => seen.add(id));
      return heard;
    }, 'audible question or farewell', Math.max(1, Math.min(timeout,
      (voiceEvents.find(event => event.type === 'create')?.at ?? started) + duration - 4500 - Date.now())));
  }
  function currentTopic(text, permitted = expected) {
    const sentences = text.trim().split(/(?<=[.?!])\s+/u);
    const question = sentences.filter(sentence => sentence.endsWith('?')).at(-1) ?? text;
    const direct = permitted.find(id => cases.find(row => row.id === id).clue.test(question));
    // A concrete situation immediately before an open-ended “what would you do?”
    // is part of the question rather than an unrelated earlier acknowledgement.
    const setup = sentences.at(-2) ?? '';
    return direct ?? permitted.find(id => cases.find(row => row.id === id).clue.test(setup));
  }
  async function waitForAudibleClose() {
    const row = await until(async () => {
      const voice = await inspectVoice();
      return voice?.status === 'ENDED' && voice;
    }, 'server finalization after actual browser playback', 14_000);
    assert.equal(row.closeReason, 'TARA_FINISHED', 'Normal close must follow the audible farewell');
  }
  async function manualEnd() {
    const end = page.getByRole('button', { name: 'Akhiri', exact: true });
    if (await end.isEnabled().catch(() => false)) {
      await end.click({ timeout: 2500 });
      await page.getByRole('button', { name: 'Akhiri interview', exact: true }).click({ timeout: 2500 });
      await page.getByRole('heading', { name: completionProbe() ? /Tara memeriksa|Wawancara|Lanjutkan wawancara/ :
        'Terima kasih sudah berbagi' }).waitFor({ timeout: 14000 });
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
      audio = await hear(null, 25_000);
    } catch (error) {
      if (scenario !== 'agenda-full' || (await read()).heard.length) throw error;
      const hint = await page.getByText(/coba bilang “Halo” lewat mikrofon/).isVisible();
      assert.ok(hint, 'A silent model must give the candidate a clear way to start the interview');
      report.openingNeededCandidate = true;
      const hello = await play('hello');
      audio = await hear(hello);
    }
    report.opening = audio.text;
    assert.ok(audio.text.toLowerCase().replace(/,/g, '').includes('halo ' + firstName.toLowerCase()),
      'The greeting addresses the candidate by first name');
    assert.match(audio.text, /\b(?:gue|gua) Tara\b/i);
    assert.match(audio.text, /\bCV\b/i, 'The greeting explains what Tara will discuss');
    assert.match(audio.text, readyQuestion, 'The greeting asks the candidate to confirm readiness');
    const invitationToStart = readyQuestion.exec(audio.text);
    assert.doesNotMatch(audio.text.slice(0, invitationToStart.index), /\?/u, 'Readiness is the only question in the greeting');
    assert.match(audio.text.slice(invitationToStart.index + invitationToStart[0].length), /^[\s?.!,]*$/,
      'The greeting ends with the readiness question');
    // A brief breath after the greeting is not another spoken turn. Verify the
    // complete transcript and fail on sustained audio without a transcript.
    await page.waitForTimeout(coverageProbe() ? 350 : 1750);
    const greetingPlayback = (await read()).heard;
    report.audioAfterGreeting = greetingPlayback.filter(window => window.start > audio.end);
    const beforeReady = (await inspectVoice()).transcript.filter(row => row.speaker === 'TARA').map(row => row.text).join(' ');
    assert.equal(beforeReady.trim(), report.opening, 'Tara asks nothing further before readiness');
    assert.ok(report.audioAfterGreeting.every(window => window.end - window.start < 450), 'No sustained audio follows the greeting');
    await until(async () => {
      const meter = await read();
      return meter.now - meter.heard.at(-1).end >= 700;
    }, 'quiet after greeting', 2500);
    const ready = await play('ready');
    audio = await hear(ready, 26_000);
    report.firstQuestion = audio.text;
    report.firstQuestionStart = audio.start;
    report.firstResponseAfterReadyMs = Math.round(audio.start - ready.end);
    report.readinessOverlap = (await read()).heard.some(window => window.start > ready.start && window.start < ready.end);
    const skillWords = cvClaim.skill.match(/[\p{L}\p{N}+#]+/gu) ?? [];
    assert.ok(skillWords.every(word => audio.text.toLowerCase().includes(word.toLowerCase())),
      'The first question names the grounded skill from the CV');
    assert.equal((audio.text.match(/\?/g) || []).length, 1, 'The first CV turn asks one question');
    assert.match(audio.text, /\b(?:contoh|pengalaman|waktu|kapan|pernah|proyek|kerjain|tindakan yang (?:lo|lu|kamu) (?:lakukan|ambil))\b/iu,
      'The first question tests actual use of the CV skill');
    assert.equal(currentTopic(audio.text), 'api', 'The first question starts with the CV skill linked to the API work');
    let topic = currentTopic(audio.text);
    report.topics.push({ id: topic, heardMs: audio.start - (await read()).heard[0].start, text: audio.text });
    async function answer(id) {
      if (focusedProbe()) await until(async () => {
        const meter = await read();
        return meter.now - meter.heard.at(-1).end >= (coverageProbe() || resumeProbe() ? 750 : 1500);
      }, 'Tara finished speaking', 20_000);
      const input = await play(id);
      const next = await hear(input, Math.max(18000, input.end - input.start + 24000));
      const meter = await read();
      if (focusedProbe()) assert.ok((next.text.match(/\?/g) || []).length <= 1,
        'Focused playback check expects a complete single question or farewell');
      const observation = { input: id, fromSpeechEndMs: Math.round(next.start - input.end), text: next.text, heard: next,
        overlap: meter.heard.some(row => row.start > input.start && row.start < input.end) };
      report.turns.push(observation);
      audio = next;
      return observation;
    }
    if (focusedBehaviour()) {
      if (scenario === 'agenda-completion-redirect') {
        const redirected = await answer('off-topic-first');
        assert.equal(currentTopic(redirected.text, ['api']), 'api', 'First unrelated reply should get one concrete redirect');
        assert.match(redirected.text, /\b(?:pernah|waktu|pengalaman|kapan|contoh)\b/iu,
          'A redirect about past use still asks for an actual example');
        if (redirected.overlap) report.dialogueFailures.push('First direction started before the candidate stopped speaking.');
        const moved = await answer('off-topic-second');
        assert.ok(currentTopic(moved.text, expected.filter(id => id !== 'api')), 'Second unrelated reply should leave the same topic');
        if (moved.overlap) report.dialogueFailures.push('Transition started before the candidate stopped speaking.');
      } else if (scenario === 'agenda-completion-pause') {
        const response = await answer('held-floor');
        assert.equal(response.overlap, false, 'Silence inside an unfinished explanation must leave the candidate the floor');
        const advanced = currentTopic(response.text, expected.filter(id => id !== 'api'));
        report.firstPassAdvanced = Boolean(advanced);
        if (!advanced) report.dialogueFailures.push('Tara stayed on the answered topic while initial topics remained.');
        assert.match((await inspectVoice()).transcript.filter(row => row.speaker === 'CANDIDATE').map(row => row.text).join(' '),
          /(?:stok|stock|inventori|kode pos)/iu, 'Response after the pause must reach the saved transcript');
      } else if (scenario === 'agenda-completion-clarify') {
        const clarified = await answer('clarification-short');
        assert.equal(currentTopic(clarified.text, ['api']), 'api', 'The same task should get a concrete clarification');
        const next = await answer('api');
        assert.ok(currentTopic(next.text, expected.filter(id => id !== 'api')), 'A concrete example must move the interview forward');
      } else {
        const gap = await answer('api');
        assert.match(gap.text, /(?:autentikasi dua faktor|dua faktor|two.factor)/iu);
        assert.match(gap.text, /\b(?:pernah|pengalaman)\b/iu, 'Ask actual use of the mandatory skill');
        const alternative = await answer('no-such-skill');
        assert.equal(alternative.overlap, false);
        assert.match(alternative.text, /(?:kalau|misal|bayangin|bagaimana|gimana|langkah|cara)/iu, 'Offer a concrete work situation after no previous experience');
        assert.equal(currentTopic(alternative.text, ['security']), 'security');
        const advanced = await answer('security-scenario');
        assert.equal(currentTopic(advanced.text, ['incident']), 'incident', 'After one concrete scenario response, move to the remaining competency');
      }
      await manualEnd();
    } else if (resumeProbe()) {
      let response = await answer('api');
      if (currentTopic(response.text) === 'api') response = await answer('api-detail');
      assert.equal(currentTopic(response.text), 'incident', 'Require one answered competency before pausing the first connection');
      const original = await db.voiceInterview.findUniqueOrThrow({ where: { sessionId } });
      await page.waitForTimeout(750);
      await page.getByRole('button', { name: 'Akhiri', exact: true }).click();
      await page.getByRole('button', { name: 'Jeda wawancara', exact: true }).click();
      await page.getByRole('button', { name: 'Lanjutkan wawancara', exact: true }).waitFor({ timeout: 12_000 });
      const paused = await db.aiScreeningSession.findUniqueOrThrow({ where: { id: sessionId }, select: { voiceCompletion: true } });
      const firstLeg = await db.voiceInterview.findUniqueOrThrow({ where: { id: original.id } });
      assert.ok(firstLeg.billedVoiceMs > 0);
      assert.equal(paused.voiceCompletion.remainingVoiceMs, 900000 - firstLeg.billedVoiceMs);
      assert.deepEqual(paused.voiceCompletion.missingCriterionIds, [], 'Live does not infer missing topics from keywords');
      assert.equal(await db.aiScreeningWork.count({ where: { subjectId: sessionId, kind: 'VOICE_EVALUATE' } }), 0);
      const restart = await read();
      await page.getByRole('button', { name: 'Lanjutkan wawancara', exact: true }).click();
      await page.getByText('Terhubung', { exact: true }).waitFor({ timeout: 15000 });
      audio = await hear({ start: restart.now, end: restart.now }, 25_000);
      assert.equal(currentTopic(audio.text), 'incident', 'The new connection resumes on the unanswered competency');
      assert.doesNotMatch(audio.text, /\b(?:gue|gua) Tara\b/iu, 'The candidate already heard the introduction');
      await answer('incident');
      await until(async () => {
        const voice = await inspectVoice();
        return voice.transcript.some(turn => turn.speaker === 'CANDIDATE' && /roll back|rollback|health check/i.test(turn.text));
      }, 'a substantive saved answer on the second connection', 8500);
      report.usageAfterFirstLegMs = firstLeg.billedVoiceMs;
      report.remainingAtPauseMs = paused.voiceCompletion.remainingVoiceMs;
      await manualEnd();
    } else if (coverageProbe()) {
      const asked = new Set(report.topics.map(item => item.id));
      const answered = new Set();
      for (let turn = 0; turn < 8 && answered.size < 4 && !spokenFarewell.test(audio.text); turn++) {
        const cue = topic && answered.has(topic) ? topic + '-detail' : topic ?? 'finished';
        const finalOpportunity = topic && !answered.has(topic) && answered.size === 3;
        const response = await answer(cue);
        if (topic) answered.add(topic);
        if (spokenFarewell.test(response.text))
          report.dialogueFailures.push('Tara announced the end during the opening coverage window.');
        if (finalOpportunity) break;
        if (spokenFarewell.test(audio.text)) break;
        const next = currentTopic(audio.text, expected.filter(id => !asked.has(id))) ?? currentTopic(audio.text);
        if (!next) {
          report.dialogueFailures.push('Tara did not move to a distinct competency after a substantive answer: ' + audio.text);
          topic = undefined;
          break;
        } else if (asked.has(next)) {
          report.dialogueFailures.push(cue === 'api' && repeatedPersonalAction.test(audio.text) ?
            'Tara asked again for the personal action already described on API work.' :
            'Tara asked about a covered competency before giving the remaining competencies a first turn: ' + next);
          break;
        } else {
          asked.add(next);
          report.topics.push({ id: next, heardMs: response.heard.start - (await read()).heard[0].start, text: audio.text });
        }
        topic = next;
      }
      assert.equal(asked.size, 4, 'Tara asked each competency');
      assert.equal(answered.size, 4, 'The candidate had the opportunity to answer each competency');
      const securityPrompt = report.topics.find(row => row.id === 'security')?.text ?? '';
      assert.match(securityPrompt, /(?:autentikasi dua faktor|dua faktor|two.factor)/iu,
        'Tara explicitly names the missing mandatory skill in browser playback');
      if (!/\b(?:pernah|pengalaman|waktu (?:lo|lu|kamu)|kapan (?:lo|lu|kamu))\b/iu.test(securityPrompt))
        report.dialogueFailures.push('Tara did not ask whether the candidate had actually used the missing mandatory skill.');
      assert.doesNotMatch(audio.text, /wawancara kita selesai[.!]?\s*$/iu, 'The short coverage test is still before the normal closing window');
      if (fullDurationProbe()) {
        const clips = fullDurationAnswers();
        const repeated = new Set();
        const exhausted = new Set();
        const key = text => (text.match(/[^.?!]+\?/gu)?.at(-1) ?? text).normalize('NFKC')
          .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const questionKeys = new Set(report.topics.map(row => key(row.text)));
        const origin = (await read()).heard[0].start;
        const expectedEnd = () => (voiceEvents.find(event => event.type === 'create')?.at ?? started) + duration - 4500;
        report.requiredClosingWindowMs = [720_000, 900_000];
        assert.ok(report.topics.every(row => row.heardMs <= 540_000), 'All four first opportunities must begin before minute nine');
        while (!spokenFarewell.test(audio.text) && Date.now() < expectedEnd()) {
          const nextTopic = currentTopic(audio.text) ?? topic;
          const questionKey = key(audio.text);
          if (questionKeys.has(questionKey)) repeated.add(questionKey);
          questionKeys.add(questionKey);
          const clip = clips.get(nextTopic)?.shift();
          if (!clip) {
            if (exhausted.has(nextTopic)) {
              report.dialogueFailures.push('Tara asked for another example after the candidate finished this topic: ' + nextTopic);
              break;
            }
            exhausted.add(nextTopic);
            await answer('finished');
            continue;
          }
          topic = nextTopic;
          await answer(clip);
        }
        report.exactRepeatedQuestions = [...repeated];
        report.audibleFarewellMs = Math.round(audio.start - origin);
        report.audibleFarewellText = audio.text;
        assert.match(audio.text, spokenFarewell, 'No audible closing was captured');
        assert.ok(report.audibleFarewellMs >= 720_000 && report.audibleFarewellMs <= 900_000,
          'Expected an audible farewell between real minutes 12 and 15. Observed ' + report.audibleFarewellMs + ' ms.');
        await waitForAudibleClose();
        if (repeated.size) report.dialogueFailures.push('Repeated spoken questions during the same interview.');
      } else await manualEnd();
    } else if (completionProbe()) {
      const response = await answer('api');
      if (scenario === 'agenda-completion-response') assert.equal(currentTopic(response.text, ['incident']), 'incident',
        'A concrete first answer opens the remaining competency before any deeper question on the same topic');
      else assert.match(response.text, /api|endpoint|stok|inventaris|input|validasi|(?:lanjut|pindah).*insiden|produksi|wawancara kita selesai/iu,
        'Tara acknowledges the evidence or clearly advances to the related job scenario');
      if (isClosingProbe()) {
        if (currentTopic(audio.text) === 'api' && /\?/.test(audio.text)) await answer('api-detail');
        if (!/wawancara kita selesai[.!]?\s*$/i.test(audio.text)) {
          assert.match(audio.text, /(?:tambah|hal terakhir)/i);
          await answer('finished');
        }
        assert.doesNotMatch(audio.text, /wawancara kita selesai[.!]?\s*$/i, 'An accelerated clock cannot prove the model knows the actual closing phase');
        await manualEnd();
      } else if (currentTopic(audio.text) === 'api') {
        await answer('api-detail');
      }
    } else if (isClosingProbe()) {
      await answer('complete');
      if (currentTopic(audio.text) === 'api' && /\?/.test(audio.text)) await answer('api-detail');
      if (!/wawancara kita selesai[.!]?\s*$/i.test(audio.text)) {
        assert.match(audio.text, /(?:tambah|hal terakhir)/i, 'Only a chance to add final information may precede the farewell');
        await answer('finished');
      }
      assert.match(audio.text, /wawancara kita selesai[.!]?\s*$/i);
      await page.getByRole('heading', { name: 'Terima kasih sudah berbagi' }).waitFor({ timeout: 12000 });
    } else if (isAlignedProbe()) {
      let transition = await answer('api');
      if (currentTopic(transition.text) !== 'incident') {
        assert.match(transition.text, /stok|validasi|konsistensi|konkurensi|input|bersamaan|endpoint/i);
        assert.doesNotMatch(transition.text, /(?:ceritain|ceritakan).{0,18}(?:satu )?contoh.*(?:pakai|menggunakan).*\?/iu);
        transition = await answer('api-detail');
      }
      assert.equal(currentTopic(transition.text), 'incident', 'Tara follows the grounded CV example with a distinct job scenario');
      assert.equal((transition.text.match(/\?/g) || []).length, 1);
      report.topics.push({ id: 'incident', heardMs: transition.heard.start - (await read()).heard[0].start, text: transition.text });
      await answer('incident');
      if (currentTopic(audio.text) === 'incident' && /\?/.test(audio.text)) await answer('incident-detail');
      if (!/wawancara kita selesai[.!]?\s*$/i.test(audio.text)) {
        assert.match(audio.text, /(?:tambah|hal terakhir)/i, 'Only a chance to add final information may precede the farewell');
        await answer('finished');
      }
      assert.match(audio.text, /wawancara kita selesai[.!]?\s*$/i);
      await page.getByRole('heading', { name: 'Terima kasih sudah berbagi' }).waitFor({ timeout: 12000 });
    } else if (scenario === 'agenda-pace') {
      await answer('repeat');
      assert.equal(currentTopic(audio.text, [topic]), topic, 'Requested repetition should clarify the current question');
      assert.equal((audio.text.match(/\?/g) || []).length, 1, 'Repeating the question should not add a second question');
      const next = await answer(topic === 'api' ? 'pause' : topic);
      assert.equal((next.text.match(/\?/g) || []).length, 1, 'The next turn gives one concrete question');
      assert.doesNotMatch(next.text, /(?:ceritain|ceritakan).{0,16}(?:satu )?contoh waktu (?:lo|lu) pakai(?: itu)?\?/iu,
        'A concrete CV example must not lead to the same opening question again');
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
    if (completionProbe()) {
      report.audioBeforeClose = await read().catch(() => null);
      report.receiverStats = await page.evaluate(() => window.taraAgendaTest?.receiverStats()).catch(() => null);
    }
    if (!autoClosing || conversationError) await manualEnd().catch(() => undefined);
    report.audio = await read().catch(() => null);
    if (fullDurationProbe() || process.env.RELIABILITY_VOICE_CAPTURE === '1') {
      const recordings = await page.evaluate(() => window.taraAgendaTest?.takeRecordings()).catch(() => []);
      report.recordedOutput = (recordings ?? []).map((bytes, index) => {
        const name = report.test + '-connection-' + (index + 1) + '.webm';
        fs.writeFileSync(path.join(process.env.AI_RELIABILITY_OUTPUT, name), Buffer.from(bytes, 'base64'));
        return name;
      });
    }
    await page.evaluate(() => window.taraAgendaTest?.dispose()).catch(() => undefined);
    await inspectVoice().catch(() => undefined);
    if (focusedProbe()) {
      const recorded = await db.voiceInterview.findUnique({ where: { sessionId }, select: { taraInterview: true } });
      report.delivery = recorded?.taraInterview?.nativeDelivery;
    }
    report.voiceEvents = voiceEvents;
    report.voiceElapsedMs = Date.now() - started;
    report.expectedEnd = autoClosing ? 'TARA_FINISHED' : 'CANDIDATE_ENDED';
    const measurements = [report.firstResponseAfterReadyMs, ...report.turns.map(row => row.fromSpeechEndMs)].filter(Number.isFinite);
    if (measurements.length) {
      report.measuredVoiceReplies = measurements.length;
      report.p95SpeechStartMs = percentile95(measurements);
    }
    if (completionProbe() && report.audio) {
      const { origin, sent, heard } = report.audio;
      const replies = [...(report.firstQuestionStart !== undefined ? [{ input: 'ready', start: report.firstQuestionStart }] : []),
        ...report.turns.map(row => ({ input: row.input, start: row.heard.start }))];
      report.latencyBreakdown = sent.map((input, index) => {
        const windowEnd = sent[index + 1]?.start ?? Infinity;
        const audio = heard.find(window => window.start < windowEnd && window.end >= input.start);
        const overlap = audio !== undefined && audio.start < input.end;
        if (!audio) return { input: input.id, overlap };
        const reply = replies[index]?.input === input.id ? replies[index] : undefined;
        const firstAudioMs = Math.round(audio.start - input.end);
        if (!reply) return { input: input.id, overlap, firstAudioMs };
        const onset = voiceEvents.filter(event => event.type === 'provider_audio_onset' &&
          event.at >= origin + input.start && event.at <= origin + reply.start + 250).at(-1);
        return { input: input.id, overlap, firstAudioMs, outputMs: Math.round(reply.start - input.end),
          providerObservedMs: onset ? Math.round(onset.at - origin - input.end) : null,
          providerToBrowserMs: onset ? Math.round(origin + reply.start - onset.at) : null };
      });
      report.turnsWithoutSubstantiveReply = sent.filter((input, index) => replies[index]?.input !== input.id).map(input => input.id);
    }
  }
  if (conversationError) throw conversationError;
  assert.equal(voiceEvents.filter(event => event.type === 'create').length, resumeProbe() ? 2 : 1);
  assert.equal(voiceEvents.find(event => event.type === 'create').model, 'gpt-live-1');
  assert.equal(voiceEvents.filter(event => event.type === 'responses' && event.active).length, 0);
  assert.equal(voiceEvents.filter(event => event.type === 'session.delegation.created').length, 0);
  const commands = voiceEvents.filter(event => event.type === 'session.commentary.append');
  assert.ok(commands.length <= (resumeProbe() ? 2 : 1) && commands.every(event => event.key === 'tara-opening'));
  assert.equal(report.voice.status, 'ENDED');
  assert.equal(report.voice.reason, autoClosing && !resumeProbe() ? 'TARA_FINISHED' : 'CANDIDATE_ENDED');
  if (!completionProbe()) assert.ok(Date.parse(report.voice.endedAt) - Date.parse(report.voice.startedAt) <= duration);
  assert.equal(report.transcript.filter(row => row.speaker === 'TARA').flatMap(row => [...row.text.matchAll(/\b(?:gue|gua) Tara\b/gi)]).length, 1);
  if (autoClosing && !resumeProbe()) assert.ok(report.audio.heard.at(-1).end <= audio.end + 250, 'Audio must stop after the heard farewell');
  if (scenario === 'agenda-full' || resumeProbe() || coverageProbe()) {
    const evalWork = await processWork(db, worker, 'VOICE_EVALUATE', sessionId, allowed);
    const result = await getReport();
    const role = result.evaluation.result.roleAssessment;
    assert.equal(role.coverage.total, numCompetencies);
    assert.equal(role.coverage.assessed, numCompetencies);
    assert.equal(role.components.cv, 75);
    assert.equal(result.evaluation.finalScore, role.score);
    assert.ok(role.criteria.every(row => row.evidence.every(entry => result.voice.transcript.some(turn =>
      turn.id === entry.questionId && turn.speaker === 'CANDIDATE' && turn.text.includes(entry.quote)))));
    await processWork(db, worker, 'PDF', sessionId);
    await call('/recruitment/invitations/' + invitationId + '/report', foreign, null, 'GET', 403);
    const ready = await getReport();
    assert.equal(ready.pdfStatus, 'READY');
    const pdf = await fetch(ready.pdfUrl, { signal: AbortSignal.timeout(10000) });
    assert.equal(pdf.status, 200);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(Buffer.from(pdfBytes.subarray(0, 5)).toString(), '%PDF-');
    const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
    const pdfjs = await import(pathToFileURL(apiRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    const loading = pdfjs.getDocument({ data: pdfBytes, verbosity: 0 });
    try {
      const cover = await (await loading.promise).getPage(1);
      const contents = await cover.getTextContent();
      const coverText = contents.items.map(item => item.str ?? '').join(' ').replace(/\s+/gu, ' ');
      const scoreLabel = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(role.score);
      assert.ok(coverText.includes('Skor akhir ' + scoreLabel + ' / 100'), 'The PDF cover shows the final score returned by the report');
      report.pdfFinalScore = role.score;
    } finally { await loading.destroy(); }
    report.evaluation = role;
    if (process.env.RELIABILITY_VOICE_REAL_EVAL === '1') {
      const calls = await db.aiScreeningCall.findMany({ where: { workId: evalWork, task: 'evaluate' }, orderBy: { createdAt: 'asc' },
        select: { model: true, status: true, inputTokens: true, outputTokens: true, costUsd: true } });
      assert.ok(calls.length >= 1 && calls.length <= 2 && calls.every(call => call.model === 'gpt-6-luna'));
      report.evaluationProviderCalls = calls;
      assert.equal(await db.aiScreeningEvaluation.count({ where: { sessionId } }), 1);
    }
    const list = await call('/recruitment/candidates/' + invitation.candidateId + '/invitations', hr);
    assert.equal(list.find(item => item.id === invitation.id)?.session?.evaluation?.finalScore, role.score);
    if (!completionProbe()) assert.ok(await db.aiScreeningCall.count({ where: { workId: evalWork } }) >= 1);
  }
  report.providerCalls = await db.aiScreeningCall.findMany({ where: { OR: [{ workId: { in: [prep, candidate] } }, { subjectId: sessionId }] },
    select: { task: true, model: true, status: true, inputTokens: true, outputTokens: true, costUsd: true } });
  assert.ok(!report.openingNeededCandidate, 'The automatic opening still requires provider verification');
  assert.ok(report.firstResponseAfterReadyMs >= 0);
  assert.equal(report.readinessOverlap, false, 'Tara waits until the readiness reply finishes');
  assert.deepEqual(report.turnsWithoutSubstantiveReply ?? [], [], 'Every test turn must have a complete spoken response');
  assert.ok(report.turns.every(row => row.fromSpeechEndMs >= 0 && !row.overlap), 'Tara must allow the candidate to finish');
  if (!focusedProbe() || completionProbe()) {
    if (report.firstResponseAfterReadyMs > 1500)
      report.dialogueFailures.push('The first CV question started more than 1.5 seconds after readiness.');
    if (report.p95SpeechStartMs > 1500)
      report.dialogueFailures.push('Measured speech-end to browser playback p95 exceeds 1.5 seconds.');
  }
  assert.deepEqual(report.dialogueFailures, []);
  report.steps.push('Each voice connection used GPT-Live with the same frozen agenda and retained the actual conversation.');
}

module.exports = { coverageProbe, requiredSkillProbe, dutiesForScenario, loadAudio, useSyntheticMicrophone, observeProvider, verifyVoice, reserveSpend, validateReadinessAudio, heardQuestion, heardSequentialTurn, processWork };
