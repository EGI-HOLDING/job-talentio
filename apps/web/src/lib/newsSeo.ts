import { DEFAULT_LOCALE, LOCALES } from '@/lib/locale';
import type { Locale } from '@/lib/locale';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobtalent.io').replace(/\/$/, '');

export type NewsCategoryKey = 'CAREER' | 'INSIGHT' | 'EVENT' | 'EDUCATION';

export type NewsListItem = {
  slug: string;
  category: NewsCategoryKey;
  title: string;
  excerpt: string;
  coverUrl?: string | null;
  coverCredit?: string | null;
  sourceName?: string | null;
  publishedAt: string;
};

export type NewsArticleDetail = NewsListItem & {
  body: string;
  sourceUrl?: string | null;
  locale: string;
};

/** Server-side fetch; cached 5 min. Returns null for unpublished/missing. */
export async function fetchNewsArticle(slug: string): Promise<NewsArticleDetail | null> {
  try {
    const res = await fetch(`${API_URL}/api/news/slug/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as NewsArticleDetail;
  } catch {
    return null;
  }
}

export function newsCanonicalUrl(slug: string, locale: Locale = DEFAULT_LOCALE): string {
  return `${SITE_URL}/${locale}/news/${slug}`;
}

export function newsLanguageAlternates(slug: string): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const locale of LOCALES) alternates[locale] = newsCanonicalUrl(slug, locale);
  alternates['x-default'] = newsCanonicalUrl(slug, DEFAULT_LOCALE);
  return alternates;
}
