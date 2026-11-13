import { SKILL_CONVERSATION, TIMED_CONVERSATION, repeatsQuestion } from './conversation.policy';
import { assertSchema, validQuestion, type CandidatePayload, type PackagePayload } from './screening.schemas';
import { SKILL_TURN_SCHEMA, TIMED_TURN_SCHEMA } from './prompts/tasks/skill-interview';

export const TOPIC_MS = 180_000;
export const REVISIT_MS = 60_000;
export const TARA_FIRST_PASS_MS = 11 * 60_000;
export const TARA_COMPLETE_MS = 14 * 60_000;
export const TARA_SESSION_MS = 15 * 60_000;
export const TARA_CHAT_REVIEW_MS = 8_000;
export const TARA_ROLE_INTRO = 'Halo, gue Tara. Kita bahas tugas di posisi ini, ya.';
const MIN_CLARIFICATION_MS = 35_000;
export const ALTERNATIVE_TOPIC = 'outside-cv';
const MAX_TURNS = SKILL_CONVERSATION.maxCore + SKILL_CONVERSATION.maxFollowUp;

export type TaraOutcome = 'CONCRETE_EXAMPLE' | 'INCOMPLETE_EXAMPLE' | 'NO_RELEVANT_EXAMPLE' | 'CLARIFIED_DISCREPANCY' | 'NOT_ASKED' | 'TECHNICAL_INTERRUPTION' | 'ANSWER_CUT_SHORT';
export const taraOutcomeLabel: Record<TaraOutcome, string> = {
    CONCRETE_EXAMPLE: 'Ada contoh konkret',
    INCOMPLETE_EXAMPLE: 'Ada contoh relevan, sebagian bukti masih kurang',
    NO_RELEVANT_EXAMPLE: 'Sudah ditanya, belum ada contoh relevan',
    CLARIFIED_DISCREPANCY: 'Ada ketidaksesuaian setelah klarifikasi',
    NOT_ASKED: 'Belum sempat ditanya',
    TECHNICAL_INTERRUPTION: 'Kesempatan menjawab terganggu secara teknis',
    ANSWER_CUT_SHORT: 'Jawaban belum sempat ditinjau saat giliran berakhir',
};
type TurnJudgment = 'EXAMPLE' | 'NEEDS_DETAIL' | 'OFF_TOPIC' | 'DISCREPANCY';
export type EvidenceField = 'TASK' | 'ACTION' | 'CONTEXT' | 'RESULT' | 'ROLE_BOUNDARY';
type TurnEvidence = {topicId: string; quote: string; fields: EvidenceField[]};
export type TaraDecision = { outcome: TurnJudgment; answerQuote: string; question: string | null; evidence?: TurnEvidence[] };
export type TaraTopic = {
    id: string; criterionId: string; label: string; question: string; alternative: boolean;
    cvQuote?: string; requirementRef?: string; priority?: 'CORE' | 'SUPPORTING'; fields?: EvidenceField[];
};
type TaraCitation = Omit<TurnEvidence, 'topicId'> & {answerRef: string; fromTopic: string};
export type TaraOpportunity = {
    questionRef: string; openedAt?: number; closedAt?: number; delivery: 'CHAT' | 'AUDIO' | 'TEXT_FALLBACK';
    resolution?: 'ANSWERED' | 'WINDOW_EXPIRED' | 'CUT_SHORT' | 'INTERRUPTED';
    redirected?: boolean;
    connected?: boolean;
};
export type TaraNote = {
    topicId: string;
    outcome: TaraOutcome;
    questionRefs: string[];
    answerRefs: string[];
    quote?: string;
    evidence?: TaraCitation[];
    opportunities?: TaraOpportunity[];
    reason?: 'EVIDENCE_COMPLETE' | 'AFTER_REDIRECT' | 'NO_RESPONSE' | 'TIME_LIMIT' | 'DELIVERY_FAILED' | 'ANALYSIS_UNAVAILABLE' | 'OPPORTUNITY_GIVEN' | 'INTERRUPTED';
};
type TopicState = {
    note: TaraNote;
    depth: number;
    revisit: 'NEEDS_DETAIL' | 'DISCREPANCY' | null;
    focus: TurnJudgment | null;
};
export type TaraProgress = {
    policyVersion?: string;
    endedReason?: 'COMPLETE' | 'TIME_LIMIT' | 'INTERRUPTED';
    active: number;
    questions: number;
    stage: 'FIRST' | 'REVISIT' | 'DONE';
    topics: TopicState[];
};

