'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { BrowsePage, DirectoryStatus } from '@/components/public/BrowsePage';
import s from '@/components/public/PublicPages.module.css';
import { ExploreCategoryCard } from '@/components/explore/ExploreCategoryCard';
type Category = { name: string; slug: string; icon?: string | null };
export default function ExploreCategoriesPage() {
  const { t, locale } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    Promise.all([api<Category[]>('/meta/categories', { auth: false, signal: controller.signal }), api<{ facets?: { categories?: Array<{slug: string; count: number}> } }>('/jobs?limit=1&sort=newest', { auth: false, signal: controller.signal })])
      .then(([items, response]) => { if (!controller.signal.aborted) { setCategories(items); setCounts(Object.fromEntries((response.facets?.categories || []).map((item) => [item.slug, item.count]))); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locale, retry]);
  return <BrowsePage title={t('exploreCategoriesTitle')}>
    {loading || error || !categories.length ? <DirectoryStatus loading={loading} error={error} onRetry={() => setRetry((v) => v + 1)} /> : <div className={s.grid}>{[...categories].sort((a,b) => (counts[b.slug] || 0) - (counts[a.slug] || 0)).map((item) => <ExploreCategoryCard key={item.slug} name={item.name} slug={item.slug} icon={item.icon} count={counts[item.slug] || 0} countLabel={t('openRolesCount').replace('{n}', String(counts[item.slug] || 0))} />)}</div>}
  </BrowsePage>;
}
