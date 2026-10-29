export const DEFAULT_PIPELINE = [
  'NEW',
  'IN_REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

/** Stages shown on the recruiter Kanban board. NEW remains an application status before HR review. */
export const KANBAN_STAGES = [
  'IN_REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

export const LOCALES = ['uz', 'ru', 'en', 'id'] as const;
export const DEFAULT_LOCALE = 'uz' as const;
