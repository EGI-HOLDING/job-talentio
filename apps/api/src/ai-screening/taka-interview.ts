import type { PromptPreset } from './prompts/compose';
import type { CandidatePayload, Claim, ClaimResult, EvaluationPayload, JsonSchema, PackagePayload } from './screening.schemas';
import { inputTrust } from './prompts/shared/input-trust';
import { neutrality } from './prompts/shared/neutrality';
import { evidenceCatalog } from './evidence-catalog';
import { screeningModel } from './screening.policy';
import type { EvidenceField, TaraOpportunity, taraInterviewReport } from './tara-interview';
import { voiceOpportunities } from './voice/voice-evidence';
import type { VoiceTurn } from './voice/voice.policy';

export const TAKA_INTERVIEW_VERSION = 'taka-interview-evidence-v1';
const fields: EvidenceField[] = ['TASK', 'ACTION', 'CONTEXT', 'RESULT', 'ROLE_BOUNDARY'];
const levels = ['NONE', 'OFF_TOPIC', 'DECLINED', 'GENERAL', 'PARTIAL', 'CONCRETE', 'STRONG'] as const;
type Level = typeof levels[number];
type Notes = ReturnType<typeof taraInterviewReport>;
type Turn = TaraOpportunity & { claimId: string; question: string; answers: Array<{ id: string; text: string }> };
type ChatQuestion = { id: string; claimId: string; text: string; answer: string | null; shownAt: Date | null; answeredAt: Date | null; timedOut: boolean };
export type TakaClaimScope = {
    state: 'ASSESSED' | 'NOT_ASKED' | 'INSUFFICIENT_OPPORTUNITY' | 'TECHNICAL_INTERRUPTION' | 'ASSESSMENT_UNAVAILABLE';
    basis?: 'DIRECT' | 'VOLUNTEERED';
    questionRefs: string[];
    askedFields: EvidenceField[];
    openFields: EvidenceField[];
};
export type TakaCoverage = {
    version: typeof TAKA_INTERVIEW_VERSION;
    state: 'COMPLETE' | 'PARTIAL' | 'NO_ASSESSABLE_CLAIMS' | 'ALTERNATIVE';
    plannedClaims: number;
    assessedClaims: number;
    openScopeClaims: number;
    interrupted: boolean;
};

const string: JsonSchema = { type: 'string' };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });

export function freezeTakaInterview(): PromptPreset {
    return {
        version: TAKA_INTERVIEW_VERSION, model: screeningModel(), name: 'taka_interview_evidence',
        reasoning: 'low', maxOutput: 4500, schema: object({}),
        instructions: [inputTrust, neutrality,
            'Nilai dukungan klaim CV hanya dari ucapan kandidat yang terekam. Kutipan CV mendefinisikan klaim, kebutuhan lowongan mendefinisikan relevansi, dan pertanyaan Tara menunjukkan apa yang diminta. Ketiganya bukan bukti tindakan kandidat. Jangan simpulkan kejujuran atau kelayakan diterima.',
            'Untuk tiap klaim: NONE jika belum ada bukti yang relevan atau tidak ada jawaban, OFF_TOPIC jika jawaban akhir membahas hal lain, DECLINED hanya jika kandidat dengan jelas menyatakan tidak bisa memberi contoh, menolak menjawab atau menyangkal penggunaan yang persis diklaim. GENERAL untuk pernyataan umum, PARTIAL untuk rincian relevan dengan celah yang benar-benar diuji, CONCRETE untuk tindakan pribadi yang jelas, STRONG untuk contoh spesifik yang mendukung lingkup yang ditanya dengan jelas dan lengkap.',
            'Periksa askedFields pada pertanyaan dan ruang lingkup klaim. Ketiadaan detail yang belum ditanya, termasuk alasan, hasil, konteks, dan batas peran, tidak menurunkan nilai; contoh singkat dapat STRONG. Cakupan terbuka tetap dicatat server. Jangan mewajibkan metrik, perusahaan tertentu, nama rahasia, atau pengalaman formal kecuali konteks itu memang diklaim dan diuji.',
            'Tautkan hanya quoteRef dari katalog jawaban kandidat. Untuk bukti positif, isi fields yang benar-benar dibuktikan kutipan itu. Untuk OFF_TOPIC atau DECLINED, rujuk jawaban aktual dan fields kosong. Gunakan jawaban topik lain hanya jika tugas dan tindakan nyata untuk klaim ini dijelaskan secara independen. Jika hanya menyebut nama skill, gunakan NONE. Kembalikan null hanya jika klaim tidak dapat diperiksa dari masukan.',
            'discrepancyRef hanya jika kandidat menjelaskan kontribusi atau konteks yang secara eksplisit bertentangan dengan klaim CV. Jika kandidat mengklarifikasi atau mengoreksi, gunakan jawaban akhirnya. Alasan satu kalimat dalam bahasa Indonesia, tanpa kesimpulan tentang kepribadian.',
        ].join('\n\n'),
    };
}

