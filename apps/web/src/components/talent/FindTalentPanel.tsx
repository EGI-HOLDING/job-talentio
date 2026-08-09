'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { FilterFieldset, LabelText } from '@/components/ui/Field';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { AdvancedFiltersPanel } from '@/components/ui/AdvancedFiltersPanel';
import { CandidateListSkeleton } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { MatchRing } from '@/components/ui/MatchRing';

type PlanCode = 'FREE' | 'STANDARD' | 'PREMIUM';

const CAND_PAGE_SIZES = [12, 24, 36] as const;
const DEGREE_OPTS = ['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'] as const;

type CandFilters = {
  q: string;
  city: string;
  skills: string;
  skillMode: 'AND' | 'OR';
  degree: string;
  languages: string;
  experienceYearsMin: string;
  experienceYearsMax: string;
  hasCertification: boolean;
  matchJobId: string;
  sort: 'relevance' | 'newest' | 'match';
  page: number;
  limit: number;
};

const DEFAULT_CAND_FILTERS: CandFilters = {
  q: '',
  city: '',
  skills: '',
  skillMode: 'OR',
  degree: '',
  languages: '',
  experienceYearsMin: '',
  experienceYearsMax: '',
  hasCertification: false,
  matchJobId: '',
  sort: 'relevance',
  page: 1,
  limit: 12,
};

function toggleCsv(csv: string, value: string) {
  const set = new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return Array.from(set).join(',');
}

function jobSelectLabel(j: {
  title: string;
  status?: string;
  workMode?: string | null;
  city?: { name: string } | null;
}) {
  const location = jobLocationLabel(j);
  const status = j.status && j.status !== 'PUBLISHED' ? ` | ${j.status}` : '';
  return `${j.title} - ${location}${status}`;
}

function filtersFromSearchParams(sp: URLSearchParams): CandFilters {
  return {
    ...DEFAULT_CAND_FILTERS,
    q: sp.get('q') || '',
    city: sp.get('city') || '',
    skills: sp.get('skills') || '',
    skillMode: sp.get('skillMode') === 'AND' ? 'AND' : 'OR',
    degree: sp.get('degree') || '',
    languages: sp.get('languages') || '',
    experienceYearsMin: sp.get('experienceYearsMin') || '',
    experienceYearsMax: sp.get('experienceYearsMax') || '',
    hasCertification: sp.get('hasCertification') === 'true',
    matchJobId: sp.get('matchJobId') || '',
    sort: (['relevance', 'newest', 'match'].includes(sp.get('sort') || '')
      ? sp.get('sort')
      : 'relevance') as CandFilters['sort'],
    page: Math.max(1, Number(sp.get('page') || 1) || 1),
    limit: CAND_PAGE_SIZES.includes(Number(sp.get('limit')) as (typeof CAND_PAGE_SIZES)[number])
      ? Number(sp.get('limit'))
      : 12,
  };
}

function filtersToSearchParams(f: CandFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.city) params.set('city', f.city);
  if (f.skills) params.set('skills', f.skills);
  if (f.skillMode !== 'OR') params.set('skillMode', f.skillMode);
  if (f.degree) params.set('degree', f.degree);
  if (f.languages) params.set('languages', f.languages);
  if (f.experienceYearsMin) params.set('experienceYearsMin', f.experienceYearsMin);
  if (f.experienceYearsMax) params.set('experienceYearsMax', f.experienceYearsMax);
  if (f.hasCertification) params.set('hasCertification', 'true');
  if (f.matchJobId) params.set('matchJobId', f.matchJobId);
  if (f.sort !== 'relevance') params.set('sort', f.sort);
  if (f.page > 1) params.set('page', String(f.page));
  if (f.limit !== 12) params.set('limit', String(f.limit));
  return params;
}

