import type { RecruiterBreakdown } from '../matching/recruiter-matching';

// An evaluation-only revision must not change the CV evidence frozen at submission.
export function frozenCvAssessment(current: { cvScore: number | null; cvBreakdown: unknown } | null, revisions: Array<{ snapshot: unknown }>) {
    for (const candidate of [current, ...revisions.map(r => r.snapshot as typeof current)]) {
        if (!candidate || typeof candidate !== 'object') continue;
        const score = candidate.cvScore, breakdown = candidate.cvBreakdown as RecruiterBreakdown | null;
        if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100 &&
            breakdown?.assessable === true && Math.abs(breakdown.total - score) < .000001)
            return breakdown;
    }
    return null;
}
