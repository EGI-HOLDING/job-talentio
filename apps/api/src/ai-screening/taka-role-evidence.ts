import { redactScreeningContacts } from './screening.policy';
import { assertSchema, type JsonSchema } from './screening.schemas';
import { explicitRoleDecline, freezeRoleAssessment, type RoleInput, type RoleJudgement, type RoleTranscriptEntry } from './taka-role-assessment';
import { TAKA_ROLE_EVIDENCE_VERSION } from './taka-versions';

const str: JsonSchema = { type: 'string' };
const points: JsonSchema = { type: 'integer', enum: [0, 1, 2, 3, 4] };
const enums = (...values: string[]): JsonSchema => ({ ...str, enum: values });
const nullable = (value: JsonSchema): JsonSchema => ({ anyOf: [value, { type: 'null' }] });
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false });
const questionRef: JsonSchema = { ...str, pattern: '^q[1-9][0-9]*$' };
const answerRef: JsonSchema = { ...str, pattern: '^a[1-9][0-9]*$' };
const common = { level: nullable(points), clarity: nullable(points),
    basis: enums('EVIDENCE', 'DECLINED', 'AFTER_REDIRECTION', 'INSUFFICIENT'),
    fit: nullable(enums('DIRECT', 'TRANSFERABLE')), actionRef: nullable(answerRef), requiresQuestionContext: { type: 'boolean' },
    reason: { ...str, maxLength: 350 }, evidence: { type: 'array', maxItems: 4, items: answerRef },
    discrepancyRef: nullable(answerRef) } satisfies Record<string, JsonSchema>;
const providerRow = object({ ...common, questionRef: nullable(questionRef), redirectRef: nullable(questionRef) });
// The server can still recover independent positive evidence when only a question pointer is malformed.
const recoverableRow = object({ ...common, questionRef: nullable(str), redirectRef: nullable(str) });
type Proposed = RoleJudgement & { fit: 'DIRECT' | 'TRANSFERABLE' | null; actionRef: string | null; requiresQuestionContext: boolean };

export function roleEvidenceReferences(input: RoleInput) {
    const questions = new Map(input.transcript.filter(row => row.speaker === 'TARA' && row.question)
        .map((row, i) => ['q' + (i + 1), row] as const));
    const answers = new Map(input.catalog.map((row, i) => ['a' + (i + 1), row] as const));
    const followingQuestions = new Map([...questions.values()].map((question, index, all) => [question.id, all[index + 1]?.startMs]));
    return { questions, answers, followingQuestions };
}

export function roleEvidenceRequest(input: RoleInput, refs: ReturnType<typeof roleEvidenceReferences>, ids: string[], repair = false) {
    const criteria = input.criteria.filter(row => ids.includes(row.id));
    const preset = freezeRoleAssessment();
    const questionIds = new Map([...refs.questions].map(([id, row]) => [row.id, id]));
    return {
        preset: { ...preset, version: TAKA_ROLE_EVIDENCE_VERSION, name: 'taka_role_evidence',
            schema: object({ criteria: object(Object.fromEntries(criteria.map(row => [row.id, providerRow]))) }),
            instructions: preset.instructions + '\n\n' + [
                'ID kompetensi adalah nama field di criteria. questionRef dan redirectRef memakai qN dari questions. evidence, actionRef dan discrepancyRef memakai aN dari answers. Jangan salin ID kompetensi atau turnId ke field referensi.',
                'Untuk EVIDENCE, fit DIRECT berarti tindakan atau keputusan secara langsung memenuhi fokus kompetensi, termasuk contoh dari pekerjaan lain yang melakukan tindakan yang sama atau jawaban situasional yang konkret. TRANSFERABLE berarti kemiripan sebagian dan batas maksimum 2. Untuk 3 atau 4, wajib pilih actionRef dari evidence yang memuat tindakan atau keputusan pribadi yang langsung menjawab kompetensi. Kata kunci, alat, hasil kerja lain, pengetahuan umum, atau tindakan persiapan saja tidak cukup. Kesepakatan ruang lingkup memerlukan tindakan memperoleh persetujuan. Nilai 4 membutuhkan dukungan kuat untuk seluruh fokus yang diuji.',
                'Pilih questionRef hanya untuk pertanyaan lengkap yang menguji kompetensi itu. Untuk bukti yang cukup secara mandiri, termasuk bukti lintas topik, requiresQuestionContext=false dan questionRef boleh null. Jika jawaban bergantung pada pertanyaan (contoh: "gue lakukan itu"), isi requiresQuestionContext=true dan pilih pertanyaan yang diperlukan.',
                'Untuk penilaian selain EVIDENCE, fit dan actionRef harus null. Untuk DECLINED, kandidat harus eksplisit tidak bisa atau tidak mau memberi contoh atau menjelaskan langkah. Untuk AFTER_REDIRECTION, kandidat harus telah menjawab dua pertanyaan utuh pada kompetensi yang sama dan tetap tidak relevan. Untuk 0, kesempatan pada pertanyaan terkait harus ANSWERED. Diam, jawaban terpotong, dan permintaan mengulang bukan 0. Gunakan INSUFFICIENT bila belum teruji dan cantumkan rujukan pertanyaan bila memang ada.',
                ...(repair ? ['Perbaiki hanya kompetensi yang diminta. Periksa kembali rujukan, kesempatan menjawab, serta kecocokan tindakan dengan kompetensi. Kembalikan INSUFFICIENT jika penilaian tidak dapat dibuktikan.'] : []),
            ].join('\n\n'),
        },
        data: { role: input.rubric.title, criteria: criteria.map(criterion => ({ ...criterion,
            cvClaims: input.plan.claims.filter(claim => claim.criterionId === criterion.id)
                .map(({ id, quote, scope }) => ({ id, quote: redactScreeningContacts(quote), scope })) })),
            transcript: input.transcript.map(({ id, speaker, startMs, endMs, text }) => ({ turnId: id, speaker, startMs, endMs,
                question: questionIds.get(id), text: redactScreeningContacts(text) })),
            questions: [...refs.questions].map(([id, row]) => ({ id, turnId: row.id, opportunity: row.opportunity })),
            answers: [...refs.answers].map(([id, row]) => ({ id, turnId: row.ref, text: redactScreeningContacts(row.text) })),
        },
    };
}

