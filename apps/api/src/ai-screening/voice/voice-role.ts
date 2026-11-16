import type { AssessmentLanguage } from '@job-talentio/shared';
import { TARA_LIVE_AUDIO_PROTOCOL } from '@job-talentio/shared';
import { nativeVoiceTurns, NATIVE_VOICE_VERSION, type NativeDelivery } from './voice-native';
import type { Fragment, VoiceTurn } from './voice.policy';

import { isIncompleteQuestion, isReadinessCheck } from './voice-redirect';

export const ROLE_VOICE_VERSION = 'tara-voice-role-v1';
export function isNativeVoice(version: string) {
    return version === ROLE_VOICE_VERSION || version === NATIVE_VOICE_VERSION || version === TARA_LIVE_AUDIO_PROTOCOL;
}
export const ROLE_VOICE_CLOSING_TEXT = 'Makasih udah cerita. Wawancara kita selesai.';
export const ROLE_VOICE_EN_CLOSING_TEXT = 'Thanks for sharing. This concludes our interview.';
const farewellPatterns: Record<AssessmentLanguage, RegExp> = {
    id: /(?:^|[.!?]\s+)wawancara kita selesai[.!]?$/iu,
    en: /(?:^|[.!?]\s+)this concludes our interview[.!]?$/iu,
};
const fullClosingPatterns: Record<AssessmentLanguage, RegExp> = {
    id: /(?:^|(?<=[.!?]))\s*makasih\s+udah\s+cerita\.\s+wawancara\s+kita\s+selesai[.!]?\s*$/iu,
    en: /(?:^|(?<=[.!?]))\s*thanks\s+for\s+sharing\.\s+this\s+concludes\s+our\s+interview[.!]?\s*$/iu,
};

type Slot = { topicId: string; openedAt: number; questionRefs: string[];
    repeated?: Array<{ ref: string; topicId: string }> };
export type RoleVoiceControl = {
    slot: number;
    slots: Slot[];
};
export function roleVoiceTurns(fragments: Fragment[], preserveAnswerTail = false) {
    const turns = nativeVoiceTurns([...fragments].sort((a, b) => a.startMs - b.startMs || a.id - b.id), preserveAnswerTail);
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
    const actualExperience = /\b(?:(?:lo|lu|kamu|anda)\s+(?:(?:udah|sudah)\s+)?pernah\s+[^?\r\n]+|(?:did|have)\s+you\s+(?:ever\s+)?(?:use|used|work with|worked with)\s+[^?\r\n]+)\?/iu;
    return actualExperience.test(text) || /\b(?:apa|bagaimana|gimana|kapan|mengapa|kenapa|siapa|berapa|bagian mana|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|how|why|what|describe)\b/iu.test(text) &&
        (/[?]/u.test(text) || /(?:^|[.!]\s+)(?:(?:jadi|nah|coba|boleh|bisa)(?:\s+(?:lo|lu|kamu))?\s+)?(?:apa yang|gimana|bagaimana|bagian mana|ceritain|ceritakan|jelasin|jelaskan|sebutin|sebutkan|uraikan|how|what|describe)\b/iu.test(text.trim()));
}
const directGenericQuestion = /(?:^|[.!]\s+)\s*(?:(?:gimana|bagaimana) cara (?:lu|lo|kamu) (?:mengerjakan|ngerjain) tugas berikut|(?:gimana|bagaimana)(?: jadinya| caranya)?)\?\s*$/iu;
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

