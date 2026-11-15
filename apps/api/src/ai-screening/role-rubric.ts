import { normalizeSkillKey } from '../common/skill-resolve';
import { hash, normalizedText, screeningEnabled } from './screening.policy';
import type { CandidatePayload, PackagePayload } from './screening.schemas';

export const ROLE_ASSESSMENT_VERSION = 'taka-role-assessment-v1';
export const ROLE_RUBRIC_VERSION = 'taka-role-rubric-v2';
export const CV_EXTRACTION_VERSION = 'taka-cv-source-v1';
export const ROLE_WEIGHTS = { cv: 30, competency: 60, explanation: 10 } as const;
export const roleAssessmentEnabled = () => screeningEnabled() && process.env.TAKA_ROLE_ASSESSMENT_ENABLED === 'true';
export const alignedRoleRubricEnabled = () => roleAssessmentEnabled() && process.env.TAKA_ALIGNED_ROLE_RUBRIC_ENABLED === 'true';
export const currentRoleRubricVersion = () => alignedRoleRubricEnabled() ? ROLE_RUBRIC_VERSION : ROLE_ASSESSMENT_VERSION;

type Job = {
    title: string;
    description?: string;
    responsibilities?: string[];
    experienceYearsMin?: number | null;
    jobSkills: Array<{ skillId?: string; skill: { name: string; aliases?: Array<{ alias: string }> }; isRequired: boolean; minLevel?: string | null }>;
    jobLanguages: Array<{ language: { name: string }; isRequired: boolean; provenance?: string | null; minLevel?: string | null }>;
};

export type RoleCriterion = {
    id: string;
    name: string;
    requirementRef: string;
    anchors: [string, string, string, string, string];
    question: string;
    sources?: RoleRequirement[];
    equivalence?: { action: string; output: string };
};
export type RoleRequirement = { id: string; kind: 'DUTY' | 'SKILL' | 'LANGUAGE' | 'EXPERIENCE'; text: string;
    aliases?: string[]; minimum?: string | null; original?: string; usageRequired?: boolean; minimumUsage?: string };
export type RoleRubric = {
    version: typeof ROLE_ASSESSMENT_VERSION | typeof ROLE_RUBRIC_VERSION;
    revision: string;
    sourceRevision?: string;
    agendaVersion?: string;
    title: string;
    description?: string;
    criteria: RoleCriterion[];
    interviewIds: string[];
};

const labelKey = (label: string) => normalizeSkillKey(normalizedText(label));
const skillLabelKey = (label: string) => labelKey(label.replace(/[\s.]+$/u, ''));
const criterionId = (key: string) => 'role-' + hash(key).slice(0, 16);
function requirementContains(text: string, label: string) {
    const tokens = text.split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean).map(labelKey);
    return tokens.some((_, from) => {
        let joined = '';
        for (let to = from; to < tokens.length && joined.length < label.length; to++) joined += tokens[to];
        return joined === label;
    });
}

export function createRoleRubric(job: Job, version: RoleRubric['version'] = currentRoleRubricVersion()): RoleRubric {
    if (version === ROLE_RUBRIC_VERSION) return createRoleRequirements(job);
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
        id: criterionId(key), name, requirementRef: requirement,
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
    return rubric?.version === ROLE_ASSESSMENT_VERSION || rubric?.version === ROLE_RUBRIC_VERSION ? rubric : undefined;
}

export function roleCvCriteria(rubric: RoleRubric): RoleCriterion[] {
    return rubric.criteria.filter(row => row.sources?.length
        ? row.sources.some(source => source.kind !== 'LANGUAGE')
        : row.id !== criterionId('language:' + labelKey(row.name)));
}

export function roleInterviewCandidates(rubric: RoleRubric) {
    return rubric.criteria.filter(row => row.sources ? row.sources.some(source => source.kind === 'DUTY' || source.kind === 'SKILL') : row.id !== criterionId('experience') &&
        row.id !== criterionId('language:' + labelKey(row.name)));
}

