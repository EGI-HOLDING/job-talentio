import { languageLevelRank, EMPLOYEE_PROFESSIONAL_WEIGHTS, EMPLOYEE_INTENT_VERSION, type MatchEvidence, type MatchInsights } from '@job-talentio/shared';
import { EmployeeOccupationIndex } from './employee-occupation';
import type { IntentFacts, IntentSkill } from './employee-intent-evidence';
export type IntentJob = {
    id: string;
    title: string;
    jobTitleId: string | null;
    companyId: string;
    publishedAt: Date | null;
    countryId: string | null;
    cityId: string | null;
    workMode: string;
    experienceYearsMin: number | null;
    experienceLevel: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string;
    salaryPeriod: string;
    city?: {
        province: {
            countryId: string;
        };
    } | null;
    jobSkills: Array<{
        skillId: string;
        isRequired: boolean;
        weight: number;
        minLevel: string | null;
        skill: Pick<IntentSkill, 'name' | 'matchingKind'>;
    }>;
    jobLanguages: Array<{
        minLevel: string;
        isRequired: boolean;
        provenance: string;
        language: {
            code: string;
            name: string;
        };
    }>;
};
export type IntentPreferences = {
    selectedIds: string[];
    cityId?: string | null;
    residenceCountryId?: string | null;
    preferredCountries: Array<{
        id: string;
    }>;
    preferredWorkModes: string[];
    desiredSalaryMin: unknown;
    desiredSalaryCurrency: string;
    desiredSalaryPeriod: string;
};
export type IntentEvaluation = {
    score: number;
    positiveCore: boolean;
    optionalScore: number;
    tier: number;
    practical: number[];
    insights: MatchInsights;
    eligibility: ReturnType<EmployeeOccupationIndex['eligibility']>;
};
const levels = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const grades = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function yearsUnion(rows: IntentFacts['experiences'], now: Date) {
    const intervals = rows.map(e => [e.startDate ? +new Date(e.startDate) : NaN, e.isCurrent ? +now : e.endDate ? +new Date(e.endDate) : NaN]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s <= e && e <= +now).sort((a, b) => a[0] - b[0]);
    let last = -Infinity, total = 0;
    for (const [start, end] of intervals) {
        total += Math.max(0, end - Math.max(start, last));
        last = Math.max(last, end);
    }
    return { years: total / 31557600000, known: intervals.length > 0 };
}
const weighted = (values: Array<[
    number,
    number
]>) => { const sum = values.reduce((n, [w]) => n + w, 0); return sum ? 100 * values.reduce((n, [w, v]) => n + w * v, 0) / sum : 50; };
export function evaluateIntent(preferences: IntentPreferences, facts: IntentFacts, job: IntentJob, index: EmployeeOccupationIndex, now = new Date()): IntentEvaluation {
    const eligibility = index.eligibility(preferences.selectedIds, job.jobTitleId);
    const evidence: MatchEvidence[] = [];
    const required: Array<'MET' | 'UNKNOWN' | 'UNMET'> = [];
    const parts: Array<[
        number,
        number
    ]> = [];
    let optionalScore = 0;
    if (!eligibility.eligible)
        return { score: 0, positiveCore: false, optionalScore: 0, tier: 2, practical: [], eligibility, insights: { version: EMPLOYEE_INTENT_VERSION, mode: 'LATEST', evidence, reviewExperienceIds: [] } };
    evidence.push({ kind: 'ROLE', label: job.title, status: 'MET', required: false, code: 'ROLE_MATCH', evidenceRefs: [`jobTitle:${eligibility.canonicalRoleId}`, `family:${eligibility.familyId}`] });
    const hard = job.jobSkills.filter(s => s.skill.matchingKind === 'PROFESSIONAL');
    const authored = hard.filter(s => s.isRequired);
    const scored = authored.length ? authored : hard;
    let presence = 0, total = 0, levelTotal = 0, levelValue = 0;
    for (const req of job.jobSkills) {
        const found = facts.skills.find(s => s.skillId === req.skillId);
        const known = found?.confirmed && found.level && levels.includes(found.level);
        const status = !found ? 'UNKNOWN' : req.minLevel ? !known ? 'UNKNOWN' : levels.indexOf(found.level!) >= levels.indexOf(req.minLevel) ? 'MET' : 'UNMET' : 'MET';
        const weight = Number.isFinite(req.weight) && req.weight > 0 ? req.weight : 1;
        if (scored.includes(req)) {
            total += weight;
            presence += weight * (found ? 1 : 0.5);
            if (req.minLevel) {
                levelTotal += weight;
                levelValue += weight * (status === 'MET' ? 1 : status === 'UNMET' ? 0 : 0.5);
            }
        }
        else if (found)
            optionalScore += Math.min(1, weight);
        if (req.isRequired && req.skill.matchingKind === 'PROFESSIONAL')
            required.push(status);
        evidence.push({ kind: 'SKILL', label: req.skill.name, required: req.isRequired, status, code: status === 'MET' ? 'SKILL_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : found ? 'LEVEL_UNCONFIRMED' : 'NOT_LISTED', evidenceRefs: [`jobSkill:${req.skillId}`, ...(found ? [`cvEvidence:${found.key}`] : [])] });
    }
    if (total)
        parts.push([EMPLOYEE_PROFESSIONAL_WEIGHTS.skillPresence, presence / total]);
    if (levelTotal)
        parts.push([EMPLOYEE_PROFESSIONAL_WEIGHTS.skillLevel, levelValue / levelTotal]);
    const relevant = facts.experiences.filter(e => e.jobTitleId && index.identity(e.jobTitleId)?.canonicalRoleId === eligibility.canonicalRoleId);
    const duration = yearsUnion(relevant, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
    if (job.experienceYearsMin != null) {
        const minimum = job.experienceYearsMin;
        const status = minimum === 0 ? 'MET' : !duration.known ? 'UNKNOWN' : duration.years >= minimum ? 'MET' : 'UNMET';
        required.push(status);
        parts.push([EMPLOYEE_PROFESSIONAL_WEIGHTS.experience, status === 'UNKNOWN' ? 0.5 : minimum === 0 ? 1 : clamp(duration.years / minimum)]);
        evidence.push({ kind: 'EXPERIENCE', label: String(minimum), status, required: true, code: status === 'MET' ? 'EXPERIENCE_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : 'NOT_LISTED', evidenceRefs: relevant.map(e => `cvEvidence:${e.key}`) });
    }
    if (job.experienceLevel) {
        const candidate = Math.max(-1, ...relevant.map(e => grades.indexOf(e.seniority ?? '')));
        const target = grades.indexOf(job.experienceLevel);
        const known = candidate >= 0 && target >= 0;
        const status = !known ? 'UNKNOWN' : candidate >= target ? 'MET' : 'UNMET';
        required.push(status);
        parts.push([EMPLOYEE_PROFESSIONAL_WEIGHTS.seniority, !known ? 0.5 : 1 - Math.min(1, Math.abs(candidate - target) / 3)]);
        evidence.push({ kind: 'EXPERIENCE', label: job.experienceLevel, status, required: true, code: status === 'MET' ? 'EXPERIENCE_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : 'NOT_LISTED', evidenceRefs: relevant.map(e => `cvEvidence:${e.key}`) });
    }
    const langs = job.jobLanguages.filter(l => l.provenance === 'EMPLOYER_CONFIRMED');
    let langTotal = 0, langValue = 0;
    for (const req of langs) {
        const found = facts.languages.find(l => l.code === req.language.code);
        const known = found?.level;
        const status = !known ? 'UNKNOWN' : languageLevelRank(found.level as never) >= languageLevelRank(req.minLevel as never) ? 'MET' : 'UNMET';
        if (req.isRequired) {
            required.push(status);
            langTotal++;
            langValue += status === 'MET' ? 1 : status === 'UNKNOWN' ? 0.5 : 0;
        }
        else if (status === 'MET')
            optionalScore++;
        evidence.push({ kind: 'LANGUAGE', label: req.language.name, status, required: req.isRequired, code: status === 'MET' ? 'LANGUAGE_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : 'NOT_LISTED', evidenceRefs: found ? [`cvEvidence:${found.key}`] : [] });
    }
    if (langTotal)
        parts.push([EMPLOYEE_PROFESSIONAL_WEIGHTS.language, langValue / langTotal]);
    const country = job.countryId ?? job.city?.province.countryId;
    const countries = preferences.preferredCountries.map(c => c.id);
    const countryFit = country ? (countries.length ? Number(countries.includes(country)) : Number(country === preferences.residenceCountryId)) : 0.5;
    const location = countryFit === 0 ? 0 : job.cityId && job.cityId === preferences.cityId ? 1 : countryFit === 1 ? 0.75 : 0.5;
    const work = preferences.preferredWorkModes.length ? Number(preferences.preferredWorkModes.includes(job.workMode)) : 0.5;
    let salary = 0.5;
    const desired = Number(preferences.desiredSalaryMin);
    const monthly = (v: number, p: string) => p === 'YEARLY' ? v / 12 : p === 'MONTHLY' ? v : null;
    if (desired > 0 && job.currency === preferences.desiredSalaryCurrency) {
        const a = monthly(desired, preferences.desiredSalaryPeriod), b = job.salaryMax == null ? null : monthly(job.salaryMax, job.salaryPeriod);
        if (a && b != null)
            salary = clamp(b / a);
        else if (preferences.desiredSalaryPeriod === 'HOURLY' && job.salaryPeriod === 'HOURLY' && job.salaryMax != null)
            salary = clamp(job.salaryMax / desired);
    }
    const tier = required.some(s => s === 'UNMET') ? 2 : required.length > 0 && required.every(s => s === 'MET') ? 0 : 1;
    return { score: weighted(parts), positiveCore: true, optionalScore: Math.min(10, optionalScore), tier, practical: [location, work, salary], eligibility, insights: { version: EMPLOYEE_INTENT_VERSION, mode: 'PERSONALIZED', evidence, reviewExperienceIds: facts.experiences.filter(e => !e.jobTitleId || !e.startDate || !e.isCurrent && !e.endDate).map(e => e.key) } };
}
export function compareIntent(a: IntentEvaluation, b: IntentEvaluation) { return a.tier - b.tier || b.score - a.score || b.practical[0] - a.practical[0] || b.practical[1] - a.practical[1] || b.practical[2] - a.practical[2] || b.optionalScore - a.optionalScore; }
