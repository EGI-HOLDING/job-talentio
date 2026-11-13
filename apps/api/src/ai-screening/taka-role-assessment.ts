import type { PromptPreset } from './prompts/compose';
import { inputTrust } from './prompts/shared/input-trust';
import { neutrality } from './prompts/shared/neutrality';
import { evidenceCatalog } from './evidence-catalog';
import { ROLE_ASSESSMENT_VERSION, ROLE_WEIGHTS, type RoleRubric } from './role-rubric';
import { redactScreeningContacts, scoreScreening } from './screening.policy';
import type { CandidatePayload, ClaimResult, EvaluationPayload, JsonSchema } from './screening.schemas';
import { chatTakaTurns } from './taka-interview';
import type { RoleVoiceEvidence } from './voice/voice-role';
import { TAKA_ROLE_EVIDENCE_VERSION } from './taka-versions';

type Opportunity = 'ANSWERED' | 'SILENCE' | 'INTERRUPTED' | 'UNVERIFIED' | 'PLAYBACK_INTERRUPTED';
export type RoleTranscriptEntry = {
    id: string;
    speaker: 'TARA' | 'CANDIDATE';
    text: string;
    startMs: number;
    endMs: number;
    topicId?: string;
    question?: boolean;
    opportunity?: Opportunity;
};
type Grade = {
    criterionId: string;
    name: string;
    level: number | null;
    clarity: number | null;
    state: 'ASSESSED' | 'NOT_ASKED' | 'INSUFFICIENT_OPPORTUNITY' | 'TECHNICAL_INTERRUPTION' | 'PLAYBACK_UNVERIFIED' | 'ASSESSMENT_UNAVAILABLE';
    reason: string;
    questionRefs: string[];
    evidence: Array<{ questionId: string; questionRef?: string; questionText?: string; quote: string }>;
    discrepancy?: ClaimResult['contradictions'][number];
};
type Components = { [Key in keyof typeof ROLE_WEIGHTS]: number | null };
export type RoleAssessment = {
    version: typeof ROLE_ASSESSMENT_VERSION | typeof TAKA_ROLE_EVIDENCE_VERSION;
    rubricRevision: string;
    state: 'COMPLETE' | 'INCOMPLETE';
    missing: Array<'CV' | 'RUBRIC' | 'COVERAGE'>;
    components: Components;
    contributions: Components;
    weights: typeof ROLE_WEIGHTS;
    score: number | null;
    coverage: { assessed: number; total: number; interrupted: boolean };
    partial?: { competency: number; explanation: number };
    criteria: Grade[];
};

export function roleChatTranscript(questions: Parameters<typeof chatTakaTurns>[0], notes?: Parameters<typeof chatTakaTurns>[1]) {
    const turns = chatTakaTurns(questions, notes);
    const start = turns[0]?.openedAt ?? 0;
    return turns.flatMap<RoleTranscriptEntry>(turn => {
        const opened = Math.max(0, (turn.openedAt ?? start) - start);
        const closed = Math.max(opened + 1, (turn.closedAt ?? start) - start);
        const opportunity: Opportunity = turn.connected && turn.resolution === 'ANSWERED' && turn.answers.length ? 'ANSWERED' :
            turn.connected && turn.resolution === 'WINDOW_EXPIRED' ? turn.answers.length ? 'ANSWERED' : 'SILENCE' : 'INTERRUPTED';
        return [{ id: 'question:' + turn.questionRef, speaker: 'TARA', text: turn.question, startMs: opened, endMs: opened,
            topicId: turn.claimId, question: true, opportunity }, ...turn.answers.map(answer => ({
            id: 'answer:' + answer.id, speaker: 'CANDIDATE' as const, text: answer.text, startMs: closed, endMs: closed, topicId: turn.claimId,
        }))];
    });
}

