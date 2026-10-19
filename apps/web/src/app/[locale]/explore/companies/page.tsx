'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Pagination } from '@/components/ui/Pagination';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { JobsIcon } from '@/components/jobs/JobsIcon';
import s from '@/components/explore/CompanyDirectory.module.css';

type CompanyRow = { slug: string; name: string; logoUrl?: string | null; plan?: string; openJobsCount: number };
type BrowseResponse = { items: CompanyRow[]; total: number; page: number; limit: number; totalPages: number };
type Industry = { slug: string; name: string; companyCount?: number };
type IndustryGroup = { slug: string; name: string; industries: Industry[] };
const PAGE_LIMIT = 24;

function ExploreCompaniesPageInner() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Preserve existing links with tab=vip / tab=industry and industrySlug.
  const vipOnly = searchParams.get('tab') === 'vip';
  const industrySlug = searchParams.get('industrySlug') || '';
  const qParam = searchParams.get('q') || '';
  const rawPage = Number(searchParams.get('page') || 1);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const [qInput, setQInput] = useState(qParam);
  const [industryQuery, setIndustryQuery] = useState('');
  const [groups, setGroups] = useState<IndustryGroup[]>([]);
  const [metadataError, setMetadataError] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const setParams = useCallback((patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    const query = next.toString();
    router[replace ? 'replace' : 'push'](query ? `/explore/companies?${query}` : '/explore/companies', { scroll: false });
  }, [router, searchParams]);

  useEffect(() => { setQInput(qParam); }, [qParam]);
  useEffect(() => {
    const controller = new AbortController();
    setMetadataLoading(true);
    setMetadataError(false);
    api<{ groups?: IndustryGroup[] }>('/meta/industries?group=1', { auth: false, signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setGroups(response.groups || []); })
      .catch(() => { if (!controller.signal.aborted) setMetadataError(true); })
      .finally(() => { if (!controller.signal.aborted) setMetadataLoading(false); });
    return () => controller.abort();
  }, [locale, metadataRetry]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT), sort: 'jobs' });
    if (vipOnly) params.set('plan', 'VIP');
    if (industrySlug) params.set('industrySlug', industrySlug);
    if (qParam.trim()) params.set('q', qParam.trim());
    api<BrowseResponse>(`/companies?${params}`, { auth: false, signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setData(response); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vipOnly, industrySlug, page, qParam, locale, retry]);
  useEffect(() => { if (resultsRef.current) resultsRef.current.scrollTop = 0; }, [vipOnly, industrySlug, page, qParam]);
  useEffect(() => {
    const nav = document.querySelector('.nav-wrap');
    if (!nav) return;
    const measure = () => rootRef.current?.style.setProperty('--directory-nav-height', `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => filterRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setFiltersOpen(false); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(filterRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') || []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    function resize() { if (window.innerWidth > 1100) setFiltersOpen(false); }
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', resize);
      filterButtonRef.current?.focus();
    };
  }, [filtersOpen]);

  const industries = useMemo(() => groups.flatMap((group) => group.industries)
    .filter((industry) => !industryQuery || industry.name.toLocaleLowerCase().includes(industryQuery.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.slug === industrySlug) - Number(a.slug === industrySlug) || (b.companyCount || 0) - (a.companyCount || 0) || a.name.localeCompare(b.name)), [groups, industryQuery, industrySlug]);
  const activeIndustry = groups.flatMap((group) => group.industries).find((industry) => industry.slug === industrySlug);
  function reset() {
    setQInput('');
    setIndustryQuery('');
    setParams({ q: null, industrySlug: null, tab: null, page: null });
  }
  function onSearch(event: FormEvent) {
    event.preventDefault();
    setParams({ q: qInput.trim() || null });
  }

  return <div ref={rootRef} className={s.page}>
    <header className={s.header} inert={filtersOpen ? true : undefined}>
      <h1 className="sr-only">{t('companiesStat')}</h1>
      <form className={s.search} role="search" aria-label={t('workspace.searchCompany')} onSubmit={onSearch}>
        <label className={s.searchField}><JobsIcon kind="search" /><input value={qInput} onChange={(event) => setQInput(event.target.value)} placeholder={t('exploreCompaniesSearch')} aria-label={t('exploreCompaniesSearch')} /></label>
        <button className={s.searchButton} type="submit">{t('search')}</button>
      </form>
    </header>
    <div className={s.workspace}>
      {filtersOpen && <div className={s.backdrop} onClick={() => setFiltersOpen(false)} aria-hidden="true" />}
      <aside ref={filterRef} id="company-industries" className={`${s.sidebar} ${filtersOpen ? s.sidebarOpen : ''}`} role={filtersOpen ? 'dialog' : 'complementary'} aria-modal={filtersOpen ? true : undefined} aria-label={t('discovery.industries')}>
        <div className={s.sidebarHeading}>
          <h2>{t('discovery.industries')}</h2>
          <button type="button" className={s.reset} onClick={reset}>{t('workspace.reset')}</button>
          <button type="button" className={s.closeFilters} onClick={() => setFiltersOpen(false)} aria-label={t('workspace.closeFilters')}><JobsIcon kind="close" /></button>
        </div>
        <div className={s.sidebarScroll}>
          <label className={s.industrySearch}><JobsIcon kind="search" /><input value={industryQuery} onChange={(event) => setIndustryQuery(event.target.value)} placeholder={t('discovery.searchIndustries')} aria-label={t('discovery.searchIndustries')} /></label>
          <div role="radiogroup" aria-label={t('discovery.industries')}>
            <label className={s.industryChoice}><input type="radio" name="company-industry" checked={!industrySlug} onChange={() => setParams({ industrySlug: null })} /><span>{t('discovery.allIndustries')}</span></label>
            {!!industrySlug && !activeIndustry && !metadataLoading && <label className={s.industryChoice}><input type="radio" name="company-industry" checked readOnly /><span>{industrySlug}</span></label>}
            <ExpandableList items={industries} initialCount={8} step={12} getKey={(industry) => industry.slug} renderItem={(industry) => <label key={industry.slug} className={s.industryChoice}><input type="radio" name="company-industry" checked={industrySlug === industry.slug} onChange={() => setParams({ industrySlug: industry.slug })} /><span>{industry.name}</span></label>} />
          </div>
          {metadataLoading && <p className={s.metadataError} role="status">{t('ui.loading')}</p>}
          {metadataError && <p className={s.metadataError} role="alert">{t('discovery.industryError')} <button type="button" onClick={() => setMetadataRetry((value) => value + 1)}>{t('workspace.retry')}</button></p>}
          {!metadataLoading && !metadataError && !industries.length && <p className={s.metadataError}>{t('discovery.noIndustries')}</p>}
        </div>
        <div className={s.legal}><Link href="/terms">{t('termsOfService')}</Link><Link href="/privacy">{t('privacyPolicy')}</Link></div>
        <button type="button" className={s.showResults} onClick={() => setFiltersOpen(false)}>{t('workspace.showResults')}{!loading && data ? ` (${data.total})` : ''}</button>
      </aside>
      <section className={s.results} aria-label={t('companiesStat')} inert={filtersOpen ? true : undefined}>
        <div className={s.toolbar}>
          <button ref={filterButtonRef} type="button" className={s.filterButton} onClick={() => setFiltersOpen(true)} aria-controls="company-industries" aria-expanded={filtersOpen}><JobsIcon kind="filter" />{t('filters')}{industrySlug ? ' (1)' : ''}</button>
          <h2 aria-live="polite">{loading ? t('ui.loading') : !error && data ? t('companiesCount').replace('{n}', String(data.total)) : t('companiesStat')}</h2>
          <label className={s.vipToggle}><input type="checkbox" checked={vipOnly} onChange={(event) => setParams({ tab: event.target.checked ? 'vip' : null })} /><span>{t('discovery.vipOnly')}</span></label>
        </div>
        {(qParam || industrySlug) && <div className={s.activeFilters}>
          {qParam && <button type="button" onClick={() => setParams({ q: null })}>{qParam}<JobsIcon kind="close" /></button>}
          {industrySlug && <button type="button" onClick={() => setParams({ industrySlug: null })}>{activeIndustry?.name || industrySlug}<JobsIcon kind="close" /></button>}
        </div>}
        <div ref={resultsRef} className={s.resultsScroll} aria-busy={loading}>
          {loading ? <div className={s.grid} role="status" aria-label={t('ui.loading')}>{Array.from({ length: 12 }, (_, index) => <div className={s.skeletonCard} key={index} aria-hidden="true"><i /><span /></div>)}</div> : error ? <div className={s.message} role="alert"><p>{t('discovery.companyError')}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>{t('workspace.retry')}</button></div> : data?.items.length ? <div className={s.grid}>
            {data.items.map((company) => <Link key={company.slug} href={`/jobs?companySlug=${encodeURIComponent(company.slug)}`} className={`${s.company} ${company.plan === 'VIP' ? s.vipCompany : ''}`}>
              <span className={s.logo} aria-hidden="true">{company.logoUrl ? <img src={company.logoUrl} alt="" /> : company.name.charAt(0)}</span>
              <span className={s.companyCopy}><span className={s.companyName}>{company.name}{company.plan === 'VIP' && <span className={s.vipBadge}>{t('vipBadge')}</span>}</span><span className={s.roles}>{t('openRolesCount').replace('{n}', String(company.openJobsCount))}</span></span>
            </Link>)}
          </div> : <div className={s.message}><p>{t('discovery.companyEmpty')}</p><button type="button" onClick={reset}>{t('workspace.reset')}</button></div>}
        </div>
        {!error && data && data.total > 0 && <div className={`${s.pagination} ${data.totalPages <= 1 ? s.singlePage : ''}`}><Pagination page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} disabled={loading} onPageChange={(nextPage) => setParams({ page: String(nextPage) })} /></div>}
      </section>
    </div>
  </div>;
}

export default function ExploreCompaniesPage() {
  const { t } = useI18n();
  return <Suspense fallback={<div className={s.message} role="status">{t('ui.loading')}</div>}><ExploreCompaniesPageInner /></Suspense>;
}
