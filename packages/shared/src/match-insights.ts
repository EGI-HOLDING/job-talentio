export type RequirementStatus = 'MET' | 'UNMET' | 'UNKNOWN';
export type MatchEvidence = {
  kind: 'ROLE' | 'SKILL' | 'EXPERIENCE' | 'LANGUAGE' | 'LOCATION' | 'EDUCATION';
  label: string;
  labels?: { en:string; id?:string | null; uz?:string | null; ru?:string | null };
  status: RequirementStatus;
  required: boolean;
  minimumLevel?:string;
  evidenceRefs: string[];
  code: 'ROLE_MATCH' | 'PAST_ROLE' | 'RELATED_ROLE' | 'SKILL_MATCH' | 'EXPERIENCE_MATCH' | 'LANGUAGE_MATCH' | 'LOCATION_MATCH' | 'NOT_LISTED' | 'LEVEL_UNCONFIRMED' | 'BELOW_REQUIREMENT' | 'UNVERIFIED_REQUIREMENT' | 'REVIEW_EXPERIENCE';
};
export type MatchInsights = {
  version: string;
  mode: 'PERSONALIZED' | 'LATEST';
  evidence: MatchEvidence[];
  reviewExperienceIds: string[];
};
export type OccupationMatchingMetadata = {
  sources: Array<{ provider: string; uri?: string; code?: string; version: string }>;
  isco08?: string;
  labelReview?: { id?: string; uz?: string };
  relatedRoles: Array<{ id: string; kind: 'RELATED'; reference: string; approved: boolean }>;
};
