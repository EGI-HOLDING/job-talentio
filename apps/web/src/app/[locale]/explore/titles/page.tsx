'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreTitleCard } from '@/components/explore/ExploreTitleCard';
import { Pagination } from '@/components/ui/Pagination';
import { BrowsePage, DirectoryStatus } from '@/components/public/BrowsePage';
import s from '@/components/public/PublicPages.module.css';

type TitleItem = { id: string; name: string; slug: string; count: number };

type TitlesResponse = {
  items: TitleItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export default function ExploreTitlesPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TitlesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    const params = new URLSearchParams({page:String(page),limit:'24'}); if (query) params.set('q',query);
    api<TitlesResponse>('/meta/job-titles?' + params,{auth:false,signal:controller.signal}).then((response) => { if (!controller.signal.aborted) setData(response); }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[query,page,locale,retry]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q.trim());
  }

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  return <BrowsePage title={t('exploreTitlesTitle')}>
    <form className={s.search} onSubmit={onSearch}><input value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('exploreTitlesSearch')} aria-label={t('exploreTitlesSearch')} /><button type="submit" className={s.primary}>{t('search')}</button></form>
    {loading || error ? <DirectoryStatus loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} /> : <div className={s.grid} style={{marginTop:24}}>{data?.items.map((item) => <ExploreTitleCard key={item.id} name={item.name} slug={item.slug} count={item.count} countLabel={rolesLabel(item.count)} />)}{data && !data.items.length && <DirectoryStatus loading={false} onRetry={() => setRetry((value) => value + 1)} />}</div>}
    {!loading && !error && data && data.totalPages > 1 && <div className={s.pagination}><Pagination page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={setPage} /></div>}
  </BrowsePage>;
}
