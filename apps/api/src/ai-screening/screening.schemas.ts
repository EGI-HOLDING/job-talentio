import { z } from 'zod';
import { normalizedText } from './screening.policy';
export const draftSchema = z.object({ resumeId: z.string().min(1).optional(), coverLetter: z.string().max(5000).optional(), removeCoverFile: z.boolean().optional(), source: z.string().max(40).regex(/^[a-z0-9_:-]+$/i).optional(), funnelSession: z.string().max(200).optional() }).strict();
export const leaseSchema = z.object({ clientId: z.string().min(10).max(100) }).strict();
export const answerSchema = leaseSchema.extend({ questionId: z.string().min(1), answer: z.string().max(1200) }).strict();
export const questionSchema = leaseSchema.extend({ questionId: z.string().min(1) }).strict();
export type Criterion = {
    id: string;
    name: string;
    requirementRef: string;
    anchors: string[];
};
export type PackagePayload = {
    context: string;
    criteria: Criterion[];
};
export type Claim = {
    id: string;
    criterionId: string;
    statement: string;
    quote: string;
    lineStart: number;
    lineEnd: number;
    question: string;
};
export type CandidatePayload = {
    claims: Claim[];
    limitations: string[];
};
export type FollowUpPayload = {
    stop: boolean;
    question: string | null;
};
export type Evidence = {
    questionId: string;
    quote: string;
};
export type CriterionResult = {
    criterionId: string;
    score: number | null;
    reason: string;
    evidence: Evidence[];
};
export type SourceQuote = {
    source: 'CV' | 'ANSWER';
    ref: string;
    quote: string;
};
export type ClaimResult = {
    claimId: string;
    status: 'SUPPORTED' | 'INSUFFICIENT' | 'CLARIFY';
    reason: string;
    evidence: Evidence[];
    contradictions: Array<{
        left: SourceQuote;
        right: SourceQuote;
    }>;
};
export type EvaluationPayload = {
    summary: string;
    strengths: string[];
    gaps: string[];
    interviewQuestions: string[];
    criteria: CriterionResult[];
    claims: ClaimResult[];
};
export type AnswerSource = {
    id: string;
    answer: string | null;
    criterionId: string;
    claimId: string;
};
export type JsonSchema = {
    type?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: unknown[];
    anyOf?: JsonSchema[];
};
const str: JsonSchema = { type: 'string' }, integer: JsonSchema = { type: 'integer' };
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const evidence = obj({ questionId: str, quote: str });
const sourceQuote = obj({ source: { type: 'string', enum: ['CV', 'ANSWER'] }, ref: str, quote: str });
export const PACKAGE_SCHEMA = obj({ context: str, criteria: arr(obj({ id: str, name: str, requirementRef: str, anchors: arr(str) })) });
export const CANDIDATE_SCHEMA = obj({ claims: arr(obj({ id: str, criterionId: str, statement: str, quote: str, lineStart: integer, lineEnd: integer, question: str })), limitations: arr(str) });
export const FOLLOW_UP_SCHEMA = obj({ stop: { type: 'boolean' }, question: nullable(str) });
export const EVALUATION_SCHEMA = obj({ summary: str, strengths: arr(str), gaps: arr(str), interviewQuestions: arr(str),
    criteria: arr(obj({ criterionId: str, score: nullable({ type: 'integer', enum: [0, 1, 2, 3, 4] }), reason: str, evidence: arr(evidence) })),
    claims: arr(obj({ claimId: str, status: { type: 'string', enum: ['SUPPORTED', 'INSUFFICIENT', 'CLARIFY'] }, reason: str, evidence: arr(evidence), contradictions: arr(obj({ left: sourceQuote, right: sourceQuote })) })) });
