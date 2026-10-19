'use client';

import { useState } from 'react';
import { Link } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { UgcText } from '@/components/ui/UgcText';
import { NEWS_CATEGORY_LABEL_KEY, formatNewsDate } from '@/components/news/NewsCard';
import type { NewsArticleDetail } from '@/lib/newsSeo';
import s from '@/components/public/PublicPages.module.css';

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
    <div className={s.page}><div className={s.container}>
      <article className={s.article}>
        <Link href="/news" className={s.back}>
          {'\u2190'} {t('public.backInsights')}
        </Link>

        <div className="news-card-meta" style={{ margin: '1rem 0 0.6rem' }}>
          <span className="badge">{t(NEWS_CATEGORY_LABEL_KEY[article.category])}</span>
          <span className="muted">{formatNewsDate(article.publishedAt, locale)}</span>
        </div>

        <h1>{article.title}</h1>
        <p className={s.articleLead}>{article.excerpt}</p>

        {article.coverUrl && (
          <figure style={{ margin: '0 0 1.4rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={article.coverUrl} alt="" />
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
          className={s.articleBody}
          paragraphs
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
    </div></div>
  );
}