export function roleLiveTranscript(turns: Array<RoleVoiceEvidence & { playbackInterrupted?: boolean }>, interrupted: boolean, direct = false) {
    return turns.flatMap<RoleTranscriptEntry>((turn, index) => {
        const { id, text, startMs, topicId, speaker, question, heard } = turn;
        if (speaker !== 'CANDIDATE' && speaker !== 'TARA') return [];
        const endMs = question ? turn.questionEndMs : turn.endMs;
        if (!question) return [{ id, text, startMs, endMs, topicId, speaker }];
        const nextQuestion = turns.findIndex((next, position) => position > index && next.question && next.heard);
        const subsequent = turns.slice(index + 1, nextQuestion < 0 ? undefined : nextQuestion);
        const answered = subsequent.some(next => next.speaker === 'CANDIDATE' && next.endMs >= endMs && next.text.trim() &&
            (!direct || next.startMs >= endMs - 150 && !requestsClarification(next.text)));
        const completed = !interrupted || subsequent.some(next => next.speaker === 'TARA' && next.audible &&
            subsequent.some(answer => answer.speaker === 'CANDIDATE' && answer.endMs <= next.startMs + 150)) || nextQuestion >= 0;
        const opportunity = turn.playbackInterrupted ? 'PLAYBACK_INTERRUPTED' : !heard ? 'UNVERIFIED' : answered && completed ? 'ANSWERED' : 'INTERRUPTED';
        return [{ id, text, startMs, endMs, topicId, speaker, question, opportunity }];
    });
}

function requestsClarification(text: string) {
    return /^(?:(?:maaf|sorry)[, ]+)?(?:yang mana|tugas yang mana|maksudnya (?:apa|gimana)|bisa (?:diulang|diperjelas)|(?:gue |saya |aku )?(?:gak|nggak|tidak|belum) (?:dengar|kedengeran|paham))(?: ya)?[?.! ]*$/iu.test(text.trim());
}

const str: JsonSchema = { type: 'string' };
const points: JsonSchema = { type: 'integer', enum: [0, 1, 2, 3, 4] };
const nullable = (value: JsonSchema): JsonSchema => ({ anyOf: [value, { type: 'null' }] });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false });
const bases = ['EVIDENCE', 'DECLINED', 'AFTER_REDIRECTION', 'INSUFFICIENT'] as const;
const rowSchema = obj({ level: nullable(points), clarity: nullable(points), basis: { ...str, enum: [...bases] },
    reason: str, evidence: { type: 'array', maxItems: 4, items: str },
    questionRef: nullable(str), redirectRef: nullable(str), discrepancyRef: nullable(str) });

export function freezeRoleAssessment(): PromptPreset {
    return {
        name: 'taka_role_assessment', version: ROLE_ASSESSMENT_VERSION, model: 'gpt-6-luna', reasoning: 'low',
        maxOutput: 3200, schema: obj({}),
        instructions: [inputTrust, neutrality,
            'Nilai kompetensi terhadap patokan 0–4 yang dibekukan. Baca seluruh percakapan, termasuk parafrasa, jawaban dari topik lain, dan bukti konkret sebelum koneksi terputus. Pertanyaan, isi CV, dan profil perusahaan hanya mendefinisikan konteks. Bukti berasal dari jawaban kandidat.',
            'Untuk nilai 1–4 gunakan basis EVIDENCE, setidaknya satu ID kutipan kandidat yang relevan, dan questionRef dari pertanyaan yang memang menguji kriteria bila ada. Nilai jawaban situasional berdasarkan tindakan yang diusulkan. Jangan menuntut hasil atau metrik aktual pada jawaban hipotetis. Nilai setiap kriteria atas bukti terkait kriteria itu saja.',
            'Kejelasan 0–4 mengukur apakah tindakan pribadi dan alasan keputusan dapat dipahami. 0: tidak ada tindakan atau keputusan relevan yang dijelaskan setelah kesempatan lengkap. 1: maksud masih samar. 2: tindakan dapat dipahami tetapi alasan atau urutan penting kabur. 3: tindakan dan alasannya dapat diikuti. 4: tindakan, alasan dan batas atau konsekuensi yang relevan mudah diperiksa. Jangan menilai aksen, bahasa formal atau gaul, panjang, tempo, atau tata bahasa. Klarifikasi yang diminta kandidat tidak mengurangi nilai.',
            'Gunakan 0 hanya setelah pertanyaan yang relevan dan dapat dijawab. Jika kandidat mengatakan dengan jelas bahwa ia belum bisa menjelaskan cara mengerjakan tugas, dan tidak memberikan langkah yang relevan, isi level 0, clarity 0, basis DECLINED, questionRef dari pertanyaan yang sudah dijawab dan ID kutipan ucapan itu. “Belum pernah” diikuti penjelasan cara mengerjakannya tetap dinilai. AFTER_REDIRECTION memerlukan pertanyaan awal dan satu pengulangan terarah yang telah dijawab tanpa bukti relevan. Kembalikan null dengan basis INSUFFICIENT jika kesempatan atau bukti tidak dapat diperiksa. Hindari memberi 0 atas pertanyaan yang gagal disampaikan atau detail yang belum ditanya.',
            'Salin ID referensi yang tersedia, jangan menulis kutipan baru. discrepancyRef hanya untuk ketidaksesuaian eksplisit antara klaim CV terkait dan jawaban aktual setelah kandidat mengklarifikasi. Gunakan satu kalimat alasan dalam bahasa Indonesia. Jangan menilai kejujuran, kepribadian, atau memberi keputusan perekrutan.',
        ].join('\n\n'),
    };
}