export function frozenTakaInterview(snapshot: unknown): PromptPreset | undefined {
    const preset = (snapshot as { takaInterviewAssessment?: PromptPreset } | null)?.takaInterviewAssessment;
    if (preset && preset.version !== TAKA_INTERVIEW_VERSION) throw new Error('UNKNOWN_TAKA_INTERVIEW_ASSESSMENT');
    return preset;
}

export function chatTakaTurns(questions: ChatQuestion[], notes?: Notes): Turn[] {
    const opportunities = new Map(notes?.topics.flatMap(topic => (topic.opportunities ?? []).map(row => [row.questionRef, row] as const)));
    return questions.flatMap(q => {
        if (!q.shownAt) return [];
        const saved = opportunities.get(q.id);
        return [{
            questionRef: q.id, question: q.text, claimId: q.claimId, delivery: 'CHAT',
            openedAt: +q.shownAt, closedAt: q.answeredAt ? +q.answeredAt : undefined,
            resolution: saved?.resolution ?? (q.answeredAt && !q.timedOut ? 'ANSWERED' : 'CUT_SHORT'),
            redirected: saved?.redirected,
            connected: saved?.connected ?? Boolean(q.answeredAt && !q.timedOut),
            answers: q.answeredAt && q.answer?.trim() ? [{ id: q.id, text: q.answer }] : [],
        }];
    });
}

export function liveTakaTurns(turns: VoiceTurn[], startedAt: Date, transcriptComplete: boolean, notes?: Notes): Turn[] {
    const byId = new Map(turns.map(turn => [turn.id, turn]));
    const windows = new Map(voiceOpportunities(turns).map(window => [window.questionRef, window.answerRefs]));
    return notes?.topics.flatMap(topic => (topic.opportunities ?? []).flatMap(row => {
        const question = byId.get(row.questionRef);
        if (!question || question.speaker !== 'TARA' || row.delivery === 'CHAT' || row.openedAt == null) return [];
        const answers = (windows.get(row.questionRef) ?? []).flatMap(ref => {
            const candidate = byId.get(ref);
            return candidate?.speaker === 'CANDIDATE' && candidate.text.trim() &&
                (row.closedAt == null || +startedAt + candidate.startMs <= row.closedAt)
                ? [{ id: candidate.id, text: candidate.text }] : [];
        });
        // A stored completed turn survives a later disconnect. Silence requires an intact transcript.
        return [{ ...row, claimId: topic.topicId, question: question.text, answers,
            connected: row.connected && (row.resolution === 'ANSWERED' || transcriptComplete) }];
    })) ?? [];
}

function plannedFields(claim: Claim): EvidenceField[] {
    return [...new Set<EvidenceField>(['TASK', 'ACTION', ...(claim.scope === 'CONTEXTUAL' ? ['CONTEXT' as const] : []),
        ...(claim.extraEvidence ?? []).map(value => value.field)])];
}

