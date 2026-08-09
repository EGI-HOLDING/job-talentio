'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreTitleCard } from '@/components/explore/ExploreTitleCard';
import { Pagination } from '@/components/ui/Pagination';

type TitleItem = { id: string; name: string; slug: string; count: number };

type TitlesResponse = {
  items: TitleItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export default function ExploreTitlesPage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TitlesResponse | null>(null);

  const load = useCallback(async (search: string, p: number) => {
    const params = new URLSearchParams({
      page: String(p),
      limit: '24',
    });
    if (search) params.set('q', search);
    const res = await api<TitlesResponse>(`/meta/job-titles?${params}`, { auth: false });
    setData(res);
  }, []);

  useEffect(() => {
    load(query, page).catch(() => setData(null));
  }, [load, query, page]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q.trim());
  }

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '2rem' }}>
        <p className="muted" style={{ marginBottom: '0.35rem' }}>
          <Link href="/">{t('home')}</Link>
          {' / '}
          <span>{t('exploreTitlesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreTitlesTitle')}
        </h1>
        <p className="muted">{t('exploreTitlesSubtitle')}</p>

        <form className="hero-search" style={{ marginTop: '1.25rem', maxWidth: 520 }} onSubmit={onSearch}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('exploreTitlesSearch')}
            aria-label={t('exploreTitlesSearch')}
          />
          <button type="submit" className="cta">
            {t('searchJobs')}
          </button>
        </form>

        <div className="explore-grid" style={{ marginTop: '1.5rem' }}>
          {(data?.items || []).map((item) => (
            <ExploreTitleCard
              key={item.id}
              name={item.name}
              slug={item.slug}
              count={item.count}
              countLabel={rolesLabel(item.count)}
            />
          ))}
          {data && !data.items.length && <p className="muted">{t('exploreEmpty')}</p>}
        </div>

        {data && data.total > 0 && data.totalPages > 1 && (
          <div style={{ marginTop: '1.5rem' }}>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              limit={data.limit}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
