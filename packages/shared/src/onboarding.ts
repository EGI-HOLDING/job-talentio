import { z } from "zod";
import { resumeImportSchema, resumeImportExperienceSchema, resumeImportEducationSchema, resumeImportLanguageSchema } from "./schemas";
export const onboardingStatusSchema = z.enum([
  "NOT_REQUIRED",
  "IN_PROGRESS",
  "COMPLETED",
]);
// Parsing and in-progress edits may leave required import fields blank.
// Preserve those rows for review; only `review` is validated for final import.
export const onboardingReviewDraftSchema = resumeImportSchema.extend({
  skills: z.array(z.string().max(80)).max(50).default([]),
  experiences: z.array(resumeImportExperienceSchema.extend({
    title: z.string().max(160),
    companyName: z.string().max(160),
  })).max(20).default([]),
  educations: z.array(resumeImportEducationSchema.extend({ school: z.string().max(200) })).max(10).default([]),
  languages: z.array(resumeImportLanguageSchema.extend({ name: z.string().max(80) })).max(15).default([]),
});
export const onboardingReviewSchema = z.object({
  data: onboardingReviewDraftSchema,
  basics: z.boolean(),
  skills: z.array(z.boolean()).max(50),
  experiences: z.array(z.boolean()).max(20),
  educations: z.array(z.boolean()).max(10),
  languages: z.array(z.boolean()).max(15),
});
export type OnboardingReview = z.infer<typeof onboardingReviewSchema>;
export const employeePreferencesSchema = z.object({
  desiredPositions: z
    .array(z.string().trim().min(1).max(160))
    .max(10)
    .optional(),
  preferredCountryIds: z.array(z.string().min(1).max(100)).max(10).optional(),
  residenceCountryId: z.string().min(1).max(100).nullable().optional(),
  desiredSalaryMin: z
    .number()
    .finite()
    .positive()
    .max(1_000_000_000_000)
    .refine(
      (n) => /^\d+(?:\.\d{1,2})?$/.test(String(n)),
      "Use at most two decimal places",
    )
    .nullable()
    .optional(),
  desiredSalaryCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  desiredSalaryPeriod: z.enum(["MONTHLY", "YEARLY", "HOURLY"]).optional(),
  salaryNegotiable: z.boolean().optional(),
});
export const employeeOnboardingSchema = employeePreferencesSchema.extend({
  step: z.number().int().min(1).max(5).optional(),
  fullName: z.string().trim().max(200).optional(),
  visibility: z
    .enum(["PUBLIC", "TO_REGISTERED_RECRUITERS", "PRIVATE"])
    .optional(),
  noExperience: z.boolean().optional(),
  resumeId: z.string().max(100).nullable().optional(),
  resumeGeneration: z.number().int().nonnegative().optional(),
  review: resumeImportSchema.nullable().optional(),
  reviewState: onboardingReviewSchema.nullable().optional(),
  manualExperiences: z
    .array(
      resumeImportExperienceSchema.extend({
        countryId: z.string().max(100).optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type EmployeeOnboardingInput = z.infer<typeof employeeOnboardingSchema>;
