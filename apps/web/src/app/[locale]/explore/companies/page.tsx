'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreCompanyCard } from '@/components/explore/ExploreCompanyCard';
import { Pagination } from '@/components/ui/Pagination';

type Tab = 'industry' | 'vip' | 'all';

type CompanyRow = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  plan?: string;
  openJobsCount: number;
  industry?: { slug: string; name: string } | null;
};

type BrowseResponse = {
  items: CompanyRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type IndustryGroup = {
  slug: string;
  name: string;
  industries: Array<{ slug: string; name: string; companyCount?: number }>;
};

const PAGE_LIMIT = 24;

function ExploreCompaniesPageInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = (searchParams.get('tab') as Tab) || 'all';
  const industrySlug = searchParams.get('industrySlug') || '';
  const qParam = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || 1));

  const [qInput, setQInput] = useState(qParam);
  const [groups, setGroups] = useState<IndustryGroup[]>([]);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const activeTab: Tab =
    tab === 'industry' || tab === 'vip' || tab === 'all' ? tab : 'all';

  const setParams = useCallback(
    (patch: Record<string, string | null | undefined>, replace = false) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router[replace ? 'replace' : 'push'](qs ? `/explore/companies?${qs}` : '/explore/companies');
    },
    [router, searchParams],
  );

  useEffect(() => {
    setQInput(qParam);
  }, [qParam]);

  useEffect(() => {
    if (activeTab !== 'industry') return;
    api<{ groups?: IndustryGroup[] }>('/meta/industries?group=1', { auth: false })
      .then((r) => setGroups(r.groups || []))
      .catch(() => setGroups([]));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'industry' && !industrySlug) {
      setData(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_LIMIT));
    params.set('sort', 'jobs');
    if (activeTab === 'vip') params.set('plan', 'VIP');
    if (industrySlug) params.set('industrySlug', industrySlug);
    if (activeTab === 'all' && qParam.trim()) params.set('q', qParam.trim());

    api<BrowseResponse>(`/companies?${params.toString()}`, { auth: false })
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, limit: PAGE_LIMIT, totalPages: 1 }))
      .finally(() => setLoading(false));
  }, [activeTab, industrySlug, page, qParam]);

  const industryName = useMemo(() => {
    if (!industrySlug) return '';
    for (const g of groups) {
      const hit = g.industries.find((i) => i.slug === industrySlug);
      if (hit) return hit.name;
    }
    return industrySlug;
  }, [groups, industrySlug]);

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  function companiesLabel(n: number) {
    return t('companiesCount').replace('{n}', String(n));
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setParams({ tab: 'all', q: qInput.trim() || null, page: '1', industrySlug: industrySlug || null });
  }

  function switchTab(next: Tab) {
    if (next === 'industry') {
      setParams({ tab: 'industry', q: null, page: null, industrySlug: null });
      return;
    }
    if (next === 'vip') {
      setParams({ tab: 'vip', q: null, page: '1', industrySlug: null });
      return;
    }
    setParams({ tab: 'all', page: '1' });
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '2rem' }}>
        <p className="muted" style={{ marginBottom: '0.35rem' }}>
          <Link href="/">{t('home')}</Link>
          {' / '}
          <span>{t('exploreCompaniesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreCompaniesTitle')}
        </h1>
        <p className="muted">{t('exploreCompaniesSubtitle')}</p>

        <div
          className="explore-group-toggle"
          role="tablist"
          aria-label={t('exploreCompaniesTabs')}
          style={{ marginTop: '1.25rem' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'industry'}
            className={activeTab === 'industry' ? 'active' : ''}
            onClick={() => switchTab('industry')}
          >
            {t('exploreCompaniesTabIndustry')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'vip'}
            className={activeTab === 'vip' ? 'active' : ''}
            onClick={() => switchTab('vip')}
          >
            {t('exploreCompaniesTabVip')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={activeTab === 'all' ? 'active' : ''}
            onClick={() => switchTab('all')}
          >
            {t('exploreCompaniesTabAll')}
          </button>
        </div>

        {activeTab === 'all' && (
          <form className="hero-search explore-company-search" onSubmit={onSearch} style={{ marginTop: '1.25rem' }}>
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={t('exploreCompaniesSearch')}
              aria-label={t('exploreCompaniesSearch')}
            />
            <button type="submit" className="cta">
              {t('search')}
            </button>
          </form>
        )}

        {industrySlug && activeTab !== 'industry' && (
          <div className="company-filter-banner" style={{ marginTop: '1rem' }}>
            <div>
              <strong>
                {t('industryFilter')}: {industryName || industrySlug}
              </strong>
            </div>
            <div className="company-filter-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setParams({ industrySlug: null, page: '1' })}
              >
                {t('clearIndustryFilter')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'industry' && !industrySlug && (
          <div style={{ marginTop: '1.5rem' }}>
            {groups.map((g) => (
              <div key={g.slug} className="explore-city-section">
                <h2 className="explore-city-section__title">{g.name}</h2>
                <div className="explore-grid">
                  {g.industries.map((ind) => (
                    <button
                      key={ind.slug}
                      type="button"
                      className="explore-card explore-card--category"
                      style={{ textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%' }}
                      onClick={() =>
                        setParams({ tab: 'all', industrySlug: ind.slug, page: '1', q: null })
                      }
                    >
                      <strong>{ind.name}</strong>
                      <span>{companiesLabel(ind.companyCount ?? 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <p className="muted">{t('exploreEmpty')}</p>}
          </div>
        )}

        {(activeTab !== 'industry' || industrySlug) && (
          <>
            <div className="explore-grid explore-grid--company" style={{ marginTop: '1.5rem' }}>
              {(data?.items || []).map((c) => (
                <ExploreCompanyCard
                  key={c.slug}
                  name={c.name}
                  slug={c.slug}
                  logoUrl={c.logoUrl}
                  plan={c.plan}
                  vipLabel={t('vipBadge')}
                  count={c.openJobsCount}
                  countLabel={rolesLabel(c.openJobsCount)}
                />
              ))}
              {!loading && !(data?.items || []).length && (
                <p className="muted">
                  {activeTab === 'vip' ? t('exploreCompaniesVipEmpty') : t('exploreEmpty')}
                </p>
              )}
            </div>
            {data && data.total > 0 && (
              <div className="pagination-wrap">
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  total={data.total}
                  limit={data.limit}
                  onPageChange={(p) => setParams({ page: String(p) })}
                  disabled={loading}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default function ExploreCompaniesPage() {
  return (
    <Suspense fallback={<div className="shell" style={{ padding: '2rem 1.5rem' }}>Loading...</div>}>
      <ExploreCompaniesPageInner />
    </Suspense>
  );
}