// Split explicitly listed actions without breaking up a single action with several objects.
function dutyActions(text: string) {
    const actions = text.split(/\s*(?:[;,]\s*(?:(?:dan|and)\s+)?|\s+(?:dan|and)\s+)(?=(?:men(?:indaklanjuti|jawab|jelaskan|yusun|yajikan|catat|gatur|gali|ilai|injau|ulis|yampaikan|jaga|yetujui|yepakati)|mem(?:buat|impin|antau|eriksa|presentasikan|peroleh)|meng(?:uji|elola|oordinasikan|embangkan|klarifikasi|evaluasi|ukur)|ber(?:kolaborasi|koordinasi)|review|approve|obtain approval|agree|present|document|follow up|coordinate|test|design|prepare|deploy)\s)/iu);
    return actions.flatMap(action => {
        // One preparation verb can produce a proposal and a separate presentation.
        const work = action.match(/^((?:menyiapkan|menyusun|membuat|menulis|prepare|draft|write|create)\s+)(proposal)\s+(?:dan|and)\s+(pitch deck|deck presentasi|slide presentasi|materi presentasi|presentation slides|presentation deck)(\s.*)?$/iu);
        return work ? [work[1] + work[2], work[1] + work[3] + (work[4] ?? '')] : [action];
    });
}

