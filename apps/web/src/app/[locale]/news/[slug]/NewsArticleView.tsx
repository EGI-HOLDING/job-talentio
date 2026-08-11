'use client';

import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { NEWS_CATEGORY_LABEL_KEY, formatNewsDate } from '@/components/news/NewsCard';
import type { NewsArticleDetail } from '@/lib/newsSeo';

export function NewsArticleView({ article }: { article: NewsArticleDetail }) {
  const { t, locale } = useI18n();
  const paragraphs = article.body.split(/\n\n+/).filter((p) => p.trim().length > 0);

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

        <div className="news-article-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

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
