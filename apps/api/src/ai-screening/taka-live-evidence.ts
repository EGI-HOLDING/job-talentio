import type { AssessmentLanguage } from '@job-talentio/shared';
import { assessmentTextLanguage } from './assessment-language';
import { normalizedText, redactScreeningContacts } from './screening.policy';
import { assertSchema, type JsonSchema } from './screening.schemas';
import { explicitRoleDecline, freezeRoleAssessment, inRoleAnswerWindow,
    type RoleInput, type RoleJudgement, type RoleTranscriptEntry } from './taka-role-assessment';
import { roleEvidenceReferences } from './taka-role-evidence';
import { TAKA_LIVE_COMPLETION_VERSION } from './taka-versions';
import { inputTrust } from './prompts/shared/input-trust';
import { neutrality } from './prompts/shared/neutrality';

const str: JsonSchema = { type: 'string' };
const values = (...items: string[]): JsonSchema => ({ type: 'string', enum: items });
const clarity: JsonSchema = { type: 'integer', enum: [0, 1, 2, 3, 4] };
const ref = (prefix: 'q' | 'a'): JsonSchema => ({ type: 'string', pattern: '^' + prefix + '[1-9][0-9]*$' });
const nullable = (value: JsonSchema): JsonSchema => ({ anyOf: [value, { type: 'null' }] });
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const refs = (minimum: number, maximum: number): JsonSchema => ({ type: 'array', minItems: minimum, maxItems: maximum, items: ref('a') });
const reason: JsonSchema = { type: 'string', maxLength: 350 };
const levels = [0, 1, 2, 3, 4];
// A refusal and positive evidence share the same answer references. The server
// validates their meaning using the grade and the captured question window.
const wireRow = object({ level: nullable({ type: 'integer', enum: levels }), clarity: nullable(clarity),
    evidence: refs(0, 4), questionRef: nullable(ref('q')),
    redirectRef: nullable(ref('q')), fit: nullable(values('DIRECT', 'TRANSFERABLE')),
    requiresQuestionContext: { type: 'boolean' }, discrepancyRef: nullable(ref('a')), reason });
const priorWireRow = object({ ...wireRow.properties!,
    actionRef: nullable(ref('a')), answerRef: nullable(ref('a')), firstAnswerRef: nullable(ref('a')), lastAnswerRef: nullable(ref('a')),
    basis: values('EVIDENCE', 'DECLINED', 'AFTER_REDIRECTION', 'INSUFFICIENT') });

type Base = { reason: string; questionRef: string | null };
type Proposed = Base & (
    { basis: 'INSUFFICIENT' } |
    { basis: 'DECLINED'; answerRef: string } |
    { basis: 'AFTER_REDIRECTION'; questionRef: string; firstAnswerRef: string; redirectRef: string; lastAnswerRef: string } |
    { basis: 'EVIDENCE'; level: number; clarity: number; fit: 'DIRECT' | 'TRANSFERABLE'; evidence: string[];
        actionRef: string | null; requiresQuestionContext: boolean; discrepancyRef: string | null }
);

