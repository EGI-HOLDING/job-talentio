import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(['EMPLOYEE', 'RECRUITER']),
    locale: z.enum(['uz', 'ru', 'en']).default('uz'),
    acceptTerms: z
      .boolean()
      .refine((v) => v === true, { message: 'You must accept the terms to create an account' }),
    companyName: z.string().trim().min(2).max(160).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'RECRUITER') {
      const name = data.companyName?.trim() ?? '';
      if (name.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['companyName'],
          message: 'Company name is required for recruiter accounts',
        });
      }
    }
  });

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
});

/** Google Identity Services ID-token sign-in. role/companyName only needed for first sign-in. */
export const googleOAuthSchema = z
  .object({
    idToken: z.string().min(20),
    role: z.enum(['EMPLOYEE', 'RECRUITER']).optional(),
    companyName: z.string().trim().min(2).max(160).optional(),
    locale: z.enum(['uz', 'ru', 'en']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'RECRUITER' && (data.companyName?.trim() ?? '').length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyName'],
        message: 'Company name is required for recruiter accounts',
      });
    }
  });

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(200),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email(),
});

export const devLoginSchema = z.object({
  email: z.string().email(),
  // SUPER_ADMIN must never be mintable via dev-login
  role: z.enum(['EMPLOYEE', 'RECRUITER']).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20).max(300),
});

/** Logout works even when the access token already expired; token is optional. */
export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(300).optional(),
});

export const companySchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(5000).optional(),
  website: z.string().url().optional().or(z.literal('')),
  citySlug: z.string().max(120).optional(),
  industrySlug: z.string().max(120).optional(),
  size: z
    .enum(['SIZE_1_10', 'SIZE_11_50', 'SIZE_51_200', 'SIZE_201_1000', 'SIZE_1000_PLUS'])
    .optional(),
});

export const jobPostSchema = z.object({
  title: z.string().min(3).max(200),
  jobTitleSlug: z.string().max(120).optional(),
  description: z.string().min(20).max(20000),
  citySlug: z.string().max(120).optional(),
  categorySlug: z.string().max(120).optional(),
  employmentType: z
    .enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'])
    .default('FULL_TIME'),
  workMode: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).default('ONSITE'),
  salaryMin: z.number().int().nonnegative().optional().nullable(),
  salaryMax: z.number().int().nonnegative().optional().nullable(),
  salaryPeriod: z.enum(['MONTHLY', 'YEARLY', 'HOURLY']).default('MONTHLY'),
  currency: z.string().default('UZS'),
  experienceYearsMin: z.number().int().min(0).max(50).optional().nullable(),
  experienceLevel: z
    .enum(['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'])
    .optional()
    .nullable(),
  skills: z
    .array(
      z
        .object({
          slug: z.string().min(1).max(80).optional(),
          name: z.string().min(1).max(80).optional(),
          isRequired: z.boolean().optional().default(true),
          weight: z.number().min(0.1).max(5).optional().default(1),
        })
        .refine((s) => Boolean(s.slug || s.name), { message: 'slug or name required' }),
    )
    .max(30)
    .default([]),
  benefitSlugs: z.array(z.string()).max(20).default([]),
  benefits: z
    .array(
      z
        .object({
          slug: z.string().min(1).max(80).optional(),
          name: z.string().min(1).max(80).optional(),
        })
        .refine((b) => Boolean(b.slug || b.name), { message: 'slug or name required' }),
    )
    .max(20)
    .optional(),
  languages: z
    .array(
      z
        .object({
          code: z.string().min(2).max(8).optional(),
          name: z.string().min(1).max(80).optional(),
          minLevel: z
            .enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'])
            .optional()
            .default('B1'),
          isRequired: z.boolean().optional().default(true),
        })
        .refine((l) => Boolean(l.code || l.name), { message: 'code or name required' }),
    )
    .max(4)
    .default([]),
  locale: z.enum(['uz', 'ru', 'en']).default('uz'),
});

