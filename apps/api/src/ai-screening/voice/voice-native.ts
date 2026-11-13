import { recordTaraOpportunity, startTara, type TaraProgress, type TaraTopic } from '../tara-interview';
import type { Fragment, VoiceTurn } from './voice.policy';
import type { RoleVoiceControl, VoiceControlEvent } from './voice-role';
import { isReadinessCheck } from './voice-redirect';

export const NATIVE_VOICE_VERSION = 'tara-voice-native-v1';
export const NATIVE_STARTUP_MS = 60_000;
export const VOICE_MEDIA_SIGNALS = ['READY', 'PLAYBACK_READY', 'AUDIBLE', 'QUIET', 'INTERRUPTED', 'INPUT_ACTIVE', 'INPUT_QUIET'] as const;
export type MediaSignal = typeof VOICE_MEDIA_SIGNALS[number];
type AudibleWindow = { start: number; end: number; interrupted?: boolean };
export type NativeDelivery = {
    origin?: number;
    firstAudible?: number;
    firstAudioMs?: number;
    readyAt?: number;
    playbackReadyAt?: number;
    clockStartedAt?: number;
    playbackVerified?: boolean;
    droppedOutputs?: number;
    open?: number;
    sequence: number;
    windows: AudibleWindow[];
    shown?: string[];
};
export type NativeProgress = TaraProgress & { nativeDelivery?: NativeDelivery; roleControl?: RoleVoiceControl; voiceControls?: VoiceControlEvent[] };

export function reflectedVoiceSignal(delta: unknown) {
    if (typeof delta !== 'string' || !delta || delta.length > 64_000) return false;
    const pcm = Buffer.from(delta, 'base64');
    let energy = 0;
    let samples = 0;
    for (let offset = 0; offset + 1 < pcm.length; offset += 8) {
        energy += (pcm.readInt16LE(offset) / 32768) ** 2;
        samples++;
    }
    return samples > 0 && energy / samples >= 0.0025 ** 2;
}

export function nativeVoiceTurns(fragments: Fragment[]): VoiceTurn[] {
    const lanes = new Map<string, VoiceTurn[]>();
    const ordered = [...fragments.filter(row => row.speaker === 'TARA'), ...fragments.filter(row => row.speaker === 'CANDIDATE')];
    for (const row of ordered) {
        const turns = lanes.get(row.speaker) ?? [];
        if (!lanes.has(row.speaker)) lanes.set(row.speaker, turns);
        const last = turns.at(-1);
        const gap = row.speaker === 'TARA' ? 650 : 1800;
        const changesQuestion = row.speaker === 'CANDIDATE' && last && lanes.get('TARA')?.some(turn =>
            question(turn.text) && turn.startMs > last.startMs && turn.startMs <= row.startMs);
        if (last && !changesQuestion && row.startMs >= last.startMs && row.startMs - last.endMs <= gap) {
            last.text += row.text;
            last.endMs = Math.max(last.endMs, row.endMs);
            last.fragmentIds.push(row.id);
        } else turns.push({ id: 'v' + row.id, speaker: row.speaker, text: row.text, startMs: row.startMs,
            endMs: row.endMs, fragmentIds: [row.id] });
    }
    return [...lanes.values()].flat().sort((a, b) => a.startMs - b.startMs || a.fragmentIds[0] - b.fragmentIds[0]);
}

const normalized = (text: string) => text.normalize('NFKC').toLowerCase()
    .replace(/[\u2010-\u2015]/gu, '-').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const question = (text: string) => /\?|\b(?:apa yang|bagian mana|gimana|bagaimana|kapan|ceritain|ceritakan|pernah ada|bisa jelasin)\b/iu.test(text);
const redirects = (text: string) => /\b(?:balik (?:dikit|ke|lagi)|tarik balik|fokus ke|gue potong|yang gue tanya)\b/iu.test(text);

export function topicForQuestion(text: string, topics: readonly TaraTopic[]) {
    if (!question(text)) return undefined;
    if (topics.length === 1 && topics[0].alternative)
        return /\b(?:contoh|pengalaman|proyek|kegiatan|tanggung jawab|tugas|bagian)\b/iu.test(text) ? topics[0] : undefined;
    const matches = topics.filter(topic => {
        const label = normalized(topic.label);
        const variants = [...new Set([label, ...[' ', ' dot ', ' titik '].map(separator => label.replace(/(?<=\p{L})\.(?=\p{L})/gu, separator))])];
        return variants.some(name => name && new RegExp(`(?<![\\p{L}\\p{N}+#])(?<![\\p{L}\\p{N}][.-])${escape(name)}(?![\\p{L}\\p{N}+#]|[.-][\\p{L}\\p{N}])`, 'u').test(normalized(text)));
    });
    return matches.length === 1 ? matches[0] : undefined;
}

