const workletUrl = '/audio/tara-turn-playback.js?v=2';

export function loadTaraTurnPlayback(context: AudioContext) {
  return context.audioWorklet.addModule(workletUrl);
}

export function taraTurnPlayback(context: AudioContext, onDropped: () => void, onFailure: () => void) {
  const processor = new AudioWorkletNode(context, 'tara-turn-playback', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1,
  });
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const output = context.createGain();
  output.gain.value = 0;
  processor.connect(analyser).connect(output).connect(context.destination);
  let rendered!: () => void;
  const ready = new Promise<void>(resolve => { rendered = resolve; });
  processor.onprocessorerror = onFailure;
  processor.port.onmessage = event => {
    if (event.data?.type === 'RENDERING') rendered();
    if (event.data?.type === 'OUTPUT_DROPPED') onDropped();
  };
  let microphone: MediaStreamAudioSourceNode | undefined;
  let remote: MediaStreamAudioSourceNode | undefined;
  return {
    analyser, ready,
    setVolume(volume: number) { output.gain.value = volume; },
    setMicrophone(stream: MediaStream) {
      microphone?.disconnect();
      microphone = context.createMediaStreamSource(stream);
      microphone.connect(processor, 0, 1);
    },
    setRemote(track: MediaStreamTrack) {
      remote?.disconnect();
      remote = context.createMediaStreamSource(new MediaStream([track]));
      remote.connect(processor, 0, 0);
    },
    dispose() {
      processor.onprocessorerror = null;
      microphone?.disconnect();
      remote?.disconnect();
      processor.disconnect();
      analyser.disconnect();
      output.disconnect();
      processor.port.close();
    },
  };
}
