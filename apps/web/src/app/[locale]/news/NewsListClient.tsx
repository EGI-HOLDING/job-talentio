'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { NewsCard, NEWS_CATEGORY_LABEL_KEY } from '@/components/news/NewsCard';
import type { NewsCategoryKey, NewsListItem } from '@/lib/newsSeo';

const CATEGORIES: NewsCategoryKey[] = ['CAREER', 'INSIGHT', 'EVENT', 'EDUCATION'];
const PAGE_SIZE = 12;

type NewsListResponse = {
  items: NewsListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function NewsListClient() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramCategory = searchParams.get('category');
  const category: NewsCategoryKey | null = CATEGORIES.includes(paramCategory as NewsCategoryKey)
    ? (paramCategory as NewsCategoryKey)
    : null;

  const [items, setItems] = useState<NewsListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (pageToLoad: number, append: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(pageToLoad), limit: String(PAGE_SIZE) });
        if (category) params.set('category', category);
        const data = await api<NewsListResponse>(`/news?${params.toString()}`, { auth: false });
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setPage(data.page);
        setTotalPages(data.totalPages);
      } catch {
        if (!append) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [category],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  function chooseCategory(next: NewsCategoryKey | null) {
    router.replace(next ? `/news?category=${next}` : '/news');
  }

  return (
    <div className="shell">
      <section className="section">
        <h1 className="section-title" style={{ fontSize: '1.7rem' }}>
          {t('news')}
        </h1>
        <p className="muted">{t('latestNewsSubtitle')}</p>

        <div className="news-filter-row" role="tablist" aria-label={t('news')}>
          <button
            type="button"
            className="chip"
            aria-pressed={!category}
            style={!category ? { background: 'var(--accent)', color: '#fff', border: 0 } : undefined}
            onClick={() => chooseCategory(null)}
          >
            {t('newsAll')}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={category === c}
              style={category === c ? { background: 'var(--accent)', color: '#fff', border: 0 } : undefined}
              onClick={() => chooseCategory(c)}
            >
              {t(NEWS_CATEGORY_LABEL_KEY[c])}
            </button>
          ))}
        </div>

        <div className="news-grid">
          {items.map((item) => (
            <NewsCard key={item.slug} item={item} />
          ))}
        </div>
        {!loading && items.length === 0 && <p className="muted">{t('newsEmpty')}</p>}

        {page < totalPages && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button type="button" className="secondary" disabled={loading} onClick={() => void load(page + 1, true)}>
              {loading ? '...' : `${t('viewAll')} +`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
