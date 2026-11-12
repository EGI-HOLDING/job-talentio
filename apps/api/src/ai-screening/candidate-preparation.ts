import { normalizeSkillKey } from '../common/skill-resolve';
import { TIMED_CONVERSATION } from './conversation.policy';
import { openConversation } from './prompts/shared/conversation-opening';
import { validQuestion, type CandidatePayload, type Claim, type Criterion, type JsonSchema, type PackagePayload } from './screening.schemas';

export const CANDIDATE_PREPARATION_MS = 60_000;
const MAX_PROPOSALS = 8;
const MAX_SEGMENT = 440;
const text: JsonSchema = { type: 'string' };
export const CANDIDATE_REFERENCES_SCHEMA: JsonSchema = {
    type: 'object', required: ['claims'], additionalProperties: false,
    properties: { claims: { type: 'array', maxItems: MAX_PROPOSALS, items: {
        type: 'object', additionalProperties: false, required: ['sourceRef', 'skillText', 'criterionId', 'relevance'],
        properties: { sourceRef: text, skillText: { type: 'string', maxLength: 80 }, criterionId: text,
            relevance: { type: 'string', enum: ['CORE', 'SUPPORTING'] } },
    } } },
};

type Segment = { id: string; text: string; lineStart: number; lineEnd: number };
export type CandidateJob = { description?: string; responsibilities?: string[]; jobSkills?: Array<{
    skillId?: string; isRequired?: boolean; skill?: { name: string; aliases?: Array<{ aliasKey: string; alias?: string }> };
}> };
type ProposedClaim = { sourceRef?: unknown; skillText?: unknown; criterionId?: unknown; relevance?: unknown;
    skill?: unknown; quote?: unknown; lineStart?: unknown; lineEnd?: unknown };
type RankedClaim = { claim: Omit<Claim, 'id'>; key: string; priority: number };
const normalize = (s: string) => s.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/gu, '-').replace(/\s+/gu, ' ').trim();
const folded = (s: string) => normalize(s).toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function skillMatch(skill: string, source: string) {
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}+#])(?<![\\p{L}\\p{N}][.-])${escape(skill)}(?![\\p{L}\\p{M}\\p{N}+#]|[.-][\\p{L}\\p{N}])`, 'iu').exec(source);
}

