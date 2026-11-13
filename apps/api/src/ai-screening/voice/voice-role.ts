import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { nativeVoiceTurns, NATIVE_VOICE_VERSION, type NativeDelivery } from './voice-native';
import type { Fragment, VoiceTurn } from './voice.policy';

import { isIncompleteQuestion } from './voice-redirect';

export const ROLE_VOICE_VERSION = 'tara-voice-role-v1';
export function isNativeVoice(version: string) {
    return version === ROLE_VOICE_VERSION || version === NATIVE_VOICE_VERSION || version === TARA_LIVE_AUDIO_PROTOCOL;
}
export const ROLE_VOICE_CLOSING_TEXT = 'Makasih udah cerita. Wawancara kita selesai.';

type Slot = { topicId: string; openedAt: number; questionRefs: string[];
    repeated?: Array<{ ref: string; topicId: string }> };
export type RoleVoiceControl = {
    slot: number;
    slots: Slot[];
};
export type VoiceControlEvent = { key: string; sentAt: number; acknowledgedAt?: number };

export function roleVoiceTurns(fragments: Fragment[]) {
    const turns = nativeVoiceTurns([...fragments].sort((a, b) => a.startMs - b.startMs || a.id - b.id));
    const grouped: VoiceTurn[] = [];
    for (const turn of turns) {
        const prior = grouped.at(-1);
        if (prior?.speaker === 'TARA' && turn.speaker === 'TARA' && turn.startMs - prior.endMs <= 1600) {
            prior.text = prior.text.trimEnd() + ' ' + turn.text.trimStart();
            prior.endMs = Math.max(prior.endMs, turn.endMs);
            prior.fragmentIds.push(...turn.fragmentIds);
        } else grouped.push({ ...turn, fragmentIds: [...turn.fragmentIds] });
    }
    return grouped;
}

function isQuestion(text: string) {
    return /\b(?:apa|bagaimana|gimana|kapan|mengapa|kenapa|siapa|berapa|bagian mana|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|how|why|what|describe)\b/iu.test(text) &&
        (/[?]/u.test(text) || /(?:^|[.!]\s+)(?:jadi\s+|nah\s+)?(?:apa yang|gimana|bagaimana|bagian mana|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|how|what|describe)\b/iu.test(text.trim()));
}
const directGenericQuestion = /(?:^|[.!]\s+)\s*(?:(?:gimana|bagaimana) cara (?:lu|lo|kamu) (?:mengerjakan|ngerjain) tugas berikut|(?:gimana|bagaimana)(?: jadinya| caranya)?|(?:lu|lo|kamu) (?:udah |sudah )?siap)\?\s*$/iu;
function outputSpans(turn: VoiceTurn, byId: Map<number, Fragment>, question: boolean) {
    const rows = turn.fragmentIds.flatMap(id => byId.get(id) ?? []);
    if (!question) return rows;
    const text = rows.map(row => row.text).join('');
    const end = text.lastIndexOf('?');
    if (end < 0) return rows;
    const start = [...text.slice(0, end).matchAll(/(?<!\.)[.!?]\s+(?=\p{L})/gu)].at(-1);
    const from = start && isQuestion(text.slice(start.index + start[0].length, end + 1)) ? start.index + start[0].length : 0;
    let offset = 0;
    return rows.filter(row => {
        const spanStart = offset;
        offset += row.text.length;
        return offset > from && spanStart < end && /[\p{L}\p{N}]/u.test(row.text);
    });
}

export function playbackOrigin(turns: VoiceTurn[], delivery: NativeDelivery) {
    const first = turns.find(turn => turn.speaker === 'TARA');
    const startMs = delivery.firstAudioMs ?? first?.startMs;
    return startMs !== undefined && delivery.firstAudible !== undefined ? delivery.firstAudible - startMs : undefined;
}

// A quiet gap can split the playback meter window even though all spoken words
// are covered. Check the source intervals up to the question boundary, rather
// than requiring one window to contain an entire recap and follow-up.
export function heardRoleSpeech(turn: VoiceTurn, delivery: NativeDelivery, origin: number, byId: Map<number, Fragment>, question = false) {
    const spans = outputSpans(turn, byId, question);
    if (!spans.length) return false;
    const start = origin + spans[0].startMs;
    const end = origin + spans.at(-1)!.endMs;
    const windows = delivery.windows.filter(row => row.end > start - 350 && row.start < end + 350);
    if (!windows.length || windows.some(row => row.interrupted && row.end >= start && row.end < end + 350)) return false;
    return spans.every(span => windows.some(window => origin + span.endMs > window.start && origin + span.startMs < window.end &&
        origin + span.startMs >= window.start - 350 && origin + span.endMs <= window.end + (window.interrupted ? -350 : 350)));
}

export function roleVoiceEvidence(fragments: Fragment[], delivery: NativeDelivery, control?: RoleVoiceControl, direct = false) {
    const turns = roleVoiceTurns(fragments), byId = new Map(fragments.map(fragment => [fragment.id, fragment]));
    const origin = direct && (!delivery.playbackVerified || delivery.firstAudioMs === undefined) ? undefined : playbackOrigin(turns, delivery);
    const repeated = new Map(control?.slots.flatMap(slot => (slot.repeated ?? []).map(row => [row.ref, row.topicId] as const)));
    return { turns, origin, byId, evidence: turns.map(turn => {
        const question = turn.speaker === 'TARA' && (!direct || !directGenericQuestion.test(turn.text)) &&
            (direct && /\?\s*$/u.test(turn.text) || isQuestion(turn.text) && !isIncompleteQuestion(turn.text));
        const questionEndMs = question && !direct ? outputSpans(turn, byId, true).at(-1)?.endMs ?? turn.endMs : turn.endMs;
        const audible = turn.speaker === 'TARA' && origin !== undefined && heardRoleSpeech(turn, delivery, origin, byId, question && !direct);
        const heard = question && (audible || !direct && turn.fragmentIds.every(id => {
            const eventId = byId.get(id)?.eventId;
            return eventId !== undefined && delivery.shown?.includes(eventId);
        }));
        const slot = control?.slots.filter(slot => slot.questionRefs.includes(turn.id)).at(-1) ??
            (origin === undefined ? undefined : control?.slots.filter(slot => slot.openedAt <= origin + turn.startMs + 150).at(-1));
        return { ...turn, question, questionEndMs, heard, audible, topicId: repeated.get(turn.id) ?? slot?.topicId };
    }) };
}

export function directFarewellAt(fragments: Fragment[], delivery: NativeDelivery) {
    if (delivery.open !== undefined || !delivery.playbackVerified || delivery.firstAudioMs === undefined) return;
    const turns = roleVoiceTurns(fragments);
    const farewell = turns.at(-1);
    if (farewell?.speaker !== 'TARA' || !/(?:^|[.!?]\s+)(?:makasih|terima kasih) udah cerita[.!]\s+wawancara kita selesai[.!]?$/iu.test(farewell.text.trim())) return;
    if (turns.some(turn => turn.speaker === 'CANDIDATE' && turn.endMs >= farewell.endMs)) return;
    const origin = playbackOrigin(turns, delivery);
    if (origin === undefined || !heardRoleSpeech(farewell, delivery, origin, new Map(fragments.map(row => [row.id, row])))) return;
    return origin + farewell.endMs;
}

export type RoleVoiceEvidence = ReturnType<typeof roleVoiceEvidence>['evidence'][number];