export function taraTopics(plan: CandidatePayload, rubric: PackagePayload, timed = false): TaraTopic[] {
    if (plan.roleTopics?.length) return plan.roleTopics.map(row => {
        const criterion = rubric.criteria.find(criterion => criterion.id === row.criterionId);
        const claim = plan.claims.find(claim => claim.id === row.cvClaimId);
        return { id: row.criterionId, criterionId: row.criterionId, label: criterion?.name ?? row.question, question: row.question,
            alternative: !claim, cvQuote: claim?.quote, requirementRef: criterion?.requirementRef, priority: 'CORE', fields: ['TASK', 'ACTION'] };
    });
    if (plan.claims.length) return plan.claims.map(claim => ({
        id: claim.id, criterionId: claim.criterionId, label: claim.skill ?? claim.statement, question: claim.question, alternative: false,
        ...(timed ? {cvQuote: claim.quote, requirementRef: claim.requirementRef ?? rubric.criteria.find(row => row.id === claim.criterionId)?.requirementRef,
            priority: claim.relevance, fields: ['TASK', 'ACTION', ...(claim.extraEvidence ?? []).map(entry => entry.field)] as EvidenceField[]} : {}),
    }));
    const criterion = rubric.criteria.find(row => row.id === plan.alternativeCriterionId);
    if (!criterion) throw new Error('TARA_ALTERNATIVE_CRITERION_MISSING');
    const label = criterion.name.replace(/[?:\r\n]+/g, ' ').trim();
    return [{
        id: ALTERNATIVE_TOPIC, criterionId: criterion.id, label: criterion.name,
        ...(timed ? {requirementRef: criterion.requirementRef, priority:'CORE' as const, fields:['TASK', 'ACTION'] as EvidenceField[]} : {}),
        question: plan.alternativeQuestion ?? ('Oke, kita mulai ya 😄 Pernah ada proyek atau kegiatan yang berkaitan sama ' +
            (label && label.length <= 65 ? label : 'tugas utama posisi ini') + '?'),
        alternative: true,
    }];
}

export function startTara(topics: TaraTopic[], timed = false): TaraProgress {
    return {
        ...(timed ? {policyVersion: TIMED_CONVERSATION.version} : {}),
        active: 0, questions: 1, stage: 'FIRST',
        topics: topics.map(topic => ({
            note: { topicId: topic.id, outcome: 'NOT_ASKED', questionRefs: [], answerRefs: [] },
            depth: 0, revisit: null, focus: null,
        })),
    };
}

export function validTaraDecision(value: unknown, answer: string, previous: string[], topics?: TaraTopic[]): TaraDecision {
    assertSchema(topics ? TIMED_TURN_SCHEMA : SKILL_TURN_SCHEMA, value);
    const decision = value as TaraDecision;
    if (!decision.answerQuote.trim() || !answer.includes(decision.answerQuote)) throw new Error('TARA_UNGROUNDED_TURN');
    if (topics) decision.evidence = decision.evidence!.filter(entry => entry.quote.trim() && answer.includes(entry.quote) &&
        entry.fields.length && topics.some(topic => topic.id === entry.topicId));
    const question = decision.question;
    if (decision.outcome === 'EXAMPLE') return { ...decision, question: null };
    return { ...decision, question: question && validQuestion(question, SKILL_CONVERSATION)
        && question.match(/\?/g)?.length === 1 && !repeatsQuestion(question, previous) ? question : null };
}

