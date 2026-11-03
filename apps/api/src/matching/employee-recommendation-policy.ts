import { employeeQualityGateAccepted } from './employee-quality-gate';
import {makeRelatedBenchmark} from './employee-related-benchmark';
import {isSecureRuntime} from '../common/jwt-secret';
const relatedQualityDataset=makeRelatedBenchmark();

export const employeeRecommendationV32Enabled = () => process.env.EMPLOYEE_RECOMMENDATION_V32_ENABLED === 'true';
export function localRecommendationPreview() {
  try { const url=new URL(process.env.DATABASE_URL || '');
    return !isSecureRuntime() && ['localhost','127.0.0.1'].includes(url.hostname) && url.port==='5434' && /^\/(job_talentio|talentio_recommendation_v32_it_\d+)$/.test(url.pathname);
  } catch { return false; }
}
export function recommendationGateAccepted(payload: unknown) {
  const p=payload as Record<string,unknown>|null;
  return !!p && p.policyVersion==='related-roles-v32' && p.coverageReviewed===true && p.falseEmptyCount===0 && employeeQualityGateAccepted(p,relatedQualityDataset);
}
