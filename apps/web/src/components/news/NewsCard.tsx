'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import type { NewsCategoryKey, NewsListItem } from '@/lib/newsSeo';

export const NEWS_CATEGORY_LABEL_KEY: Record<NewsCategoryKey, string> = {
  CAREER: 'newsCatCareer',
  INSIGHT: 'newsCatInsight',
  EVENT: 'newsCatEvent',
  EDUCATION: 'newsCatEducation',
};

export function formatNewsDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale === 'uz' ? 'uz' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export function NewsCard({ item }: { item: NewsListItem }) {
  const { t, locale } = useI18n();
  return (
    <Link href={`/news/${item.slug}`} className="news-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="news-cover" src={item.coverUrl || ''} alt={item.title} loading="lazy" />
      <div className="news-card-body">
        <div className="news-card-meta">
          <span className="badge">{t(NEWS_CATEGORY_LABEL_KEY[item.category])}</span>
          <span className="muted">{formatNewsDate(item.publishedAt, locale)}</span>
        </div>
        <h3>{item.title}</h3>
        <p className="news-card-excerpt">{item.excerpt}</p>
        <span className="news-card-read">{t('readMore')} →</span>
      </div>
    </Link>
  );
}