export function taraBudget(progress: TaraProgress, count: number, started: number, now: number, mode: 'VOICE' | 'CHAT') {
    const closeAt = started + TARA_COMPLETE_MS;
    const outstanding = progress.stage === 'FIRST' ? Math.max(1, count - progress.active) : 1;
    const firstPass = started + TARA_FIRST_PASS_MS;
    const slot = progress.stage === 'FIRST'
        ? Math.min(TOPIC_MS, Math.max(0, Math.floor((firstPass - now) / outstanding)))
        : REVISIT_MS;
    return {
        topicEnd: Math.min(closeAt, now + slot), closeAt,
        canClarify: now + (mode === 'CHAT' ? 60_000 + TARA_CHAT_REVIEW_MS : MIN_CLARIFICATION_MS) <= Math.min(closeAt, now + slot),
        canRevisit: closeAt - now >= (mode === 'CHAT' ? 60_000 + TARA_CHAT_REVIEW_MS : 45_000),
    };
}

export function taraHasEvidence(topic: TaraTopic, note: TaraNote) {
    return !!topic.fields?.length && topic.fields.every(field => note.evidence?.some(entry => entry.fields.includes(field)));
}

export function recordTaraOpportunity(note: TaraNote, opportunity: TaraOpportunity) {
    const entries = note.opportunities ??= [];
    const index = entries.findIndex(item => item.questionRef === opportunity.questionRef);
    if (index < 0) entries.push(opportunity);
    else entries[index] = {...entries[index], ...opportunity};
}

export function rememberTaraEvidence(progress: TaraProgress, topics: TaraTopic[], decision: TaraDecision | undefined, answers: Array<{ref: string; text: string}>) {
    for (const entry of decision?.evidence ?? []) {
        const index = topics.findIndex(topic => topic.id === entry.topicId);
        if (index < progress.active && progress.stage === 'FIRST' || index < 0) continue;
        if (progress.stage === 'REVISIT' && index !== progress.active) continue;
        // Cross-topic evidence is a Tara note. Scoring still uses the original per-claim opportunity.
        const source = answers.find(answer => answer.text.includes(entry.quote));
        if (!source) continue;
        const note = progress.topics[index].note;
        const evidence = note.evidence ??= [];
        const existing = evidence.find(item => item.answerRef === source.ref && item.quote === entry.quote);
        if (existing) existing.fields = [...new Set([...existing.fields, ...entry.fields])];
        else if (evidence.length < 12) evidence.push({answerRef: source.ref, quote: entry.quote, fields: [...new Set(entry.fields)], fromTopic: topics[progress.active].id});
    }
}

export function taraAssessmentTopics(progress: TaraProgress, topics: TaraTopic[]) {
    return topics.flatMap((topic, index) => index === progress.active || progress.stage === 'FIRST' && index > progress.active
        ? [{...topic, covered: [...new Set(progress.topics[index].note.evidence?.flatMap(item => item.fields) ?? [])]}] : []);
}

function clarification(outcome: TurnJudgment) {
    if (outcome === 'DISCREPANCY') return 'Gue cek maksud lu sebentar ya. Keahlian tadi lu pakai di pengalaman yang lu tulis itu?';
    if (outcome === 'OFF_TOPIC') return 'Gue tarik balik dikit ya. Keahlian tadi lu pakai buat ngerjain bagian yang mana?';
    return 'Dari contoh tadi, bagian mana yang lu kerjain sendiri?';
}

