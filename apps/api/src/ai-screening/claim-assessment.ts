import { assertSchema, EVALUATION_SCHEMA, validateEvaluation, type AnswerSource, type CandidatePayload, type EvaluationPayload, type JsonSchema, type PackagePayload } from './screening.schemas';

// V2 remains readable; V3 is deliberately scored per sampled CV claim.
const oldClaim: JsonSchema = JSON.parse(JSON.stringify(EVALUATION_SCHEMA.properties!.claims.items!));
export const CLAIM_EVALUATION_SCHEMA: JsonSchema = {
    ...EVALUATION_SCHEMA,
    properties: { ...EVALUATION_SCHEMA.properties, claims: { type: 'array', items: { ...oldClaim,
        properties: { ...oldClaim.properties, score: { type: 'integer', enum: [0, 1, 2, 3, 4] } }, required: [...oldClaim.required!, 'score'] } } },
};
delete CLAIM_EVALUATION_SCHEMA.properties!.criteria;
CLAIM_EVALUATION_SCHEMA.required = EVALUATION_SCHEMA.required!.filter(k => k !== 'criteria');
// Provider-side constraints prevent expensive retry loops for otherwise valid citations.
CLAIM_EVALUATION_SCHEMA.properties!.summary = { type: 'string', maxLength: 450 };
for (const key of ['strengths', 'gaps', 'interviewQuestions']) CLAIM_EVALUATION_SCHEMA.properties![key] = { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 180 } };
const claimFields = CLAIM_EVALUATION_SCHEMA.properties!.claims.items!.properties!;
claimFields.reason = { type: 'string', maxLength: 180 };
claimFields.evidence.maxItems = 2;
claimFields.evidence.items!.properties!.quote = { type: 'string', maxLength: 180 };
claimFields.contradictions.maxItems = 1;
for (const side of ['left','right']) claimFields.contradictions.items!.properties![side].properties!.quote = { type: 'string', maxLength: 180 };

export function assertAnswerOpportunities(plan: CandidatePayload, answers: AnswerSource[]) {
    if (!plan.claims.length) throw Error('NO_CV_CLAIMS');
    for (const claim of plan.claims) {
        const root = answers.find(q => q.claimId === claim.id && q.kind === 'CORE');
        if (!root?.shownAt || !root.answeredAt || root.answer === null)
            throw Error('ANSWER_OPPORTUNITY_MISSING');
    }
    if (answers.some(q => !q.shownAt || !q.answeredAt || q.answer === null)) throw Error('ANSWER_SOURCE_INCOMPLETE');
}

export function validateClaimEvaluation(value: unknown, rubric: PackagePayload, plan: CandidatePayload, answers: AnswerSource[]): EvaluationPayload {
    assertAnswerOpportunities(plan, answers);
    assertSchema(CLAIM_EVALUATION_SCHEMA, value);
    const raw = value as Omit<EvaluationPayload, 'criteria'>;
    // Reuse all citation, contradiction, editorial and source constraints of V2.
    const result = validateEvaluation({ ...raw, claims: raw.claims.map(({ score: _score, ...rest }) => rest), criteria: rubric.criteria.map(c => ({ criterionId: c.id, score: null, reason: '', evidence: [] })) }, rubric, plan, answers);
    result.claims = raw.claims;
    for (const claim of result.claims) {
        if (!Number.isInteger(claim.score) || claim.score! < 0 || claim.score! > 4) throw Error('CLAIM_SCORE_REQUIRED');
        const chain = answers.filter(a => a.claimId === claim.claimId);
        if (!chain.some(q => q.answer?.trim()) && (claim.score !== 0 || claim.status !== 'INSUFFICIENT' || claim.evidence.length)) throw Error('EMPTY_ANSWER_MUST_SCORE_ZERO');
        if (chain.some(q => q.answer?.trim()) && !claim.evidence.length) throw Error('CLAIM_SCORE_REQUIRES_CITATION');
        if (claim.status === 'SUPPORTED' && claim.score! < 3) throw Error('CLAIM_SUPPORT_SCORE_CONFLICT');
        if (claim.status === 'INSUFFICIENT' && claim.score! > 2) throw Error('CLAIM_SUPPORT_SCORE_CONFLICT');
    }
    // Compatibility projection only; the aggregate uses claims, never these rows.
    result.criteria = rubric.criteria.map(c => {
        const rows = result.claims.filter(r => plan.claims.find(p => p.id === r.claimId)?.criterionId === c.id);
        return { criterionId: c.id, score: rows.length ? rows.reduce((s, r) => s + r.score!, 0) / rows.length : null,
            reason: rows.length ? 'Dukungan terhadap klaim CV yang diperiksa.' : 'Tidak termasuk klaim CV yang diperiksa.', evidence: rows.flatMap(r => r.evidence).slice(0, 2) };
    });
    return result;
}

export function unansweredEvaluation(rubric: PackagePayload, plan: CandidatePayload, answers: AnswerSource[]): EvaluationPayload {
    return validateClaimEvaluation({ summary: 'Tidak ada jawaban tersimpan yang mendukung klaim CV yang diperiksa.', strengths: [],
        gaps: ['Konfirmasikan kontribusi kandidat pada klaim yang belum dijelaskan.'], interviewQuestions: [],
        claims: plan.claims.map(c => ({ claimId: c.id, score: 0, status: 'INSUFFICIENT', reason: 'Tidak ada jawaban tersimpan setelah kesempatan menjawab selesai.', evidence: [], contradictions: [] })) }, rubric, plan, answers);
}
