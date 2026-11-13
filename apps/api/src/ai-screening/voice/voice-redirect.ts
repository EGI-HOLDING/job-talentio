import type { TaraTopic } from '../tara-interview';

export type VoiceRedirect = { ref: string; retriedAt?: number; pending: boolean };
type RedirectSpeech = { id: string; text: string; deliveredQuestion: boolean; interruptedQuestion: boolean };

const redirectLead = /\b(?:(?:balik|kembali)\s+(?:(?:dikit|lagi|sebentar|ya)\s+){0,2}(?:ke|soal)|(?:kita|gue|saya)\s+fokus\s+(?:ke|pada)|let(?:'s| us)\s+(?:get |go )?back to)\b/iu;
const questionOpening = /\b(?:bagian mana|langkah apa|apa(?: yang)?|gimana|bagaimana|kenapa|kapan|berapa|siapa|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|bisa(?:kah)? (?:beri(?:kan)?|kasih)|how did you|which part|describe)\b/iu;
const scaffolding = new Set('aja anda bagian cara coba dan dari detail itu kamu ke lo lu mana nya soal tadi yang a about did of that the to you your'.split(' '));
export const CANDIDATE_PAUSE_MS = 1800;
export const REDIRECT_RETRY_WINDOW_MS = 8000;

export function droppedOutputRecoveryAt(dropped: number, lastCandidateSpeechAt: number) {
    return Math.max(dropped + 4500, lastCandidateSpeechAt + 3500);
}

export function reflectedInputActive(audio: unknown) {
    if (typeof audio !== 'string' || !audio || audio.length > 64_000) return false;
    const pcm = Buffer.from(audio, 'base64');
    let energy = 0, count = 0;
    for (let i = 0; i + 1 < pcm.length; i += 12) {
        energy += (pcm.readInt16LE(i) / 32768) ** 2;
        count++;
    }
    return count > 0 && energy / count >= .008 ** 2;
}

function hasFocusedRequest(text: string) {
    return text.split(/(?<=[?!.])\s+/u).some(clause => {
        const opening = questionOpening.exec(clause);
        if (!opening || /(?:\.{3}|[…–—-])\s*$/u.test(clause)) return false;
        const words = clause.slice(opening.index + opening[0].length).match(/[\p{L}\p{N}+#]+/gu) ?? [];
        return words.some(word => (word.length >= 3 || /^[A-Z0-9+#]{2,}$/u.test(word)) && !scaffolding.has(word.toLowerCase()));
    });
}

export function trackVoiceRedirect(previous: VoiceRedirect | undefined, speech: RedirectSpeech): VoiceRedirect | undefined {
    const lead = redirectLead.test(speech.text.trim());
    if (!previous?.pending && !lead && !speech.interruptedQuestion) return previous;
    if (speech.deliveredQuestion && hasFocusedRequest(speech.text))
        return { ref: speech.id, retriedAt: previous?.retriedAt, pending: false };
    if (previous?.pending) return previous;
    return { ref: speech.id, retriedAt: previous?.retriedAt, pending: true };
}

export function isIncompleteQuestion(text: string) {
    return questionOpening.test(text) && !hasFocusedRequest(text);
}

export function planVoiceRedirect(state: VoiceRedirect | undefined, now: number, quietSince: number, timeLeft: number) {
    if (!state?.pending || state.retriedAt !== undefined || now - quietSince < CANDIDATE_PAUSE_MS || timeLeft < REDIRECT_RETRY_WINDOW_MS + 1000) return false;
    state.retriedAt = now;
    return true;
}

export function roleRedirectQuestion(topic: Pick<TaraTopic, 'label' | 'question'>) {
    const source = topic.question.replace(/\s+/gu, ' ').trim();
    const duty = topic.label.replace(/\s+/gu, ' ').replace(/[.!?]+$/u, '').trim();
    return source.endsWith('?') ? source : `Untuk tugas “${duty}”, apa langkah yang bakal lu ambil?`;
}