export const jobSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(), // slug or comma-separated slugs
  category: z.string().optional(),
  company: z.string().optional(),
  companySlug: z.string().optional(), // exact company slug (comma-separated ok)
  /** Company Industry slug (comma-separated ok) */
  industrySlug: z.string().optional(),
  /** Canonical JobTitle slug (comma-separated ok) */
  jobTitle: z.string().optional(),
  employmentType: z.string().optional(),
  workMode: z.string().optional(),
  experienceLevel: z.string().optional(),
  skills: z.string().optional(), // comma-separated slugs
  skillMode: z.enum(['AND', 'OR']).default('OR'),
  benefits: z.string().optional(), // comma-separated slugs
  /** Comma-separated language tokens: `en` or `en:B2` (level = floor, inclusive). */
  languages: z.string().optional(),
  salaryMin: z.coerce.number().optional(),
  salaryMax: z.coerce.number().optional(),
  experienceYearsMax: z.coerce.number().optional(),
  postedWithin: z.enum(['24h', '7d', '30d']).optional(),
  hotOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  sort: z
    .enum(['relevance', 'newest', 'salary_high', 'salary_low', 'experience', 'match'])
    .default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  /** Keep in sync with web jobs page DEFAULT_LIMIT (12). */
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const candidateSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  skills: z.string().optional(), // comma-separated slugs
  skillMode: z.enum(['AND', 'OR']).default('OR'),
  /** Comma-separated JobTitle slugs (desired role / experience titles). */
  jobTitle: z.string().optional(),
  degree: z.string().optional(),
  languages: z.string().optional(),
  experienceYearsMin: z.coerce.number().optional(),
  experienceYearsMax: z.coerce.number().optional(),
  hasCertification: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  matchJobId: z.string().optional(),
  sort: z.enum(['relevance', 'newest', 'match']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  /** Keep in sync with recruiter Find talent default page size (12). */
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const applicationStatusSchema = z.object({
  status: z.enum([
    'NEW',
    'IN_REVIEW',
    'INTERVIEW',
    'OFFER',
    'HIRED',
    'REJECTED',
    'WITHDRAWN',
  ]),
  note: z.string().max(2000).optional(),
});

export const applySchema = z.object({
  coverLetter: z.string().max(5000).optional(),
  resumeId: z.string().min(1).optional(),
  // Optional questions may arrive as empty strings from the form; drop them after trim.
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        answer: z.string().max(2000),
      }),
    )
    .optional()
    .default([])
    .transform((rows) =>
      rows
        .map((r) => ({ questionId: r.questionId, answer: r.answer.trim() }))
        .filter((r) => r.answer.length > 0),
    ),
});

export const chatMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const planUpgradeSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM', 'VIP']),
});

/** Public hiring-company directory (explore / Top Companies). */
export const companyBrowseSchema = z.object({
  q: z.string().optional(),
  industrySlug: z.string().optional(),
  plan: z.enum(['VIP', 'PREMIUM', 'STANDARD', 'FREE']).optional(),
  sort: z.enum(['jobs', 'name']).default('jobs'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export const hotJobSchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
});

/** Recruiter-authored translation of a posting (one row per extra language). */
export const jobTranslationSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(20).max(20000),
});

/** Public curated news list (career/insight/event/education). */
export const newsBrowseSchema = z.object({
  category: z.enum(['CAREER', 'INSIGHT', 'EVENT', 'EDUCATION']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

export const newsLatestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(8).default(4),
});

export const profileUpdateSchema = z.object({
  headline: z.string().max(200).optional(),
  summary: z.string().max(5000).optional(),
  citySlug: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional(),
  visibility: z
    .enum(['PUBLIC', 'TO_REGISTERED_RECRUITERS', 'PRIVATE'])
    .optional(),
  desiredSalaryMin: z.number().int().nonnegative().optional().nullable(),
  desiredPosition: z.string().max(160).optional(),
});

export const skillSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80).optional(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).optional(),
});

export const skillLevelUpdateSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
});

export const experienceSchema = z.object({
  companyName: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  description: z.string().max(5000).optional(),
  citySlug: z.string().max(120).optional(),
  locationNote: z.string().max(160).optional(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  isCurrent: z.boolean().default(false),
});

export const educationSchema = z.object({
  school: z.string().min(1).max(200),
  degree: z.enum(['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD']).optional(),
  field: z.string().max(160).optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

export const certificationSchema = z.object({
  name: z.string().min(1).max(200),
  issuer: z.string().max(160).optional(),
  issuedAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  credentialUrl: z.string().url().optional().or(z.literal('')),
});

export const languageSchema = z.object({
  code: z.string().min(2).max(10).optional(),
  name: z.string().min(1).max(80).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']),
});

export const languageLevelUpdateSchema = z.object({
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']),
});

export const jobAlertSchema = z.object({
  name: z.string().min(1).max(120),
  query: z.string().max(200).optional(),
  citySlug: z.string().max(120).optional(),
  categorySlug: z.string().max(120).optional(),
  skillSlugs: z.array(z.string()).max(20).default([]),
  frequency: z.enum(['DAILY', 'WEEKLY']).default('DAILY'),
});

export const jobAlertUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  query: z.string().max(200).optional().nullable(),
  citySlug: z.string().max(120).optional().nullable(),
  categorySlug: z.string().max(120).optional().nullable(),
  skillSlugs: z.array(z.string()).max(20).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY']).optional(),
  isActive: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});

export const changeEmailSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().min(1),
});