function missingDetail(topic: TaraTopic, note: TaraNote) {
    if (!topic.fields) return undefined;
    const missing = topic.fields.filter(field => !note.evidence?.some(item => item.fields.includes(field)));
    if (missing.includes('ACTION')) return undefined;
    if (missing.includes('TASK')) return 'Keahlian tadi lu pakai buat menyelesaikan tugas yang mana?';
    if (missing.includes('CONTEXT')) return 'Lu pakai keahlian itu di proyek atau kegiatan yang mana?';
    if (missing.includes('RESULT')) return 'Apa hasil dari bagian yang lu kerjain waktu itu?';
    if (missing.includes('ROLE_BOUNDARY')) return 'Gimana pembagian tanggung jawab lu dengan anggota tim lain?';
}

function moveTopic(progress: TaraProgress, topics: TaraTopic[], canRevisit: boolean) {
    if (progress.questions >= MAX_TURNS) return null;
    if (progress.stage === 'FIRST' && progress.active + 1 < topics.length) {
        progress.active++;
        const topic = topics[progress.active], note = progress.topics[progress.active].note;
        if (!note.evidence?.length) return topic.question;
        const label = topic.label.replace(/[?:\r\n]+/g, ' ').trim().slice(0, 65);
        const missing = topic.fields?.find(field => !note.evidence?.some(item => item.fields.includes(field)));
        if (missing === 'RESULT') return `Masih soal ${label}, apa hasil dari bagian yang lu kerjain?`;
        if (missing === 'CONTEXT') return `Lu pakai ${label} itu di proyek atau kegiatan yang mana?`;
        return `Soal ${label} yang lu sebut tadi, bagian mana yang lu tangani sendiri?`;
    }
    if (!canRevisit) return null;
    const discrepancy = progress.topics.findIndex(topic => topic.revisit === 'DISCREPANCY');
    const core = progress.policyVersion ? progress.topics.findIndex((topic, i) => topic.revisit && topics[i].priority === 'CORE') : -1;
    const index = discrepancy >= 0 ? discrepancy : core >= 0 ? core : progress.topics.findIndex(topic => topic.revisit);
    if (index < 0) return null;
    const topic = progress.topics[index];
    progress.active = index;
    progress.stage = 'REVISIT';
    topic.depth = 2;
    topic.focus = topic.revisit;
    topic.revisit = null;
    const label = topics[index].label.replace(/[?:\r\n]+/g, ' ').trim();
    const lead = label && label.length <= 55 ? label : 'keahlian yang lu tulis';
    return topic.focus === 'DISCREPANCY'
        ? `Gue balik sebentar ke ${lead} ya. Pengalaman mana yang sebenarnya melibatkan keahlian itu?`
        : `Gue balik sebentar ke ${lead} ya. ${missingDetail(topics[index],topic.note)??'Apa keputusan yang lu ambil sendiri waktu itu?'}`;
}

