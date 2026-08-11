import type { Metadata } from 'next';
import {
  buildJobPostingJsonLd,
  fetchJobSeo,
  jobCanonicalUrl,
  jobLanguageAlternates,
  jobMetaDescription,
} from '@/lib/jobSeo';
import { sanitizeMojibake } from '@/lib/text';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { JobDetailClient } from './JobDetailClient';

type PageProps = { params: Promise<{ id: string; locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, locale } = await params;
  const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const job = await fetchJobSeo(id, active);
  if (!job) return {};
  const title = `${sanitizeMojibake(job.title)} - ${job.company.name}`;
  const description = jobMetaDescription(job);
  const url = jobCanonicalUrl(job.id, active);
  return {
    title,
    description,
    alternates: { canonical: url, languages: jobLanguageAlternates(job.id) },
    openGraph: { title, description, url, type: 'website' },
  };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id, locale } = await params;
  const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const job = await fetchJobSeo(id, active);
  const jsonLd = job ? buildJobPostingJsonLd(job, active) : null;
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Escape < so job descriptions cannot break out of the script tag.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      )}
      <JobDetailClient />
    </>
  );
}
