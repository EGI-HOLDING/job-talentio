// Explicitly billed, at most one GPT-Live session per invocation. Synthetic WAVs only.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const scenario = process.argv[2];
assert.equal(process.env.TARA_PAID_AUDIO_PROBE, '1');
assert.ok(['latency', 'interruption'].includes(scenario));
const wav = readFileSync(process.env.TARA_SYNTHETIC_WAV);
const second = scenario === 'latency' && process.env.TARA_SYNTHETIC_WAV_2 ? readFileSync(process.env.TARA_SYNTHETIC_WAV_2) : wav;
const third = process.env.TARA_SYNTHETIC_WAV_3 ? readFileSync(process.env.TARA_SYNTHETIC_WAV_3) : null;
const files = [wav, second, ...(third ? [third] : [])];
for (const file of files) assert.ok(file.length < 2 * 1024 * 1024 && file.toString('ascii', 0, 4) === 'RIFF');
if (!process.env.OPENAI_API_KEY) process.loadEnvFile('.env');
assert.ok(process.env.OPENAI_API_KEY, 'Provider key missing');

const runtime = process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/egi_i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = createRequire(resolve(runtime, 'playwright/package.json'))('playwright');
const api = resolve('apps/api/dist/ai-screening');
const { VoiceProvider } = require(api + '/voice/voice.provider');
const { createVoiceRequest } = require(api + '/prompts/voice-session');
const provider = new VoiceProvider({ get: key => process.env[key] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const topics = [
        { id: 'python', criterionId: 'task', label: 'Python', question: 'Soal Python, bisa ceritain contoh tugas yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] },
        { id: 'sql', criterionId: 'task', label: 'SQL', question: 'Soal SQL, bagian mana yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] },
        ...(third ? [{ id: 'docker', criterionId: 'task', label: 'Docker', question: 'Soal Docker, bagian mana yang lu kerjain sendiri?', fields: ['TASK', 'ACTION'] }] : []),
    ];
    const browser = await chromium.launch({ headless: true, executablePath: process.env.TARA_PROBE_CHROME,
        args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    let id, channel, closed = false, closing = false, cap, usable = true;
    const records = { scenario, model: 'gpt-live-1', sessionCreates: 0, externalModelCalls: 0, errors: [], turns: [], violations: [], delegated: 0, opening: false };
    const transcript = { CANDIDATE: '', TARA: '' };
    async function wait(test, reason, max = 12_000) {
        const until = Date.now() + max;
        while (usable && Date.now() < until) {
            const result = await test();
            if (result) return result;
            await sleep(50);
        }
        throw Error(reason);
    }
    try {
        await page.route('http://localhost/tara-native-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><audio autoplay></audio>' }));
        await page.goto('http://localhost/tara-native-probe');
        const offer = await page.evaluate(async files => {
            const ac = new AudioContext(), dest = ac.createMediaStreamDestination(), peer = new RTCPeerConnection();
            const inputs = await Promise.all(files.map(value => ac.decodeAudioData(Uint8Array.from(atob(value), char => char.charCodeAt(0)).buffer)));
            const state = window.probe = { ac, dest, peer, inputs, windows: [], lastSound: 0, track: false };
            const idle = ac.createOscillator(), gain = ac.createGain();
            gain.gain.value = 0; idle.connect(gain).connect(dest); idle.start();
            await ac.resume();
            peer.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
            peer.createDataChannel('live-events');
            peer.ontrack = ({ streams, track }) => {
                const remote = streams[0] ?? new MediaStream([track]), player = document.querySelector('audio');
                player.srcObject = remote;
                void player.play().catch(() => {});
                const analyser = ac.createAnalyser();
                analyser.fftSize = 512;
                ac.createMediaStreamSource(remote).connect(analyser);
                const pcm = new Float32Array(512);
                let start;
                setInterval(() => {
                    analyser.getFloatTimeDomainData(pcm);
                    const level = Math.sqrt(pcm.reduce((sum, x) => sum + x*x, 0) / pcm.length);
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
        }, files.map(file => file.toString('base64')));
        const request = createVoiceRequest('marin', offer, topics);
        assert.deepEqual(request.session.delegation, { type:'client' });
        cap = setTimeout(() => {
            usable = false;
            if (channel && !closed) try { channel.send({type:'session.close'}); } catch {}
            void page.close().catch(() => {});
        }, 75_000);
        records.sessionCreates++;
        const response = await provider.create(request);
        id = response.session.id;
        channel = provider.attach(id, event => {
            if (event.type === 'session.closed') closed = true;
            if (event.type === 'error' && !closing) records.errors.push(event.error?.code ?? 'unknown');
            if (event.type === 'session.delegation.created') records.delegated++;
            if (event.type === 'session.input_transcript.delta') transcript.CANDIDATE += event.delta;
            if (event.type === 'session.output_transcript.delta') transcript.TARA += event.delta;
        }, () => {});
        await channel.opened;
        await page.evaluate(sdp => window.probe.peer.setRemoteDescription({type:'answer',sdp}), response.transport.sdp);
        await wait(() => page.evaluate(() => window.probe.peer.connectionState==='connected' && window.probe.track), 'Native WebRTC audio track unavailable');
        await sleep(1500);
        if (!transcript.TARA && !await page.evaluate(() => window.probe.windows.length > 0))
            channel.send({ type: 'session.commentary.append', event_id:'tara-opening', delegation_id:null,
                content:'Buka interview sekarang dalam bahasa Indonesia dan ajukan pertanyaan pertama dari data wawancara. Setelah pertanyaan, beri kandidat waktu untuk menjawab.' });
        await wait(() => page.evaluate(() => window.probe.windows.some(window => window.end!==undefined) && performance.now()-window.probe.lastSound>800), 'No audible opening question');
        records.opening = true;
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
                        performance.now()-window.probe.lastSound>800,marker),'Response did not finish');
                    turn.playbackCompleted=true;
                }
            }finally{
                turn.response=transcript.TARA.slice(previousOutput).trim().slice(0,180);
            }
            if(!interruption){
                if(delay < -200 || delay > 1500) records.violations.push('Turn onset outside target: '+delay+' ms');
                const expected=i===0?/python|pipeline|alur data|validasi|nilai kosong|data hilang/i:/sql|kueri|query|duplikat|laporan|total|data asli/i;
                if(!expected.test(turn.response))records.violations.push('Response did not reference the answer on turn '+(i+1));
            }else {
                if(delay >= -500) records.violations.push('Tara did not interrupt during the off-topic answer');
            }
        }
        assert.equal(records.delegated,0);
        assert.deepEqual(records.errors,[]);
        assert.deepEqual(records.violations,[]);
    }finally{
        closing = true;
        clearTimeout(cap);
        if(channel && !closed){try{channel.send({type:'session.close'});const until=Date.now()+1200;while(!closed&&Date.now()<until)await sleep(40);}catch{}}
        if(id&&!closed)await provider.hangup(id).catch(()=>{});
        channel?.dispose();
        await browser.close();
        console.log(JSON.stringify({...records,closed,openingTranscriptObserved:transcript.TARA.length>0}));
    }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