export function advanceTara(progress: TaraProgress, topics: TaraTopic[], turn: {
    questionRef?: string; answerRefs: string[]; answered: boolean; previous: string[];
    decision?: TaraDecision; timedOut?: boolean; technical?: boolean; answers?: Array<{ref: string; text: string}>;
    opportunity?: TaraOpportunity;
}, { canClarify = true, canRevisit = true, canContinue = true } = {}) {
    const next = structuredClone(progress);
    const state = next.topics[next.active];
    const topic = topics[next.active];
    if (next.stage === 'DONE' || !state) return { progress: next, question: null };
    const priorOutcome = state.note.outcome;
    if (next.policyVersion) rememberTaraEvidence(next, topics, turn.decision, turn.answers ?? []);
    const completeEvidence = next.policyVersion && turn.questionRef && taraHasEvidence(topic, state.note);
    const decision = completeEvidence && turn.decision?.outcome !== 'DISCREPANCY'
        ? {outcome: 'EXAMPLE' as const, answerQuote: state.note.evidence?.at(-1)?.quote ?? '', question:null}
        : next.policyVersion && turn.decision?.outcome === 'EXAMPLE' && !completeEvidence
            ? {...turn.decision, outcome: 'NEEDS_DETAIL' as const} : turn.decision;
    if (turn.questionRef && !state.note.questionRefs.includes(turn.questionRef)) state.note.questionRefs.push(turn.questionRef);
    state.note.answerRefs = [...new Set([...state.note.answerRefs, ...turn.answerRefs])];
    if (turn.opportunity) recordTaraOpportunity(state.note, turn.opportunity);
    if (decision?.answerQuote) state.note.quote = decision.answerQuote;
    if (turn.technical) state.note.outcome = 'TECHNICAL_INTERRUPTION';
    else if (turn.questionRef) {
        if (decision?.outcome === 'EXAMPLE') state.note.outcome = 'CONCRETE_EXAMPLE';
        else if (decision?.outcome === 'DISCREPANCY' && state.focus === 'DISCREPANCY' && !topic.alternative)
            state.note.outcome = 'CLARIFIED_DISCREPANCY';
        else if (priorOutcome !== 'CONCRETE_EXAMPLE') state.note.outcome = turn.answered && !decision
            ? (turn.timedOut ? 'ANSWER_CUT_SHORT' : 'TECHNICAL_INTERRUPTION') : 'NO_RELEVANT_EXAMPLE';
        if (next.policyVersion && state.note.outcome === 'NO_RELEVANT_EXAMPLE' && state.note.evidence?.length)
            state.note.outcome = 'INCOMPLETE_EXAMPLE';
    }
    if (next.policyVersion && (turn.questionRef || turn.technical)) {
        state.note.reason = turn.technical ? 'DELIVERY_FAILED' : state.note.outcome === 'CONCRETE_EXAMPLE' ? 'EVIDENCE_COMPLETE'
            : turn.timedOut || !canContinue ? 'TIME_LIMIT' : !turn.answered ? 'NO_RESPONSE' : !decision ? 'ANALYSIS_UNAVAILABLE'
                : state.depth ? 'AFTER_REDIRECT' : 'OPPORTUNITY_GIVEN';
    }
    const outcome = decision?.outcome ?? 'NEEDS_DETAIL';
    if (turn.questionRef && turn.answered && !turn.technical && !turn.timedOut && outcome !== 'EXAMPLE'
        && state.note.outcome !== 'CLARIFIED_DISCREPANCY' && canContinue && canClarify && !state.depth && next.questions < MAX_TURNS) {
        const question = decision?.question ?? (outcome === 'NEEDS_DETAIL' ? missingDetail(topic,state.note) : undefined) ?? clarification(outcome);
        if (!repeatsQuestion(question, turn.previous)) {
            state.depth = 1;
            state.focus = outcome;
            next.questions++;
            return { progress: next, question };
        }
    }
    if (!topic.alternative && state.depth === 1 && decision && !turn.technical
        && (outcome === 'NEEDS_DETAIL' || outcome === 'DISCREPANCY') &&
        ['NO_RELEVANT_EXAMPLE','INCOMPLETE_EXAMPLE'].includes(state.note.outcome)) state.revisit = outcome;
    const question = canContinue ? moveTopic(next, topics, canRevisit) : null;
    if (question) next.questions++;
    else {
        next.stage = 'DONE';
        if (next.policyVersion) next.endedReason = canContinue ? 'COMPLETE' : 'TIME_LIMIT';
    }
    return { progress: next, question };
}

export function taraInterviewReport(progress: TaraProgress, topics: TaraTopic[]) {
    return {
        version: progress.policyVersion ?? SKILL_CONVERSATION.version,
        ...(progress.endedReason ? {endedReason: progress.endedReason} : {}),
        topics: topics.map((topic, index) => ({
            ...progress.topics[index].note, label: topic.label, alternative: topic.alternative,
            ...(topic.fields ? {fields: topic.fields, cvQuote: topic.cvQuote, requirementRef: topic.requirementRef} : {}),
        })),
    };
}
