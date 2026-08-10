import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchNewsArticle, newsCanonicalUrl } from '@/lib/newsSeo';
import { NewsArticleView } from './NewsArticleView';

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await fetchNewsArticle(slug);
  if (!article) return {};
  const url = newsCanonicalUrl(article.slug);
  return {
    title: `${article.title} - Job Talentio`,
    description: article.excerpt,
    alternates: { canonical: url },
    openGraph: {
      title: article.title,
      description: article.excerpt,
      url,
      type: 'article',
      ...(article.coverUrl ? { images: [{ url: article.coverUrl }] } : {}),
    },
  };
}

export default async function NewsArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await fetchNewsArticle(slug);
  if (!article) notFound();

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    url: newsCanonicalUrl(article.slug),
    ...(article.coverUrl ? { image: [article.coverUrl] } : {}),
    publisher: { '@type': 'Organization', name: 'Job Talentio' },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <NewsArticleView article={article} />
    </>
  );
}
