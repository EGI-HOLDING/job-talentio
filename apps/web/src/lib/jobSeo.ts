import { sanitizeMojibake } from '@/lib/text';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/locale';
import type { Locale } from '@/lib/locale';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobtalent.io').replace(/\/$/, '');

export type JobSeoPayload = {
  id: string;
  title: string;
  description: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY';
  workMode: 'ONSITE' | 'REMOTE' | 'HYBRID';
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod: 'MONTHLY' | 'YEARLY' | 'HOURLY';
  currency: string;
  publishedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  company: { name: string; slug: string; logoUrl?: string | null };
  city?: { name: string } | null;
};

/** Server-side fetch; cached 5 min. Returns null for drafts/missing jobs. */
export async function fetchJobSeo(id: string): Promise<JobSeoPayload | null> {
  try {
    const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(id)}/seo`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as JobSeoPayload;
  } catch {
    return null;
  }
}

const EMPLOYMENT_TYPE_SCHEMA: Record<JobSeoPayload['employmentType'], string> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACTOR',
  INTERNSHIP: 'INTERN',
  TEMPORARY: 'TEMPORARY',
};

const SALARY_UNIT_SCHEMA: Record<JobSeoPayload['salaryPeriod'], string> = {
  MONTHLY: 'MONTH',
  YEARLY: 'YEAR',
  HOURLY: 'HOUR',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function jobCanonicalUrl(id: string, locale: Locale = DEFAULT_LOCALE): string {
  return `${SITE_URL}/${locale}/jobs/${id}`;
}

/** hreflang map so Google can serve the right language version of a posting. */
export function jobLanguageAlternates(id: string): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const locale of LOCALES) alternates[locale] = jobCanonicalUrl(id, locale);
  alternates['x-default'] = jobCanonicalUrl(id, DEFAULT_LOCALE);
  return alternates;
}

export function jobMetaDescription(job: JobSeoPayload): string {
  const text = sanitizeMojibake(job.description).replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** Google Jobs JobPosting structured data (schema.org). */
export function buildJobPostingJsonLd(
  job: JobSeoPayload,
  locale: Locale = DEFAULT_LOCALE,
): Record<string, unknown> {
  const descriptionHtml = escapeHtml(sanitizeMojibake(job.description)).replace(/\n/g, '<br>');
  const logoUrl = job.company.logoUrl
    ? job.company.logoUrl.startsWith('http')
      ? job.company.logoUrl
      : `${SITE_URL}${job.company.logoUrl}`
    : undefined;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: sanitizeMojibake(job.title),
    description: descriptionHtml,
    datePosted: job.publishedAt ?? job.createdAt,
    employmentType: EMPLOYMENT_TYPE_SCHEMA[job.employmentType] ?? 'FULL_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company.name,
      sameAs: `${SITE_URL}/${locale}/companies/${job.company.slug}`,
      ...(logoUrl ? { logo: logoUrl } : {}),
    },
    identifier: {
      '@type': 'PropertyValue',
      name: job.company.name,
      value: job.id,
    },
    url: jobCanonicalUrl(job.id, locale),
    directApply: true,
  };

  if (job.closedAt) {
    jsonLd.validThrough = job.closedAt;
  }

  if (job.workMode === 'REMOTE') {
    jsonLd.jobLocationType = 'TELECOMMUTE';
    jsonLd.applicantLocationRequirements = { '@type': 'Country', name: 'Uzbekistan' };
  }
  // Google requires jobLocation for onsite/hybrid; include for remote too when city known.
  if (job.city?.name || job.workMode !== 'REMOTE') {
    jsonLd.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(job.city?.name ? { addressLocality: job.city.name } : {}),
        addressCountry: 'UZ',
      },
    };
  }

  if (job.salaryMin != null || job.salaryMax != null) {
    jsonLd.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.currency || 'UZS',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin != null ? { minValue: job.salaryMin } : {}),
        ...(job.salaryMax != null ? { maxValue: job.salaryMax } : {}),
        unitText: SALARY_UNIT_SCHEMA[job.salaryPeriod] ?? 'MONTH',
      },
    };
  }

  return jsonLd;
}
