export type AudioActivity = { source: 'tara' | 'candidate'; active: boolean; at: number; interrupted?: boolean };

export function observeVoiceAudio(
    player: HTMLAudioElement,
    microphone: () => MediaStream | null,
    connected: () => boolean,
    observeInput: () => boolean,
    report: (activity: AudioActivity) => void,
) {
    let context: AudioContext;
    try { context = new AudioContext(); } catch { return () => {}; }
    const tara = context.createAnalyser();
    const candidate = context.createAnalyser();
    tara.fftSize = candidate.fftSize = 1024;
    const samples = new Float32Array(tara.fftSize);
    let remoteStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    let remoteSource: MediaStreamAudioSourceNode | undefined;
    let micSource: MediaStreamAudioSourceNode | undefined;
    let audible = false;
    let lastOutput = 0;
    let inputActive: boolean | undefined;
    let lastInput = performance.now();
    let inputReportedAt = 0;

    function monitor(stream: MediaStream | null, analyser: AnalyserNode, previous?: MediaStreamAudioSourceNode) {
        previous?.disconnect();
        if (!stream?.getAudioTracks().length) return;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        return source;
    }

    function level(analyser: AnalyserNode) {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        return Math.sqrt(energy / samples.length);
    }

    function sample() {
        if (context.state !== 'running') {
            if (audible) {
                audible = false;
                report({ source: 'tara', active: false, at: performance.now(), interrupted: true });
            }
            inputActive = undefined;
            lastInput = performance.now();
            return;
        }
        const remote = player.srcObject instanceof MediaStream ? player.srcObject : null;
        const mic = microphone();
        if (remote !== remoteStream) { remoteSource = monitor(remote, tara, remoteSource); remoteStream = remote; }
        if (mic !== micStream) {
            micSource = monitor(mic, candidate, micSource);
            micStream = mic;
            inputActive = undefined;
            lastInput = performance.now();
        }
        const now = performance.now();
        const playable = connected() && remoteSource && !player.paused && !player.muted && player.volume > 0 &&
            player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && remote?.getAudioTracks().some(track => track.readyState === 'live' && !track.muted);
        if (playable && level(tara) * player.volume >= 0.0025) {
            lastOutput = now;
            if (!audible) report({ source: 'tara', active: true, at: now });
            audible = true;
        } else if (audible && (!playable || now - lastOutput >= 500)) {
            audible = false;
            report({ source: 'tara', active: false, at: playable ? lastOutput : now, interrupted: !playable });
        }

        if (!connected() || !micSource || !observeInput()) { inputActive = undefined; lastInput = now; return; }
        if (mic?.getAudioTracks().some(track => track.enabled && !track.muted && track.readyState === 'live') && level(candidate) >= 0.003) {
            lastInput = now;
            if (inputActive !== true || now - inputReportedAt >= 2000) {
                report({ source: 'candidate', active: true, at: now });
                inputReportedAt = now;
            }
            inputActive = true;
        } else if (now - lastInput >= 750 && (inputActive !== false || now - inputReportedAt >= 2000)) {
            inputActive = false;
            report({ source: 'candidate', active: false, at: now });
            inputReportedAt = now;
        }
    }

    // The media element owns playback. Both analyser nodes are read-only branches.
    const timer = setInterval(() => { try { sample(); } catch { /* Browser diagnostics are best effort. */ } }, 40);
    void context.resume().catch(() => undefined);
    return () => {
        clearInterval(timer);
        remoteSource?.disconnect();
        micSource?.disconnect();
        void context.close().catch(() => undefined);
    };
}
