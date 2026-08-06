'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterFieldset, FormField } from '@/components/ui/Field';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { AdvancedFiltersPanel } from '@/components/ui/AdvancedFiltersPanel';
import { JobListSkeleton } from '@/components/ui/Skeleton';
import { api, getSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { jobLocationLabel } from '@/lib/location';

type MetaItem = { id: string; name: string; slug: string; icon?: string | null };
type Job = {
  id: string;
  title: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  workMode?: string;
  employmentType?: string;
  experienceLevel?: string | null;
  isHot?: boolean;
  matchScore?: number | null;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string; slug: string } | null;
  category?: { name: string; slug: string } | null;
  jobSkills?: Array<{ skill: { name: string; slug: string } }>;
  benefits?: Array<{ benefit: { name: string; icon?: string | null } }>;
};

type SearchResponse = {
  items: Job[];
  total: number;
  page: number;
  limit: number;
  sort: string;
  totalPages: number;
  facets?: {
    cities: Array<{ slug: string; name: string; count: number }>;
    categories: Array<{ slug: string; name: string; count: number }>;
    companies?: Array<{ slug: string; name: string; logoUrl?: string | null; count: number }>;
    skills?: Array<{ slug: string; name: string; count: number }>;
    experienceLevels: Record<string, number>;
  };
};

type Filters = {
  q: string;
  city: string;
  category: string;
  companySlug: string;
  skills: string;
  skillMode: string;
  benefits: string;
  employmentType: string;
  workMode: string;
  experienceLevel: string;
  salaryMin: string;
  salaryMax: string;
  postedWithin: string;
  hotOnly: boolean;
  sort: string;
  page: number;
  limit: number;
};

const PAGE_SIZE_OPTIONS = [12, 24, 36] as const;
const DEFAULT_LIMIT = 12;
const EXP_LEVELS = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'];

const EMPTY: Filters = {
  q: '',
  city: '',
  category: '',
  companySlug: '',
  skills: '',
  skillMode: 'OR',
  benefits: '',
  employmentType: '',
  workMode: '',
  experienceLevel: '',
  salaryMin: '',
  salaryMax: '',
  postedWithin: '',
  hotOnly: false,
  sort: 'relevance',
  page: 1,
  limit: DEFAULT_LIMIT,
};

function filtersFromParams(sp: URLSearchParams): Filters {
  const rawLimit = Number(sp.get('limit') || DEFAULT_LIMIT);
  const limit = PAGE_SIZE_OPTIONS.includes(rawLimit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawLimit
    : DEFAULT_LIMIT;
  return {
    q: sp.get('q') ?? '',
    city: sp.get('city') ?? '',
    category: sp.get('category') ?? '',
    companySlug: sp.get('companySlug') ?? '',
    skills: sp.get('skills') ?? '',
    skillMode: sp.get('skillMode') ?? 'OR',
    benefits: sp.get('benefits') ?? '',
    employmentType: sp.get('employmentType') ?? '',
    workMode: sp.get('workMode') ?? '',
    experienceLevel: sp.get('experienceLevel') ?? '',
    salaryMin: sp.get('salaryMin') ?? '',
    salaryMax: sp.get('salaryMax') ?? '',
    postedWithin: sp.get('postedWithin') ?? '',
    hotOnly: sp.get('hotOnly') === 'true',
    sort: sp.get('sort') ?? 'relevance',
    page: Math.max(1, Number(sp.get('page') || 1)),
    limit,
  };
}

function toParams(f: Filters, view?: string | null): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(EMPTY) as Array<keyof Filters>).forEach((key) => {
    const value = f[key];
    if (key === 'page') {
      if (Number(value) > 1) p.set('page', String(value));
      return;
    }
    if (key === 'limit') {
      if (Number(value) !== DEFAULT_LIMIT) p.set('limit', String(value));
      return;
    }
    if (key === 'sort') {
      if (value !== 'relevance') p.set('sort', String(value));
      return;
    }
    if (key === 'skillMode') {
      if (value !== 'OR') p.set('skillMode', String(value));
      return;
    }
    if (key === 'hotOnly') {
      if (value) p.set('hotOnly', 'true');
      return;
    }
    if (value) p.set(key, String(value));
  });
  if (view === 'companies') p.set('view', 'companies');
  return p;
}

