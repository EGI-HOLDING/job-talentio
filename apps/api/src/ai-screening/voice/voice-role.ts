import { TARA_FIRST_PASS_MS, TOPIC_MS, type TaraTopic } from '../tara-interview';
import { nativeVoiceTurns, NATIVE_VOICE_VERSION, type NativeDelivery } from './voice-native';
import type { Fragment, VoiceTurn } from './voice.policy';
import { taraVerbalStop } from './voice-turns';
import { CANDIDATE_PAUSE_MS, isIncompleteQuestion, planVoiceRedirect, REDIRECT_RETRY_WINDOW_MS, trackVoiceRedirect, type VoiceRedirect } from './voice-redirect';

export const ROLE_VOICE_VERSION = 'tara-voice-role-v1';
export function isNativeVoice(version: string) {
    return version === ROLE_VOICE_VERSION || version === NATIVE_VOICE_VERSION;
}
export const ROLE_VOICE_CLOSING_TEXT = 'Makasih udah cerita. Wawancara kita selesai.';
const CLOSE_GRACE_MS = 8_000;

type Slot = { topicId: string; openedAt: number; questionRefs: string[]; refocused?: boolean;
    repeated?: Array<{ ref: string; topicId: string }>; redirect?: VoiceRedirect };
export type RoleVoiceControl = {
    slot: number;
    slots: Slot[];
    close?: { at: number; reason: 'TIME_LIMIT' | 'TARA_FINISHED' | 'CANDIDATE_ENDED' };
};
export type VoiceControlEvent = { key: string; sentAt: number; acknowledgedAt?: number };

export function startRoleVoice(topics: TaraTopic[]): RoleVoiceControl {
    return { slot: 0, slots: topics.slice(0, 1).map(topic => ({ topicId: topic.id, openedAt: 0, questionRefs: [] })) };
}

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
const signoff = (text: string) => /\b(?:(?:interview|wawancara|sesi)(?: kita)? (?:sudah |udah |telah )?(?:selesai|berakhir)|(?:kita|gue|saya) (?:akhiri|tutup)(?: wawancara| interview| sesi)? (?:sampai di sini|sekarang))\b/iu.test(text) &&
    !/\b(?:kalau|bila|kapan)\s+(?:interview|wawancara|sesi)\b/iu.test(text);

