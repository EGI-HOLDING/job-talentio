import { z } from 'zod';
import { normalizedText } from './screening.policy';
import { CURRENT_CONVERSATION, usesSkillInterview, usesTimedInterview, type ConversationPolicy } from './conversation.policy';
import { openConversation } from './prompts/shared/conversation-opening';
import type { taraInterviewReport } from './tara-interview';
import type { TakaClaimScope, TakaCoverage } from './taka-interview';
import { normalizeSkillKey } from '../common/skill-resolve';
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
    skill?: string;
    requirementRef?: string;
    scope?: 'GENERAL' | 'CONTEXTUAL';
    relevance?: 'CORE' | 'SUPPORTING';
    extraEvidence?: Array<{field: 'CONTEXT' | 'RESULT' | 'ROLE_BOUNDARY'; cvQuote: string}>;
};
export type CandidatePayload = {
    claims: Claim[];
    limitations: string[];
    alternativeCriterionId?: string | null;
    alternativeQuestion?: string;
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
    score?: number | null;
    assessment?: TakaClaimScope;
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
    taraInterview?: ReturnType<typeof taraInterviewReport>;
    interviewAssessment?: TakaCoverage;
};
export type AnswerSource = {
    id: string;
    answer: string | null;
    criterionId: string;
    claimId: string;
    kind?: string;
    shownAt?: Date | string | null;
    answeredAt?: Date | string | null;
    timedOut?: boolean;
};
export type JsonSchema = {
    maxLength?: number;
    pattern?: string;
    maxItems?: number;
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
export function conversationSchemas(policy: ConversationPolicy) {
    const question: JsonSchema = { type: 'string', maxLength: policy.maxCharacters, pattern: `^[^\\s:]+(?:[ \\t]+[^\\s:]+){0,${policy.maxWords - 1}}$` };
    const candidate = structuredClone(CANDIDATE_SCHEMA);
    candidate.properties!.claims.maxItems = policy.maxCore;
    candidate.properties!.claims.items!.properties!.question = question;
    candidate.properties!.limitations.maxItems = 3;
    if (usesSkillInterview(policy)) {
        const item = candidate.properties!.claims.items!;
        Object.assign(item.properties!, {
            skill: str, scope: { type: 'string', enum: ['GENERAL', 'CONTEXTUAL'] },
            relevance: { type: 'string', enum: ['CORE', 'SUPPORTING'] },
        });
        item.required!.push('skill', 'scope', 'relevance');
        if (usesTimedInterview(policy)) {
            item.properties!.extraEvidence = { ...arr(obj({ field: { type: 'string', enum: ['CONTEXT', 'RESULT', 'ROLE_BOUNDARY'] }, cvQuote: { type: 'string', maxLength: 180 } })), maxItems: 3 };
            item.required!.push('extraEvidence');
        }
        candidate.properties!.alternativeCriterionId = nullable(str);
        candidate.required!.push('alternativeCriterionId');
    }
    return { candidate, followUp: obj({ stop: { type: 'boolean' }, question: nullable(question) }) };
}
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
    if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) throw new Error('Invalid ' + path);
    if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error('Too long ' + path);
    if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error('Too many ' + path);
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
function questionEmojiCount(text: string) {
    const segments = new Intl.Segmenter('id', { granularity: 'grapheme' }).segment(text);
    return [...segments].filter(({ segment }) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(segment)).length;
}
export function validQuestion(text: string, policy?: ConversationPolicy) {
    const modern = policy?.probeOrder === 'breadth-first';
    if (modern && (text.includes(':') || /[\r\n]/.test(text) || /^\s*(?:[-*•]|\d+[.)])/.test(text) || text.trim().split(/\s+/u).length > policy.maxWords || questionEmojiCount(text) > 1 || /(?:gue|gw) (?:gak|nggak|ga|tidak) percaya|pembohong|lu bohong|ngaku aja|pasti lolos|skor lu|nilai lu/i.test(text))) return false;
    return text.trim().length >= 12 && (modern ? [...text].length : text.length) <= (policy?.maxCharacters ?? 360) && !/sesi\s*[12]|session\s*[12]/i.test(text) && (text.match(/\?/g) || []).length <= 1;
}
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
export function validateCandidate(value: unknown, p: PackagePayload, cvText: string, policy: ConversationPolicy = CURRENT_CONVERSATION,
    requestedSkills: Array<{skill?:{name: string; aliases?:Array<{aliasKey:string}>}}> = []): CandidatePayload {
    const skillInterview = usesSkillInterview(policy);
    assertSchema(skillInterview ? conversationSchemas(policy).candidate : CANDIDATE_SCHEMA, value);
    const plan = structuredClone(value) as CandidatePayload, lines = cvText.split('\n');
    if (skillInterview) {
        const seen = new Set<string>();
        const aliases = new Map<string, Set<string>>();
        for (const {skill} of requestedSkills) {
            if (!skill) continue;
            const canonical = normalizeSkillKey(skill.name);
            for (const alias of [canonical, ...(skill.aliases ?? []).map(row => normalizeSkillKey(row.aliasKey))]) {
                const matches = aliases.get(alias) ?? new Set<string>();
                matches.add(canonical);
                aliases.set(alias, matches);
            }
        }
        plan.claims = plan.claims.sort((a,b) => Number(b.relevance === 'CORE') - Number(a.relevance === 'CORE')).filter(claim => {
            const skill = normalizedText(claim.skill!);
            const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!skill || skill.length > 100 || !new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(normalizedText(claim.quote)))
                throw new Error('Ungrounded CV skill');
            const labelKey = normalizeSkillKey(skill);
            const matches = aliases.get(labelKey);
            const key = matches?.size === 1 ? [...matches][0] : labelKey;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (plan.claims.length ? plan.alternativeCriterionId !== null
            : !p.criteria.some(criterion => criterion.id === plan.alternativeCriterionId)) throw new Error('Invalid alternative criterion');
    }
    if ((skillInterview || /^tara-conversation-v[56]\./.test(policy.version)) && plan.claims[0])
        plan.claims[0].question = openConversation(plan.claims[0].question);
    if (!skillInterview && plan.claims.length < 1 || plan.claims.length > policy.maxCore || new Set(plan.claims.map(c => c.id)).size !== plan.claims.length || plan.limitations.length > 3 || plan.limitations.some(l => l.length > 220))
        throw new Error('Invalid candidate plan');
    for (const c of plan.claims) {
        if (usesTimedInterview(policy) && (new Set(c.extraEvidence!.map(item => item.field)).size !== c.extraEvidence!.length ||
            c.extraEvidence!.some(item => !item.cvQuote.trim() || !normalizedText(c.quote).includes(normalizedText(item.cvQuote)))))
            throw new Error('Ungrounded evidence requirement');
        if (!idOk(c.id) || !p.criteria.some(x => x.id === c.criterionId) || !c.statement.trim() || c.statement.length > 300 || !c.quote.trim() || c.quote.length > 500 || !validQuestion(c.question, policy) || skillInterview && (c.question.match(/\?/g)?.length !== 1))
            throw new Error('Invalid CV claim');
        if (c.lineStart < 1 || c.lineEnd < c.lineStart || c.lineEnd > lines.length || !lines.slice(c.lineStart - 1, c.lineEnd).join('\n').includes(c.quote)) {
            // PDF line wrapping is not a factual difference. Resolve only a unique
            // literal match with whitespace collapsed; no fuzzy words/punctuation.
            let normalized = ''; const offsets: number[] = [];
            for (let i=0;i<cvText.length;i++) {
                const char = /\s/.test(cvText[i]) ? ' ' : cvText[i];
                if (char === ' ' && normalized.endsWith(' ')) continue;
                normalized += char; offsets.push(i);
            }
            const quote = c.quote.replace(/\s+/g,' ').trim();
            const start = normalized.indexOf(quote);
            if (!quote || start < 0 || normalized.indexOf(quote,start+1) >= 0) throw new Error('Ungrounded CV claim');
            const from = offsets[start], to = offsets[start+quote.length-1]+1;
            c.quote = cvText.slice(from,to);
            c.lineStart = cvText.slice(0,from).split('\n').length;
            c.lineEnd = cvText.slice(0,to).split('\n').length;
            if (c.quote.length > 500) throw new Error('Ungrounded CV claim');
        }
    }
    return plan;
}
export function validateFollowUp(value: unknown, policy: ConversationPolicy = CURRENT_CONVERSATION): FollowUpPayload {
    assertSchema(FOLLOW_UP_SCHEMA, value);
    const f = value as FollowUpPayload;
    if (f.stop && f.question !== null || !f.stop && (!f.question || !validQuestion(f.question, policy)))
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
