import { EMPLOYEE_INTENT_VERSION } from '@job-talentio/shared';
import { createHash } from 'node:crypto';
import { makeEmployeeBenchmark } from './employee-intent.benchmark';
import { EMPLOYEE_EVIDENCE_PARSER } from './employee-intent-evidence';
const dataset=makeEmployeeBenchmark();
export function employeeQualityGateAccepted(payload: unknown, expectedDataset=dataset): boolean {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload as Record<string, unknown>;
    const expectedDatasetHash=createHash('sha256').update(JSON.stringify(expectedDataset)).digest('hex');
    return p.version === EMPLOYEE_INTENT_VERSION && p.parserVersion === EMPLOYEE_EVIDENCE_PARSER && p.rankingVersion === expectedDataset.rankingVersion && p.datasetHash === expectedDatasetHash && p.profiles === expectedDataset.profiles.filter(p=>p.split==='evaluation').length && p.families === new Set(expectedDataset.profiles.filter(p=>p.split==='evaluation').map(p=>p.family)).size && p.humanValidated === true && p.zeroLeakage === true && p.performancePassed === true && p.eligibleRecall === 1 && typeof p.reviewedBy === 'string' && p.reviewedBy.trim().length >= 2 && typeof p.reviewedAt === 'string' && Number.isFinite(Date.parse(p.reviewedAt)) && typeof p.precisionAt10 === 'number' && p.precisionAt10 >= 0.9 && p.precisionAt10 <= 1 && typeof p.ndcgAt10 === 'number' && p.ndcgAt10 >= 0.85 && p.ndcgAt10 <= 1;
}
