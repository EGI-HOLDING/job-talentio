import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchNewsArticle, newsCanonicalUrl, newsLanguageAlternates } from '@/lib/newsSeo';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { NewsArticleView } from './NewsArticleView';

type PageProps = { params: Promise<{ slug: string; locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const article = await fetchNewsArticle(slug, active);
  if (!article) return {};
  const url = newsCanonicalUrl(article.slug, active);
  return {
    title: `${article.title} - Job Talentio`,
    description: article.excerpt,
    alternates: {
      canonical: url,
      languages: newsLanguageAlternates(article.slug, article.availableLocales),
    },
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
  const { slug, locale } = await params;
  const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const article = await fetchNewsArticle(slug, active);
  if (!article) notFound();

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    url: newsCanonicalUrl(article.slug, active),
    inLanguage: article.contentLocale ?? article.locale,
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
