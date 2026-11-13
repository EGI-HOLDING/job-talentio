import { normalizeSkillKey } from '../common/skill-resolve';
import { hash, normalizedText, screeningEnabled } from './screening.policy';
import type { CandidatePayload, PackagePayload } from './screening.schemas';

export const ROLE_ASSESSMENT_VERSION = 'taka-role-assessment-v1';
export const CV_EXTRACTION_VERSION = 'taka-cv-source-v1';
export const ROLE_WEIGHTS = { cv: 30, competency: 60, explanation: 10 } as const;
export const roleAssessmentEnabled = () => screeningEnabled() && process.env.TAKA_ROLE_ASSESSMENT_ENABLED === 'true';

type Job = {
    title: string;
    responsibilities?: string[];
    experienceYearsMin?: number | null;
    jobSkills: Array<{ skill: { name: string; aliases?: Array<{ alias: string }> }; isRequired: boolean; minLevel?: string | null }>;
    jobLanguages: Array<{ language: { name: string }; isRequired: boolean; provenance?: string | null; minLevel?: string | null }>;
};

export type RoleCriterion = {
    id: string;
    name: string;
    requirementRef: string;
    anchors: [string, string, string, string, string];
    question: string;
};
export type RoleRubric = {
    version: typeof ROLE_ASSESSMENT_VERSION;
    revision: string;
    title: string;
    criteria: RoleCriterion[];
    interviewIds: string[];
};

const labelKey = (label: string) => normalizeSkillKey(normalizedText(label));
function requirementContains(text: string, label: string) {
    const tokens = text.split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean).map(labelKey);
    return tokens.some((_, from) => {
        let joined = '';
        for (let to = from; to < tokens.length && joined.length < label.length; to++) joined += tokens[to];
        return joined === label;
    });
}

export function createRoleRubric(job: Job): RoleRubric {
    const title = normalizedText(job.title);
    const duties = [...new Map((job.responsibilities ?? []).flatMap(value => {
        const duty = normalizedText(value).slice(0, 400);
        const key = labelKey(duty);
        return key ? [[key, duty] as const] : [];
    })).values()];
    const candidates: Array<{ key: string; name: string; requirement: string; duty?: string; interview: boolean }> = [];
    for (const duty of duties) {
        candidates.push({ key: 'duty:' + labelKey(duty), name: duty, requirement: duty, duty, interview: true });
    }
    const skills = job.jobSkills.filter(skill => skill.isRequired).map(row => ({
        name: normalizedText(row.skill.name), level: row.minLevel ?? null,
        aliases: [...new Set([row.skill.name, ...(row.skill.aliases ?? []).map(value => value.alias)].map(labelKey))].sort(),
    })).filter(row => labelKey(row.name)).sort((a, b) => a.name.localeCompare(b.name, 'id') || (a.level ?? '').localeCompare(b.level ?? ''));
    const seen = new Set<string>();
    for (const skill of skills) {
        if (skill.aliases.some(alias => seen.has(alias))) continue;
        skill.aliases.forEach(alias => seen.add(alias));
        const duty = candidates.find(row => row.duty && skill.aliases.some(alias => alias && requirementContains(row.duty!, alias)));
        const detail = skill.name + (skill.level ? ' (level ' + skill.level + ')' : '');
        if (duty) duty.requirement += ' · Keahlian wajib: ' + detail;
        else candidates.push({ key: 'skill:' + labelKey(skill.name), name: skill.name, requirement: detail, interview: true });
    }
    for (const row of job.jobLanguages.filter(row => row.isRequired && row.provenance === 'EMPLOYER_CONFIRMED')
        .sort((a, b) => a.language.name.localeCompare(b.language.name, 'id'))) {
        const name = normalizedText(row.language.name);
        if (!name) continue;
        candidates.push({ key: 'language:' + labelKey(name), name, requirement: 'Bahasa wajib: ' + name + (row.minLevel ? ' · ' + row.minLevel : ''), interview: false });
    }
    if (job.experienceYearsMin && job.experienceYearsMin > 0) {
        candidates.push({ key: 'experience', name: 'Pengalaman minimum', requirement: 'Pengalaman relevan minimal ' + job.experienceYearsMin + ' tahun.', interview: false });
    }
    const unique = [...new Map(candidates.map(row => [row.key, row])).values()];
    const criteria = unique.map(({ key, name, requirement, duty }): RoleCriterion => ({
        id: 'role-' + hash(key).slice(0, 16), name, requirementRef: requirement,
        question: duty ? 'Gimana cara lu mengerjakan tugas berikut?\n' + duty :
            'Gimana cara lu menerapkan ' + name.replace(/[.!?]+$/u, '') + ' dalam pekerjaan ' + title + '?',
        anchors: [
            'Setelah mendapat kesempatan menjawab, belum menunjukkan penerapan yang relevan untuk ' + name + '.',
            'Menyebut konsep relevan untuk ' + name + ', dengan sedikit rincian tindakan yang bisa dijelaskan.',
            'Menjelaskan tindakan relevan untuk ' + name + ', dengan celah penting pada keputusan, pelaksanaan, atau validasi.',
            'Menjelaskan tindakan yang tepat dan alasan keputusan yang sesuai dengan standar ' + requirement + '.',
            'Menunjukkan penerapan kuat untuk ' + requirement + ', dengan keputusan yang tepat serta validasi, hasil, atau penanganan risiko yang relevan.',
        ],
    }));
    const interviewIds = criteria.filter((_, index) => unique[index].interview).slice(0, 4).map(row => row.id);
    const content: Omit<RoleRubric, 'revision'> = { version: ROLE_ASSESSMENT_VERSION, title, criteria, interviewIds };
    return { ...content, revision: hash(content) };
}

export function frozenRoleRubric(snapshot: unknown): RoleRubric | undefined {
    const rubric = (snapshot as { roleRubric?: RoleRubric } | null)?.roleRubric;
    return rubric?.version === ROLE_ASSESSMENT_VERSION ? rubric : undefined;
}

function interviewCriteria(rubric: RoleRubric) {
    const byId = new Map(rubric.criteria.map(row => [row.id, row]));
    return rubric.interviewIds.flatMap(id => byId.get(id) ?? []);
}

export function rolePackage(rubric: RoleRubric): PackagePayload {
    return { context: rubric.title, criteria: interviewCriteria(rubric) };
}

export function attachRoleTopics(plan: CandidatePayload, rubric: RoleRubric | undefined): CandidatePayload {
    if (!rubric?.interviewIds.length) return plan;
    return { ...plan, roleTopics: interviewCriteria(rubric).map(criterion => {
        const claim = plan.claims.find(row => row.criterionId === criterion.id);
        return { criterionId: criterion.id, question: criterion.question, cvClaimId: claim?.id };
    }) };
}
