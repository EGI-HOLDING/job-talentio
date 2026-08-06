import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(120),
  role: z.enum(['EMPLOYEE', 'RECRUITER']),
  locale: z.enum(['uz', 'ru', 'en']).default('uz'),
  acceptTerms: z.literal(true),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const devLoginSchema = z.object({
  email: z.string().email(),
  role: z.enum(['EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN']).optional(),
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
      z.object({
        slug: z.string().min(1).max(80),
        isRequired: z.boolean().optional().default(true),
        weight: z.number().min(0.1).max(5).optional().default(1),
      }),
    )
    .max(30)
    .default([]),
  benefitSlugs: z.array(z.string()).max(20).default([]),
  locale: z.enum(['uz', 'ru', 'en']).default('uz'),
});

export const jobSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(), // slug or comma-separated slugs
  category: z.string().optional(),
  company: z.string().optional(),
  companySlug: z.string().optional(), // exact company slug (comma-separated ok)
  employmentType: z.string().optional(),
  workMode: z.string().optional(),
  experienceLevel: z.string().optional(),
  skills: z.string().optional(), // comma-separated slugs
  skillMode: z.enum(['AND', 'OR']).default('OR'),
  benefits: z.string().optional(), // comma-separated slugs
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
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const candidateSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  skills: z.string().optional(), // comma-separated slugs
  skillMode: z.enum(['AND', 'OR']).default('OR'),
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
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z.string().min(1).max(2000),
      }),
    )
    .optional()
    .default([]),
});

export const chatMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const planUpgradeSchema = z.object({
  plan: z.enum(['STANDARD', 'PREMIUM']),
});

export const hotJobSchema = z.object({
  days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
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

export const jobAlertSchema = z.object({
  name: z.string().min(1).max(120),
  query: z.string().max(200).optional(),
  citySlug: z.string().max(120).optional(),
  categorySlug: z.string().max(120).optional(),
  skillSlugs: z.array(z.string()).max(20).default([]),
  frequency: z.enum(['DAILY', 'WEEKLY']).default('DAILY'),
});

export const resumeSchema = z.object({
  title: z.string().min(1).max(160),
  content: z.string().max(50000).optional(),
  isPrimary: z.boolean().optional(),
});

export const resumeImportSchema = z.object({
  headline: z.boolean().optional(),
  summary: z.boolean().optional(),
  phone: z.boolean().optional(),
  skillIndexes: z.array(z.number().int().min(0)).max(50).default([]),
  experienceIndexes: z.array(z.number().int().min(0)).max(20).default([]),
  educationIndexes: z.array(z.number().int().min(0)).max(10).default([]),
  languageIndexes: z.array(z.number().int().min(0)).max(15).default([]),
});

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
