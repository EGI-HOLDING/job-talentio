// Explicitly billed, at most one GPT-Live session per invocation. Synthetic WAVs only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const scenario = process.argv[2];
const structured = process.env.TARA_ROLE_AUDIO_PROBE === '1';
const audit = ['overlap', 'redirect'].includes(scenario);
const recovery = audit && scenario === 'redirect' && process.env.TARA_AUDIT_RECOVERY === '1';
const protectedPlayback = audit && process.env.TARA_AUDIT_PROTECTED_PLAYBACK === '1';
const mixedAnswers = protectedPlayback && process.env.TARA_AUDIT_MIXED === '1';
const oneAuditAnswer = audit && process.env.TARA_AUDIT_ONE_ANSWER === '1';
const auditInstructions = process.env.TARA_AUDIT_INSTRUCTIONS;
const auditTopic = process.env.TARA_AUDIT_TOPIC === 'shipping' ? {
    id: 'shipping', criterionId: 'shipping-validation', label: 'validasi alamat pengiriman',
    question: 'Buat validasi alamat pengiriman, apa bagian yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'],
} : null;
assert.equal(process.env.TARA_PAID_AUDIO_PROBE, '1');
assert.ok(['latency', 'interruption'].includes(scenario) || structured && audit);
const wav = readFileSync(process.env.TARA_SYNTHETIC_WAV);
const second = (scenario === 'latency' || scenario === 'overlap' || mixedAnswers) && process.env.TARA_SYNTHETIC_WAV_2 ? readFileSync(process.env.TARA_SYNTHETIC_WAV_2) : wav;
const third = process.env.TARA_SYNTHETIC_WAV_3 ? readFileSync(process.env.TARA_SYNTHETIC_WAV_3) : null;
const files = [wav, second, ...(third ? [third] : [])];
for (const file of files) assert.ok(file.length < 2 * 1024 * 1024 && file.toString('ascii', 0, 4) === 'RIFF');
if (!process.env.OPENAI_API_KEY) process.loadEnvFile('.env');
assert.ok(process.env.OPENAI_API_KEY, 'Provider key missing');