function liveProposal(value: unknown): Proposed | undefined {
    if (!value || typeof value !== 'object') return;
    const schema = 'basis' in value ? priorWireRow : wireRow;
    assertSchema({ ...schema, properties: { ...schema.properties, questionRef: nullable(str) } }, value);
    const { basis, level, clarity: valueClarity, evidence, actionRef, questionRef, fit, requiresQuestionContext,
        discrepancyRef, redirectRef, answerRef, firstAnswerRef, lastAnswerRef, reason } = value as {
        basis?: Proposed['basis']; level: number | null; clarity: number | null; evidence: string[]; actionRef?: string | null;
        questionRef: string | null; fit: 'DIRECT' | 'TRANSFERABLE' | null; requiresQuestionContext: boolean; discrepancyRef: string | null;
        redirectRef: string | null; answerRef?: string | null; firstAnswerRef?: string | null; lastAnswerRef?: string | null; reason: string;
    };
    if (basis === undefined) {
        if (level === null) return valueClarity === null && evidence.length === 0 && !redirectRef ?
            { basis: 'INSUFFICIENT', questionRef, reason } : undefined;
        if (level > 0 && valueClarity !== null && fit && evidence.length && !redirectRef)
            return { basis: 'EVIDENCE', level, clarity: valueClarity, evidence, actionRef: evidence[0], questionRef, fit,
                requiresQuestionContext, discrepancyRef, reason };
        if (level !== 0 || valueClarity !== 0 || fit || discrepancyRef || requiresQuestionContext) return;
        if (!redirectRef && evidence.length === 1)
            return { basis: 'DECLINED', questionRef, answerRef: evidence[0], reason };
        if (questionRef && redirectRef && evidence.length === 2)
            return { basis: 'AFTER_REDIRECTION', questionRef, redirectRef, firstAnswerRef: evidence[0], lastAnswerRef: evidence[1], reason };
        return;
    }
    // Positive evidence is independent of any pointers to the zero-grade branches.
    if (basis === 'EVIDENCE' && level !== null && level > 0 && valueClarity !== null && fit && evidence.length)
        return { basis, level, clarity: valueClarity, evidence, actionRef: actionRef ?? null, questionRef, fit, requiresQuestionContext, discrepancyRef, reason };
    if (evidence.length || actionRef || fit || discrepancyRef || requiresQuestionContext) return;
    if (basis === 'INSUFFICIENT' && level === null && valueClarity === null && !redirectRef && !answerRef && !firstAnswerRef && !lastAnswerRef)
        return { basis, questionRef, reason };
    if (level !== 0 || valueClarity !== 0 || !questionRef) return;
    if (basis === 'DECLINED' && answerRef && !redirectRef && !firstAnswerRef && !lastAnswerRef)
        return { basis, questionRef, answerRef, reason };
    if (basis === 'AFTER_REDIRECTION' && redirectRef && firstAnswerRef && lastAnswerRef && !answerRef)
        return { basis, questionRef, redirectRef, firstAnswerRef, lastAnswerRef, reason };
}
type References = ReturnType<typeof roleEvidenceReferences>;
type Issue = 'INVALID_OUTPUT' | 'INSUFFICIENT_WITH_ANSWER' | 'INVALID_QUESTION_REF' | 'INVALID_ANSWER_REF' | 'ACTION_REF_OUTSIDE_EVIDENCE' |
    'ANSWER_OUTSIDE_QUESTION' | 'QUESTION_INTERRUPTED' | 'QUESTION_NOT_CONFIRMED' | 'CLARIFICATION_ONLY' |
    'ANSWER_CUT_SHORT' | 'DECLINE_NOT_EXPLICIT';
export type LiveEvidenceDiagnostic = { questionRefs: string[]; reasons: Issue[] };
export const liveReviewLabels: Record<Issue, string> = {
    INVALID_OUTPUT: 'Hasil penilaian belum lolos pemeriksaan.',
    INSUFFICIENT_WITH_ANSWER: 'Jawaban tersimpan perlu diperiksa kembali pada kompetensi ini.',
    INVALID_QUESTION_REF: 'Rujukan pertanyaan tidak dapat diperiksa.',
    INVALID_ANSWER_REF: 'Rujukan jawaban tidak dapat diperiksa.',
    ACTION_REF_OUTSIDE_EVIDENCE: 'Rujukan tindakan tidak sesuai dengan kutipan jawaban.',
    ANSWER_OUTSIDE_QUESTION: 'Jawaban dirujuk dari giliran yang berbeda.',
    QUESTION_INTERRUPTED: 'Pemutaran pertanyaan terputus.',
    QUESTION_NOT_CONFIRMED: 'Penyampaian pertanyaan belum terverifikasi.',
    CLARIFICATION_ONLY: 'Kandidat meminta klarifikasi sebelum menjawab.',
    ANSWER_CUT_SHORT: 'Jawaban terpotong saat sesi berakhir.',
    DECLINE_NOT_EXPLICIT: 'Jawaban masih membutuhkan pendalaman.',
};

function questionAnswerCandidates(input: RoleInput, references: References, question: RoleTranscriptEntry) {
    const next = references.followingQuestions.get(question.id);
    return [...references.answers].flatMap(([id, row]) => {
        const answer = input.turns.get(row.ref);
        return answer && inRoleAnswerWindow(answer, question, next) ? [{ id, answer, text: row.text }] : [];
    });
}

