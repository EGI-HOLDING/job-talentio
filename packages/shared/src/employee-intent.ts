import { z } from 'zod';
export const EMPLOYEE_INTENT_VERSION = 'employee-intent-v3';
export const EMPLOYEE_INTENT_RANKING_VERSION = 'employee-ranking-v3.1';
export const employeeRecommendationStates = ['READY', 'CV_REQUIRED', 'CV_PROCESSING', 'CV_FAILED', 'EVIDENCE_REVIEW_REQUIRED', 'PREFERENCES_REQUIRED', 'PREFERENCES_REVIEW_REQUIRED', 'NO_ELIGIBLE_JOBS', 'UNAVAILABLE'] as const;
export type EmployeeRecommendationState = typeof employeeRecommendationStates[number];
export const employeeIntentPreferencesSchema = z.object({
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
};