// Count explicitly asked details. Ambiguous wording leaves the detail open.
function questionFields(question: string): EvidenceField[] {
    const q = question.normalize('NFKC').toLowerCase();
    const found: EvidenceField[] = [];
    if (/\b(?:contoh|tugas (?:apa|mana|yang)|buat ngerjain apa|dipakai (?:untuk|buat) apa|what (?:task|work)|example)\b/u.test(q)) found.push('TASK');
    if (/\b(?:bagian (?:mana|apa)|sendiri|lu (?:kerjain|lakukan|tangani)|apa yang (?:lu|lo|kamu) lakukan|what did you do|your own)\b/u.test(q)) found.push('ACTION');
    if (/\b(?:di proyek (?:yang )?mana|di (?:perusahaan|kegiatan) (?:yang )?mana|pengalaman mana|which (?:project|company)|(?:skill|keahlian) (?:itu|tadi) lu pakai di pengalaman)\b/u.test(q)) found.push('CONTEXT');
    if (/\b(?:apa (?:hasil|dampak)|(?:hasil|dampak)(?:nya)? (?:apa|gimana|bagaimana)|berapa (?:hasil|besar)|what (?:was the |were the )?(?:result|outcome)|how did (?:it|that) turn out)\b/u.test(q)) found.push('RESULT');
    if (/\b(?:pembagian tanggung jawab|siapa yang (?:mengerjakan|menyetujui|memimpin)|batas (?:peran|kontribusi)|who (?:led|approved|did)|division of responsibilities)\b/u.test(q)) found.push('ROLE_BOUNDARY');
    return found;
}

const completed = (turn: Turn) => turn.connected === true && (turn.resolution === 'ANSWERED' || turn.resolution === 'WINDOW_EXPIRED');

export function prepareTakaEvidence(plan: CandidatePayload, turns: Turn[], criteria: PackagePayload['criteria'] = []) {
    const answers = turns.flatMap(turn => turn.answers.map(answer => ({
        id: answer.id, answer: answer.text, claimId: turn.claimId, criterionId: '',
    })));
    const catalog = evidenceCatalog({ claims: [], limitations: [] }, answers);
    const sources = new Map(turns.flatMap(turn => turn.answers.map(answer => [answer.id, turn] as const)));
    const askedFields = new Map(plan.claims.map(claim => [claim.id, [...new Set(turns
        .filter(turn => turn.claimId === claim.id && completed(turn)).flatMap(turn => questionFields(turn.question)))]
        .filter(field => plannedFields(claim).includes(field))]));
    return { plan, turns, catalog, snippets: new Map(catalog.map(quote => [quote.id, quote])), sources, askedFields,
        requirements: new Map(criteria.map(row => [row.id, row.requirementRef])) };
}

type Input = ReturnType<typeof prepareTakaEvidence>;
type Judged = { level: Level; reason: string; evidence: Array<{ quoteRef: string; fields: EvidenceField[] }>; discrepancyRef: string | null };

export function takaEvaluationRequest(preset: PromptPreset, input: Input, requested: Claim[]) {
    const refs = input.catalog.map(row => row.id);
    const quoteRef: JsonSchema = refs.length && refs.length <= 200 ? { ...string, enum: refs } : string;
    const judgement = nullable(object({
        level: { ...string, enum: [...levels] }, reason: string,
        evidence: { type: 'array', maxItems: 4, items: object({ quoteRef, fields: { type: 'array', maxItems: fields.length,
            items: { ...string, enum: fields } } }) },
        discrepancyRef: nullable(quoteRef),
    }));
    return {
        preset: { ...preset, schema: object({ claims: object(Object.fromEntries(requested.map(claim => [claim.id, judgement]))) }) },
        data: {
            claims: requested.map(({ id, criterionId, statement, quote, scope, extraEvidence }) => ({
                id, statement, quote, scope, extraEvidence, requirementRef: input.requirements.get(criterionId), askedFields: input.askedFields.get(id),
            })),
            turns: input.turns.filter(turn => turn.answers.length).map(({ claimId, questionRef, question, answers, resolution }) => ({
                claimId, questionRef, question, resolution, answerRefs: answers.map(answer => answer.id),
            })),
            evidenceCatalog: input.catalog,
        },
    };
}