export const confirmEmailChangeSchema = z.object({
  token: z.string().min(20),
});

export const resumeSchema = z.object({
  title: z.string().min(1).max(160),
  content: z.string().max(50000).optional(),
  isPrimary: z.boolean().optional(),
  /** Canonical JobTitle slug (preferred). */
  jobTitleSlug: z.string().max(120).optional(),
  /** Free-text role name; resolved via JobTitle catalog when slug omitted. */
  jobTitle: z.string().min(2).max(160).optional(),
});

/** Max non-deleted resumes per employee profile. */
export const MAX_RESUMES_PER_PROFILE = 10;

export const resumeImportSchema = z.object({
  headline: z.boolean().optional(),
  summary: z.boolean().optional(),
  phone: z.boolean().optional(),
  skillIndexes: z.array(z.number().int().min(0)).max(50).default([]),
  experienceIndexes: z.array(z.number().int().min(0)).max(20).default([]),
  educationIndexes: z.array(z.number().int().min(0)).max(10).default([]),
  languageIndexes: z.array(z.number().int().min(0)).max(15).default([]),
});

export const resumeTemplateKeys = ['classic', 'modern', 'compact'] as const;
export type ResumeTemplateKey = (typeof resumeTemplateKeys)[number];

export const resumeInclusionSectionsSchema = z.object({
  summary: z.boolean().default(true),
  skills: z.boolean().default(true),
  experience: z.boolean().default(true),
  education: z.boolean().default(true),
  languages: z.boolean().default(true),
  certifications: z.boolean().default(true),
  phone: z.boolean().default(true),
  email: z.boolean().default(true),
});

export const resumeInclusionSchema = z.object({
  sections: resumeInclusionSectionsSchema.default({}),
  experienceIds: z.array(z.string()).max(50).nullable().optional(),
  educationIds: z.array(z.string()).max(30).nullable().optional(),
  skillIds: z.array(z.string()).max(80).nullable().optional(),
  languageIds: z.array(z.string()).max(30).nullable().optional(),
  certificationIds: z.array(z.string()).max(40).nullable().optional(),
});

export const resumeBuilderSettingsSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  templateKey: z.enum(resumeTemplateKeys).optional(),
  themeAccent: z.string().max(32).optional().nullable(),
  inclusion: resumeInclusionSchema.optional(),
  isPrimary: z.boolean().optional(),
  jobTitleSlug: z.string().max(120).optional(),
  jobTitle: z.string().min(2).max(160).optional(),
});

export const DEFAULT_RESUME_INCLUSION = {
  sections: {
    summary: true,
    skills: true,
    experience: true,
    education: true,
    languages: true,
    certifications: true,
    phone: true,
    email: true,
  },
  experienceIds: null as string[] | null,
  educationIds: null as string[] | null,
  skillIds: null as string[] | null,
  languageIds: null as string[] | null,
  certificationIds: null as string[] | null,
};

export type ResumeInclusion = z.infer<typeof resumeInclusionSchema>;

export const jobQuestionSchema = z.object({
  question: z.string().min(3).max(500),
  type: z.enum(['TEXT', 'YES_NO', 'NUMBER']).default('TEXT'),
  isRequired: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const interviewSchema = z.object({
  scheduledAt: z.string(),
  durationMins: z.number().int().min(15).max(480).default(60),
  location: z.string().max(300).optional(),
  meetingUrl: z.string().url().optional().or(z.literal('')),
  note: z.string().max(2000).optional(),
});

export const accountUpdateSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  locale: z.enum(['uz', 'ru', 'en']).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const reportSchema = z.object({
  entityType: z.enum(['JOB_POST', 'USER', 'COMPANY', 'CHAT_MESSAGE']),
  entityId: z.string().min(1),
  reason: z.string().min(5).max(2000),
});

const applicationStatusEnum = z.enum([
  'NEW',
  'IN_REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
]);

export const messageTemplateSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(5000),
});

export const messageTemplateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
});

/** Bulk move and/or message applicants in one pipeline stage. */
export const bulkCampaignSchema = z
  .object({
    companyId: z.string().min(1),
    jobPostId: z.string().min(1),
    applicationIds: z.array(z.string().min(1)).min(1).max(50),
    fromStatus: applicationStatusEnum.optional(),
    toStatus: applicationStatusEnum.optional(),
    templateId: z.string().min(1).optional(),
    messageBody: z.string().trim().min(1).max(5000).optional(),
    note: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.toStatus && !data.templateId && !data.messageBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide toStatus and/or a message (templateId or messageBody)',
      });
    }
  });

export const bulkCommsOptOutSchema = z.object({
  optedOut: z.boolean(),
});