const questionWords = new Set('apa apakah bagaimana gimana kenapa mengapa kapan berapa siapa mana bisa boleh lu lo kamu anda tadi sudah udah jelasin jelaskan ceritain ceritakan tentang itu ini yang cara pernah tolong coba bagian dan atau'.split(' '));
function questionTerms(text: string) {
    const mark = text.lastIndexOf('?');
    const question = (mark >= 0 ? text.slice(0, mark) : text).trimEnd();
    const clauses = question.normalize('NFKC').toLowerCase().trim().split(/[!?.]\s+/u);
    return new Set((clauses.at(-1)?.match(/[\p{L}\p{N}+#]+/gu) ?? []).filter(word => !questionWords.has(word)));
}

function repeatedQuestion(text: string, previous: string) {
    const a = questionTerms(text), b = questionTerms(previous);
    return Math.min(a.size, b.size) >= 2 && [...a].filter(word => b.has(word)).length / Math.max(a.size, b.size) >= .8;
}

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

export function roleVoiceEvidence(fragments: Fragment[], delivery: NativeDelivery, control?: RoleVoiceControl) {
    const turns = roleVoiceTurns(fragments), byId = new Map(fragments.map(fragment => [fragment.id, fragment]));
    const origin = playbackOrigin(turns, delivery);
    const repeated = new Map(control?.slots.flatMap(slot => (slot.repeated ?? []).map(row => [row.ref, row.topicId] as const)));
    return { turns, origin, byId, evidence: turns.map(turn => {
        const question = turn.speaker === 'TARA' && isQuestion(turn.text) && !isIncompleteQuestion(turn.text);
        const questionEndMs = question ? outputSpans(turn, byId, true).at(-1)?.endMs ?? turn.endMs : turn.endMs;
        const audible = turn.speaker === 'TARA' && origin !== undefined && heardRoleSpeech(turn, delivery, origin, byId, question);
        const heard = question && (audible || turn.fragmentIds.every(id => {
            const eventId = byId.get(id)?.eventId;
            return eventId !== undefined && delivery.shown?.includes(eventId);
        }));
        const slot = control?.slots.filter(slot => slot.questionRefs.includes(turn.id)).at(-1) ??
            (origin === undefined ? undefined : control?.slots.filter(slot => slot.openedAt <= origin + turn.startMs + 150).at(-1));
        return { ...turn, question, questionEndMs, heard, audible, topicId: repeated.get(turn.id) ?? slot?.topicId };
    }) };
}

export type RoleVoiceEvidence = ReturnType<typeof roleVoiceEvidence>['evidence'][number];
export type RoleVoiceAction = 'NEXT' | 'REFOCUS' | 'REDIRECT' | 'CLOSE' | 'END' | undefined;

export function stepRoleVoice(state: RoleVoiceControl, topics: TaraTopic[], fragments: Fragment[], delivery: NativeDelivery,
    started: number, now: number, timeLimit: boolean, candidateLastSpeechAt?: number, awaitingOutputRecovery = false): RoleVoiceAction {
    const { turns, origin, byId, evidence } = roleVoiceEvidence(fragments, delivery, state);
    const last = turns.at(-1);
    const candidateEnded = last?.speaker === 'CANDIDATE' && taraVerbalStop(last.text);
    if (state.close) {
        if (candidateEnded || now - state.close.at >= CLOSE_GRACE_MS) return 'END';
        const heardSignoff = origin !== undefined && delivery.open === undefined && turns.some(turn =>
            turn.speaker === 'TARA' && signoff(turn.text) && origin + turn.endMs >= state.close!.at &&
            heardRoleSpeech(turn, delivery, origin, byId));
        return heardSignoff ? 'END' : undefined;
    }
    const slot = state.slots[state.slot];
    if (!slot) return 'CLOSE';
    if (!slot.openedAt) slot.openedAt = started - 1500;
    const after = origin === undefined ? [] : evidence.filter(turn => origin + turn.startMs >= slot.openedAt - 150);
    const pastQuestions = new Set(state.slots.slice(0, state.slot).flatMap(prior => prior.questionRefs));
    const completedQuestions = evidence.filter(turn => pastQuestions.has(turn.id));
    let refocus = false;
    for (const question of after.filter(turn => turn.heard)) {
        if (slot.questionRefs.length >= 2) break;
        if (slot.questionRefs.includes(question.id)) continue;
        const repeated = completedQuestions.find(prior => repeatedQuestion(question.text, prior.text));
        if (repeated?.topicId) {
            if (!slot.repeated?.some(row => row.ref === question.id))
                (slot.repeated ??= []).push({ ref: question.id, topicId: repeated.topicId });
            refocus ||= !slot.refocused;
            continue;
        }
        slot.questionRefs.push(question.id);
    }
    const quietSince = delivery.windows.at(-1)?.end ?? started;
    const deadline = Math.min(slot.openedAt + TOPIC_MS, started + Math.floor(TARA_FIRST_PASS_MS * (state.slot + 1) / topics.length));
    // The browser still plays native media. These checks only decide whether to
    // follow up or advance, and never interpret an input transcript delta as a turn end.
    const answers = after.filter(turn => turn.speaker === 'CANDIDATE');
    const lastCandidate = answers.at(-1);
    const candidateQuietSince = Math.max(candidateLastSpeechAt ?? 0, lastCandidate && origin !== undefined ? origin + lastCandidate.endMs : 0);
    const candidateHasFloor = now - candidateQuietSince < CANDIDATE_PAUSE_MS;
    if (candidateEnded || timeLimit && !candidateHasFloor) {
        state.close = { at: now, reason: candidateEnded ? 'CANDIDATE_ENDED' : 'TIME_LIMIT' };
        return 'CLOSE';
    }
    if (candidateHasFloor) return undefined;
    if (delivery.open === undefined && origin !== undefined) {
        let redirect: VoiceRedirect | undefined;
        for (const turn of after.filter(turn => turn.speaker === 'TARA' && origin + turn.startMs <= quietSince + 350 &&
            (turn.audible || delivery.windows.some(window => origin + turn.startMs < window.end && origin + turn.endMs > window.start)))) {
            const interruptedQuestion = (!turn.audible && turn.question) || isIncompleteQuestion(turn.text);
            redirect = trackVoiceRedirect(redirect, { id: turn.id, text: turn.text, deliveredQuestion: turn.question && turn.audible,
                interruptedQuestion: interruptedQuestion && slot.questionRefs.length > 0 &&
                    answers.some(answer => answer.startMs < turn.endMs && answer.endMs > turn.startMs) });
        }
        if (redirect && slot.redirect) redirect.retriedAt = slot.redirect.retriedAt;
        slot.redirect = redirect;
        if (planVoiceRedirect(redirect, now, Math.max(candidateQuietSince, quietSince), deadline - now)) return 'REDIRECT';
    }
    if (refocus && !slot.questionRefs.length && delivery.open === undefined && now < deadline) {
        slot.refocused = true;
        return 'REFOCUS';
    }
    const recentQuestion = after.find(turn => turn.id === slot.questionRefs.at(-1));
    const answer = recentQuestion && answers.filter(turn => turn.endMs >= recentQuestion.questionEndMs && turn.text.trim().length >= 3).at(-1);
    const acknowledgement = answer && after.find(turn => turn.speaker === 'TARA' && turn.startMs >= answer.endMs - 150 &&
        !turn.question && turn.text.trim().split(/\s+/u).length >= 4);
    const acknowledged = acknowledgement && origin !== undefined && delivery.open === undefined && now >= quietSince + 700 &&
        heardRoleSpeech(acknowledgement, delivery, origin, byId);
    const waitingAfterAnswer = answer && origin !== undefined && delivery.open === undefined &&
        now >= Math.max(origin + answer.endMs, quietSince) + 4500;
    const awaitingRedirect = slot.redirect?.pending && (slot.redirect.retriedAt === undefined || now < slot.redirect.retriedAt + REDIRECT_RETRY_WINDOW_MS);
    if (now < deadline && (awaitingRedirect || awaitingOutputRecovery)) return undefined;
    if (!acknowledged && !waitingAfterAnswer && now < deadline) return undefined;
    if (state.slot + 1 >= topics.length) {
        state.close = { at: now, reason: 'TARA_FINISHED' };
        return 'CLOSE';
    }
    state.slot++;
    state.slots.push({ topicId: topics[state.slot].id, openedAt: now, questionRefs: [] });
    return 'NEXT';
}
