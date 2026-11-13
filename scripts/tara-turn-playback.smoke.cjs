const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.resolve(__dirname, '../apps/web/public/audio/tara-turn-playback.js'), 'utf8');
for (const sampleRate of [44_100, 48_000]) {
  let Playback;
  const events = [];
  class AudioWorkletProcessor {
    port = { postMessage: event => events.push(event.type) };
  }
  vm.runInNewContext(source, {
    sampleRate, AudioWorkletProcessor,
    registerProcessor: (_, processor) => { Playback = processor; },
  });
  function run(microphoneLevel, remoteLevel, seconds) {
    const processor = new Playback();
    const samples = 128;
    const mic = new Float32Array(samples), remote = new Float32Array(samples), out = new Float32Array(samples);
    const result = [];
    events.length = 0;
    for (let offset = 0; offset < sampleRate * seconds; offset += samples) {
      const time = offset / sampleRate;
      for (let i = 0; i < samples; i++) {
        const index = offset + i;
        mic[i] = microphoneLevel(time) * Math.sin(index / sampleRate * Math.PI * 2 * 210);
        remote[i] = remoteLevel(time) * Math.sin(index / sampleRate * Math.PI * 2 * 440);
      }
      assert.equal(processor.process([[remote], [mic]], [[out]]), true);
      result.push({ time, peak: out.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) });
    }
    return { result, events: [...events] };
  }
  for (const micLevel of [0, 0.008, 0.012, 0.02]) {
    const { result, events } = run(() => micLevel, time => time >= 0.8 && time < 2 ? 0.05 : 0, 2.5);
    assert.ok(result.some(frame => frame.peak > 0.045), 'a steady microphone floor must not mute a quiet opening');
    assert.deepEqual(events, ['RENDERING']);
  }
  const overlap = run(time => (time >= .75 && time < 1.45) || (time >= 2.1 && time < 2.75) ? .07 : .009,
    time => (time >= 1.6 && time < 3.1) || (time >= 4.8 && time < 5.3) ? .09 : 0, 5.7);
  assert.ok(overlap.result.filter(frame => frame.time < 4.8).every(frame => frame.peak < .0001),
    'a response within a thinking pause stays silent even if it keeps playing during speech');
  assert.ok(overlap.result.some(frame => frame.time > 4.8 && frame.peak > .08), 'a new response plays after the candidate yields');
  assert.deepEqual(overlap.events, ['RENDERING', 'OUTPUT_DROPPED']);
}
console.log('Tara worklet passed at 44.1 and 48 kHz: quiet openings, steady microphone noise, thinking pauses, and resumed playback.');
