import { employeeQualityGateAccepted } from './employee-quality-gate';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EMPLOYEE_INTENT_VERSION, type EmployeeRecommendationState } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';
import { loadJobPromotions, publicJobPromotion } from '../benefits/job-promotion';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { applyEmployeeOverrides, evidenceConflicts, hasEmployeeCareerEvidence, type IntentFacts, type EvidenceOverride, EMPLOYEE_EVIDENCE_PARSER } from './employee-intent-evidence';
import { evaluateIntent, compareIntent, type IntentEvaluation } from './employee-intent';
export const employeeIntentJobSelect = { id: true, title: true, jobTitleId: true, companyId: true, publishedAt: true, countryId: true, cityId: true, workMode: true, experienceYearsMin: true, experienceLevel: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { select: { province: { select: { countryId: true } } } }, jobSkills: { include: { skill: { select: { name: true, matchingKind: true } } } }, jobLanguages: { include: { language: { select: { code: true, name: true } } } } } as const;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const employeeIntentMode = () => { const mode = process.env.EMPLOYEE_INTENT_V3_MODE ?? 'off'; return ['off', 'shadow', 'enabled', 'unavailable'].includes(mode) ? mode : 'unavailable'; };
export const employeeIntentSelected = (profileId: string) => {
    const percent = Number(process.env.EMPLOYEE_INTENT_V3_PERCENT ?? 100);
    return !Number.isFinite(percent) || parseInt(digest(profileId).slice(0, 8), 16) % 100 < Math.max(0, Math.min(100, percent));
};
@Injectable()
export class EmployeeIntentService {
    constructor(private db: PrismaService) { }
    async context(profileId: string) {
        const [profile, roles] = await Promise.all([
            this.db.employeeProfile.findUniqueOrThrow({ where: { id: profileId }, include: { desiredRoles: true, preferredCountries: { select: { id: true } }, resumes: { where: { isPrimary: true, deletedAt: null, fileKey: { not: null } }, take: 1, include: { currentVersion: { include: { employeeEvidence: true } } } } } }),
            this.db.jobTitle.findMany({ include: intentRoleInclude }),
        ]);
        const index = new EmployeeOccupationIndex(roles);
        const version = profile.resumes[0]?.currentVersion;
        const stored = version?.employeeEvidence;
        const selectedIds = profile.desiredRoles.map(r => r.jobTitleId);
        const preferences = { ...profile, selectedIds };
        let state: EmployeeRecommendationState = 'READY';
        const gate = employeeIntentMode() === 'enabled' ? await this.db.featureFlag.findUnique({ where: { key: 'employee_intent_v3_quality_gate' } }) : null;
        if (employeeIntentMode() === 'unavailable' || employeeIntentMode() === 'enabled' && (!Number.isFinite(Number(process.env.EMPLOYEE_INTENT_V3_PERCENT ?? 100)) || !gate?.enabled || !employeeQualityGateAccepted(gate.payload)))
            state = 'UNAVAILABLE';
        else if (!selectedIds.length)
            state = profile.desiredPositions.length ? 'PREFERENCES_REVIEW_REQUIRED' : 'PREFERENCES_REQUIRED';
        else if (!profile.matchingPreferencesReviewed || selectedIds.some(id => !index.identity(id)))
            state = 'PREFERENCES_REVIEW_REQUIRED';
        else if (!version)
            state = 'CV_REQUIRED';
        else if (version.parseStatus === 'FAILED')
            state = 'CV_FAILED';
        else if (version.parseStatus !== 'READY' || !stored || stored.parserVersion !== EMPLOYEE_EVIDENCE_PARSER || stored.generation !== version.parseGeneration || ['PENDING', 'PROCESSING'].includes(stored.status))
            state = 'CV_PROCESSING';
        else if (stored.status === 'FAILED')
            state = 'CV_FAILED';
        let facts: IntentFacts = { roles: [], skills: [], experiences: [], languages: [] };
        if (stored?.facts && stored.status === 'READY') {
            const original = stored.facts as unknown as IntentFacts;
            const overrides = (stored.overrides ?? []) as EvidenceOverride[];
            facts = applyEmployeeOverrides(original, overrides);
            if (state === 'READY' && (evidenceConflicts(original, overrides).length || !hasEmployeeCareerEvidence(facts)))
                state = 'EVIDENCE_REVIEW_REQUIRED';
        }
        if (state === 'READY' && (!stored?.facts || stored.status !== 'READY'))
            state = 'EVIDENCE_REVIEW_REQUIRED';
        const allowedIds = state === 'READY' ? roles.filter(role => index.eligibility(selectedIds, role.id).eligible).map(r => r.id) : [];
        return { profile, preferences, index, facts, state, allowedIds, cvSource: { versionId: version?.id ?? null, status: version?.parseStatus ?? 'NONE', evidenceRevision: stored?.revision ?? null }, fingerprint: digest([EMPLOYEE_INTENT_VERSION, profile, roles]) };
    }
    async scoreJobsForProfile(profileId: string, ids: string[]) {
        const result = new Map<string, IntentEvaluation>();
        if (!ids.length)
            return result;
        const context = await this.context(profileId);
        if (context.state !== 'READY')
            return result;
        const jobs = await this.db.jobPost.findMany({ where: { id: { in: ids }, jobTitleId: { in: context.allowedIds } }, select: employeeIntentJobSelect });
        for (const job of jobs) {
            const e = evaluateIntent(context.preferences, context.facts, job, context.index);
            if (e.eligibility.eligible)
                result.set(job.id, e);
        }
        return result;
    }
    async recommend(profileId: string, page = 1, limit = 24) {
        const context = await this.context(profileId);
        const now = new Date();
        const empty = (state: EmployeeRecommendationState) => ({ items: [], page: 1, limit, total: 0, totalPages: 1, mode: 'UNAVAILABLE' as const, state, version: EMPLOYEE_INTENT_VERSION, rankingRevision: context.fingerprint, cvSource: context.cvSource });
        if (context.state !== 'READY')
            return empty(context.state);
        const jobs = await this.db.jobPost.findMany({ where: { ...liveJobWhere(now), jobTitleId: { in: context.allowedIds }, applications: { none: { profileId } } }, select: employeeIntentJobSelect });
        const ranked = jobs.map(job => ({ job, evaluation: evaluateIntent(context.preferences, context.facts, job, context.index, now) })).filter(row => row.evaluation.eligibility.eligible).sort((a, b) => compareIntent(a.evaluation, b.evaluation) || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
        if (!ranked.length)
            return empty('NO_ELIGIBLE_JOBS');
        // Interleave companies only inside exactly equivalent professional/practical relevance.
        for (let start = 0; start < ranked.length;) {
            let end = start + 1;
            while (end < ranked.length && compareIntent(ranked[start].evaluation, ranked[end].evaluation) === 0)
                end++;
            const pending = ranked.slice(start, end), diverse: typeof pending = [];
            let last = '';
            while (pending.length) {
                const at = Math.max(0, pending.findIndex(row => row.job.companyId !== last));
                const [row] = pending.splice(at, 1);
                diverse.push(row);
                last = row.job.companyId;
            }
            ranked.splice(start, end - start, ...diverse);
            start = end;
        }
        const total = ranked.length, totalPages = Math.max(1, Math.ceil(total / limit));
        page = Math.min(Math.max(1, page), totalPages);
        const selected = ranked.slice((page - 1) * limit, page * limit);
        const [full, promotions] = await Promise.all([this.db.jobPost.findMany({ where: { id: { in: selected.map(r => r.job.id) }, ...liveJobWhere(now) }, select: { id: true, title: true, companyId: true, isAnonymous: true, locale: true, createdAt: true, publishedAt: true, employmentType: true, workMode: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { include: { province: true } }, country: true, category: true, company: { select: { id: true, name: true, slug: true, logoUrl: true } } } }), loadJobPromotions(this.db, selected.map(r => r.job.id), now)]);
        const byId = new Map(full.map(j => [j.id, j]));
        const items = selected.flatMap(row => { const job = byId.get(row.job.id); return job ? [{ job: { ...job, ...publicJobPromotion(promotions, job.id), placement: 'ORGANIC' as const }, matchScore: row.evaluation.score, matchInsights: row.evaluation.insights, eligibility: row.evaluation.eligibility }] : []; });
        if (!items.length)
            return empty('NO_ELIGIBLE_JOBS');
        new Logger('EmployeeIntent').log(JSON.stringify({ version: EMPLOYEE_INTENT_VERSION, state: 'READY', eligible: total, returned: items.length, unknown: items.reduce((n, i) => n + i.matchInsights.evidence.filter(e => e.status === 'UNKNOWN').length, 0) }));
        return { items, page, limit, total, totalPages, mode: 'PERSONALIZED' as const, state: 'READY' as const, version: EMPLOYEE_INTENT_VERSION, rankingRevision: digest([context.fingerprint, ranked.map(r => [r.job.id, r.evaluation])]), cvSource: context.cvSource };
    }
    async explain(profileId: string, jobId: string) {
        const context = await this.context(profileId);
        const job = await this.db.jobPost.findUnique({ where: { id: jobId }, select: employeeIntentJobSelect });
        const eligibility = context.index.eligibility(context.preferences.selectedIds, job?.jobTitleId);
        if (context.state !== 'READY' || !job || !eligibility.eligible)
            return { state: context.state === 'READY' ? 'NO_ELIGIBLE_JOBS' : context.state, eligibility, matchScore: null, matchInsights: null };
        const evaluation = evaluateIntent(context.preferences, context.facts, job, context.index);
        return { state: 'READY', eligibility, matchScore: evaluation.score, matchInsights: evaluation.insights };
    }
}
