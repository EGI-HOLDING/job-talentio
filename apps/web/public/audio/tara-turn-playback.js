/* Keep the microphone live while deciding which remote audio can play. */
class TaraTurnPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.delay = Math.ceil(sampleRate * 0.16);
    this.buffer = new Float32Array(this.delay);
    this.position = 0;
    this.frames = 0;
    this.lastVoice = -Infinity;
    this.lastTara = -Infinity;
    this.discard = false;
    this.noiseFloor = 0.002;
    this.previousLevel = 0;
    this.stableWindows = 0;
    this.voiceWindows = 0;
    this.micEnergy = 0;
    this.micSamples = 0;
    this.calibrationSamples = 0;
  }

  level(samples) {
    if (!samples?.length) return 0;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    return Math.sqrt(energy / samples.length);
  }

  observeMicrophone(samples, now) {
    if (!samples?.length) return;
    for (const sample of samples) this.micEnergy += sample * sample;
    this.micSamples += samples.length;
    if (this.micSamples < sampleRate * 0.02) return;

    const level = Math.sqrt(this.micEnergy / this.micSamples);
    this.micEnergy = 0;
    this.calibrationSamples += this.micSamples;
    this.micSamples = 0;
    const steady = Math.abs(level - this.previousLevel) <= Math.max(0.0005, level * 0.12);
    this.previousLevel = level;
    this.stableWindows = steady ? this.stableWindows + 1 : 0;
    const calibrating = this.calibrationSamples < sampleRate * 0.32;
    const threshold = Math.max(0.005, this.noiseFloor * 2.5);
    if (level < threshold || level <= 0.025 && (calibrating || this.stableWindows >= 16)) {
      this.noiseFloor += (Math.min(level, 0.025) - this.noiseFloor) * 0.18;
    }
    // Single loud render blocks and steady background hum are not a turn.
    this.voiceWindows = !calibrating && level >= Math.max(0.005, this.noiseFloor * 2.5) ? this.voiceWindows + 1 : 0;
    if (this.voiceWindows >= 2) this.lastVoice = now;
  }

  process(inputs, outputs) {
    const remote = inputs[0]?.[0];
    const microphone = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (this.frames === 0) this.port.postMessage({ type: 'RENDERING' });
    const tara = this.level(remote) >= 0.003;
    const now = this.frames / sampleRate;
    this.observeMicrophone(microphone, now);
    const candidateHasFloor = now - this.lastVoice < 1.8;

    // Drop a premature response through its next quiet boundary so playback
    // never resumes halfway through the discarded sentence.
    if (this.discard && now - this.lastTara >= 0.5) this.discard = false;
    if (candidateHasFloor && (tara || now - this.lastTara < 0.16) && !this.discard) {
      this.buffer.fill(0);
      this.discard = true;
      this.port.postMessage({ type: 'OUTPUT_DROPPED' });
    }
    if (tara) this.lastTara = now;

    for (let i = 0; i < output.length; i++) {
      output[i] = this.buffer[this.position];
      this.buffer[this.position] = this.discard || candidateHasFloor ? 0 : remote?.[i] ?? 0;
      this.position = (this.position + 1) % this.delay;
    }
    this.frames += output.length;
    return true;
  }
}

registerProcessor('tara-turn-playback', TaraTurnPlayback);