export function assertSchema(schema: JsonSchema, value: unknown, path = 'result'): void {
    if (schema.anyOf) {
        if (!schema.anyOf.some(s => {
            try {
                assertSchema(s, value, path);
                return true;
            }
            catch {
                return false;
            }
        }))
            throw new Error('Invalid ' + path);
        return;
    }
    if (schema.enum && !schema.enum.includes(value))
        throw new Error('Invalid ' + path);
    if (schema.type === 'null') {
        if (value !== null)
            throw new Error('Invalid ' + path);
        return;
    }
    if (schema.type === 'array') {
        if (!Array.isArray(value))
            throw new Error('Invalid ' + path);
        for (const v of value)
            assertSchema(schema.items!, v, path + '[]');
        return;
    }
    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Invalid ' + path);
        const data = value as Record<string, unknown>;
        if (Object.keys(data).some(k => !schema.properties?.[k]))
            throw new Error('Unexpected ' + path);
        for (const key of schema.required ?? []) {
            if (!(key in data))
                throw new Error('Missing ' + path + '.' + key);
            assertSchema(schema.properties![key], data[key], path + '.' + key);
        }
        return;
    }
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type)
        throw new Error('Invalid ' + path);
}
const idOk = (id: string) => /^[a-z0-9_-]{1,40}$/.test(id);
export function validQuestion(text: string) { return text.trim().length >= 12 && text.length <= 360 && !/sesi\s*[12]|session\s*[12]/i.test(text) && (text.match(/\?/g) || []).length <= 1; }
export function validatePackage(value: unknown, requirements?: string): PackagePayload {
    assertSchema(PACKAGE_SCHEMA, value);
    const p = value as PackagePayload;
    if (!p.context.trim() || p.context.length > 6000 || p.criteria.length < 3 || p.criteria.length > 5 || new Set(p.criteria.map(c => c.id)).size !== p.criteria.length)
        throw new Error('Invalid job context');
    for (const c of p.criteria) {
        if (!idOk(c.id) || !c.name.trim() || c.name.length > 100 || !c.requirementRef.trim() || c.anchors.length !== 5 || c.anchors.some(a => !a.trim() || a.length > 300))
            throw new Error('Invalid criterion');
        if (requirements && !normalizedText(requirements).includes(normalizedText(c.requirementRef)))
            throw new Error('Ungrounded job requirement');
    }
    return p;
}
export function validateCandidate(value: unknown, p: PackagePayload, cvText: string): CandidatePayload {
    assertSchema(CANDIDATE_SCHEMA, value);
    const plan = value as CandidatePayload, lines = cvText.split('\n');
    if (plan.claims.length < 1 || plan.claims.length > 5 || new Set(plan.claims.map(c => c.id)).size !== plan.claims.length || plan.limitations.length > 3 || plan.limitations.some(l => l.length > 220))
        throw new Error('Invalid candidate plan');
    for (const c of plan.claims) {
        if (!idOk(c.id) || !p.criteria.some(x => x.id === c.criterionId) || !c.statement.trim() || c.statement.length > 300 || !c.quote.trim() || c.quote.length > 500 || !validQuestion(c.question))
            throw new Error('Invalid CV claim');
        if (c.lineStart < 1 || c.lineEnd < c.lineStart || c.lineEnd > lines.length || !lines.slice(c.lineStart - 1, c.lineEnd).join('\n').includes(c.quote))
            throw new Error('Ungrounded CV claim');
    }
    return plan;
}
export function validateFollowUp(value: unknown): FollowUpPayload {
    assertSchema(FOLLOW_UP_SCHEMA, value);
    const f = value as FollowUpPayload;
    if (f.stop && f.question !== null || !f.stop && (!f.question || !validQuestion(f.question)))
        throw new Error('Invalid follow-up');
    return f;
}
function validateEvidence(ref: Evidence, questions: AnswerSource[], claimId?: string, criterionId?: string) {
    const q = questions.find(q => q.id === ref.questionId && (!claimId || q.claimId === claimId) && (!criterionId || q.criterionId === criterionId));
    if (!ref.quote.trim() || ref.quote.length > 180 || !q?.answer?.includes(ref.quote))
        throw new Error('Ungrounded answer evidence');
}
export function validateEvaluation(value: unknown, p: PackagePayload, plan: CandidatePayload, questions: AnswerSource[]): EvaluationPayload {
    assertSchema(EVALUATION_SCHEMA, value);
    const e = value as EvaluationPayload;
    if (e.criteria.length !== p.criteria.length || new Set(e.criteria.map(c => c.criterionId)).size !== p.criteria.length || e.claims.length !== plan.claims.length || new Set(e.claims.map(c => c.claimId)).size !== plan.claims.length || e.summary.length > 450 || [e.strengths, e.gaps, e.interviewQuestions].some(a => a.length > 3 || a.some(t => t.length > 180)))
        throw new Error('Invalid evaluation');
    for (const c of e.criteria) {
        if (!p.criteria.some(x => x.id === c.criterionId) || c.reason.length > 120 || c.evidence.length > 2)
            throw new Error('Invalid criterion evaluation');
        const answers = questions.filter(q => q.criterionId === c.criterionId);
        if (c.score !== null && (!answers.some(q => q.answer?.trim()) || !c.evidence.length))
            throw new Error('Scores require answer evidence');
        c.evidence.forEach(r => validateEvidence(r, questions, undefined, c.criterionId));
    }
    for (const c of e.claims) {
        const claim = plan.claims.find(v => v.id === c.claimId);
        if (!claim || c.reason.length > 180 || c.evidence.length > 2 || c.contradictions.length > 1)
            throw new Error('Invalid claim assessment');
        if (c.status === 'SUPPORTED' && !c.evidence.length)
            throw new Error('Claim support requires evidence');
        c.evidence.forEach(r => validateEvidence(r, questions, c.claimId));
        if (c.status === 'CLARIFY' && !c.contradictions.length)
            throw new Error('Discrepancies need source pairs');
        if (c.status !== 'CLARIFY' && c.contradictions.length)
            throw new Error('Unexpected discrepancy');
        for (const pair of c.contradictions) {
            if (pair.left.source !== 'ANSWER' && pair.right.source !== 'ANSWER' || pair.left.quote === pair.right.quote)
                throw new Error('Discrepancy requires distinct answer evidence');
        }
        for (const pair of c.contradictions)
            for (const ref of [pair.left, pair.right]) {
                if (ref.source === 'CV') {
                    if (ref.ref !== claim.id || !ref.quote.trim() || !claim.quote.includes(ref.quote))
                        throw new Error('Ungrounded CV discrepancy');
                }
                else
                    validateEvidence({ questionId: ref.ref, quote: ref.quote }, questions, c.claimId);
            }
    }
    const prose = [e.summary, ...e.strengths, ...e.gaps, ...e.interviewQuestions, ...e.criteria.map(c => c.reason), ...e.claims.flatMap(c => [c.reason, ...c.evidence.map(r => r.quote), ...c.contradictions.flatMap(p => [p.left.quote, p.right.quote])])].join(' ');
    if (prose.split(/\s+/).length > 500)
        throw new Error('Report exceeds editorial limit');
    if (/\b(pembohong|pasti berbohong|terbukti berbohong|skor kejujuran|persentase kejujuran)\b/i.test(prose))
        throw new Error('Unsupported truthfulness conclusion');
    return e;
}
