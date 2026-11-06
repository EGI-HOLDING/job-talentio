export type RequirementStatus = 'MET' | 'UNMET' | 'UNKNOWN';
export type MatchEvidence = {
  kind: 'ROLE' | 'SKILL' | 'EXPERIENCE' | 'LANGUAGE' | 'LOCATION' | 'EDUCATION';
  label: string;
  labels?: { en:string; id?:string | null; uz?:string | null; ru?:string | null };
  status: RequirementStatus;
  required: boolean;
  minimumLevel?:string;
  experienceReference?:{source:'CATALOG_DERIVED'|'EMPLOYER_ADJUSTED'|'EMPLOYER_REQUIREMENT';minimum:number|null;maximum:number|null;version:string|null;levelCode:string|null;required:boolean};
  evidenceRefs: string[];
  code: 'ROLE_MATCH' | 'PAST_ROLE' | 'RELATED_ROLE' | 'TRANSFERABLE_EXPERIENCE' | 'SKILL_MATCH' | 'EXPERIENCE_MATCH' | 'LANGUAGE_MATCH' | 'LOCATION_MATCH' | 'NOT_LISTED' | 'LEVEL_UNCONFIRMED' | 'BELOW_REQUIREMENT' | 'UNVERIFIED_REQUIREMENT' | 'REVIEW_EXPERIENCE';
};
export type MatchInsights = {
  version: string;
  experiencePolicyVersion?:string;
  mode: 'PERSONALIZED' | 'LATEST' | 'PREFERENCES_BASED' | 'EXPLORATION';
  evidence: MatchEvidence[];
  reviewExperienceIds: string[];
  relatedTasks?: string[];
  practicalFit?: import('./employee-intent').EmployeePracticalFit;
};
export type OccupationMatchingMetadata = {
  professionSourceUri?: string;
  professionTaskProfile?: { scope: string; evidence: string; skillUris: string[] };
  sources: Array<{ provider: string; uri?: string; code?: string; version: string }>;
  isco08?: string;
  labelReview?: { id?: string; uz?: string };
  relatedRoles: Array<{ id: string; kind: 'RELATED'; reference: string; approved: boolean }>;
};