export function acceptTakaJudgements(input: Input, ids: string[], raw: unknown): Map<string, Judged | null> {
    const accepted = new Map<string, Judged | null>();
    const claims = (raw as { claims?: Record<string, unknown> } | null)?.claims;
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return accepted;
    for (const id of ids) {
        if (!Object.hasOwn(claims, id)) continue;
        const row = claims[id] as Judged | null;
        if (row === null) { accepted.set(id, null); continue; }
        if (!row || !levels.includes(row.level) || typeof row.reason !== 'string' || !row.reason.trim() ||
            /\b(?:pembohong|pasti berbohong|terbukti berbohong|skor kejujuran)\b/i.test(row.reason) ||
            !Array.isArray(row.evidence) || row.evidence.length > 4 ||
            row.evidence.some(item => !item || !input.snippets.has(item.quoteRef) || !Array.isArray(item.fields) ||
                item.fields.length > fields.length || item.fields.some(field => !fields.includes(field))) ||
            (row.discrepancyRef !== null && !row.evidence.some(item => item.quoteRef === row.discrepancyRef)) ||
            (row.level !== 'NONE' && !row.evidence.length)) continue;
        const supported = new Set(row.evidence.flatMap(item => item.fields));
        if (['CONCRETE', 'STRONG'].includes(row.level) && (!supported.has('TASK') || !supported.has('ACTION'))) continue;
        accepted.set(id, { ...row, reason: row.reason.trim().slice(0, 300) });
    }
    return accepted;
}

type AssessedClaim = Omit<ClaimResult, 'score'> & { score: number | null; asked: boolean; assessment: TakaClaimScope };
const noEvidence = 'Belum ada contoh relevan setelah kesempatan menjawab selesai.';
const reasonFor: Record<Exclude<TakaClaimScope['state'], 'ASSESSED'>, string> = {
    NOT_ASKED: 'Klaim belum sempat dibahas.',
    INSUFFICIENT_OPPORTUNITY: 'Kesempatan menjawab atau klarifikasi belum cukup untuk memberi nilai.',
    TECHNICAL_INTERRUPTION: 'Kesempatan menjawab terpotong atau rekamannya belum lengkap.',
    ASSESSMENT_UNAVAILABLE: 'Bukti tersimpan, penilaian klaim perlu ditinjau.',
};