export function FindTalentPanel() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [candFilters, setCandFilters] = useState<CandFilters>(() =>
    filtersFromSearchParams(new URLSearchParams(searchParams.toString())),
  );
  const [candidates, setCandidates] = useState<any>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [error, setError] = useState('');
  const [skillQ, setSkillQ] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [planCode, setPlanCode] = useState<PlanCode>('FREE');
  const [meta, setMeta] = useState<{
    cities: any[];
    skills: any[];
    languages: any[];
  }>({ cities: [], skills: [], languages: [] });

  const canColdChat = planCode === 'PREMIUM';

  const syncUrl = useCallback(
    (f: CandFilters) => {
      const qs = filtersToSearchParams(f).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  function applyCand(patch: Partial<CandFilters>) {
    setCandFilters((prev) => {
      const next = { ...prev, ...patch };
      if (!('page' in patch)) next.page = 1;
      if (next.matchJobId && next.sort !== 'match' && patch.matchJobId !== undefined) {
        next.sort = 'match';
      }
      if (!next.matchJobId && next.sort === 'match') next.sort = 'relevance';
      syncUrl(next);
      return next;
    });
  }

  useEffect(() => {
    const session = getSession();
    if (!session || (session.user.role !== 'RECRUITER' && session.user.role !== 'SUPER_ADMIN')) {
      window.location.href = `/login?next=${encodeURIComponent('/talent')}`;
      return;
    }
    (async () => {
      try {
        const [mine, cities, skills, langs] = await Promise.all([
          api<any[]>('/companies/mine'),
          api('/meta/cities', { auth: false }),
          api('/meta/skills?sort=popular&take=120', { auth: false }),
          api('/meta/languages', { auth: false }).catch(() => []),
        ]);
        setMeta({
          cities: cities as any[],
          skills: skills as any[],
          languages: langs as any[],
        });
        const cid = mine[0]?.companyId;
        if (cid) {
          const [list, sub] = await Promise.all([
            api<any[]>(`/jobs/company/${cid}`),
            api<{ plan: PlanCode }>(`/billing/companies/${cid}/subscription`).catch(() => null),
          ]);
          setJobs(list);
          setPlanCode(
            (sub?.plan || mine[0]?.company?.subscription?.plan || 'FREE') as PlanCode,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCandLoading(true);
      try {
        const params = filtersToSearchParams(candFilters);
        params.set('sort', candFilters.matchJobId ? 'match' : candFilters.sort);
        params.set('page', String(candFilters.page));
        params.set('limit', String(candFilters.limit));
        const data = await api<any>(`/profiles/candidates?${params.toString()}`);
        if (cancelled) return;
        setCandidates(data);
        if (data?.page != null && data.page !== candFilters.page) {
          setCandFilters((prev) => ({ ...prev, page: data.page as number }));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load talent');
      } finally {
        if (!cancelled) setCandLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candFilters]);

  const selectedCandCities = candFilters.city.split(',').filter(Boolean);
  const selectedCandSkills = candFilters.skills.split(',').filter(Boolean);
  const selectedCandLangs = candFilters.languages.split(',').filter(Boolean);
  const cityFacet = Object.fromEntries((candidates?.facets?.cities || []).map((c: any) => [c.slug, c.count]));
  const skillFacetList = candidates?.facets?.skills || [];
  const skillFacet = Object.fromEntries(skillFacetList.map((s: any) => [s.slug, s.count]));
  const filteredSkills = useMemo(() => {
    const bySlug = new Map<string, { slug: string; name: string; count?: number }>();
    for (const s of skillFacetList) {
      bySlug.set(s.slug, { slug: s.slug, name: s.name, count: s.count });
    }
    for (const s of meta.skills) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, { slug: s.slug, name: s.name, count: skillFacet[s.slug] });
    }
    return [...bySlug.values()]
      .filter((s) => !skillQ || s.name.toLowerCase().includes(skillQ.toLowerCase()))
      .sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name));
  }, [meta.skills, skillFacetList, skillFacet, skillQ]);

  const candAdvancedCount = [
    candFilters.skills,
    candFilters.degree,
    candFilters.languages,
    candFilters.experienceYearsMin,
    candFilters.experienceYearsMax,
    candFilters.hasCertification ? '1' : '',
    candFilters.skillMode !== 'OR' ? candFilters.skillMode : '',
  ].filter(Boolean).length;

  const candTotalPages =
    candidates?.totalPages || Math.max(1, Math.ceil((candidates?.total || 0) / candFilters.limit));

  return (
    <div>
      {error && (
        <p className="muted" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {error}
        </p>
      )}
      <div className="jobs-toolbar" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 className="section-title" style={{ margin: 0, fontSize: '1.75rem' }}>
            {t('findTalent')}
          </h1>
          <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
            {candLoading && !candidates
              ? t('findTalentSearching')
              : t('findTalentCount').replace('{n}', String(candidates?.total ?? 0))}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={candFilters.sort}
            onChange={(e) => applyCand({ sort: e.target.value as CandFilters['sort'] })}
            aria-label={t('sortBy')}
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="newest">Sort: Newest</option>
            <option value="match" disabled={!candFilters.matchJobId}>
              Sort: Match to job
            </option>
          </select>
          <select
            value={candFilters.limit}
            onChange={(e) => applyCand({ limit: Number(e.target.value) })}
            aria-label={t('resultsPerPage')}
          >
            {CAND_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          {(candFilters.q ||
            candFilters.city ||
            candFilters.skills ||
            candFilters.degree ||
            candFilters.languages ||
            candFilters.experienceYearsMin ||
            candFilters.experienceYearsMax ||
            candFilters.hasCertification ||
            candFilters.matchJobId) && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setCandFilters(DEFAULT_CAND_FILTERS);
                syncUrl(DEFAULT_CAND_FILTERS);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="jobs-layout" style={{ padding: 0 }}>
        <aside className="filters">
          <h3>Filters</h3>
          <form
            className="filter-group"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              applyCand({ q: String(fd.get('q') || '') });
            }}
          >
            <label>
              <LabelText>Keywords</LabelText>
              <input name="q" defaultValue={candFilters.q} key={candFilters.q} placeholder="Name, headline, skill..." />
            </label>
            <button type="submit" style={{ width: '100%', marginTop: '0.5rem' }}>
              Search
            </button>
          </form>

          <div className="filter-group">
            <label>
              <LabelText>Match to job</LabelText>
              <select
                value={candFilters.matchJobId}
                onChange={(e) =>
                  applyCand({
                    matchJobId: e.target.value,
                    sort: e.target.value ? 'match' : 'relevance',
                  })
                }
              >
                <option value="">Any (no match ranking)</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobSelectLabel(j)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <FilterFieldset legend="City" className="filter-group">
            <ExpandableList
              items={meta.cities}
              initialCount={10}
              step={10}
              getKey={(c) => c.slug}
              renderItem={(c) => (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={selectedCandCities.includes(c.slug)}
                    onChange={() => applyCand({ city: toggleCsv(candFilters.city, c.slug) })}
                  />
                  <LabelText optional={false}>{c.name}</LabelText>
                  {cityFacet[c.slug] !== undefined && (
                    <span className="facet-count">({cityFacet[c.slug]})</span>
                  )}
                </label>
              )}
            />
          </FilterFieldset>

          <AdvancedFiltersPanel
            storageKey="jt_talent_advanced_filters"
            activeCount={candAdvancedCount}
            forceOpen={candAdvancedCount > 0}
          >
            <FilterFieldset legend={`Skills (${candFilters.skillMode})`} className="filter-group">
              <label>
                <LabelText>Match mode</LabelText>
                <select
                  value={candFilters.skillMode}
                  onChange={(e) => applyCand({ skillMode: e.target.value as 'AND' | 'OR' })}
                  style={{ marginBottom: '0.4rem' }}
                >
                  <option value="OR">Match any (OR)</option>
                  <option value="AND">Match all (AND)</option>
                </select>
              </label>
              <label>
                <LabelText>Filter skills</LabelText>
                <input
                  value={skillQ}
                  onChange={(e) => setSkillQ(e.target.value)}
                  placeholder="Filter skills..."
                />
              </label>
              <ExpandableList
                items={filteredSkills}
                initialCount={10}
                step={10}
                getKey={(s) => s.slug}
                renderItem={(s) => (
                  <label className="filter-check">
                    <input
                      type="checkbox"
                      checked={selectedCandSkills.includes(s.slug)}
                      onChange={() => applyCand({ skills: toggleCsv(candFilters.skills, s.slug) })}
                    />
                    <LabelText optional={false}>{s.name}</LabelText>
                    {s.count !== undefined && <span className="facet-count">({s.count})</span>}
                  </label>
                )}
              />
            </FilterFieldset>

            <div className="filter-group">
              <div className="grid-2" style={{ gap: '0.4rem' }}>
                <label>
                  <LabelText>Min years</LabelText>
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    value={candFilters.experienceYearsMin}
                    onChange={(e) => applyCand({ experienceYearsMin: e.target.value })}
                  />
                </label>
                <label>
                  <LabelText>Max years</LabelText>
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    value={candFilters.experienceYearsMax}
                    onChange={(e) => applyCand({ experienceYearsMax: e.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="filter-group">
              <label>
                <LabelText>Degree</LabelText>
                <select value={candFilters.degree} onChange={(e) => applyCand({ degree: e.target.value })}>
                  <option value="">Any</option>
                  {DEGREE_OPTS.map((d) => (
                    <option key={d} value={d}>
                      {d.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <FilterFieldset legend="Languages" className="filter-group">
              <ExpandableList
                items={meta.languages}
                initialCount={8}
                step={10}
                getKey={(l) => l.code}
                renderItem={(l) => (
                  <label className="filter-check">
                    <input
                      type="checkbox"
                      checked={selectedCandLangs.includes(l.code)}
                      onChange={() => applyCand({ languages: toggleCsv(candFilters.languages, l.code) })}
                    />
                    <LabelText optional={false}>{l.name}</LabelText>
                  </label>
                )}
              />
            </FilterFieldset>

            <div className="filter-group">
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={candFilters.hasCertification}
                  onChange={(e) => applyCand({ hasCertification: e.target.checked })}
                />
                <LabelText optional={false}>Has certification</LabelText>
              </label>
            </div>
          </AdvancedFiltersPanel>
        </aside>

        <div>
          {candLoading && !candidates && <CandidateListSkeleton count={6} />}
          {!candLoading && (candidates?.items || []).length === 0 && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No talent matches these filters. Try clearing filters or broadening skills/city.
              </p>
            </div>
          )}
          {(candidates?.items || []).map((p: any) => (
            <div key={p.id} className="job-card" style={{ marginBottom: '0.75rem' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="company-logo"
                src={
                  p.user?.avatarUrl ||
                  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(p.user?.fullName || 'C')}`
                }
                alt=""
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0 }}>{p.user?.fullName}</h3>
                <div className="job-meta">
                  <span>{p.headline || '-'}</span>
                  {p.city?.name && <span>{p.city.name}</span>}
                  <span>{p.experienceYears ?? 0}y exp</span>
                  {p.contactsBlurred && <span>Contacts limited</span>}
                </div>
                <div className="chips" style={{ marginTop: '0.45rem' }}>
                  {(p.skills || []).slice(0, 6).map((s: any) => (
                    <span key={s.id} className="badge skill">
                      {s.skill?.name}
                      {s.level ? ` | ${s.level}` : ''}
                    </span>
                  ))}
                </div>
                <div className="chips" style={{ marginTop: '0.5rem' }}>
                  <Link
                    href={`/candidates/${p.id}${candFilters.matchJobId ? `?matchJobId=${candFilters.matchJobId}` : ''}`}
                    className="chip"
                    style={{ fontSize: '0.75rem' }}
                  >
                    View profile
                  </Link>
                  {canColdChat ? (
                    <Link
                      href={`/messages?peer=${p.user?.id}${candFilters.matchJobId ? `&job=${candFilters.matchJobId}` : ''}`}
                      className="chip"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Chat
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard/recruiter?tab=billing"
                      className="chip muted"
                      title="Cold outreach requires Premium"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Chat (Premium)
                    </Link>
                  )}
                </div>
              </div>
              {p.matchScore != null && <MatchRing score={p.matchScore} />}
            </div>
          ))}

          {(candidates?.total || 0) > 0 && candTotalPages > 1 && (
            <div className="pagination-wrap" style={{ marginTop: '1.25rem' }}>
              <Pagination
                page={candidates?.page ?? candFilters.page}
                totalPages={candTotalPages}
                total={candidates?.total || 0}
                limit={candidates?.limit ?? candFilters.limit}
                disabled={candLoading}
                onPageChange={(p) => applyCand({ page: p })}
                truncatedNote={
                  candidates?.truncated
                    ? `Showing top ${Number(candidates.total).toLocaleString()} of ${Number(candidates.matchedTotal ?? candidates.total).toLocaleString()} matches for this sort`
                    : null
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
