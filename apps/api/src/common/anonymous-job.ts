import type { Locale } from './i18n/locale';

/** Placeholder employer shown on confidential postings, per UI language. */
export const ANONYMOUS_EMPLOYER_NAME: Record<Locale, string> = {
  uz: 'Maxfiy ish beruvchi',
  ru: 'Конфиденциальный работодатель',
  en: 'Confidential employer',
};

/** Application stages at which a confidential employer is revealed to the candidate. */
export const ANONYMOUS_REVEAL_STATUSES = ['INTERVIEW', 'OFFER', 'HIRED'] as const;

export function anonymousEmployerName(locale: Locale | string | null | undefined): string {
  return ANONYMOUS_EMPLOYER_NAME[(locale as Locale) in ANONYMOUS_EMPLOYER_NAME ? (locale as Locale) : 'uz'];
}

export function revealsAnonymousEmployer(status: string | null | undefined): boolean {
  return (ANONYMOUS_REVEAL_STATUSES as readonly string[]).includes(status ?? '');
}

export type MaskedCompany = {
  id: string;
  name: string;
  slug: string;
  logoUrl: null;
  isVerified: boolean;
  /** Tells clients not to link, follow or show a logo. */
  anonymous: true;
};

/**
 * Replace the company on a confidential posting with a neutral placeholder.
 * Keeps the job's own fields intact; drops every company attribute (id, slug,
 * logo, plan, members) because any of them identifies the employer.
 */
export function maskAnonymousCompany<T extends object>(
  job: T,
  locale: Locale | string | null | undefined,
  opts: { reveal?: boolean } = {},
): T {
  const row = job as T & { isAnonymous?: boolean };
  if (!row.isAnonymous || opts.reveal) return job;
  const masked: MaskedCompany = {
    id: '',
    name: anonymousEmployerName(locale),
    slug: '',
    logoUrl: null,
    isVerified: false,
    anonymous: true,
  };
  return { ...job, company: masked } as T;
}

/** Company name for plain-text surfaces (alerts, Telegram) that carry only the name. */
export function displayCompanyName(
  job: { isAnonymous?: boolean },
  companyName: string,
  locale: Locale | string | null | undefined,
): string {
  return job.isAnonymous ? anonymousEmployerName(locale) : companyName;
}