export function frozenRoleAssessment(snapshot: unknown) {
    const preset = (snapshot as { roleAssessmentPrompt?: PromptPreset } | null)?.roleAssessmentPrompt;
    return preset?.version === ROLE_ASSESSMENT_VERSION ? preset : freezeRoleAssessment();
}

export function prepareRoleEvidence(rubric: RoleRubric, transcript: RoleTranscriptEntry[], plan: CandidatePayload) {
    const criteria = rubric.criteria.filter(row => rubric.interviewIds.includes(row.id))
        .sort((a, b) => rubric.interviewIds.indexOf(a.id) - rubric.interviewIds.indexOf(b.id));
    const catalog = evidenceCatalog({ claims: [], limitations: [] }, transcript.flatMap(row => row.speaker === 'CANDIDATE'
        ? [{ id: row.id, answer: row.text, claimId: '', criterionId: '' }] : []));
    return { rubric, criteria, transcript, catalog, plan, turns: new Map(transcript.map(row => [row.id, row])),
        snippets: new Map(catalog.map(row => [row.id, row])) };
}
export type RoleInput = ReturnType<typeof prepareRoleEvidence>;

export function roleEvaluationRequest(input: RoleInput, preset: PromptPreset, ids = input.rubric.interviewIds, direct = false) {
    const criteria = input.criteria.filter(row => ids.includes(row.id));
    return {
        preset: { ...preset, schema: obj({ criteria: obj(Object.fromEntries(criteria.map(row => [row.id, rowSchema]))) }),
            ...(direct ? { instructions: preset.instructions + '\n\nUntuk Tara Live, petakan makna pertanyaan ke tugas pada rubrik, termasuk parafrasa dan pertanyaan klarifikasi. Pilih questionRef hanya jika pertanyaannya lengkap dan fokus pada kompetensi itu. Sapaan, konfirmasi siap, arahan balik tanpa pertanyaan konkret, permintaan mengulang, dan pertanyaan yang belum terverifikasi penyampaiannya tidak membuktikan kesempatan menjawab. Bukti positif yang konkret boleh berasal dari jawaban pada topik lain.' } : {}) },
        data: { role: input.rubric.title, criteria: criteria.map(criterion => ({ ...criterion,
            cvClaims: input.plan.claims.filter(claim => claim.criterionId === criterion.id)
                .map(({ id, quote, scope }) => ({ id, quote: redactScreeningContacts(quote), scope })) })),
            transcript: input.transcript.map(row => ({ ...row, text: redactScreeningContacts(row.text) })),
            evidence: input.catalog.map(({ id, ref, text }) => ({ id, ref, text: redactScreeningContacts(text) })),
        },
    };
}

