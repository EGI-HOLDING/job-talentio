export const PLAN_LIMITS = {
  FREE: {
    activeJobs: 1,
    coldChat: false,
    candidateSearch: 'limited' as const,
    matchingBoost: false,
  },
  STANDARD: {
    activeJobs: 5,
    coldChat: false,
    candidateSearch: 'full' as const,
    matchingBoost: false,
  },
  PREMIUM: {
    activeJobs: 20,
    coldChat: true,
    candidateSearch: 'full' as const,
    matchingBoost: true,
    coldChatDailyQuota: 20,
  },
  /** Featured browse (VIP tab / Top Companies) + highest entitlements */
  VIP: {
    activeJobs: 50,
    coldChat: true,
    candidateSearch: 'full' as const,
    matchingBoost: true,
    coldChatDailyQuota: 50,
    featuredBrowse: true as const,
  },
} as const;

export const PLAN_PRICES_UZS = {
  FREE: 0,
  STANDARD: 299_000,
  PREMIUM: 799_000,
  VIP: 1_999_000,
  HOT_JOB_7D: 99_000,
  HOT_JOB_14D: 179_000,
  HOT_JOB_30D: 299_000,
} as const;

/** Demo / staging companies promoted to VIP for Top Companies browse. */
export const VIP_DEMO_COMPANY_SLUGS = [
  'uzpay-fintech',
  'orient-bank',
  'uztelecom-digital',
  'clickpay-solutions',
  'caravan-marketplace',
] as const;

export const HOT_JOB_DAYS = [7, 14, 30] as const;

export const DEFAULT_PIPELINE = [
  'NEW',
  'IN_REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export const LOCALES = ['uz', 'ru', 'en'] as const;
export const DEFAULT_LOCALE = 'uz' as const;
