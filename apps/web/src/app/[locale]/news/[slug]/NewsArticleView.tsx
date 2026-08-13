'use client';

import { useState } from 'react';
import { Link } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { UgcText } from '@/components/ui/UgcText';
import { NEWS_CATEGORY_LABEL_KEY, formatNewsDate } from '@/components/news/NewsCard';
import type { NewsArticleDetail } from '@/lib/newsSeo';

export function NewsArticleView({ article: initial }: { article: NewsArticleDetail }) {
  const { t, locale } = useI18n();
  const [article, setArticle] = useState(initial);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');

  async function machineTranslate() {
    setTranslating(true);
    setError('');
    try {
      const res = await api<{ status: string; article: NewsArticleDetail }>(
        `/news/slug/${encodeURIComponent(article.slug)}/translate/${locale}`,
        { method: 'POST' },
      );
      if (res.article) setArticle(res.article);
      if (res.status === 'disabled' || res.status === 'budget-exceeded') {
        setError(t('ui.translateFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.translateFailed'));
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="shell">
      <article className="news-article section">
        <Link href="/news" className="muted" style={{ fontSize: '0.9rem' }}>
          ← {t('backToNews')}
        </Link>

        <div className="news-card-meta" style={{ margin: '1rem 0 0.6rem' }}>
          <span className="badge">{t(NEWS_CATEGORY_LABEL_KEY[article.category])}</span>
          <span className="muted">{formatNewsDate(article.publishedAt, locale)}</span>
        </div>

        <h1 style={{ margin: '0 0 1rem', lineHeight: 1.25 }}>{article.title}</h1>

        {article.coverUrl && (
          <figure style={{ margin: '0 0 1.4rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="news-article-cover" src={article.coverUrl} alt={article.title} />
            {article.coverCredit && (
              <figcaption className="news-cover-credit">{article.coverCredit}</figcaption>
            )}
          </figure>
        )}

        {error && (
          <p className="error" style={{ margin: '0 0 1rem' }}>
            {error}
          </p>
        )}

        <UgcText
          text={article.body}
          contentLocale={article.contentLocale}
          isMachineTranslated={article.isMachineTranslated}
          preserveLineBreaks
          className="news-article-body"
          translating={translating}
          onTranslate={
            article.canMachineTranslate ? () => void machineTranslate() : undefined
          }
        />

        {article.sourceName && article.sourceUrl && (
          <p className="muted" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            {t('newsFurtherReading')}:{' '}
            <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">
              {article.sourceName}
            </a>
          </p>
        )}
      </article>
    </div>
  );
}