function buildPageItems(page: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

function formatSalary(min?: number | null, max?: number | null) {
  if (!min && !max) return 'Negotiable';
  const fmt = (n: number) => n.toLocaleString('uz-UZ');
  if (min && max) return `${fmt(min)} – ${fmt(max)} UZS`;
  return `${fmt(min || max!)} UZS`;
}

function toggleCsv(csv: string, slug: string) {
  const set = new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
  if (set.has(slug)) set.delete(slug);
  else set.add(slug);
  return [...set].join(',');
}

function JobsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const browseCompanies = searchParams.get('view') === 'companies';
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cities, setCities] = useState<MetaItem[]>([]);
  const [categories, setCategories] = useState<MetaItem[]>([]);
  const [skills, setSkills] = useState<MetaItem[]>([]);
  const [benefits, setBenefits] = useState<MetaItem[]>([]);
  const [skillQ, setSkillQ] = useState('');
  const [jumpPage, setJumpPage] = useState('');
  const [hiringCompanies, setHiringCompanies] = useState<
    Array<{ slug: string; name: string; logoUrl?: string | null; count: number }>
  >([]);
  const session = typeof window !== 'undefined' ? getSession() : null;

  useEffect(() => {
    Promise.all([
      api<MetaItem[]>('/meta/cities', { auth: false }),
      api<MetaItem[]>('/meta/categories', { auth: false }),
      api<MetaItem[]>('/meta/skills?sort=popular&take=120', { auth: false }),
      api<MetaItem[]>('/meta/benefits', { auth: false }),
    ])
      .then(([c, cat, sk, b]) => {
        setCities(c);
        setCategories(cat);
        setSkills(sk);
        setBenefits(b);
      })
      .catch(() => undefined);
    api<SearchResponse>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => setHiringCompanies(r.facets?.companies || []))
      .catch(() => undefined);
  }, []);

  const apply = useCallback(
    (patch: Partial<Filters>, opts?: { keepBrowse?: boolean }) => {
      const next = { ...filters, ...patch };
      if (patch.page === undefined && !('page' in patch)) next.page = 1;
      const keepBrowse = opts?.keepBrowse ?? browseCompanies;
      router.push(`/jobs?${toParams(next, keepBrowse ? 'companies' : null).toString()}`);
    },
    [filters, router, browseCompanies],
  );

  useEffect(() => {
    setLoading(true);
    setError('');
    const p = toParams(filters);
    api<SearchResponse>(`/jobs?${p.toString()}`, { auth: false })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  const selectedSkills = filters.skills.split(',').filter(Boolean);
  const selectedCities = filters.city.split(',').filter(Boolean);
  const selectedCats = filters.category.split(',').filter(Boolean);
  const selectedBenefits = filters.benefits.split(',').filter(Boolean);
  const selectedLevels = filters.experienceLevel.split(',').filter(Boolean);
  const selectedCompanies = filters.companySlug.split(',').filter(Boolean);

  const skillFacetList = data?.facets?.skills || [];
  const skillFacet = Object.fromEntries(skillFacetList.map((s) => [s.slug, s.count]));
  const skillList = useMemo(() => {
    const bySlug = new Map<string, MetaItem & { count?: number }>();
    for (const s of skillFacetList) {
      bySlug.set(s.slug, { id: s.slug, slug: s.slug, name: s.name, count: s.count });
    }
    for (const s of skills) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, { ...s, count: skillFacet[s.slug] });
      else {
        const cur = bySlug.get(s.slug)!;
        bySlug.set(s.slug, { ...cur, name: s.name || cur.name });
      }
    }
    return [...bySlug.values()]
      .filter((s) => !skillQ || s.name.toLowerCase().includes(skillQ.toLowerCase()))
      .sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name));
  }, [skills, skillFacetList, skillFacet, skillQ]);

  const cityFacet = Object.fromEntries((data?.facets?.cities || []).map((c) => [c.slug, c.count]));
  const catFacet = Object.fromEntries((data?.facets?.categories || []).map((c) => [c.slug, c.count]));
  const companyFacetList = hiringCompanies.length
    ? hiringCompanies
    : data?.facets?.companies || [];
  const expFacet = data?.facets?.experienceLevels || {};
  const singleCompanySlug =
    filters.companySlug && !filters.companySlug.includes(',') ? filters.companySlug : '';
  const activeCompany =
    (singleCompanySlug && companyFacetList.find((c) => c.slug === singleCompanySlug)) ||
    (singleCompanySlug
      ? { slug: singleCompanySlug, name: singleCompanySlug, count: data?.total ?? 0 }
      : null);

  const advancedActiveCount = [
    filters.companySlug,
    filters.skills,
    filters.experienceLevel,
    filters.benefits,
    filters.workMode,
    filters.postedWithin,
    filters.salaryMin,
    filters.salaryMax,
    filters.hotOnly ? '1' : '',
    filters.skillMode !== 'OR' ? filters.skillMode : '',
  ].filter(Boolean).length;
  const forceAdvancedOpen = advancedActiveCount > 0;

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    apply({ q: String(fd.get('q') || '') });
  }

  const pageItems = buildPageItems(filters.page, data?.totalPages || 1);
  const rolesLabel = (n: number) => t('openRolesCount').replace('{n}', String(n));

  return (
    <div className="shell jobs-layout">
      <aside className="filters">
        <h3>{t('filters')}</h3>
        <form onSubmit={onSearch} className="filter-group">
          <FormField label={t('keyword')} optional>
            <input name="q" defaultValue={filters.q} key={filters.q} placeholder={t('searchPlaceholder')} />
          </FormField>
          <button type="submit" style={{ width: '100%', marginTop: '0.5rem' }}>
            {t('search')}
          </button>
        </form>

        <FilterFieldset legend={t('city')} className="filter-group">
          <ExpandableList
            items={cities}
            initialCount={10}
            step={10}
            getKey={(c) => c.slug}
            renderItem={(c) => (
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={selectedCities.includes(c.slug)}
                  onChange={() => apply({ city: toggleCsv(filters.city, c.slug) })}
                />
                {c.name}
                {cityFacet[c.slug] !== undefined && (
                  <span className="facet-count">({cityFacet[c.slug]})</span>
                )}
              </label>
            )}
          />
        </FilterFieldset>

        <FilterFieldset legend={t('category')} className="filter-group">
          {categories.map((c) => (
            <label key={c.slug} className="filter-check">
              <input
                type="checkbox"
                checked={selectedCats.includes(c.slug)}
                onChange={() => apply({ category: toggleCsv(filters.category, c.slug) })}
              />
              {c.icon} {c.name}
              {catFacet[c.slug] !== undefined && (
                <span className="facet-count">({catFacet[c.slug]})</span>
              )}
            </label>
          ))}
        </FilterFieldset>

        <AdvancedFiltersPanel
          storageKey="jt_jobs_advanced_filters"
          activeCount={advancedActiveCount}
          forceOpen={forceAdvancedOpen}
        >
          <FilterFieldset legend={t('company')} className="filter-group">
            <ExpandableList
              items={companyFacetList}
              initialCount={10}
              step={10}
              getKey={(c) => c.slug}
              renderItem={(c) => (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={selectedCompanies.includes(c.slug)}
                    onChange={() => apply({ companySlug: toggleCsv(filters.companySlug, c.slug) })}
                  />
                  {c.name}
                  <span className="facet-count">({c.count})</span>
                </label>
              )}
            />
            {!companyFacetList.length && <p className="muted" style={{ fontSize: '0.8rem' }}>—</p>}
          </FilterFieldset>

          <FilterFieldset legend={`${t('skills')} (${filters.skillMode})`} className="filter-group">
            <FormField label={t('matchMode')} optional>
              <select
                value={filters.skillMode}
                onChange={(e) => apply({ skillMode: e.target.value })}
                style={{ marginBottom: '0.4rem' }}
              >
                <option value="OR">{t('matchAny')}</option>
                <option value="AND">{t('matchAll')}</option>
              </select>
            </FormField>
            <FormField label={t('filterSkills')} optional>
              <input
                value={skillQ}
                onChange={(e) => setSkillQ(e.target.value)}
                placeholder={t('filterSkills')}
              />
            </FormField>
            <ExpandableList
              items={skillList}
              initialCount={10}
              step={10}
              getKey={(s) => s.slug}
              renderItem={(s) => (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={selectedSkills.includes(s.slug)}
                    onChange={() => apply({ skills: toggleCsv(filters.skills, s.slug) })}
                  />
                  {s.name}
                  {s.count !== undefined && <span className="facet-count">({s.count})</span>}
                </label>
              )}
            />
          </FilterFieldset>

          <FilterFieldset legend={t('experienceLevel')} className="filter-group">
            {EXP_LEVELS.map((lvl) => (
              <label key={lvl} className="filter-check">
                <input
                  type="checkbox"
                  checked={selectedLevels.includes(lvl)}
                  onChange={() => apply({ experienceLevel: toggleCsv(filters.experienceLevel, lvl) })}
                />
                {lvl}
                {expFacet[lvl] !== undefined && (
                  <span className="facet-count">({expFacet[lvl]})</span>
                )}
              </label>
            ))}
          </FilterFieldset>

          <FilterFieldset legend={t('benefits')} className="filter-group">
            <ExpandableList
              items={benefits}
              initialCount={8}
              step={10}
              getKey={(b) => b.slug}
              renderItem={(b) => (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={selectedBenefits.includes(b.slug)}
                    onChange={() => apply({ benefits: toggleCsv(filters.benefits, b.slug) })}
                  />
                  {b.icon} {b.name}
                </label>
              )}
            />
          </FilterFieldset>

          <div className="filter-group">
            <FormField label={t('workMode')} optional>
              <select
                value={filters.workMode}
                onChange={(e) => apply({ workMode: e.target.value })}
              >
                <option value="">{t('any')}</option>
                <option value="ONSITE">{t('onsite')}</option>
                <option value="HYBRID">{t('hybrid')}</option>
                <option value="REMOTE">{t('remote')}</option>
              </select>
            </FormField>
          </div>

          <div className="filter-group">
            <FormField label={t('postedWithin')} optional>
              <select
                value={filters.postedWithin}
                onChange={(e) => apply({ postedWithin: e.target.value })}
              >
                <option value="">{t('anyTime')}</option>
                <option value="24h">{t('last24h')}</option>
                <option value="7d">{t('last7d')}</option>
                <option value="30d">{t('last30d')}</option>
              </select>
            </FormField>
          </div>

          <div className="filter-group grid-2">
            <FormField label={`${t('salary')} min`} optional>
              <input
                type="number"
                value={filters.salaryMin}
                onChange={(e) => apply({ salaryMin: e.target.value })}
                placeholder="UZS"
              />
            </FormField>
            <FormField label={`${t('salary')} max`} optional>
              <input
                type="number"
                value={filters.salaryMax}
                onChange={(e) => apply({ salaryMax: e.target.value })}
                placeholder="UZS"
              />
            </FormField>
          </div>

          <label className="filter-check">
            <input
              type="checkbox"
              checked={filters.hotOnly}
              onChange={(e) => apply({ hotOnly: e.target.checked })}
            />
            {t('hotJobsOnly')}
          </label>
        </AdvancedFiltersPanel>

        <button type="button" className="secondary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => router.push('/jobs')}>
          {t('clearFilters')}
        </button>
      </aside>

      <section>
        {(browseCompanies || !singleCompanySlug) && companyFacetList.length > 0 && (
          <div className="company-browse">
            <div className="company-browse-head">
              <div>
                <h2>{t('browseByCompany')}</h2>
                <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                  {t('browseByCompanyHint')}
                </p>
              </div>
              {!browseCompanies && (
                <Link href="/jobs?view=companies" className="hiring-view-all">
                  {t('viewAll')} <span aria-hidden>→</span>
                </Link>
              )}
            </div>
            <div className="company-browse-grid">
              {(browseCompanies ? companyFacetList : companyFacetList.slice(0, 8)).map((c) => (
                <Link
                  key={c.slug}
                  href={`/jobs?companySlug=${encodeURIComponent(c.slug)}`}
                  className={`hiring-card ${selectedCompanies.includes(c.slug) ? 'active' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      c.logoUrl ||
                      `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(c.name)}`
                    }
                    alt=""
                  />
                  <div>
                    <strong>{c.name}</strong>
                    <span>{rolesLabel(c.count)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {activeCompany && singleCompanySlug && (
          <div className="company-filter-banner">
            <div>
              <strong>{t('jobsAtCompany').replace('{name}', activeCompany.name)}</strong>
              <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
                {rolesLabel(data?.total ?? activeCompany.count)}
              </p>
            </div>
            <div className="company-filter-actions">
              <Link href={`/companies/${activeCompany.slug}`} className="chip">
                {t('viewCompanyProfile')}
              </Link>
              <button
                type="button"
                className="secondary"
                onClick={() => apply({ companySlug: '' }, { keepBrowse: true })}
              >
                {t('clearCompanyFilter')}
              </button>
            </div>
          </div>
        )}

        <div className="jobs-toolbar">
          <div>
            <strong>{data?.total ?? '—'}</strong> <span className="muted">{t('jobsFound')}</span>
            <div className="chips" style={{ marginTop: '0.5rem' }}>
              {selectedCities.map((s) => (
                <button key={s} type="button" className="chip active" onClick={() => apply({ city: toggleCsv(filters.city, s) })}>
                  {cities.find((c) => c.slug === s)?.name || s} ×
                </button>
              ))}
              {selectedSkills.map((s) => (
                <button key={s} type="button" className="chip active" onClick={() => apply({ skills: toggleCsv(filters.skills, s) })}>
                  {skills.find((sk) => sk.slug === s)?.name || s} ×
                </button>
              ))}
              {filters.hotOnly && (
                <button type="button" className="chip chip-hot" onClick={() => apply({ hotOnly: false })}>
                  Hot ×
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              value={filters.sort}
              onChange={(e) => apply({ sort: e.target.value })}
              aria-label={t('sortBy')}
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="salary_high">Salary high</option>
              <option value="salary_low">Salary low</option>
              <option value="experience">Experience</option>
              {session?.user.role === 'EMPLOYEE' && <option value="match">Best match</option>}
            </select>
            <select
              value={filters.limit}
              onChange={(e) => apply({ limit: Number(e.target.value) })}
              aria-label={t('resultsPerPage')}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
        {loading && <JobListSkeleton count={filters.limit > 12 ? 8 : 6} />}

        {!loading &&
          data?.items.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="job-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="company-logo"
                src={
                  job.company.logoUrl ||
                  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(job.company.name)}`
                }
                alt=""
              />
              <div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {job.isHot && <span className="badge hot">Hot</span>}
                  {job.category && <span className="badge">{job.category.name}</span>}
                  {job.experienceLevel && <span className="badge skill">{job.experienceLevel}</span>}
                </div>
                <h3>{job.title}</h3>
                <div className="job-meta">
                  <span>{job.company.name}</span>
                  <span>{jobLocationLabel(job)}</span>
                  <span className="salary" style={{ fontSize: '0.9rem' }}>
                    {formatSalary(job.salaryMin, job.salaryMax)}
                  </span>
                </div>
                <div className="chips">
                  {(job.jobSkills || []).slice(0, 5).map((js) => (
                    <span key={js.skill.slug} className="badge skill">
                      {js.skill.name}
                    </span>
                  ))}
                </div>
              </div>
              {job.matchScore != null ? (
                <div className="match-ring">{job.matchScore}%</div>
              ) : (
                <div />
              )}
            </Link>
          ))}

        {!loading && data && data.items.length === 0 && (
          <div className="card">
            <p className="muted">No jobs match these filters. Try clearing some.</p>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="pagination-wrap">
            <div className="pagination-range">
              Page {data.page} of {data.totalPages}
            </div>
            <div className="pagination-pages">
              <button
                type="button"
                className="pagination-page"
                disabled={filters.page <= 1}
                onClick={() => apply({ page: filters.page - 1 })}
              >
                ‹
              </button>
              {pageItems.map((item, i) =>
                item === '…' ? (
                  <span key={`e${i}`} className="pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`pagination-page ${item === filters.page ? 'active' : ''}`}
                    onClick={() => apply({ page: item })}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                type="button"
                className="pagination-page"
                disabled={filters.page >= data.totalPages}
                onClick={() => apply({ page: filters.page + 1 })}
              >
                ›
              </button>
            </div>
            <form
              className="pagination-jump"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(jumpPage);
                if (n >= 1 && n <= data.totalPages) apply({ page: n });
              }}
            >
              <input
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                placeholder="#"
                aria-label={t('jumpToPage')}
              />
              <button type="submit" className="secondary">
                Go
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="shell jobs-layout" style={{ padding: '1.5rem 0' }}>
          <JobListSkeleton count={6} />
        </div>
      }
    >
      <JobsInner />
    </Suspense>
  );
}