export function heardContinuousTurn(turn: VoiceTurn, delivery: NativeDelivery, origin: number) {
    const start = origin + turn.startMs;
    const end = origin + turn.endMs;
    // A word estimate can fall just outside the metered audio. Confirm the
    // whole utterance against one window for language reminders and farewells.
    if (delivery.windows.some(window => window.interrupted && window.end >= start && window.start < end)) return false;
    return delivery.windows.some(window => {
        if (window.interrupted || window.start >= end || window.end <= start) return false;
        const lag = window.start - start;
        if (lag <= 350) return end <= window.end + 350;
        // The native transcript can lead continuous browser audio. For a later
        // window require its full duration instead of allowing a clipped tail.
        return lag <= 650 && window.end - window.start >= end - start;
    });
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

export function roleVoiceEvidence(fragments: Fragment[], delivery: NativeDelivery, control?: RoleVoiceControl, direct = false, preserveAnswerTail = false) {
    const turns = roleVoiceTurns(fragments, preserveAnswerTail), byId = new Map(fragments.map(fragment => [fragment.id, fragment]));
    const origin = direct && (!delivery.playbackVerified || delivery.firstAudioMs === undefined) ? undefined : playbackOrigin(turns, delivery);
    const repeated = new Map(control?.slots.flatMap(slot => (slot.repeated ?? []).map(row => [row.ref, row.topicId] as const)));
    return { turns, origin, byId, evidence: turns.map(turn => {
        const question = turn.speaker === 'TARA' && (!direct || !(directGenericQuestion.test(turn.text) || isReadinessCheck(turn.text))) &&
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

/** Allows evaluation of the question itself when a preceding recap lacked playback telemetry. */
export function roleAssessmentVoiceEvidence(fragments: Fragment[], delivery: NativeDelivery, preserveAnswerTail = false) {
    const { evidence, origin, byId } = roleVoiceEvidence(fragments, delivery, undefined, true, preserveAnswerTail);
    return evidence.map((turn): RoleVoiceEvidence & { playbackInterrupted?: boolean } => {
        if (!turn.question || origin === undefined) return turn;
        const spans = outputSpans(turn, byId, true);
        if (!spans.length) return turn;
        const start = origin + spans[0].startMs;
        const questionEndMs = Math.max(...spans.map(span => span.endMs));
        const end = origin + questionEndMs;
        const interrupted = delivery.windows.some(window => window.interrupted && window.start < end && window.end >= start);
        const heard = !interrupted && spans.every(span => delivery.windows.some(window => !window.interrupted &&
            origin + span.startMs >= window.start - 350 && origin + span.endMs > window.start && origin + span.endMs <= window.end));
        return { ...turn, heard, questionEndMs, playbackInterrupted: interrupted };
    });
}

function closingSpeech(turn: VoiceTurn, byId: Map<number, Fragment>, language: AssessmentLanguage) {
    const spans = outputSpans(turn, byId, false);
    const text = spans.map(span => span.text).join('');
    const match = fullClosingPatterns[language].exec(text);
    if (!match?.index) return turn;
    const start = match.index + match[0].length - match[0].trimStart().length;
    let end = 0;
    for (const [index, span] of spans.entries()) {
        const previousEnd = end;
        end += span.text.length;
        if (end <= start) continue;
        // Earlier speech may have been interrupted. Use the complete closing
        // only when its first word can be timed separately from that speech.
        if (span.text.slice(0, start - previousEnd).trim()) return turn;
        return { ...turn, startMs: span.startMs, text: text.slice(start),
            fragmentIds: spans.slice(index).map(row => row.id) };
    }
    return turn;
}

export function directFarewellAt(fragments: Fragment[], delivery: NativeDelivery, earliestStartMs = 0, candidateLastSpeechAt?: number,
    language: AssessmentLanguage = 'id', reflectedCandidateSpeechAt?: number) {
    if (delivery.open !== undefined || !delivery.playbackVerified || delivery.firstAudioMs === undefined) return;
    const turns = roleVoiceTurns(fragments);
    const last = turns.at(-1);
    if (last?.speaker !== 'TARA' || !farewellPatterns[language].test(last.text.trim())) return;
    const byId = new Map(fragments.map(row => [row.id, row]));
    const farewell = closingSpeech(last, byId, language);
    if (farewell.startMs < earliestStartMs) return;
    const origin = playbackOrigin(turns, delivery);
    if (origin === undefined) return;
    const startsAt = origin + farewell.startMs;
    if ((candidateLastSpeechAt ?? -Infinity) >= startsAt || (reflectedCandidateSpeechAt ?? -Infinity) >= startsAt) return;
    const heardWholeFarewell = heardContinuousTurn(farewell, delivery, origin);
    for (const turn of turns) {
        if (turn.speaker !== 'CANDIDATE' || turn.endMs <= farewell.startMs) continue;
        if (candidateLastSpeechAt === undefined || !heardWholeFarewell) return;
        if (turn.endMs - farewell.startMs <= 350) continue;
        // When the estimate extends further, require a separately timed, complete
        // farewell and speech measurements from this turn on both input paths.
        const candidateStartsAt = origin + turn.startMs;
        if (fullClosingPatterns[language].exec(farewell.text)?.index !== 0 || candidateLastSpeechAt < candidateStartsAt ||
            reflectedCandidateSpeechAt === undefined || reflectedCandidateSpeechAt < candidateStartsAt) return;
    }
    if (!heardWholeFarewell && !heardRoleSpeech(farewell, delivery, origin, byId)) return;
    return origin + farewell.endMs;
}

export type RoleVoiceEvidence = ReturnType<typeof roleVoiceEvidence>['evidence'][number];