export function recordMedia(delivery: NativeDelivery, event: MediaSignal, sequence: number, now: number) {
    if (sequence <= delivery.sequence) return false;
    delivery.sequence = sequence;
    if (event === 'READY') delivery.readyAt ??= now;
    else if (event === 'PLAYBACK_READY') delivery.playbackReadyAt ??= now;
    else if (event === 'AUDIBLE') {
        delivery.firstAudible ??= now;
        delivery.open ??= now;
    } else if ((event === 'QUIET' || event === 'INTERRUPTED') && delivery.open !== undefined) {
        if (now > delivery.open && delivery.windows.length < 200)
            delivery.windows.push({ start: delivery.open, end: now, ...(event === 'INTERRUPTED' ? { interrupted: true } : {}) });
        delivery.open = undefined;
    }
    return true;
}

function audible(turn: VoiceTurn, delivery: NativeDelivery, origin: number) {
    return delivery.windows.some(window => origin + turn.startMs >= window.start - 750 &&
        origin + turn.endMs <= window.end + (window.interrupted ? 0 : 350) &&
        origin + turn.endMs > window.start && origin + turn.startMs < window.end &&
        (!window.interrupted || origin + turn.endMs < window.end - 350));
}

export function nativeInterview(topics: TaraTopic[], turns: VoiceTurn[], delivery: NativeDelivery, endedAt: number, interrupted: boolean, direct = false) {
    const progress: NativeProgress = { ...startTara(topics, true), stage: 'DONE', questions: 0, nativeDelivery: delivery,
        endedReason: interrupted ? 'INTERRUPTED' : 'COMPLETE' };
    const firstOutput = turns.find(turn => turn.speaker === 'TARA');
    const firstAudioMs = direct ? delivery.firstAudioMs : delivery.firstAudioMs ?? firstOutput?.startMs;
    const origin = firstAudioMs !== undefined && delivery.firstAudible !== undefined ? delivery.firstAudible - firstAudioMs : delivery.origin;
    const questions = turns.filter(turn => turn.speaker === 'TARA' && question(turn.text) && !(direct && isReadinessCheck(turn.text)));
    const evidenceTurns: VoiceTurn[] = [];
    if (origin === undefined || direct && !delivery.playbackVerified) return { progress, evidenceTurns, origin: endedAt };
    for (const [index, turn] of questions.entries()) {
        const topic = topicForQuestion(turn.text, topics);
        const note = progress.topics.find(state => state.note.topicId === topic?.id)?.note;
        if (!note) continue;
        if (!audible(turn, delivery, origin)) {
            if (!note.questionRefs.length) {
                note.outcome = 'TECHNICAL_INTERRUPTION';
                note.reason = 'DELIVERY_FAILED';
            }
            continue;
        }
        const next = questions[index + 1];
        const answers = turns.filter(answer => answer.speaker === 'CANDIDATE' && answer.startMs >= turn.endMs - 150 &&
            origin + answer.startMs <= endedAt && (!next || answer.endMs <= next.startMs + 150));
        note.questionRefs.push(turn.id);
        note.answerRefs.push(...answers.map(answer => answer.id));
        recordTaraOpportunity(note, { questionRef: turn.id, delivery: 'AUDIO', openedAt: origin + turn.endMs,
            closedAt: Math.max(origin + turn.endMs, next ? Math.min(endedAt, origin + next.startMs) : endedAt),
            connected: true, redirected: note.questionRefs.length > 1 && redirects(turn.text),
            resolution: answers.length ? (next ? 'ANSWERED' : 'CUT_SHORT') : 'INTERRUPTED' });
        note.outcome = answers.length ? 'INCOMPLETE_EXAMPLE' : note.answerRefs.length ? 'INCOMPLETE_EXAMPLE' : 'TECHNICAL_INTERRUPTION';
        note.reason = answers.length ? 'OPPORTUNITY_GIVEN' : 'DELIVERY_FAILED';
        evidenceTurns.push(turn, ...answers);
        progress.questions++;
    }
    return { progress, evidenceTurns, origin };
}
