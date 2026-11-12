import { inputTrust } from './shared/input-trust';
import { taraVoice } from './shared/tara-voice';
import { taraHumor } from './shared/tara-humor';
import { interviewBoundaries } from './shared/interview-boundaries';

export function createVoiceRequest(input: { model: string; reasoningModel: string; voice: string }, sdp: string) {
    const instructions = [inputTrust, taraVoice, taraHumor, interviewBoundaries,
        'Kanal ini mendengarkan suara kandidat untuk transkripsi wawancara. Aplikasi menyampaikan pertanyaan melalui pemutar tersendiri. Tetap diam selama sesi dan jangan mulai percakapan atau mendelegasikan tugas.',
    ].join('\n\n');
    return {
        session: {
            model: input.model, store: false, instructions,
            input: [{ role: 'developer', content: [{ type: 'input_text', text: 'Dengarkan untuk transkripsi.' }] }],
            audio: { output: { voice: input.voice } },
            client: { data_channel: { allowed_client_events: [],
                allowed_server_events: ['session.input_transcript.delta', 'session.closed', 'error'].map(type => ({ type })) } },
            delegation: { type: 'responses', responses: { model: input.reasoningModel,
                instructions: 'Gunakan hanya pertanyaan yang diizinkan server. Jangan memilih topik atau memberi jawaban.',
                max_output_tokens: 700, reasoning: { effort: 'low' } } },
        },
        transport: { type: 'webrtc', sdp },
    };
}