const runtime = process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = createRequire(resolve(runtime, 'playwright/package.json'))('playwright');
const protectedOrigin = protectedPlayback ? new URL(process.env.TARA_PROBE_ORIGIN || 'http://127.0.0.1:3077') : null;
if (protectedOrigin) assert.ok(['127.0.0.1', 'localhost'].includes(protectedOrigin.hostname));
const api = resolve(process.env.TARA_PROBE_API_DIST || 'apps/api/dist/ai-screening');
const { VoiceProvider } = require(api + '/voice/voice.provider');
const { createVoiceRequest, roleVoiceOpening } = require(api + '/prompts/voice-session');
const { startRoleVoice, stepRoleVoice, ROLE_VOICE_CLOSING_TEXT } = structured ? require(api + '/voice/voice-role') : {};
const { reflectedInputActive, roleRedirectQuestion } = recovery || protectedPlayback ? require(api + '/voice/voice-redirect') : {};
const provider = new VoiceProvider({ get: key => process.env[key] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const topics = [auditTopic ??
        { id: 'python', criterionId: 'python-task', label: 'Python', question: 'Soal Python, bisa ceritain contoh tugas yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] },
        { id: 'sql', criterionId: 'sql-task', label: 'SQL', question: 'Soal SQL, bagian mana yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] },
        ...(third ? [{ id: 'docker', criterionId: 'docker-task', label: 'Docker', question: 'Soal Docker, bagian mana yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] }] : []),
    ];
    const browser = await chromium.launch({ headless: true, executablePath: process.env.TARA_PROBE_CHROME,
        args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    let id, channel, closed = false, closing = false, cap, usable = true;
    const records = { scenario, model: 'gpt-live-1', sessionCreates: 0, externalModelCalls: 0, errors: [], turns: [], violations: [], delegated: 0, opening: false };
    const transcript = { CANDIDATE: '', TARA: '' };
    const questionObserved = output => (auditTopic ? /alamat|pengiriman|validasi/iu : /python/iu).test(output) &&
        /\?|\b(?:ceritain|jelasin|gimana|bagian mana|bagian yang)\b/iu.test(output);
    const fragments = [], control = structured && startRoleVoice(topics), appended = new Set(), commands = [], reflectedSpeech = [];
    let reflectedEnd = -1;
    let lastCandidateSpeech;
    let billedFrom, usage;
    function steer(key, content, kind = 'instructions', delegation = null) {
        if (appended.has(key)) return;
        appended.add(key);
        channel.send({ type: 'session.'+kind+'.append', event_id:key, delegation_id:delegation, content });
        if (audit) commands.push({ key, kind, epoch: Date.now() });
    }
    async function wait(test, reason, max = 12_000) {
        const until = Date.now() + max;
        while (usable && Date.now() < until) {
            const result = await test();
            if (result) return result;
            await sleep(50);
        }
        throw Error(reason);
    }
    function speechEvidence(marker, now, windows, from) {
        const elapsed = value => Math.round(value - marker.start);
        const final = marker.yieldAt ?? marker.end;
        const output = windows.slice(marker.index).filter(row => row.start >= marker.start).map(row => ({
            onsetMs: elapsed(row.start), endMs: row.end === undefined ? null : elapsed(row.end),
        }));
        return { finalSpeechEndMs: elapsed(final), output, playbackQuietMs: Math.round(now - (windows.at(-1)?.end ?? now)),
            whileCandidateHadFloor: output.filter(row => row.onsetMs < elapsed(final) - 100).length,
            transcript: fragments.slice(from).map(({ speaker, text, startMs, endMs, arrived }) =>
                ({ speaker, text, startMs, endMs, arrivalMs: elapsed(arrived - marker.epoch) })),
            providerOutput: reflectedSpeech.filter(row => row.arrived >= marker.epoch + marker.start).map(row => ({
                startMs: row.startMs, endMs: row.endMs, firstArrivalMs: elapsed(row.arrived - marker.epoch),
            })),
            serverCommandsDuringAnswer: commands.filter(row => row.epoch >= marker.epoch + marker.start && row.epoch <= marker.epoch + final),
        };
    }
    async function auditTurn(index, holdFloor) {
        const from = fragments.length;
        const offTopic = scenario === 'redirect' || mixedAnswers && index === 1;
        const marker = await page.evaluate(({ index, offTopic, holdFloor, repairFixture }) => {
            const { ac, dest, inputs, windows } = window.probe, source = ac.createBufferSource();
            source.buffer = inputs[index];
            source.loop = offTopic && !window.probe.protectedPlayback;
            source.connect(dest);
            const pcm = source.buffer.getChannelData(0);
            let last = pcm.length - 1;
            while (last > 0 && Math.abs(pcm[last]) < .008) last--;
            const start = performance.now(), duration = offTopic && !window.probe.protectedPlayback ? repairFixture ? 7600 : 16_000 : last * 1000 / source.buffer.sampleRate;
            const end = start + duration;
            const marker = { start, end, index: windows.length, epoch: performance.timeOrigin };
            window.probe.auditInput = marker;
            source.start();
            if (source.loop) {
                source.stop(ac.currentTime + duration / 1000);
                if (!holdFloor) {
                    const watch = setInterval(() => {
                        if (performance.now() >= end) { clearInterval(watch); return; }
                        if (!windows.slice(marker.index).some(row => row.start >= start)) return;
                        marker.yieldAt = performance.now();
                        source.stop();
                        clearInterval(watch);
                    }, 20);
                }
            }
            return marker;
        }, { index, offTopic, holdFloor, repairFixture: recovery && index === 0 });
        const label = !offTopic ? [process.env.TARA_AUDIT_PAUSE_1 ?? '840 ms pause', process.env.TARA_AUDIT_PAUSE_2 ?? '120 ms pause'][index]
            : protectedPlayback ? 'off-topic answer ends naturally' : holdFloor ? 'candidate kept speaking' : 'candidate yielded';
        const collect = () => page.evaluate(() => ({ marker: window.probe.auditInput, now: performance.now(), windows: window.probe.windows,
            dropped: window.probe.dropped }));
        let snapshot;
        try {
            if (recovery && index === 0) {
                await sleep(5200);
                steer('audit-cut-redirect', 'Untuk fixture uji berikut, ucapkan hanya “Gue tarik balik ke validasi alamat pengiriman ya.” Tunggu arahan berikutnya sebelum bertanya.', 'instructions');
            }
            // Watch for subsequent audio after an isolated acknowledgment or truncated redirect.
            await wait(async () => {
                snapshot = await collect();
                const final = snapshot.marker.yieldAt ?? marker.end;
                if (protectedPlayback) {
                    const dropped = snapshot.dropped.some(at => at >= marker.start);
                    const responded = snapshot.windows.slice(marker.index).some(row => row.start >= final);
                    if (dropped && !responded && snapshot.now >= final + 5200)
                        steer('probe-recover-output-' + index, roleRedirectQuestion(topics[0]), 'commentary');
                    const firstHeard = snapshot.windows.slice(marker.index).find(row => row.start >= final);
                    const heardText = fragments.slice(from).filter(row => row.speaker === 'TARA' && firstHeard &&
                        row.arrived - marker.epoch >= firstHeard.start - 700).map(row => row.text).join('');
                    if (!responded || (offTopic ? !questionObserved(heardText) : !/\?/u.test(heardText))) return false;
                }
                if (recovery && index === 0) {
                    const { now, windows } = snapshot;
                    const delivery = { firstAudible: windows[0]?.start, sequence: 0, windows: windows.filter(row => row.end !== undefined)
                        .map(row => ({ start: row.start, end: row.end + 100 })),
                        open: windows.at(-1)?.end === undefined ? windows.at(-1)?.start : undefined };
                    const action = stepRoleVoice(control, topics, fragments, delivery, windows[0].start, now, false,
                        lastCandidateSpeech === undefined ? undefined : lastCandidateSpeech - marker.epoch);
                    if (action === 'REDIRECT') steer('audit-repair', roleRedirectQuestion(topics[0]), 'commentary');
                    if (now < final + 13_000 && (control.slots[0].redirect?.pending || !control.slots[0].questionRefs.length)) return false;
                }
                return snapshot.now >= final + 3500 && snapshot.windows.at(-1)?.end !== undefined &&
                    snapshot.now - snapshot.windows.at(-1).end >= 1100;
            }, 'Audit media observation timed out', 31_000);
        } catch (error) {
            records.violations.push(error.message);
        } finally {
            snapshot = await collect().catch(() => snapshot);
            if (snapshot) {
                const evidence = speechEvidence(snapshot.marker, snapshot.now, snapshot.windows, from);
                const firstHeard = snapshot.windows.slice(marker.index).find(row => row.start >= (snapshot.marker.yieldAt ?? marker.end));
                const heardText = firstHeard ? fragments.slice(from).filter(row => row.speaker === 'TARA' &&
                    row.arrived - marker.epoch >= firstHeard.start - 700).map(row => row.text).join('').trim() : '';
                records.turns.push({ label, ...evidence, ...(protectedPlayback ? { heardText, dropped: snapshot.dropped.filter(at => at >= marker.start).length } : {}) });
                if (protectedPlayback && evidence.whileCandidateHadFloor) records.violations.push('Tara audio played before the candidate stopped');
            }
        }
    }
    try {
        const url = (protectedOrigin?.origin ?? 'http://localhost') + '/tara-native-probe';
        await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><audio autoplay></audio>' }));
        await page.goto(url);
        const offer = await page.evaluate(async ({ files, protectedPlayback }) => {
            const ac = new AudioContext(), dest = ac.createMediaStreamDestination(), peer = new RTCPeerConnection();
            const inputs = await Promise.all(files.map(value => ac.decodeAudioData(Uint8Array.from(atob(value), char => char.charCodeAt(0)).buffer)));
            const state = window.probe = { ac, dest, peer, inputs, windows: [], dropped: [], lastSound: 0, track: false, peak: 0, protectedPlayback };
            const idle = ac.createOscillator(), gain = ac.createGain();
            gain.gain.value = 0; idle.connect(gain).connect(dest); idle.start();
            await ac.resume();
            if (protectedPlayback) await ac.audioWorklet.addModule('/audio/tara-turn-playback.js');
            peer.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
            peer.createDataChannel('live-events');
            peer.ontrack = ({ streams, track }) => {
                const remote = streams[0] ?? new MediaStream([track]), player = document.querySelector('audio');
                let playback = remote;
                let meterSource;
                if (protectedPlayback) {
                    const processor = new AudioWorkletNode(ac, 'tara-turn-playback', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
                    const output = ac.createMediaStreamDestination();
                    const remoteSink = new Audio();
                    remoteSink.muted = true;
                    remoteSink.srcObject = remote;
                    void remoteSink.play().catch(error => { state.remoteSinkError = error.name; });
                    state.remoteSink = remoteSink;
                    state.remoteSource = ac.createMediaStreamSource(remote);
                    state.micSource = ac.createMediaStreamSource(dest.stream);
                    state.remoteSource.connect(processor, 0, 0);
                    state.micSource.connect(processor, 0, 1);
                    processor.connect(output);
                    processor.port.onmessage = event => { if (event.data?.type === 'OUTPUT_DROPPED') state.dropped.push(performance.now()); };
                    processor.onprocessorerror = () => { state.processorError = true; };
                    state.processor = processor;
                    state.playbackDestination = output;
                    playback = output.stream;
                    meterSource = processor;
                }
                player.srcObject = playback;
                void player.play().catch(error => { state.playError = error.name; });
                const analyser = ac.createAnalyser();
                analyser.fftSize = 512;
                (meterSource ?? ac.createMediaStreamSource(playback)).connect(analyser);
                const silent = ac.createGain(); silent.gain.value = 0;
                analyser.connect(silent).connect(ac.destination);
                const pcm = new Float32Array(512);
                let start;
                setInterval(() => {
                    analyser.getFloatTimeDomainData(pcm);
                    const level = Math.sqrt(pcm.reduce((sum, x) => sum + x*x, 0) / pcm.length);
                    state.peak = Math.max(state.peak, level);
                    const now = performance.now();
                    if (level >= 0.008) {
                        if (start === undefined) { start = now; state.windows.push({ start }); }
                        state.lastSound = now;
                    } else if (start !== undefined && now-state.lastSound > 420) {
                        state.windows.at(-1).end = state.lastSound;
                        start = undefined;
                    }
                }, 20);
                state.track = true;
            };
            await peer.setLocalDescription(await peer.createOffer());
            for (let i=0; i<30 && peer.iceGatheringState!=='complete'; i++) await new Promise(resolve=>setTimeout(resolve,100));
            return peer.localDescription.sdp;
        }, { files: files.map(file => file.toString('base64')), protectedPlayback });
        const request = createVoiceRequest('marin', offer, topics, structured);
        if (audit && auditInstructions) request.session.instructions = readFileSync(auditInstructions, 'utf8');
        if (audit && process.env.TARA_AUDIT_SAVE_INSTRUCTIONS)
            require('node:fs').writeFileSync(process.env.TARA_AUDIT_SAVE_INSTRUCTIONS, request.session.instructions);
        assert.equal(request.session.delegation.type, 'client');
        cap = setTimeout(() => {
            usable = false;
            if (channel && !closed) try { channel.send({type:'session.close'}); } catch {}
            void page.close().catch(() => {});
        }, audit ? 85_000 : 75_000);
        records.sessionCreates++;
        billedFrom = Date.now();
        const response = await provider.create(request);
        id = response.session.id;
        channel = provider.attach(id, event => {
            if (event.type === 'session.closed') { closed = true; usage = event.usage; }
            if (event.type === 'error' && !closing) records.errors.push(event.error?.code ?? 'unknown');
            if (recovery && event.type === 'session.input_audio.append' && reflectedInputActive(event.audio)) lastCandidateSpeech = Date.now();
            if (audit && event.type === 'session.output_audio.delta' && Number.isInteger(event.start_ms) && event.end_ms > reflectedEnd) {
                reflectedEnd = event.end_ms;
                const pcm = Buffer.from(event.delta, 'base64');
                let power = 0, samples = 0;
                for (let offset = 0; offset + 1 < pcm.length; offset += 8) {
                    power += (pcm.readInt16LE(offset) / 32768) ** 2;
                    samples++;
                }
                if (samples && Math.sqrt(power / samples) >= .008) {
                    const previous = reflectedSpeech.at(-1);
                    if (previous && event.start_ms - previous.endMs <= 160) previous.endMs = event.end_ms;
                    else reflectedSpeech.push({ startMs: event.start_ms, endMs: event.end_ms, arrived: Date.now() });
                }
            }
            if (event.type === 'session.delegation.created') {
                records.delegated++;
                if (structured && event.delegation?.id && !closing) {
                    steer('quiet-'+event.delegation.id, '', 'thinking', event.delegation.id);
                    steer('respond-'+event.delegation.id, 'Tanggapi detail dalam jawaban kandidat sendiri sekarang.', 'instructions', event.delegation.id);
                }
            }
            if (['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type)) {
                const speaker = event.type === 'session.input_transcript.delta' ? 'CANDIDATE' : 'TARA';
                transcript[speaker] += event.delta;
                fragments.push({ id:fragments.length+1,speaker,text:event.delta,startMs:event.start_ms,endMs:event.end_ms,arrived:Date.now() });
            }
        }, () => {});
        await channel.opened;
        await page.evaluate(sdp => window.probe.peer.setRemoteDescription({type:'answer',sdp}), response.transport.sdp);
        await wait(() => page.evaluate(() => window.probe.peer.connectionState==='connected' && window.probe.track), 'Native WebRTC audio track unavailable');
        if (structured) steer('tara-opening',roleVoiceOpening(topics[0]),'commentary');
        else {
            await sleep(1500);
            if (!transcript.TARA && !await page.evaluate(() => window.probe.windows.length > 0))
                steer('tara-opening','Buka interview sekarang dalam bahasa Indonesia dan ajukan pertanyaan pertama dari data wawancara. Setelah pertanyaan, beri kandidat waktu untuk menjawab.','commentary');
        }
        const openingReady = () => page.evaluate(gap => window.probe.windows.some(window => window.end!==undefined) &&
            performance.now()-window.probe.lastSound>gap, audit ? 1500 : 800);
        if (audit) await wait(() => questionObserved(transcript.TARA) && /\?/u.test(transcript.TARA), 'Complete opening question not transcribed', 16_000);
        await wait(openingReady, 'No audible opening question', 18_000);
        records.opening = true;
        if (structured && !/\b(?:gue|gua|saya)\s+Tara\b/iu.test(transcript.TARA)) records.violations.push('Opening audio omitted Tara introduction');
        if (audit) {
            // Both samples use the same model, transport, interview task, and playback meter.
            // Restore the question between samples, then leave turn-taking entirely to Live.
            await auditTurn(0, recovery);
            if (recovery) records.recovery = { sent: commands.some(row => row.key === 'audit-repair'), redirect: control.slots[0].redirect,
                questionsHeard: control.slots[0].questionRefs.length, receivedMicrophoneActivity: lastCandidateSpeech !== undefined };
            if (recovery && !records.recovery.sent) records.violations.push('Recovery fixture did not exercise the repair command');
            if (!oneAuditAnswer) {
                const from = transcript.TARA.length;
                steer('audit-question', topics[0].question, 'commentary');
                await wait(() => questionObserved(transcript.TARA.slice(from)) && /\?/u.test(transcript.TARA.slice(from)), 'Second audit question not observed', 9000);
                await wait(openingReady, 'Second audit question not played', 8000);
                await auditTurn(1, true);
            }
            records.commands = commands;
            assert.deepEqual(records.errors, []);
            assert.deepEqual(records.violations, []);
            return;
        }
        for (let i=0; i<(scenario==='latency'?(third?3:2):1); i++) {
            const interruption = scenario === 'interruption' || i===2;
            const previousOutput=transcript.TARA.length;
            const inputStart=transcript.CANDIDATE.length;
            const marker=await page.evaluate(({i,loop})=>{
                const {ac,dest,inputs,windows}=window.probe, source=ac.createBufferSource();
                source.buffer=inputs[i]; source.loop=loop; source.connect(dest);
                const channel=source.buffer.getChannelData(0);
                let last=channel.length-1; while(last>0&&Math.abs(channel[last])<0.008)last--;
                const start=performance.now(), duration=last/source.buffer.sampleRate*1000;
                source.start();
                if(loop)source.stop(ac.currentTime+18);
                return {start,end:start+(loop?18000:duration),index:windows.length};
            },{i,loop:interruption});
            await wait(()=>transcript.CANDIDATE.length>inputStart+12,'Synthetic candidate audio not transcribed');
            const heard=await wait(()=>page.evaluate(marker=>window.probe.windows.slice(marker.index).find(item=>item.start>marker.start),marker),
                'No audible response from Tara',23000);
            const delay=Math.round(heard.start-marker.end);
            const turn={delayMs:delay,response:'',playbackCompleted:false};
            records.turns.push(turn);
            try{
                await wait(()=>transcript.TARA.length>previousOutput+8,'Response audio has no transcript');
                if(!interruption){
                    await wait(()=>page.evaluate(marker=>performance.now()>=marker.end&&window.probe.windows.slice(marker.index).some(item=>item.end!==undefined)&&
                        performance.now()-window.probe.lastSound>800,marker),'Response did not finish',18000);
                    turn.playbackCompleted=true;
                } else if (structured) {
                    await wait(() => {
                        const reply=transcript.TARA.slice(previousOutput);
                        return /python|pemrograman|pipeline|validasi|data/iu.test(reply) && /(?:balik|fokus|kembali|arahin|soal)/iu.test(reply) &&
                            /\?|(?:ceritain|gimana|jelasin|bagian mana|bisa sebutin)\b/iu.test(reply);
                    }, 'Tara did not redirect with a focused question',14000);
                    await wait(()=>page.evaluate(()=>performance.now()-window.probe.lastSound>550),'Interrupted response did not finish',7000);
                    turn.playbackCompleted=true;
                }
            }finally{
                turn.response=transcript.TARA.slice(previousOutput).trim().slice(0,180);
            }
            if(!interruption){
                if(delay < -200 || delay > 1500) records.violations.push('Turn onset outside target: '+delay+' ms');
                const expected=i===0?/python|pipeline|alur data|validasi|nilai kosong|data hilang/i:/sql|kueri|query|duplikat|laporan|total|data asli/i;
                if(!expected.test(turn.response))records.violations.push('Response did not reference the answer on turn '+(i+1));
                if (structured && /^(?:oke[,. ]+)?(?:gue|saya)\s+(?:cek|periksa|coba lihat)\b|^(?:sebentar|tunggu)(?: dulu)?[.!]/iu.test(turn.response))
                    records.violations.push('Response began with a waiting message');
            }else {
                if(delay >= -500) records.violations.push('Tara did not interrupt during the off-topic answer');
            }
            if (structured && records.violations.length) break;
            if (structured && scenario === 'latency' && !interruption && i === 0 && !records.violations.length) {
                const previous = transcript.TARA.length;
                const next = await wait(async () => {
                    const meter = await page.evaluate(() => ({now:performance.now(), windows:window.probe.windows}));
                    const delivery = { firstAudible:meter.windows[0]?.start, sequence:0,
                        windows:meter.windows.filter(row=>row.end!==undefined), open:meter.windows.at(-1)?.end===undefined?meter.windows.at(-1)?.start:undefined };
                    return stepRoleVoice(control,topics,fragments,delivery,meter.windows[0].start,meter.now,false)==='NEXT';
                },'Server could not advance after the first concrete answer',8000);
                if (next) {
                    steer('role-next-instructions','Topik sebelumnya selesai. Bahas satu tugas yang baru saja dipilih server. '+JSON.stringify(topics[control.slot]));
                    steer('role-next',topics[control.slot].question,'commentary');
                }
                await wait(()=>transcript.TARA.length>previous+8&&/SQL|kueri|query/iu.test(transcript.TARA.slice(previous)), 'Next approved topic was not spoken',12000);
                await wait(()=>page.evaluate(()=>performance.now()-window.probe.lastSound>700),'Next question playback was incomplete');
            }
        }
        if (structured && !records.violations.length) {
            const from = transcript.TARA.length;
            steer('role-close-instructions','Sesi sudah masuk penutupan. Setelah salam penutup, hentikan semua pertanyaan.');
            steer('role-close',ROLE_VOICE_CLOSING_TEXT,'commentary');
            await wait(()=>/\b(?:interview|wawancara|sesi)(?: kita)? (?:udah |sudah )?selesai\b/iu.test(transcript.TARA.slice(from)), 'No closing utterance',8500);
            await wait(()=>page.evaluate(()=>performance.now()-window.probe.lastSound>450),'No completed closing playback',5000);
            records.closing = true;
            if (/\?/u.test(transcript.TARA.slice(from))) records.violations.push('Question after closing command');
        }
        assert.equal(records.externalModelCalls,0);
        if (!structured) assert.equal(records.delegated,0);
        assert.deepEqual(records.errors,[]);
        assert.deepEqual(records.violations,[]);
    }finally{
        closing = true;
        if(channel && !closed){try{channel.send({type:'session.close',event_id:'probe-close'});const until=Date.now()+1200;while(!closed&&Date.now()<until)await sleep(40);}catch{}}
        if(id&&!closed){
            records.hangup = await provider.hangup(id).then(() => 'confirmed', () => 'unconfirmed');
            if (records.hangup === 'unconfirmed') records.violations.push('Provider hangup not confirmed');
        }
        clearTimeout(cap);
        if (!page.isClosed()) records.playback = await page.evaluate(async () => {
            const state=window.probe, player=document.querySelector('audio');
            if (!state) return null;
            const reports=Array.from((await state.peer.getStats()).values());
            const inbound=reports.find(row=>row.type==='inbound-rtp'&&row.kind==='audio');
            const jitterBufferMs=inbound?.jitterBufferEmittedCount?Math.round(1000*inbound.jitterBufferDelay/inbound.jitterBufferEmittedCount):null;
            return { windows:state.windows, peak:state.peak, context:state.ac.state, playError:state.playError,
                paused:player.paused, playingSeconds:player.currentTime, packetsReceived:inbound?.packetsReceived,jitterBufferMs,
                processorError:state.processorError, remoteSinkError:state.remoteSinkError, dropped:state.dropped.length };
        }).catch(()=>null);
        channel?.dispose();
        await browser.close();
        console.log(JSON.stringify({...records,closed,openingTranscriptObserved:transcript.TARA.length>0,
            ...(structured ? { outputText:transcript.TARA.slice(0,380), inputText:transcript.CANDIDATE.slice(0,380) } : {}),
            ...(audit ? { providerAudioWindows: reflectedSpeech } : {}),usage,
            elapsedMs:billedFrom?Date.now()-billedFrom:0,reservedUsd:billedFrom?(audit?.085:.075):0}));
    }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