const descriptionSections = {
    DUTIES: /^(?:tanggung jawab(?: utama)?|tugas(?: utama)?|(?:key )?responsibilities|what you(?:'|’)ll do)$/iu,
    REQUIREMENTS: /^(?:persyaratan(?: wajib)?|kualifikasi(?: wajib)?|syarat wajib|(?:minimum |required )?(?:requirements|qualifications)|must[- ]haves?)$/iu,
    REQUIRED_SKILLS: /^(?:keahlian wajib|skill wajib|required skills|mandatory skills)$/iu,
    OTHER: /^(?:keahlian|nilai tambah|kpi|kompensasi|benefits?|tentang perusahaan|profil perusahaan|skills|nice[- ]to[- ]haves?|preferred(?: qualifications| skills)?|about (?:us|the company))$/iu,
};
type DescriptionSection = keyof typeof descriptionSections;

function describedSkills(requirement: string, knownSkillKeys: ReadonlySet<string>, section?: DescriptionSection): RoleRequirement[] {
    const requiredPrefix = /^(?:(?:kandidat|anda|you)\s+)?(?:wajib|harus|must)\s+/iu;
    const requiredSuffix = /\s+(?:(?:adalah\s+)?wajib|(?:is|are) required)$/iu;
    const source = requirement.replace(/[.!?]+$/u, '');
    const explicitlyNamed = requiredSuffix.test(source);
    const explicit = requiredPrefix.test(source) || explicitlyNamed;
    if (!explicit && section !== 'REQUIREMENTS' && section !== 'REQUIRED_SKILLS') return [];
    if (/\b(?:tidak wajib|tidak harus|tidak perlu|not required|optional|preferred|a plus|nilai tambah|diutamakan|lebih disukai|nice[- ]to[- ]have)\b/iu.test(requirement)) return [];

    const clause = source.replace(requiredPrefix, '').replace(requiredSuffix, '').trim();
    const usage = clause.match(/^(?:(?:punya|memiliki|have)\s+)?(?:(?:minimal|minimum(?: of)?|at least|setidaknya)\s+)?(?:(\d{1,2}\+?\s+(?:tahun|bulan|years?|months?))(?:\s+of)?\s+)?(?:(?:berpengalaman|pengalaman)\s+(?:dalam\s+)?(?:menggunakan|penggunaan|memakai|pakai)|(?:hands[- ]on\s+)?experience\s+(?:in\s+using|using|with))\s+/iu);
    const skillPrefix = /^(?:(?:be|have|punya|memiliki)\s+)?(?:(?:menguasai|menggunakan|memakai|bisa menggunakan|mampu menggunakan)|(?:proficient|proficiency|skilled)\s+(?:in|with)|(?:know how to use|use))\s+/iu;
    const label = (usage ? clause.slice(usage[0].length) : clause.replace(skillPrefix, '')).trim();
    if (!usage && label === clause && section !== 'REQUIRED_SKILLS' && !explicitlyNamed) return [];
    // Alternatives and lists of examples cannot become individual mandatory skills.
    if (/\b(?:seperti|misalnya|such as|e\.g\.|setara|equivalent|atau|or|sertifikasi|certification|gelar|degree)\b/iu.test(label)) return [];
    const segments = label.split(/\s*,\s*(?:(?:dan|and)\s+)?/iu);
    const names = segments.flatMap(segment => {
        if (knownSkillKeys.has(skillLabelKey(segment))) return [segment];
        const items = segment.split(/\s+(?:dan|and)\s+/iu);
        const distinct = segments.length > 1 || items.every(item => knownSkillKeys.has(skillLabelKey(item)) ||
            /[\p{Lu}\d+#.]/u.test(item.slice(1)));
        return distinct ? items : [segment];
    });
    if (names.some(name => !name || name.length > 80 || !/^[\p{L}\p{M}\d .+#&/()-]+$/u.test(name) || !labelKey(name) ||
        /^(?:(?:aplikasi|alat|perangkat)\s+|(?:minimal|minimum|at least)\b|\d+\s*(?:tahun|years?)\b)/iu.test(name))) return [];
    return names.map(text => ({ id: criterionId('skill:' + skillLabelKey(text)), kind: 'SKILL', text, original: requirement,
        ...(usage ? { usageRequired: true, ...(usage[1] ? { minimumUsage: usage[1] } : {}) } : {}) }));
}

function descriptionRoleSources(description: string, knownSkillKeys: ReadonlySet<string>) {
    const expectsActor = /^(?:(?:kandidat|anda|you)\s+(?:akan|will)\s+|bertanggung jawab (?:untuk|atas)\s+|bertugas untuk\s+|responsible for\s+)/iu;
    const nonTask = /^(?:tidak|bukan|no|not|must have|should have|pengalaman|berpengalaman|wajib|mampu|menguasai|mempunyai|memiliki|minimal|minimum|able to|experience (?:in|with))\b/iu;
    const lines = description
        .replace(/<br\s*\/?\s*>|<\/(?:li|p|div|h[1-6])>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .split(/[\r\n•]+/u);
    const tasks: string[] = [];
    const skills: RoleRequirement[] = [];
    const headings = Object.entries(descriptionSections) as Array<[DescriptionSection, RegExp]>;
    let section: DescriptionSection | undefined;
    for (const line of lines) {
        for (const sentence of normalizedText(line).split(/(?<=[.!?])\s+|\s*;\s*/u)) {
            const text = sentence.replace(/^(?:[-*]|\d+[.)])\s+/u, '');
            const separator = text.indexOf(':');
            const heading = (separator === -1 ? text : text.slice(0, separator)).trim();
            const next = headings.find(([, pattern]) => pattern.test(heading))?.[0];
            if (next) section = next;
            const entry = (next ? (separator === -1 ? '' : text.slice(separator + 1)) : text).trim();
            if (!entry || section === 'OTHER') continue;
            const namedSkills = describedSkills(entry, knownSkillKeys, section);
            if (namedSkills.length) { skills.push(...namedSkills); continue; }
            const action = entry.replace(expectsActor, '');
            if ((section === 'DUTIES' || section === undefined && entry !== action) &&
                action.length >= 12 && entry.length <= 280 && !nonTask.test(action)) tasks.push(entry);
        }
    }
    return { tasks, skills };
}

function createRoleRequirements(job: Job): RoleRubric {
    const title = normalizedText(job.title);
    const duties = new Map<string, RoleRequirement>();
    const structuredSkillKeys = new Set(job.jobSkills.flatMap(({ skill }) => [skillLabelKey(skill.name), ...(skill.aliases ?? []).map(row => skillLabelKey(row.alias))]));
    const described = descriptionRoleSources(job.description ?? '', structuredSkillKeys);
    const structured = (job.responsibilities ?? []).filter(value => normalizedText(value));
    const responsibilities = structured.length ? structured : described.tasks;
    for (const value of responsibilities) {
        const original = normalizedText(value);
        for (const clause of dutyActions(original)) {
            const text = clause.trim().replace(/[.!?]+$/u, '');
            const key = labelKey(text);
            if (key && !duties.has(key)) duties.set(key, { id: criterionId('duty:' + key), kind: 'DUTY', text, original });
        }
    }
    const describedByKey = new Map<string, RoleRequirement>();
    for (const source of described.skills) {
        const key = skillLabelKey(source.text);
        const prior = describedByKey.get(key);
        if (!prior || source.usageRequired && (!prior.usageRequired || source.minimumUsage && !prior.minimumUsage)) describedByKey.set(key, source);
    }
    const skills: RoleRequirement[] = [];
    for (const row of job.jobSkills) {
        const text = normalizedText(row.skill.name), key = skillLabelKey(text);
        const aliases = [...new Set((row.skill.aliases ?? []).map(alias => normalizedText(alias.alias)).filter(Boolean))].sort();
        const keys = [key, ...aliases.map(skillLabelKey)];
        if (!key) continue;
        const specified = keys.flatMap(label => describedByKey.get(label) ?? []);
        const source = specified.find(item => item.minimumUsage) ?? specified.find(item => item.usageRequired) ??
            (row.isRequired ? undefined : specified[0]);
        if (!row.isRequired && !source) continue;
        skills.push({ id: row.skillId ?? criterionId('skill:' + key), kind: 'SKILL', text, minimum: row.minLevel ?? null, aliases,
            ...(source?.original ? { original: source.original } : {}),
            ...(source?.usageRequired ? { usageRequired: true } : {}),
            ...(source?.minimumUsage ? { minimumUsage: source.minimumUsage } : {}) });
    }
    for (const [key, source] of describedByKey) if (!structuredSkillKeys.has(key)) skills.push(source);
    skills.sort((a, b) => a.id.localeCompare(b.id));
    const languageSources = job.jobLanguages.filter(row => row.isRequired && row.provenance === 'EMPLOYER_CONFIRMED' && labelKey(row.language.name))
        .map(row => ({ id: criterionId('language:' + labelKey(row.language.name)), kind: 'LANGUAGE' as const,
            text: normalizedText(row.language.name), minimum: row.minLevel ?? null })).sort((a, b) => a.id.localeCompare(b.id));
    const experience: RoleRequirement[] = job.experienceYearsMin && job.experienceYearsMin > 0 ? [{
        id: criterionId('experience'), kind: 'EXPERIENCE', text: 'Pengalaman minimum', original: 'Pengalaman relevan minimal ' + job.experienceYearsMin + ' tahun.',
    }] : [];
    const criteria = [...duties.values(), ...skills, ...languageSources, ...experience].map(source => alignedCriterion(title, [source]));
    const interviewIds = criteria.filter(row => row.sources!.some(source => source.kind === 'DUTY' || source.kind === 'SKILL')).slice(0, 4).map(row => row.id);
    const description = normalizedText(job.description).slice(0, 6_000);
    const content = { version: ROLE_RUBRIC_VERSION, title, ...(description ? { description } : {}), criteria, interviewIds } as const;
    return { ...content, revision: hash(content) };
}

export function alignedCriterion(title: string, sources: RoleRequirement[], question?: string, id = sources[0].id): RoleCriterion {
    const [main] = sources;
    const name = main.text;
    const detail = (source: RoleRequirement) => (source.usageRequired ? 'Pengalaman menggunakan ' : '') +
        source.text + (source.minimumUsage ? ' (min. ' + source.minimumUsage + ')' : '') +
        (source.minimum ? ' (level ' + source.minimum + ')' : '');
    const requirementRef = main.kind === 'LANGUAGE' ? 'Bahasa wajib: ' + detail(main) :
        main.kind === 'EXPERIENCE' ? main.original! : [...new Set(sources.map(detail))].join(' · ');
    return {
        id, name, sources, requirementRef,
        question: question ?? (main.kind === 'DUTY' ? `Untuk tugas “${name}”, apa langkah yang bakal lu ambil?` :
            `Gimana cara lu menerapkan ${name} dalam pekerjaan ${title}?`),
        anchors: [
            'Belum menunjukkan penerapan relevan setelah kesempatan menjawab.',
            'Menyebut konsep yang relevan dengan sedikit rincian tindakan.',
            'Menjelaskan tindakan relevan dengan bagian penting yang masih kurang.',
            'Menjelaskan tindakan pribadi dan alasan keputusan yang memenuhi kompetensi.',
            'Menunjukkan penerapan yang kuat terhadap seluruh fokus yang diuji, dengan keputusan serta hasil, validasi, atau risiko yang relevan.',
        ],
    };
}

export function alignedRoleFromPacket(snapshot: unknown, packet: PackagePayload | null | undefined) {
    const rubric = frozenRoleRubric(snapshot);
    if (rubric?.version !== ROLE_RUBRIC_VERSION) return rubric;
    return packet?.roleRubric?.sourceRevision === rubric.revision ? packet.roleRubric : undefined;
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
