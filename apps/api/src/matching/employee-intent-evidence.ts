import { createHash } from 'node:crypto';
import { parseCvText } from '../profiles/cv-parser';
import { EmployeeOccupationIndex, employeeOccupationRevision, type IntentRole } from './employee-occupation';
export const EMPLOYEE_EVIDENCE_PARSER = 'employee-cv-v3.1';
export const employeeEvidenceParserVersion = (roles: IntentRole[]) => EMPLOYEE_EVIDENCE_PARSER + '@' + employeeOccupationRevision(roles);
export type IntentSkill = {
    id: string;
    name: string;
    nameId?: string | null;
    nameUz?: string | null;
    nameRu?: string | null;
    slug: string;
    matchingKind: string;
    aliases: Array<{
        alias: string;
    }>;
};
export type EvidenceSource = {
    source: 'CV' | 'USER';
    confirmed: boolean;
};
export type IntentFacts = {
    roles: Array<EvidenceSource & {
        key: string;
        jobTitleId: string;
        title: string;
    }>;
    skills: Array<EvidenceSource & {
        key: string;
        skillId: string;
        level: string | null;
    }>;
    experiences: Array<EvidenceSource & {
        key: string;
        title: string;
        jobTitleId: string | null;
        startDate: string | null;
        endDate: string | null;
        isCurrent: boolean;
        seniority: string | null;
    }>;
    languages: Array<EvidenceSource & {
        key: string;
        code: string;
        level: string | null;
    }>;
};
export type EvidenceOverride = {
    kind: 'SKILL' | 'EXPERIENCE' | 'ROLE' | 'LANGUAGE';
    key: string;
    excluded?: boolean;
    value?: Record<string, unknown>;
};
const stable = (kind: string, value: unknown) => kind + ':' + createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function seniorityOf(text: string): string | null {
    const rules: Array<[
        RegExp,
        string
    ]> = [[/\b(?:executive|direktur|director)\b/iu, 'EXECUTIVE'], [/\b(?:lead|kepala|head)\b/iu, 'LEAD'], [/\b(?:senior|sr\.?)\b/iu, 'SENIOR'], [/\b(?:middle|mid[- ]level)\b/iu, 'MIDDLE'], [/\b(?:junior|jr\.?)\b/iu, 'JUNIOR'], [/\b(?:intern|internship|magang)\b/iu, 'INTERN']];
    return rules.find(([re]) => re.test(text))?.[1] ?? null;
}
/** Year-only dates establish chronology, not an invented January anniversary. */
function groundedDate(value: string | null | undefined, text: string): string | null {
    if (!value)
        return null;
    const year = value.slice(0, 4), month = value.slice(5, 7);
    const names = [['jan', 'januari', 'january'], ['feb', 'februari', 'february'], ['mar', 'maret', 'march'], ['apr', 'april'], ['may', 'mei'], ['jun', 'juni', 'june'], ['jul', 'juli', 'july'], ['aug', 'agu', 'agustus', 'august'], ['sep', 'september'], ['oct', 'okt', 'oktober', 'october'], ['nov', 'november'], ['dec', 'des', 'desember', 'december']][Number(month) - 1] ?? [];
    const pattern = new RegExp(`(?:${year}[-/]${month}(?:[-/]\\d{2})?|(?:${names.join('|')})\\p{L}*\\s+${year})`, 'iu');
    return pattern.test(text) ? value : null;
}
export function parseEmployeeEvidence(text: string, index: EmployeeOccupationIndex, skills: IntentSkill[], languages: Array<{
    code: string;
    name: string;
    aliases?: Array<{
        alias: string;
        aliasKey: string;
    }>;
}>, identity?: {
    fullName?: string | null;
}): IntentFacts {
    let removedName = false;
    let careerSection = false;
    const normalizedName = identity?.fullName?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const careerText = text.split(/\r?\n/).filter((line, i) => {
        if (/^(?:skills|keahlian|keterampilan|pengalaman|work experience|professional experience|education|pendidikan|summary|ringkasan)\b/iu.test(line.trim()))
            careerSection = true;
        if (i < 8 && !careerSection && !removedName && normalizedName && line.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName) {
            removedName = true;
            return false;
        }
        return true;
    }).join('\n');
    // Personal contact tokens and profile URLs are not evidence of a skill.
    const skillText = careerText.replace(/\S+@\S+|https?:\/\/\S+/giu, ' ');
    const parsed = parseCvText(careerText, [], languages);
    const facts: IntentFacts = { roles: [], skills: [], experiences: [], languages: [] };
    for (const line of careerText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 8)) {
        const id = index.resolveEvidence(line);
        if (id && !facts.roles.some(r => r.jobTitleId === id))
            facts.roles.push({ key: stable('role', id), jobTitleId: id, title: line, source: 'CV', confirmed: false });
    }
    for (const skill of skills) {
        const labels = [skill.name, skill.nameId, skill.nameUz, skill.nameRu, ...skill.aliases.map(a => a.alias)].filter((s): s is string => Boolean(s));
        if (labels.some(label => new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(label).replace(/\s+/g, '\\s+')}(?=[^\\p{L}\\p{N}]|$)`, 'iu').test(skillText)))
            facts.skills.push({ key: stable('skill', skill.id), skillId: skill.id, level: null, source: 'CV', confirmed: false });
    }
    for (const row of parsed.experiences) {
        const key = stable('experience', [row.title.trim().toLowerCase(), row.companyName.trim().toLowerCase(), row.startDate ?? null]);
        if (facts.experiences.some(e => e.key === key))
            continue;
        facts.experiences.push({ key, title: row.title, jobTitleId: index.resolveEvidence(row.title), startDate: groundedDate(row.startDate, careerText), endDate: row.isCurrent ? null : groundedDate(row.endDate, careerText), isCurrent: Boolean(row.isCurrent), seniority: seniorityOf(row.title), source: 'CV', confirmed: false });
    }
    for (const row of parsed.languages)
        if (row.code)
            facts.languages.push({ key: stable('language', row.code), code: row.code, level: row.level ?? null, source: 'CV', confirmed: false });
    return facts;
}
const collections = { SKILL: 'skills', EXPERIENCE: 'experiences', ROLE: 'roles', LANGUAGE: 'languages' } as const;
export function applyEmployeeOverrides(facts: IntentFacts, overrides: EvidenceOverride[]): IntentFacts {
    const result = structuredClone(facts);
    for (const override of overrides) {
        const list = result[collections[override.kind]] as Array<{
            key: string;
        } & Record<string, unknown>>;
        const at = list.findIndex(row => row.key === override.key);
        if (override.excluded) {
            if (at >= 0)
                list.splice(at, 1);
            continue;
        }
        if (!override.value)
            continue;
        const value = { ...(at >= 0 ? list[at] : {}), ...override.value, key: override.key, source: 'USER', confirmed: true };
        if (at >= 0)
            list[at] = value;
        else
            list.push(value);
    }
    return result;
}
export const hasEmployeeCareerEvidence = (facts: IntentFacts) => facts.roles.length > 0 || facts.skills.length > 0 || facts.experiences.some(e => e.jobTitleId);
export function evidenceConflicts(facts: IntentFacts, overrides: EvidenceOverride[]) {
    const keys = new Set(Object.values(facts).flatMap(rows => rows.map((r: {
        key: string;
    }) => r.key)));
    return overrides.filter(row => !row.key.startsWith('user:') && !keys.has(row.key)).map(row => row.key);
}