function gradeClaim(input: Input, claim: Claim, judgement: Judged | null | undefined, interrupted: boolean): AssessedClaim {
    const direct = input.turns.filter(turn => turn.claimId === claim.id);
    const expected = plannedFields(claim), askedFields = input.askedFields.get(claim.id) ?? [];
    const citations = judgement?.evidence.flatMap(entry => {
        const snippet = input.snippets.get(entry.quoteRef);
        const turn = snippet && input.sources.get(snippet.ref);
        return snippet && turn ? [{ snippet, turn, fields: entry.fields }] : [];
    }) ?? [];
    const own = citations.filter(row => row.turn.claimId === claim.id);
    const directAnswer = own.some(row => completed(row.turn));
    const negative = judgement?.level === 'OFF_TOPIC' || judgement?.level === 'DECLINED';
    const positive = judgement && !negative && judgement.level !== 'NONE';
    const concrete = judgement?.level === 'CONCRETE' || judgement?.level === 'STRONG';
    const supported = new Set(positive ? citations.flatMap(row => row.fields) : []);
    const scopeComplete = expected.every(field => supported.has(field));
    const fullExample = concrete && (own.length ? askedFields.every(field => supported.has(field)) : scopeComplete);
    const noDirectAnswer = !direct.some(turn => turn.answers.length);
    const silentWindow = direct.find(turn => completed(turn) && turn.resolution === 'WINDOW_EXPIRED' &&
        !turn.answers.length && (noDirectAnswer || turn.redirected));
    const negativeTurn = negative && own.find(({ turn }) => completed(turn) && (judgement.level === 'DECLINED' || turn.redirected));
    const contradiction = judgement?.discrepancyRef && own.find(({ snippet, turn }) =>
        snippet.id === judgement.discrepancyRef && completed(turn));

    let score: number | null = null;
    let reason = '';
    let basis: TakaClaimScope['basis'];
    if (positive && (directAnswer || fullExample)) {
        basis = own.length ? 'DIRECT' : 'VOLUNTEERED';
        score = judgement.level === 'GENERAL' ? 1 : judgement.level === 'PARTIAL' ? 2 :
            askedFields.some(field => !supported.has(field)) ? 2 : judgement.level === 'STRONG' ? 4 : 3;
        reason = judgement.reason;
    } else if (negativeTurn || silentWindow) {
        score = 0;
        basis = 'DIRECT';
        reason = negativeTurn ? judgement!.reason : noEvidence;
    }
    const technical = direct.some(turn => turn.resolution === 'INTERRUPTED' || !turn.connected && turn.resolution !== 'ANSWERED') ||
        (interrupted && direct.some(turn => !completed(turn)));
    const state = score !== null ? 'ASSESSED' : judgement === undefined && (direct.some(turn => turn.answers.length) || citations.length)
        ? 'ASSESSMENT_UNAVAILABLE' : technical ? 'TECHNICAL_INTERRUPTION' : direct.length ? 'INSUFFICIENT_OPPORTUNITY' : 'NOT_ASKED';
    const selected = positive ? (own.length || fullExample ? citations : []) : negativeTurn ? [negativeTurn] : silentWindow && negative ? own.slice(-1) : [];
    const evidence = [...new Map(selected.map(({ snippet, turn }) => [snippet.id, {
        questionId: snippet.ref, questionRef: turn.questionRef, questionText: turn.question, quote: snippet.text,
    }])).values()];
    const questionRefs = [...new Set([...(silentWindow && score === 0 ? [silentWindow.questionRef] : []),
        ...direct.map(turn => turn.questionRef), ...selected.map(row => row.turn.questionRef)])];
    return {
        claimId: claim.id, score, asked: direct.length > 0,
        status: contradiction && score !== null ? 'CLARIFY' : score !== null && score >= 3 ? 'SUPPORTED' : 'INSUFFICIENT',
        reason: score !== null ? reason : reasonFor[state as Exclude<typeof state, 'ASSESSED'>],
        evidence, contradictions: contradiction && score !== null ? [{
            left: { source: 'CV', ref: claim.id, quote: claim.quote },
            right: { source: 'ANSWER', ref: contradiction.snippet.ref, quote: contradiction.snippet.text },
        }] : [],
        assessment: { state, basis, questionRefs, askedFields, openFields: expected.filter(field => !askedFields.includes(field) && !supported.has(field)) },
    };
}

export function scoreTakaInterview(input: Input, judgements: Map<string, Judged | null>, interrupted: boolean, taraInterview?: Notes) {
    const claims = input.plan.claims.map(claim => gradeClaim(input, claim, judgements.get(claim.id), interrupted));
    const assessed = claims.filter(claim => claim.score !== null);
    const openScopeClaims = assessed.filter(claim => claim.assessment.openFields.length).length;
    const coverage: TakaCoverage = {
        version: TAKA_INTERVIEW_VERSION, plannedClaims: claims.length, assessedClaims: assessed.length, openScopeClaims, interrupted,
        state: !claims.length ? 'ALTERNATIVE' : !assessed.length ? 'NO_ASSESSABLE_CLAIMS' :
            assessed.length < claims.length || interrupted || openScopeClaims ? 'PARTIAL' : 'COMPLETE',
    };
    const score = assessed.length ? Math.round(assessed.reduce((total, row) => total + row.score!, 0) * 250 / assessed.length) / 10 : null;
    const result: EvaluationPayload = {
        summary: coverage.state === 'ALTERNATIVE' ? 'Pengalaman di luar CV dicatat untuk HR.' :
            score === null ? 'Belum ada klaim yang dapat dinilai dari percakapan ini.' :
            assessed.length + ' dari ' + claims.length + ' klaim dinilai berdasarkan percakapan yang tersimpan.',
        criteria: [], claims, strengths: assessed.filter(row => row.score! >= 3).map(row => row.reason).slice(0, 3),
        gaps: assessed.filter(row => row.score! <= 2).map(row => row.reason).slice(0, 3), interviewQuestions: [],
        ...(taraInterview ? { taraInterview } : {}), interviewAssessment: coverage,
    };
    return { score, coverage, result };
}
