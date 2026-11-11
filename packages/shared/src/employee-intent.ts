import { z } from 'zod';
export const EMPLOYEE_INTENT_VERSION = 'employee-intent-v3.2';
export const EMPLOYEE_RELATED_RANKING_VERSION = 'employee-ranking-v3.2';
export type EmployeeEvidenceState = 'READY' | 'REQUIRED' | 'PROCESSING' | 'FAILED' | 'REVIEW_REQUIRED';
export const desiredSelectionsSchema = z.array(z.object({kind:z.enum(['GROUP','ROLE']),id:z.string().min(1).max(100)}).strict()).max(10).refine(rows=>new Set(rows.map(row=>row.kind+':'+row.id)).size===rows.length,'Duplicate selections');
export type DesiredSelection = z.infer<typeof desiredSelectionsSchema>[number];
export const POSITION_GROUP_POLICY_VERSION = 'position-groups-v1';
export type EmployeeRecommendationType = 'EXACT' | 'GROUP' | 'RELATED' | 'EXPLORATION';
export type EmployeeEmptyReason = 'UNRECOGNIZED_PREFERENCES' | 'NO_ACTIVE_JOBS' | 'NO_RELEVANT_JOBS' | 'TASK_COVERAGE_INCOMPLETE' | 'ALL_APPLIED' | 'SERVICE_UNAVAILABLE' | 'PRACTICAL_PREFERENCES';
export type EmployeeRecommendationFeed = 'recommendations' | 'related' | 'exploration' | 'salary-unverified';
export type EmployeePracticalFit = {
    version: string; active: boolean;
    country: 'MET'|'UNMET'|'UNKNOWN'|'NOT_REQUESTED';
    salary: 'MET'|'UNMET'|'UNKNOWN'|'NOT_REQUESTED';
    salaryReason: 'NOT_REQUESTED'|'NOT_DISCLOSED'|'INVALID_RANGE'|'CURRENCY_MISMATCH'|'PERIOD_MISMATCH'|'BELOW_TARGET'|'ENTIRE_RANGE_MEETS'|'UPPER_BOUND_MEETS'|'LOWER_BOUND_MEETS'|'UPPER_BOUND_MISSING';
    group: 'MAIN'|'SALARY_UNVERIFIED'|'EXCLUDED';
};
export const employeeRecommendationStates = ['READY', 'CV_REQUIRED', 'CV_PROCESSING', 'CV_FAILED', 'EVIDENCE_REVIEW_REQUIRED', 'PREFERENCES_REQUIRED', 'PREFERENCES_REVIEW_REQUIRED', 'NO_ELIGIBLE_JOBS', 'UNAVAILABLE'] as const;
export type EmployeeRecommendationState = typeof employeeRecommendationStates[number];
export const employeeIntentPreferencesSchema = z.object({
    desiredSelections: desiredSelectionsSchema.optional(),
    preferencesRevision: z.number().int().nonnegative().optional(),
    desiredJobTitleIds: z.array(z.string().min(1).max(100)).max(10).refine(ids => new Set(ids).size === ids.length, 'Duplicate positions').optional(),
    preferredWorkModes: z.array(z.enum(['ONSITE', 'HYBRID', 'REMOTE'])).max(3).optional(),
});
export const employeeEvidencePatchSchema = z.object({
    revision: z.number().int().nonnegative(),
    operation: z.enum(['UPSERT', 'EXCLUDE', 'RESET']),
    kind: z.enum(['SKILL', 'EXPERIENCE', 'ROLE', 'LANGUAGE']),
    key: z.string().min(1).max(200),
    value: z.record(z.unknown()).optional(),
}).strict();
export type EmployeeIntentPreferenceInput = z.infer<typeof employeeIntentPreferencesSchema>;
export type EmployeeEvidencePatch = z.infer<typeof employeeEvidencePatchSchema>;
export const EMPLOYEE_PROFESSIONAL_WEIGHTS = Object.freeze({ skillPresence: 40, experience: 25, seniority: 15, skillLevel: 10, language: 10 });
export type EmployeeEligibility = {
    eligible: boolean;
    reason: 'MATCH' | 'POSITION_MISMATCH' | 'UNREVIEWED_ROLE' | 'FAMILY_MISMATCH';
    canonicalRoleId?: string;
    familyId?: string;
    matchType?: 'EXACT' | 'GROUP' | 'RELATED';
    selectionBasis?: 'EXACT' | 'GROUP' | 'RELATED';
    selectedGroupId?: string;
    selectedGroupName?: string;
    vacancyGroupId?: string;
    vacancyGroupName?: string;
    groupReleaseVersion?: string;
    groupMembership?: {reference:string;method:string;sourceUri?:string;tasks:string[]};
    selectedRoleId?: string;
    selectedRoleName?: string;
    relationReference?: string;
    relationScore?: number;
};