export type RoleJudgement = { level: number | null; clarity: number | null; basis: typeof bases[number]; reason: string;
    evidence: string[]; questionRef: string | null; redirectRef: string | null; discrepancyRef: string | null };
const validLevel = (value: unknown) => value === null || typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;

export function acceptRoleJudgements(input: RoleInput, raw: unknown, ids = input.rubric.interviewIds) {
    const checked = new Map<string, RoleJudgement>();
    const rows = (raw as { criteria?: Record<string, RoleJudgement> } | null)?.criteria;
    for (const id of ids) {
        const row = rows?.[id];
        if (!row || !validLevel(row.level) || !validLevel(row.clarity) || !bases.includes(row.basis) ||
            typeof row.reason !== 'string' || !row.reason.trim() || /\b(?:pembohong|pasti berbohong|skor kejujuran)\b/iu.test(row.reason) ||
            !Array.isArray(row.evidence) || row.evidence.length > 4 || row.evidence.some(ref => !input.snippets.has(ref)) ||
            row.discrepancyRef !== null && !row.evidence.includes(row.discrepancyRef)) continue;
        const question = input.turns.get(row.questionRef ?? '');
        const redirect = input.turns.get(row.redirectRef ?? '');
        const belongs = (entry: RoleTranscriptEntry | undefined) => entry?.question && (!entry.topicId || entry.topicId === id);
        if (row.questionRef !== null && !belongs(question) || row.redirectRef !== null && !belongs(redirect)) continue;
        if (row.level === null && (row.clarity !== null || row.basis !== 'INSUFFICIENT')) continue;
        if (row.level !== null && row.level > 0 && (row.basis !== 'EVIDENCE' || !row.evidence.length || row.clarity === null)) continue;
        if (row.level === 0) {
            const tested = row.basis === 'AFTER_REDIRECTION' && redirect && question?.opportunity === 'ANSWERED' && redirect.startMs > question.startMs ? redirect :
                row.basis === 'DECLINED' ? question : undefined;
            const nextQuestion = tested && input.transcript.find(entry => entry.question && entry.startMs > tested.startMs &&
                entry.opportunity !== 'UNVERIFIED');
            if (!tested || tested.opportunity !== 'ANSWERED' || !row.evidence.length || row.clarity !== 0 ||
                row.evidence.some(ref => {
                    const answer = input.turns.get(input.snippets.get(ref)!.ref)!;
                    return answer.endMs < tested.endMs || Boolean(nextQuestion && answer.startMs >= nextQuestion.startMs);
                })) continue;
        }
        checked.set(id, { ...row, reason: row.reason.trim().slice(0, 350) });
    }
    return checked;
}

const missingReason = { NOT_ASKED: 'Kompetensi belum dibahas.', INSUFFICIENT_OPPORTUNITY: 'Kesempatan menjawab belum cukup.',
    TECHNICAL_INTERRUPTION: 'Penyampaian pertanyaan atau kesempatan menjawab belum terverifikasi.',
    PLAYBACK_UNVERIFIED: 'Pemutaran pertanyaan belum terverifikasi.',
    ASSESSMENT_UNAVAILABLE: 'Penilaian kompetensi perlu ditinjau.' };

export function recordedRoleDecline(input: RoleInput, questions: RoleTranscriptEntry[]) {
    const question = questions[0];
    if (questions.length !== 1 || question.opportunity !== 'ANSWERED') return;
    const next = input.transcript.find(turn => turn.question && turn.startMs > question.startMs);
    const answers = input.transcript.filter(turn => turn.speaker === 'CANDIDATE' && turn.startMs >= question.endMs - 500 &&
        turn.endMs >= question.endMs && (!next || turn.startMs < next.startMs) && turn.text.trim());
    if (answers.length !== 1) return;
    const answer = answers[0];
    if (explicitRoleDecline(answer.text))
        return { questionId: answer.id, questionRef: question.id, questionText: question.text, quote: answer.text.trim() };
}

