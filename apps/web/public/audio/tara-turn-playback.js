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
  }

  level(samples) {
    if (!samples?.length) return 0;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    return Math.sqrt(energy / samples.length);
  }

  process(inputs, outputs) {
    const remote = inputs[0]?.[0];
    const microphone = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    const voice = this.level(microphone) >= 0.004;
    const tara = this.level(remote) >= 0.006;
    const now = this.frames / sampleRate;
    const candidateHasFloor = voice || now - this.lastVoice < 1.8;
    if (voice) this.lastVoice = now;

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
