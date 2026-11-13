export function taraTurnPlayback(context: AudioContext, onDropped: () => void, onFailure: () => void) {
  const processor = new AudioWorkletNode(context, 'tara-turn-playback', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1,
  });
  const destination = context.createMediaStreamDestination();
  processor.connect(destination);
  processor.onprocessorerror = onFailure;
  processor.port.onmessage = event => {
    if (event.data?.type === 'OUTPUT_DROPPED') onDropped();
  };
  let microphone: MediaStreamAudioSourceNode | undefined;
  let remote: MediaStreamAudioSourceNode | undefined;
  // Chromium may not feed a remote WebRTC track to Web Audio until an
  // HTMLMediaElement is attached. Only the processed stream is audible.
  const remoteSink = new Audio();
  remoteSink.muted = true;

  return {
    stream: destination.stream,
    setMicrophone(stream: MediaStream) {
      microphone?.disconnect();
      microphone = context.createMediaStreamSource(stream);
      microphone.connect(processor, 0, 1);
    },
    setRemote(stream: MediaStream) {
      remote?.disconnect();
      remoteSink.srcObject = stream;
      remote = context.createMediaStreamSource(stream);
      remote.connect(processor, 0, 0);
    },
    play() { return remoteSink.srcObject ? remoteSink.play() : undefined; },
    dispose() {
      remoteSink.pause();
      remoteSink.srcObject = null;
      microphone?.disconnect();
      remote?.disconnect();
      processor.disconnect();
      processor.port.close();
      destination.stream.getTracks().forEach(track => track.stop());
    },
  };
}