export function acceptRoleEvidence(input: RoleInput, refs: ReturnType<typeof roleEvidenceReferences>, raw: unknown, ids: string[]) {
    const accepted = new Map<string, RoleJudgement>();
    const rows = (raw as { criteria?: Record<string, Proposed> } | null)?.criteria;
    for (const id of ids) {
        const row = rows?.[id];
        try { assertSchema(recoverableRow, row); } catch { continue; }
        if (!row || !row.reason.trim() || /\b(?:pembohong|pasti berbohong|skor kejujuran)\b/iu.test(row.reason)) continue;
        if (row.evidence.some(ref => !refs.answers.has(ref)) || row.discrepancyRef !== null &&
            (!row.evidence.includes(row.discrepancyRef) || !input.plan.claims.some(claim => claim.criterionId === id))) continue;
        const question = verifiedRef(row.questionRef);
        const redirect = verifiedRef(row.redirectRef);
        const invalidQuestion = row.questionRef !== null && !question || row.redirectRef !== null && !redirect;
        function verifiedRef(ref: string | null) {
            const entry = ref ? refs.questions.get(ref) : undefined;
            return entry && (!entry.topicId || entry.topicId === id) ? entry : undefined;
        }
        const original = (ref: string) => input.turns.get(refs.answers.get(ref)!.ref)!;
        const inWindow = (answer: RoleTranscriptEntry, tested: RoleTranscriptEntry) => answer.startMs >= tested.endMs - 150 &&
            answer.endMs >= tested.endMs && answer.startMs < (refs.followingQuestions.get(tested.id) ?? Infinity);
        let { level, clarity } = row;
        if (row.basis === 'EVIDENCE') {
            if (level === null || level <= 0 || clarity === null || !row.evidence.length || !row.fit ||
                row.actionRef !== null && !row.evidence.includes(row.actionRef)) continue;
            const context = redirect ?? question;
            if (row.requiresQuestionContext && (invalidQuestion || context?.opportunity !== 'ANSWERED' ||
                !row.evidence.some(ref => inWindow(original(ref), context)))) continue;
            if (row.fit === 'TRANSFERABLE') {
                level = Math.min(level, 2);
            } else if (level >= 3 && (!row.actionRef || explicitRoleDecline(original(row.actionRef).text))) continue;
        } else {
            if (invalidQuestion || row.fit !== null || row.actionRef !== null || row.discrepancyRef !== null) continue;
            if (row.basis === 'INSUFFICIENT') {
                if (level !== null || clarity !== null || row.evidence.length) continue;
            } else {
                if (level !== 0 || clarity !== 0 || question?.opportunity !== 'ANSWERED' || !row.evidence.length) continue;
                if (row.basis === 'DECLINED') {
                    if (redirect || !row.evidence.every(ref => inWindow(original(ref), question) && explicitRoleDecline(original(ref).text))) continue;
                } else if (redirect?.opportunity !== 'ANSWERED' || redirect.startMs <= question.endMs ||
                    !row.evidence.some(ref => inWindow(original(ref), question)) || !row.evidence.some(ref => inWindow(original(ref), redirect)) ||
                    !row.evidence.every(ref => inWindow(original(ref), question) || inWindow(original(ref), redirect))) continue;
            }
        }
        accepted.set(id, { level, clarity, basis: row.basis, reason: row.reason.trim(),
            evidence: [...new Set(row.evidence.map(ref => refs.answers.get(ref)!.id))], questionRef: question?.id ?? null,
            redirectRef: redirect?.id ?? null, discrepancyRef: row.discrepancyRef ? refs.answers.get(row.discrepancyRef)!.id : null });
    }
    return accepted;
}