export function explicitRoleDecline(answer: string) {
    const text = answer.trim().replace(/^(?:maaf|sorry)[,.\s]+/iu, '').replace(/[.!?]+$/u, '');
    if (/\b(?:tapi|tetapi|namun|karena|sebenarnya|kecuali|kalau|jika)\b/iu.test(text)) return;
    const statement = text.match(/^(?:saya|gue|gua|aku)\s+(?:belum|tidak|gak|nggak|enggak)\s+(.+)$/iu)?.[1];
    if (!statement) return;
    const cannotExplain = /^(?:bisa|dapat|mampu)\s+(?:menjawab(?:\s+(?:pertanyaan|soal)(?:\s+ini|\s+itu)?)?|menjelaskan\s+(?:bagaimana|cara|langkah)\b[^.!?,;]{0,80})$/iu;
    const hasNoAnswer = /^(?:punya|memiliki)\s+(?:jawaban|cara)(?:\s+yang bisa (?:saya|gue|aku) jelaskan sekarang)?$/iu;
    return cannotExplain.test(statement) || hasNoAnswer.test(statement);
}

function gradeState(level: number | null, questions: RoleTranscriptEntry[], judgement: RoleJudgement | undefined,
    unavailable: boolean, evidencePolicy: boolean, interrupted: boolean): Grade['state'] {
    if (level !== null) return 'ASSESSED';
    const answered = questions.some(q => q.opportunity === 'ANSWERED');
    if (unavailable || answered && !judgement) return 'ASSESSMENT_UNAVAILABLE';
    if (evidencePolicy && answered) return 'INSUFFICIENT_OPPORTUNITY';
    if (questions.some(q => q.opportunity === 'PLAYBACK_INTERRUPTED' || q.opportunity === 'INTERRUPTED' && (!evidencePolicy || interrupted)))
        return 'TECHNICAL_INTERRUPTION';
    if (questions.some(q => q.opportunity === 'UNVERIFIED')) return evidencePolicy ? 'PLAYBACK_UNVERIFIED' : 'TECHNICAL_INTERRUPTION';
    return questions.length ? 'INSUFFICIENT_OPPORTUNITY' : 'NOT_ASKED';
}

