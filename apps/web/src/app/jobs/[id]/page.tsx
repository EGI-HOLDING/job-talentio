import type { Metadata } from 'next';
import {
  buildJobPostingJsonLd,
  fetchJobSeo,
  jobCanonicalUrl,
  jobMetaDescription,
} from '@/lib/jobSeo';
import { sanitizeMojibake } from '@/lib/text';
import { JobDetailClient } from './JobDetailClient';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const job = await fetchJobSeo(id);
  if (!job) return {};
  const title = `${sanitizeMojibake(job.title)} - ${job.company.name}`;
  const description = jobMetaDescription(job);
  const url = jobCanonicalUrl(job.id);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const job = await fetchJobSeo(id);
  const jsonLd = job ? buildJobPostingJsonLd(job) : null;
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
