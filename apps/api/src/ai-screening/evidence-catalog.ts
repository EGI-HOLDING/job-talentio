import type { AnswerSource, CandidatePayload, EvaluationPayload, JsonSchema } from './screening.schemas';
import { CLAIM_EVALUATION_SCHEMA } from './claim-assessment';
export type EvidenceSnippet = { id: string; source: 'CV' | 'ANSWER'; ref: string; text: string };
export function evidenceCatalog(plan: CandidatePayload, answers: AnswerSource[]): EvidenceSnippet[] {
    const result: EvidenceSnippet[] = [];
    function add(source: 'CV' | 'ANSWER', ref: string, text: string) {
        let start = 0, index = 0;
        while (start < text.length) {
            let end = Math.min(text.length, start + 160);
            if (end < text.length) {
                const boundary = text.lastIndexOf(' ', end);
                if (boundary > start + 40) end = boundary;
            }
            const excerpt = text.slice(start, end).trim();
            if (excerpt) result.push({ id: source.toLowerCase() + ':' + ref + ':' + index++, source, ref, text: excerpt });
            start = end;
        }
    }
    for (const c of plan.claims) add('CV', c.id, c.quote);
    for (const a of answers) if (a.answer?.trim()) add('ANSWER', a.id, a.answer);
    return result;
}
export const CLAIM_PROVIDER_SCHEMA: JsonSchema = JSON.parse(JSON.stringify(CLAIM_EVALUATION_SCHEMA));
const fields = CLAIM_PROVIDER_SCHEMA.properties!.claims.items!.properties!;
fields.evidence.items = { type: 'object', additionalProperties: false, required: ['questionId','quoteRef'], properties: { questionId: { type: 'string' }, quoteRef: { type: 'string' } } };
for (const side of ['left','right']) {
    const object = fields.contradictions.items!.properties![side];
    delete object.properties!.quote;
    object.properties!.quoteRef = { type: 'string' };
    object.required = ['source','ref','quoteRef'];
}
export function resolveEvidence(value: unknown, catalog: EvidenceSnippet[]): Omit<EvaluationPayload, 'criteria'> {
    const raw = structuredClone(value) as any;
    for (const claim of raw.claims ?? []) {
        for (const e of claim.evidence ?? []) {
            const source = catalog.find(s => s.id === e.quoteRef && s.source === 'ANSWER' && s.ref === e.questionId);
            if (!source) throw Error('UNKNOWN_EVIDENCE_REFERENCE');
            e.quote = source.text; delete e.quoteRef;
        }
        for (const pair of claim.contradictions ?? []) for (const e of [pair.left,pair.right]) {
            const source = catalog.find(s => s.id === e.quoteRef && s.source === e.source && s.ref === e.ref);
            if (!source) throw Error('UNKNOWN_EVIDENCE_REFERENCE');
            e.quote = source.text; delete e.quoteRef;
        }
    }
    return raw;
}