// Playback energy is a diagnostic. Its approximate time does not reproduce
// every word. A specific, timely response can corroborate the actual exchange
// where transport was healthy and no interruption was recorded.
function connectedExchange(question: RoleTranscriptEntry, answer: RoleTranscriptEntry, responseConfirmsQuestion = false) {
    if (question.playback === 'INTERRUPTED' || question.opportunity === 'PLAYBACK_INTERRUPTED' || answer.cutShort || answer.clarification) return false;
    if (question.opportunity === 'ANSWERED') return true;
    if (question.playback !== 'HEALTHY_UNVERIFIED' || answer.startMs - question.endMs > 20_000) return false;
    if (responseConfirmsQuestion) return true;
    const tokens = (source: string) => new Set(normalizedText(source).toLowerCase().match(/[\p{L}\p{N}+#]{3,}/gu) ?? []);
    const generic = new Set(['yang', 'saya', 'kamu', 'gimana', 'langkah', 'bisa', 'akan', 'untuk', 'dengan', 'cara',
        'kalau', 'pada', 'dalam', 'itu', 'ini', 'what', 'would', 'your', 'the', 'you', 'how', 'and', 'gunakan']);
    const other = tokens(answer.text);
    return [...tokens(question.text)].filter(token => !generic.has(token) && other.has(token)).length >= 2;
}

function clearlyCannotAnswer(text: string) {
    if (explicitRoleDecline(text)) return true;
    const line = normalizedText(text).replace(/^(?:(?:oh|waduh|maaf|sorry|ya)[,.\s]+)+/iu, '').replace(/[.?!]+$/u, '').trim();
    const spokenDecline = /^(?:(?:saya|gue|gua|aku|i) )?(?:(?:nggak|enggak|gak|tidak|belum) bisa (?:menjawab|jawab)(?: pertanyaan (?:ini|itu))?|(?:can.t|cannot) answer(?: (?:that|this))?)(?: (?:nih|ya|deh))?$/iu;
    const explainsInability = /^(?:(?:saya|gue|gua|aku|i) )?(?:(?:belum|nggak|enggak|gak|tidak) (?:tahu|tau|paham) (?:caranya|cara (?:ngerjain|mengerjakan|melakukannya|memulai)(?:nya)?|harus (?:mulai|ngapain)(?: dari mana)?)|(?:nggak|enggak|gak|tidak|belum) bisa (?:kasih|memberi|memberikan) contoh(?:nya)?|(?:do not|don.t) know how(?: to (?:do (?:it|that)|start|approach (?:it|that)))?)(?: (?:nih|ya|deh))?$/iu;
    if (spokenDecline.test(line) || explainsInability.test(line)) return true;
    const statements = line.split(/[.!]\s+/u);
    const last = statements.pop();
    const onlyContext = /^(?:(?:saya|gue|gua|aku) )?(?:(?:(?:cuma|hanya) )?(?:ikut|hadir|mengikuti) [^?]+ sebagai pengamat|(?:sama sekali )?(?:belum|tidak|nggak) pernah(?: [^?]+)?)$/iu;
    return Boolean(last && statements.length && statements.every(statement => onlyContext.test(statement) &&
        !/\b(?:tapi|tetapi|namun|kemudian|lalu|dan|sementara)\b/iu.test(statement)) &&
        (explicitRoleDecline(last) || spokenDecline.test(last) || explainsInability.test(last)));
}

export function freezeLiveEvidencePrompt(language?: AssessmentLanguage) {
    return {
        preset: { ...freezeRoleAssessment(), version: TAKA_LIVE_COMPLETION_VERSION, name: 'taka_live_evidence',
            schema: wireRow,
            instructions: [inputTrust, neutrality,
                'Nilai kompetensi dari isi jawaban kandidat di semua giliran, termasuk jawaban singkat, sebagian, lintas topik, atau dalam bahasa berbeda. Beri 1 untuk konsep relevan dan 2 untuk langkah yang relevan meski kurang lengkap. Gunakan null jika tidak ada konsep atau tindakan relevan dan kesempatan yang sah untuk nilai nol belum tersedia.',
                'Untuk nilai positif, isi evidence dengan ID aN. Kutipan pertama memuat bukti terkuat. Nilai 3–4 memerlukan tindakan atau keputusan langsung pada kutipan pertama. DIRECT berarti tindakan menjawab kompetensi; TRANSFERABLE maksimal 2. Jika bukti mandiri, questionRef boleh null dan requiresQuestionContext false. Tindakan utuh tetap dinilai walau bagian lain ucapannya terpotong.',
                'Pilih nilai 4 jika langkah konkret kandidat menjawab seluruh fokus pertanyaan dan ada cara memeriksa hasil, aturan keputusan, atau penanganan risiko yang relevan. Cara memeriksa hasil bisa dijelaskan secara kualitatif. Untuk tugas biasa, jawaban kuat tidak wajib menyebut angka, ukuran proyek, atau hasil yang sudah terjadi. Pilih 3 jika tindakan pribadi dan alasannya jelas tetapi pemeriksaan hasil atau keputusan belum cukup. Gunakan patokan yang sama untuk contoh dari pekerjaan maupun skenario.',
                'Kejelasan mengukur apakah tindakan dan alasan kandidat dapat dipahami: 0 belum dijelaskan, 1 samar, 2 tindakan dipahami tetapi alasan atau urutan kabur, 3 tindakan dan alasan dapat diikuti, 4 tindakan, alasan dan batas atau konsekuensi dapat diperiksa. Jangan menilai aksen, gaya bahasa, atau panjang jawaban. Untuk skenario hipotetis, nilai langkah yang diusulkan tanpa menuntut hasil yang pernah terjadi.',
                'Untuk keahlian wajib bernama, bedakan penerapan aktual, pengetahuan dari skenario, dan bagian yang belum diuji. Tulis batas ini di alasan. Skenario bisa membuktikan pemahaman; jangan mengaku kandidat pernah memakai keahlian itu atau memberi nilai penuh pada syarat pengalaman aktual hanya karena skenarionya baik. Skill yang tidak tercantum di CV belum berarti kandidat tidak menguasainya.',
            ].join('\n\n'),
        },
        minimumUsage: 'Jika sumber untuk keahlian mencantumkan minimumUsage, nilai penuh memerlukan kutipan yang menunjukkan pemakaian aktual serta durasi minimum. Jawaban skenario saja memakai TRANSFERABLE untuk syarat tersebut.',
        opportunity: [
            'Untuk 0, isi level dan clarity dengan 0, questionRef dengan qN, evidence dengan [aN] jika kandidat eksplisit tidak bisa menjelaskan langkah dan tidak memberi langkah relevan pada giliran itu, atau [jawaban pertama, jawaban kedua] jika keduanya melenceng meski diarahkan. Jika kandidat menjelaskan satu langkah yang tepat tetapi tidak tahu cara melanjutkan, nilai langkah yang sudah dijelaskan. Ambil qN dari questions yang mencantumkan jawaban itu. Untuk dua jawaban, redirectRef menunjuk pertanyaan kedua. “Belum pernah” saja, permintaan klarifikasi, dan ucapan terpotong belum membuktikan nol. Server memeriksa kesempatan menjawab.',
            'Contoh: “I checked the receipt and asked dispatch to trace the package” berisi tindakan yang bisa dinilai. “Saya tidak bisa menjelaskan cara menelusuri paket” bisa dinilai 0 setelah pertanyaan jelas. “Bisa dijelasin lagi?” tanpa jawaban lain tetap null.',
            'Nilai null memakai evidence kosong. Isi fit hanya untuk nilai positif. Gunakan redirectRef hanya untuk nilai nol setelah dua jawaban, serta requiresQuestionContext true hanya untuk nilai positif yang bergantung pada isi pertanyaan.',
            `Salin ID referensi yang tersedia. discrepancyRef hanya untuk ketidaksesuaian yang telah diklarifikasi kandidat terhadap klaim CV terkait. Beri satu kalimat alasan dalam ${assessmentTextLanguage(language)}. Jangan menilai kejujuran atau memberi keputusan perekrutan.`,
            ...(language ? ['Arahan agar kandidat memakai bahasa wawancara bukan pertanyaan kompetensi atau arahan balik tentang isi. Nilai bukti yang relevan dalam jawaban apa pun bahasanya.'] : []),
        ].join('\n\n'),
        repair: 'Perbaiki hanya kompetensi yang diminta. INSUFFICIENT_WITH_ANSWER berarti ada jawaban tersimpan. Cari bukti lintas topik, termasuk ketika pertanyaan yang menguji kompetensi ini tidak ada. Gunakan evidence atau nilai nol jika syaratnya terpenuhi. Jika jawaban tidak memberi bukti dan syarat nol belum terpenuhi, INSUFFICIENT tetap sah. Isi questionRef hanya jika kompetensi ini memang ditanya dan jelaskan apa yang masih perlu ditanyakan.',
    };
}
export type FrozenLiveEvidencePrompt = ReturnType<typeof freezeLiveEvidencePrompt>;

export function liveEvidenceRequest(input: RoleInput, references: References, ids: string[],
    repairs?: ReadonlyMap<string, LiveEvidenceDiagnostic>, frozen = freezeLiveEvidencePrompt()) {
    const minimumUsage = input.criteria.some(row => ids.includes(row.id) && row.sources?.some(source => source.minimumUsage));
    const questionIds = new Map([...references.questions].map(([key, turn]) => [turn.id, key]));
    return {
        preset: { ...frozen.preset,
            schema: object({ criteria: object(Object.fromEntries(ids.map(id => [id, frozen.preset.schema]))) }),
            instructions: [frozen.preset.instructions, ...(minimumUsage ? [frozen.minimumUsage] : []), frozen.opportunity,
                ...(repairs ? [frozen.repair] : [])].join('\n\n'),
        },
        data: { role: input.rubric.title, criteria: input.criteria.filter(row => ids.includes(row.id)).map(row => ({
            ...row, repair: repairs ? repairs.get(row.id)?.reasons ?? ['VERIFY_COVERAGE'] : undefined,
            requiredSkill: input.plan.roleTopics?.find(topic => topic.criterionId === row.id)?.requiredSkill,
            cvClaims: input.plan.claims.filter(claim => claim.criterionId === row.id)
                .map(claim => ({ quote: redactScreeningContacts(claim.quote), scope: claim.scope })),
        })),
        transcript: input.transcript.map(turn => ({
            id: turn.id, speaker: turn.speaker, text: redactScreeningContacts(turn.text), question: questionIds.get(turn.id),
            startMs: turn.startMs, endMs: turn.endMs, clarification: turn.clarification, cutShort: turn.cutShort,
        })),
        // Playback telemetry is only used by the server to validate zero grades.
        questions: [...references.questions].map(([id, turn]) => ({ id, turnId: turn.id,
            answers: questionAnswerCandidates(input, references, turn).map(item => item.id) })),
        answers: [...references.answers].map(([id, snippet]) => ({ id, turnId: snippet.ref, text: redactScreeningContacts(snippet.text) })),
        },
    };
}

export function acceptLiveEvidence(input: RoleInput, references: References, raw: unknown, ids: string[],
    { repair = false } = {}) {
    const accepted = new Map<string, RoleJudgement>();
    const diagnostics = new Map<string, LiveEvidenceDiagnostic>();
    const rows = (raw as { criteria?: Record<string, unknown> } | null)?.criteria;
    const snippet = (id: string) => references.answers.get(id);
    const answer = (id: string) => input.turns.get(snippet(id)?.ref ?? '');
    for (const id of ids) {
        let row: Proposed | undefined;
        try { row = liveProposal(rows?.[id]); } catch { /* Invalid row goes through targeted repair. */ }
        const specific = (ref: string | null | undefined) => {
            const question = ref ? references.questions.get(ref) : undefined;
            return question && (!question.topicId || question.topicId === id) ? question : undefined;
        };
        function questionForAnswer(key: string) {
            const candidate = answer(key);
            if (!candidate) return undefined;
            const matching = [...references.questions.values()].filter(question => (!question.topicId || question.topicId === id) &&
                inRoleAnswerWindow(candidate, question, references.followingQuestions.get(question.id)));
            return matching.length === 1 ? matching[0] : undefined;
        }
        const question = specific(row?.questionRef) ??
            (row?.basis === 'DECLINED' ? questionForAnswer(row.answerRef) : undefined);
        const redirect = row?.basis === 'AFTER_REDIRECTION' ? specific(row.redirectRef) : undefined;
        const reject = (...reasons: Issue[]) => diagnostics.set(id, { questionRefs: [question?.id, redirect?.id].filter((value): value is string => Boolean(value)),
            reasons: [...new Set(reasons)] });
        if (!row || !row.reason.trim() || /\b(?:pembohong|pasti berbohong|skor kejujuran)\b/iu.test(row.reason)) {
            reject('INVALID_OUTPUT'); continue;
        }
        const inWindow = (answerTurn: RoleTranscriptEntry, tested: RoleTranscriptEntry) =>
            inRoleAnswerWindow(answerTurn, tested, references.followingQuestions.get(tested.id));
        const set = (level: number | null, clarityValue: number | null, ids: string[], discrepancy?: string | null) =>
            accepted.set(id, { level, clarity: clarityValue, basis: row.basis, reason: row.reason.trim(),
                evidence: [...new Set(ids.map(key => snippet(key)!.id))], questionRef: question?.id ?? null,
                redirectRef: redirect?.id ?? null, discrepancyRef: discrepancy ? snippet(discrepancy)!.id : null });
        if (row.basis === 'INSUFFICIENT') {
            if (row.questionRef && !question) { reject('INVALID_QUESTION_REF'); continue; }
            const hasSubstantiveAnswer = ({ id: answerId }: { id: string }) => {
                const turn = answer(answerId);
                const evidence = snippet(answerId)?.text.trim();
                return turn && !turn.clarification && evidence &&
                    !/^(?:(?:gua|gue|saya|aku)\s+)?(?:belum pernah|belum tahu|kurang tahu|ya|iya)[!. ]*$/iu.test(evidence);
            };
            // An omitted question reference cannot hide an answer. The repair
            // may confirm that the transcript has no evidence for this criterion.
            const available = question ? question.playback !== 'INTERRUPTED' &&
                questionAnswerCandidates(input, references, question).some(hasSubstantiveAnswer) :
                !repair && [...references.answers.keys()].some(answerId => hasSubstantiveAnswer({ id: answerId }));
            if (available) { reject('INSUFFICIENT_WITH_ANSWER'); continue; }
            set(null, null, []);
            continue;
        }
        if (row.basis === 'EVIDENCE') {
            const evidence = row.evidence.filter(key => {
                const turn = answer(key);
                return turn && !turn.clarification && !clearlyCannotAnswer(snippet(key)!.text);
            });
            if (!evidence.length) {
                if (row.evidence.some(key => Boolean(answer(key)))) { reject('CLARIFICATION_ONLY'); continue; }
                reject('INVALID_ANSWER_REF'); continue;
            }
            const level = row.fit === 'TRANSFERABLE' ? Math.min(row.level, 2) : row.level;
            const action = row.actionRef;
            if (level >= 3 && (!action || !evidence.includes(action) ||
                !answer(action) || answer(action)!.clarification || clearlyCannotAnswer(snippet(action)!.text))) {
                reject('ACTION_REF_OUTSIDE_EVIDENCE'); continue;
            }
            if (row.requiresQuestionContext && (!question || !evidence.some(key => inWindow(answer(key)!, question)))) {
                reject(question ? 'ANSWER_OUTSIDE_QUESTION' : 'INVALID_QUESTION_REF'); continue;
            }
            const discrepancy = row.discrepancyRef && evidence.includes(row.discrepancyRef) &&
                input.plan.claims.some(claim => claim.criterionId === id) ? row.discrepancyRef : null;
            set(level, row.clarity, evidence, discrepancy);
            continue;
        }
        function opportunity(tested: RoleTranscriptEntry | undefined, key: string, responseConfirmsQuestion = false): Issue[] {
            const candidate = answer(key);
            if (!tested) return ['INVALID_QUESTION_REF'];
            if (!candidate) return ['INVALID_ANSWER_REF'];
            if (!inWindow(candidate, tested)) return ['ANSWER_OUTSIDE_QUESTION'];
            if (candidate.clarification) return ['CLARIFICATION_ONLY'];
            if (candidate.cutShort) return ['ANSWER_CUT_SHORT'];
            if (tested.playback === 'INTERRUPTED' || tested.opportunity === 'PLAYBACK_INTERRUPTED') return ['QUESTION_INTERRUPTED'];
            return connectedExchange(tested, candidate, responseConfirmsQuestion) ? [] : ['QUESTION_NOT_CONFIRMED'];
        }
        if (row.basis === 'DECLINED') {
            const spoken = answer(row.answerRef);
            const declined = Boolean(spoken && clearlyCannotAnswer(spoken.text));
            const reasons = opportunity(question, row.answerRef, declined);
            if (spoken && !declined) reasons.push('DECLINE_NOT_EXPLICIT');
            if (reasons.length) { reject(...reasons); continue; }
            set(0, 0, [row.answerRef]);
            continue;
        }
        const reasons = [...opportunity(question, row.firstAnswerRef), ...opportunity(redirect, row.lastAnswerRef)];
        if (question && redirect && redirect.startMs <= question.endMs)
            reasons.push('INVALID_QUESTION_REF');
        if (reasons.length) { reject(...reasons); continue; }
        set(0, 0, [row.firstAnswerRef, row.lastAnswerRef]);
    }
    return { accepted, diagnostics };
}

export function missingLiveOpportunity(diagnostic: LiveEvidenceDiagnostic) {
    return diagnostic.reasons.length > 0 && diagnostic.reasons.every(reason => [
        'QUESTION_INTERRUPTED', 'QUESTION_NOT_CONFIRMED', 'CLARIFICATION_ONLY', 'ANSWER_CUT_SHORT', 'DECLINE_NOT_EXPLICIT',
    ].includes(reason));
}