function skillLabel(value: unknown) {
    if (typeof value !== 'string') return null;
    const label = normalize(value);
    return label.length <= 80 && label.split(' ').length <= 8 && /\p{L}/u.test(label) &&
        /^[\p{L}\p{M}\p{N} .+#&/()-]+$/u.test(label) ? label : null;
}

export function candidateEvidence(cvText: string, fullName: string): Segment[] {
    const lines = cvText.split(/\r?\n/).map(line => line.trim());
    const name = folded(fullName);
    const eligible = lines.map(line => Boolean(line && folded(line) !== name && !/@/.test(line) && !/^[+\d ()-]{8,}$/.test(line)));
    return lines.flatMap((line, i) => {
        if (!eligible[i]) return [];
        const segments: Segment[] = [];
        let rest = line, part = 1;
        while (rest) {
            const space = rest.length > MAX_SEGMENT ? rest.lastIndexOf(' ', MAX_SEGMENT) : -1;
            const end = space > 0 ? space : MAX_SEGMENT;
            segments.push({ id: `cv-${i + 1}-${part++}`, text: rest.slice(0, end), lineStart: i + 1, lineEnd: i + 1 });
            rest = rest.slice(end).trimStart();
        }
        const next = lines[i + 1];
        if (eligible[i + 1] && line.length + next.length < MAX_SEGMENT &&
            !/[:.!?;]$/.test(line) && /^(?:\p{Ll}|[,+(])/u.test(next)) {
            segments.push({ id: `cv-${i + 1}-wrap`, text: line + '\n' + next, lineStart: i + 1, lineEnd: i + 2 });
        }
        return segments;
    });
}

function alternativeCriterion(rubric: PackagePayload, job: CandidateJob) {
    for (const duty of job.responsibilities ?? []) {
        const criterion = rubric.criteria.find(row => row.requirementRef.trim() && folded(duty).includes(folded(row.requirementRef)));
        if (criterion) return { criterion, duty };
    }
    const criterion = rubric.criteria.find(row => row.requirementRef.trim() && folded(job.description ?? '').includes(folded(row.requirementRef)));
    return { criterion: criterion ?? rubric.criteria[0], duty: criterion?.requirementRef ?? job.responsibilities?.find(duty => duty.trim()) };
}

function alternativePlan(criterion: Criterion, duty?: string): CandidatePayload {
    const label = duty && normalize(duty).replace(/[^\p{L}\p{M}\p{N} .,+#&/()-]/gu, '').trim();
    const target = label && label.length <= 75 && label.split(' ').length <= 12 ? label : 'tanggung jawab utama posisi ini';
    return { claims: [], limitations: [], alternativeCriterionId: criterion.id,
        alternativeQuestion: openConversation(`Pernah ada proyek atau kegiatan yang berkaitan sama ${target}?`) };
}

function explicitContext(segment: Segment, label: string) {
    const input = normalize(segment.text);
    const match = skillMatch(label, input);
    if (!match) return null;
    const prefix = input.slice(0, match.index);
    const action = prefix.match(/(?:^|[.;]\s*|[-•]\s+)((?:membuat|merancang|mendesain|mengembangkan|mengedit|mengolah|menganalisis|mengelola|membangun|membantu|memimpin|built|created|designed|developed|edited|managed|analy[sz]ed|led|assisted)\s+[^.;:\n]{3,220}?\b(?:dengan|pakai|memakai|menggunakan|using|with|in)\s+)$/iu);
    if (!action || /\b(?:belum|tidak|rencana|ingin|never|learning to|planning)\b/iu.test(action[1])) return null;
    const context = action[1] + match[0];
    const evidence: NonNullable<Claim['extraEvidence']> = [{ field: 'CONTEXT', cvQuote: context.slice(-180) }];
    const boundary = context.match(/^(?:membantu|memimpin|assisted|led)\b[^,;]{0,140}/iu);
    if (boundary) evidence.push({ field: 'ROLE_BOUNDARY', cvQuote: boundary[0] });
    const tail = input.slice(match.index + match[0].length);
    const result = tail.match(/^(?:\s*(?:,|dan|and|sehingga|resulting in)\s*)+(?:(?:meningkatkan|menurunkan|mengurangi|mencapai|increased|decreased|reduced|achieved)\s+[^;.!?]{0,140}?\d+(?:[.,]\d+)?(?:\s*%)?)/iu);
    if (result) evidence.push({ field: 'RESULT', cvQuote: result[0].trim() });
    return { statement: context.slice(-180), evidence };
}

function usableMention(segment: Segment, label: string) {
    const source = normalize(segment.text);
    const found = skillMatch(label, source);
    return found && !/\b(?:belum|tidak|tak|never|no experience)\b[^.;,\n]{0,45}$/iu.test(source.slice(0, found.index)) ? found : null;
}

function proposedClaims(response: unknown) {
    if (!response || typeof response !== 'object' || !('claims' in response) || !Array.isArray(response.claims)) return [];
    return response.claims.slice(0, MAX_PROPOSALS).filter((row): row is ProposedClaim => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
}

export function buildCandidatePreparation(segments: Segment[], rubric: PackagePayload, job: CandidateJob,
    responses: unknown[], { recoverStored = false, alternativeOnly = false } = {}) {
    const { criterion, duty } = alternativeCriterion(rubric, job);
    if (!criterion) throw new Error('JOB_CONTEXT_FAILED');
    const alternate = () => alternativePlan(criterion, duty);
    if (alternativeOnly) return { payload: alternate(), rejected: 0, proposals: 0 };

    const byId = new Map(segments.map(segment => [segment.id, segment]));
    const criteria = new Map(rubric.criteria.map(row => [row.id, row]));
    const requested = (job.jobSkills ?? []).flatMap(row => row.skill ? [{
        id: row.skillId ?? row.skill.name, required: row.isRequired === true, name: row.skill.name,
        labels: [row.skill.name, ...(row.skill.aliases ?? []).flatMap(alias => alias.alias ? [alias.alias] : [])],
        keys: new Set([normalizeSkillKey(row.skill.name), ...(row.skill.aliases ?? []).map(alias => alias.aliasKey)]),
    }] : []);
    const catalog = (label: string) => {
        const matches = requested.filter(row => row.keys.has(normalizeSkillKey(label)));
        return matches.length === 1 ? matches[0] : undefined;
    };
    function makeClaim(segment: Segment, label: string, criterionId: string, relevance: 'CORE' | 'SUPPORTING', allowContext = true): RankedClaim | null {
        const sourceLabel = usableMention(segment, label);
        if (!sourceLabel) return null;
        const skill = sourceLabel[0], employerSkill = catalog(skill);
        const context = allowContext ? explicitContext(segment, skill) : null;
        const question = context ? `Soal ${skill}, bagian mana dari contoh di CV yang lu kerjain sendiri?`
            : `Soal ${skill} yang lu tulis di CV, bisa ceritain satu contoh waktu lu pakai?`;
        if (!validQuestion(openConversation(question), TIMED_CONVERSATION)) return null;
        return { key: employerSkill ? `catalog:${employerSkill.id}` : folded(skill), priority: employerSkill?.required ? 0 : relevance === 'CORE' ? 1 : 2,
            claim: { skill, criterionId, statement: context?.statement ?? skill, quote: segment.text,
                lineStart: segment.lineStart, lineEnd: segment.lineEnd, question, scope: context ? 'CONTEXTUAL' : 'GENERAL',
                relevance: employerSkill?.required ? 'CORE' : relevance,
                ...(employerSkill ? { requirementRef: employerSkill.name } : {}),
                extraEvidence: context?.evidence ?? [] } };
    }

    const proposals = responses.flatMap(proposedClaims);
    const ranked: RankedClaim[] = [];
    for (const proposal of proposals) {
        const label = skillLabel(proposal.skillText ?? (recoverStored ? proposal.skill : undefined));
        if (!label || typeof proposal.criterionId !== 'string' || !criteria.has(proposal.criterionId) ||
            proposal.relevance !== 'CORE' && proposal.relevance !== 'SUPPORTING') continue;
        let selected = typeof proposal.sourceRef === 'string' ? byId.get(proposal.sourceRef) : undefined;
        let allowContext = true;
        if (!selected && proposal.sourceRef === undefined && recoverStored && typeof proposal.skill === 'string' && typeof proposal.quote === 'string') {
            const quote = folded(proposal.quote);
            const matching = quote ? segments.filter(segment => folded(segment.text).includes(quote) && usableMention(segment, label)) : [];
            selected = matching.find(segment => segment.lineStart === proposal.lineStart && segment.lineEnd === proposal.lineEnd)
                ?? (matching.length === 1 ? matching[0] : undefined);
            if (!selected) {
                const literal = segments.filter(segment => segment.lineStart === segment.lineEnd && usableMention(segment, label));
                if (literal.length === 1) { selected = literal[0]; allowContext = false; }
            }
        }
        const accepted = selected && makeClaim(selected, label, proposal.criterionId, proposal.relevance, allowContext);
        if (accepted) ranked.push(accepted);
    }
    const rejected = proposals.length - ranked.length;
    if (!ranked.length) {
        for (const row of requested) {
            for (const value of row.labels) {
                const label = skillLabel(value);
                if (!label || catalog(label)?.id !== row.id) continue;
                const source = segments.find(segment => usableMention(segment, label));
                if (!source) continue;
                const linked = rubric.criteria.find(item => row.labels.some(term => skillMatch(normalize(term), normalize(item.name + ' ' + item.requirementRef)))) ?? criterion;
                const accepted = makeClaim(source, label, linked.id, row.required ? 'CORE' : 'SUPPORTING');
                if (accepted) { ranked.push(accepted); break; }
            }
        }
    }

    const seen = new Set<string>(), claims: Claim[] = [];
    ranked.sort((a, b) => a.priority - b.priority || Number(b.claim.scope === 'CONTEXTUAL') - Number(a.claim.scope === 'CONTEXTUAL'));
    for (const { claim, key } of ranked) {
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push({ ...claim, id: `skill-${claims.length}`, question: claims.length ? claim.question : openConversation(claim.question) });
        if (claims.length === TIMED_CONVERSATION.maxCore) break;
    }
    const payload = claims.length ? { claims, limitations: [], alternativeCriterionId: null } : alternate();
    return { payload, rejected, proposals: proposals.length };
}
