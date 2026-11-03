import { EMPLOYEE_INTENT_VERSION, EMPLOYEE_INTENT_RANKING_VERSION } from '@job-talentio/shared';
import { createHash } from 'node:crypto';
import { makeEmployeeBenchmark } from './employee-intent.benchmark';
import { EMPLOYEE_EVIDENCE_PARSER } from './employee-intent-evidence';
const expectedDatasetHash = createHash('sha256').update(JSON.stringify(makeEmployeeBenchmark())).digest('hex');
export function employeeQualityGateAccepted(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload as Record<string, unknown>;
    return p.version === EMPLOYEE_INTENT_VERSION && p.parserVersion === EMPLOYEE_EVIDENCE_PARSER && p.rankingVersion === EMPLOYEE_INTENT_RANKING_VERSION && p.datasetHash === expectedDatasetHash && p.profiles === 30 && p.families === 10 && p.humanValidated === true && p.zeroLeakage === true && p.performancePassed === true && p.eligibleRecall === 1 && typeof p.reviewedBy === 'string' && p.reviewedBy.trim().length >= 2 && typeof p.reviewedAt === 'string' && Number.isFinite(Date.parse(p.reviewedAt)) && typeof p.precisionAt10 === 'number' && p.precisionAt10 >= 0.9 && p.precisionAt10 <= 1 && typeof p.ndcgAt10 === 'number' && p.ndcgAt10 >= 0.85 && p.ndcgAt10 <= 1;
}