export function scoreRoleAssessment(input: RoleInput, judgements: Map<string, RoleJudgement>, cvScore: number | null,
    interrupted: boolean, notes?: EvaluationPayload['taraInterview'], evidencePolicy?: { unavailable: ReadonlySet<string> }) {
    const grades = input.criteria.map<Grade>(criterion => {
        let row = judgements.get(criterion.id);
        const judgedRefs = new Set([row?.questionRef, row?.redirectRef]);
        const questions = input.transcript.filter(turn => turn.question && (turn.topicId === criterion.id || !turn.topicId && judgedRefs.has(turn.id)));
        const statement = evidencePolicy ? undefined : recordedRoleDecline(input, questions);
        if (statement && row?.level && row.evidence.every(id => input.snippets.get(id)?.ref === statement.questionId)) row = undefined;
        const silent = !evidencePolicy && row?.level == null && questions.length && questions.every(turn => turn.opportunity === 'SILENCE');
        const declined = row?.level == null ? statement : undefined;
        const level = row?.level ?? (silent || declined ? 0 : null);
        const clarity = row?.clarity ?? (silent || declined ? 0 : null);
        const state = gradeState(level, questions, row, evidencePolicy?.unavailable.has(criterion.id) ?? false, Boolean(evidencePolicy), interrupted);
        const evidence = declined ? [declined] : row?.evidence.map(id => {
            const snippet = input.snippets.get(id)!;
            const possibleRef = row.redirectRef ?? row.questionRef ?? undefined;
            const question = possibleRef && input.turns.get(possibleRef);
            const answer = input.turns.get(snippet.ref)!;
            const questionRef = !evidencePolicy ? possibleRef : question && answer.endMs >= question.endMs &&
                !input.transcript.some(turn => turn.question && turn.startMs > question.startMs && turn.startMs < answer.startMs) ? question.id : undefined;
            return { questionId: snippet.ref, questionRef, questionText: questionRef ? input.turns.get(questionRef)?.text : undefined, quote: snippet.text };
        }) ?? [];
        const claim = input.plan.claims.find(c => c.criterionId === criterion.id);
        const difference = row?.discrepancyRef ? input.snippets.get(row.discrepancyRef) : undefined;
        return { criterionId: criterion.id, name: criterion.name, level, clarity, state,
            reason: state === 'ASSESSED' ? row?.level != null ? row.reason : declined ? 'Kandidat menyatakan belum bisa menjawab setelah mendapat kesempatan.' :
                'Waktu menjawab selesai dengan koneksi terkonfirmasi.' : state === 'INSUFFICIENT_OPPORTUNITY' && evidencePolicy && row ? row.reason : missingReason[state],
            questionRefs: [...new Set([...questions.map(q => q.id), ...(row?.questionRef ? [row.questionRef] : []), ...(row?.redirectRef ? [row.redirectRef] : [])])],
            evidence, ...(claim && difference && level !== null ? { discrepancy: { left: { source: 'CV', ref: claim.id, quote: claim.quote },
                right: { source: 'ANSWER', ref: difference.ref, quote: difference.text } } } : {}) };
    });
    const coverage = { assessed: grades.filter(row => row.level !== null).length, total: grades.length, interrupted };
    const competency = scoreScreening(grades.map(row => ({ score: row.level })));
    const explanation = scoreScreening(grades.map(row => ({ score: row.clarity })));
    const missing: RoleAssessment['missing'] = [];
    if (cvScore === null) missing.push('CV');
    if (!grades.length) missing.push('RUBRIC');
    else if (competency === null || explanation === null) missing.push('COVERAGE');
    const score = cvScore === null || competency === null || explanation === null ? null :
        Math.round((cvScore * ROLE_WEIGHTS.cv + competency * ROLE_WEIGHTS.competency + explanation * ROLE_WEIGHTS.explanation) / 10) / 10;
    const contribution = (value: number | null, weight: number) => value === null ? null : Math.round(value * weight) / 100;
    const measured = grades.filter(row => row.level !== null);
    const roleAssessment: RoleAssessment = { version: evidencePolicy ? TAKA_ROLE_EVIDENCE_VERSION : ROLE_ASSESSMENT_VERSION, rubricRevision: input.rubric.revision,
        state: score === null ? 'INCOMPLETE' : 'COMPLETE', missing, components: { cv: cvScore, competency, explanation },
        contributions: { cv: contribution(cvScore, ROLE_WEIGHTS.cv), competency: contribution(competency, ROLE_WEIGHTS.competency),
            explanation: contribution(explanation, ROLE_WEIGHTS.explanation) },
        weights: ROLE_WEIGHTS, score, coverage, criteria: grades,
        ...(evidencePolicy && measured.length > 0 && measured.length < grades.length ? { partial: {
            competency: scoreScreening(measured.map(row => ({ score: row.level })))!,
            explanation: scoreScreening(measured.map(row => ({ score: row.clarity })))!,
        } } : {}) };
    const result: EvaluationPayload = {
        summary: coverage.assessed + ' dari ' + coverage.total + ' kompetensi inti dinilai berdasarkan percakapan yang tersimpan.',
        roleAssessment, criteria: grades.map(row => ({ criterionId: row.criterionId, score: row.level, reason: row.reason, evidence: row.evidence })),
        claims: [], strengths: [], gaps: [], interviewQuestions: [], ...(notes ? { taraInterview: notes } : {}),
    };
    return { result, score: competency, finalScore: score, ready: score !== null, assessed: coverage.assessed, total: coverage.total };
}
