import type { MatchEvidence } from './match-insights';

export type HrRankingState = 'READY' | 'CV_REQUIRED' | 'CV_PROCESSING' | 'CV_FAILED' | 'CV_UNAVAILABLE' | 'EVIDENCE_REVIEW_REQUIRED' | 'JOB_REQUIREMENTS_REQUIRED';
export type HrRequirementGroup = 'MET' | 'INCOMPLETE' | 'UNMET' | 'UNASSESSABLE';
export type HrRankingMetadata = {
  rankingVersion: string;
  rankingRevision: string;
  state: HrRankingState;
  requirementGroup: HrRequirementGroup;
  rank: number | null;
  reasons: MatchEvidence[];
  source: 'APPLICATION' | 'DATABASE_CV';
};
