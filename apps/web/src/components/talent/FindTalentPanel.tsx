'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, localeHref } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/lib/navigation';
import { api, getSession } from '@/lib/api';
import { localizedJobLocation } from '@/lib/location';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { FilterFieldset, LabelText } from '@/components/ui/Field';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { AdvancedFiltersPanel } from '@/components/ui/AdvancedFiltersPanel';
import { CandidateListSkeleton } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { RecruiterAvatar, JobContextSelect, preferredCompany } from '@/components/recruiter/RecruiterPrimitives';
import { SearchField, ResourceError, WorkspaceEmpty } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import rw from '@/components/recruiter/RecruiterWorkspace.module.css';
import { PresenceDot } from '@/components/presence/PresenceDot';
import { usePresence, seedPresence } from '@/lib/presence';
import {
  csvHasLanguageCode,
  LanguageLevelCode,
  parseLanguagesCsv,
} from '@job-talentio/shared';

type PlanCode = 'FREE' | 'STANDARD' | 'PREMIUM' | 'VIP';

const CAND_PAGE_SIZES = [12, 24, 36] as const;
const DEGREE_OPTS = ['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'] as const;

type CandFilters = {
  q: string;
  city: string;
  skills: string;
  skillMode: 'AND' | 'OR';
  jobTitle: string;
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
  jobTitle: '',
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

function toggleLanguageCsv(csv: string, code: string, defaultLevel: LanguageLevelCode = 'B1') {
  const tokens = parseLanguagesCsv(csv);
  const key = code.toLowerCase();
  const has = tokens.some((t) => t.code === key);
  const next = has
    ? tokens.filter((t) => t.code !== key)
    : [...tokens, { code: key, minLevel: defaultLevel }];
  return next
    .map((t) => (t.minLevel === 'A1' ? t.code : `${t.code}:${t.minLevel}`))
    .join(',');
}

function jobSelectLabel(
  j: {
    title: string;
    status?: string;
    workMode?: string | null;
    city?: { name: string } | null;
  },
  statusLabel: (value: string) => string,
  t: (key: string) => string,
) {
  const location = localizedJobLocation(j, t);
  const status = j.status && j.status !== 'PUBLISHED' ? ` | ${statusLabel(j.status)}` : '';
  return `${j.title} - ${location}${status}`;
}

function filtersFromSearchParams(sp: URLSearchParams): CandFilters {
  return {
    ...DEFAULT_CAND_FILTERS,
    q: sp.get('q') || '',
    city: sp.get('city') || '',
    skills: sp.get('skills') || '',
    skillMode: sp.get('skillMode') === 'AND' ? 'AND' : 'OR',
    jobTitle: sp.get('jobTitle') || '',
    degree: sp.get('degree') || '',
    languages: sp.get('languages') || '',
    experienceYearsMin: sp.get('experienceYearsMin') || '',
    experienceYearsMax: sp.get('experienceYearsMax') || '',
    hasCertification: sp.get('hasCertification') === 'true',
    matchJobId: sp.get('matchJobId') || '',
    sort: (['relevance', 'newest', 'match'].includes(sp.get('sort') || '')
      ? sp.get('sort')
      : sp.get('matchJobId') ? 'match' : 'relevance') as CandFilters['sort'],
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
  if (f.jobTitle) params.set('jobTitle', f.jobTitle);
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
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
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
  const [cityQ, setCityQ] = useState('');
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [companyId, setCompanyId] = useState(searchParams.get('company') || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [planCode, setPlanCode] = useState<PlanCode>('FREE');
  const [meta, setMeta] = useState<{
    cities: any[];
    skills: any[];
    languages: any[];
  }>({ cities: [], skills: [], languages: [] });

  const canColdChat = planCode === 'PREMIUM' || planCode === 'VIP';

  const syncUrl = useCallback(
    (f: CandFilters) => {
      const params = filtersToSearchParams(f);
      if (companyId) params.set('company', companyId);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, companyId],
  );

  function applyCand(patch: Partial<CandFilters>) {
    const next = { ...candFilters, ...patch, page: patch.page || 1 };
    if (patch.matchJobId !== undefined) { next.sort = patch.matchJobId ? 'match' : 'relevance'; setCandidates(null); }
    if (!next.matchJobId && next.sort === 'match') next.sort = 'relevance';
    setCandFilters(next); syncUrl(next);
  }
  function resetFilters() {
    const next = { ...DEFAULT_CAND_FILTERS, matchJobId: candFilters.matchJobId, sort: candFilters.matchJobId ? 'match' as const : 'relevance' as const };
    setCandFilters(next); setQuery(''); syncUrl(next);
  }

  useEffect(() => {
    const session = getSession();
    if (!session) {
      window.location.href = localeHref('/login?role=RECRUITER&next=' + encodeURIComponent('/talent?' + searchParams.toString()));
      return;
    }
    if (session.user.role !== 'RECRUITER' && session.user.role !== 'SUPER_ADMIN') {
      window.location.href = localeHref(session.user.role === 'EMPLOYEE' ? '/jobs' : '/');
      return;
    }
    let active = true;
    setReady(false);
    (async () => {
      try {
        const [mine, cities, skills, langs] = await Promise.all([
          api<any[]>('/companies/mine'),
          api('/meta/cities', { auth: false }),
          api('/meta/skills?sort=popular&take=120', { auth: false }),
          api('/meta/languages', { auth: false }).catch(() => []),
        ]);
        if (!active) return;
        setMeta({
          cities: cities as any[],
          skills: skills as any[],
          languages: langs as any[],
        });
        const preferred = mine.find((item) => item.companyId === companyId) || preferredCompany(mine);
        const lists = await Promise.all(mine.map(async (membership) => {
          const items = await api<any[]>('/jobs/company/' + membership.companyId);
          return items.map((job) => ({ ...job, companyId: membership.companyId, company: membership.company }));
        }));
        if (!active) return;
        const allJobs = lists.flat();
        setJobs(allJobs);
        setCompanyId(preferred?.companyId || '');
        setPlanCode((preferred?.company?.subscription?.plan || 'FREE') as PlanCode);
        setReady(true);

      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : t('talent.loadFailed'));
      }
    })();
    return () => { active = false; };
  }, [locale, retry]);

  useEffect(() => {
    if (!ready) return;
    if (candFilters.matchJobId && !jobs.some((job) => job.id === candFilters.matchJobId)) { setCandidates(null); setCandLoading(false); setError(t('rw.unavailableJob')); return; }
    let cancelled = false;
    (async () => {
      setError('');
      setCandLoading(true);
      try {
        const params = filtersToSearchParams(candFilters);
        params.set('sort', candFilters.sort);
        params.set('page', String(candFilters.page));
        params.set('limit', String(candFilters.limit));
        const data = await api<any>(`/profiles/candidates?${params.toString()}`);
        if (cancelled) return;
        for (const item of data?.items || []) {
          if (item.user?.id) seedPresence(item.user.id, item.presence);
        }
        setCandidates({ ...data, requestMatchJobId: candFilters.matchJobId });
        if (data?.page != null && data.page !== candFilters.page) {
          setCandFilters((prev) => ({ ...prev, page: data.page as number }));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('talent.loadTalentFailed'));
      } finally {
        if (!cancelled) setCandLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candFilters, ready, locale]);

  useEffect(() => {
    const next = filtersFromSearchParams(new URLSearchParams(searchParams.toString()));
    setCandFilters((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    setQuery(next.q);
  }, [searchParams]);
  useEffect(() => {
    if (!ready) return;
    const selectedCompany = jobs.find((job) => job.id === candFilters.matchJobId)?.companyId || companyId;
    if (!selectedCompany) return;
    let active = true; setPlanCode('FREE');
    api<{ plan: PlanCode }>('/billing/companies/' + selectedCompany + '/subscription').then((data) => { if (active) setPlanCode(data.plan); }).catch(() => { /* The API still enforces contact and chat access. */ });
    return () => { active = false; };
  }, [ready, candFilters.matchJobId, companyId, jobs]);
  const selectedCandCities = candFilters.city.split(',').filter(Boolean);
  const selectedCandSkills = candFilters.skills.split(',').filter(Boolean);
  const selectedCandLangs = parseLanguagesCsv(candFilters.languages);
  const selectedJobTitles = candFilters.jobTitle.split(',').filter(Boolean);
  const cityFacet = Object.fromEntries((candidates?.facets?.cities || []).map((c: any) => [c.slug, c.count]));
  const skillFacetList = candidates?.facets?.skills || [];
  const skillFacet = Object.fromEntries(skillFacetList.map((s: any) => [s.slug, s.count]));
  const jobTitleFacetList: Array<{ slug: string; name: string; count: number }> =
    candidates?.facets?.jobTitles || [];
  const selectedTitleLabels = selectedJobTitles.map(
    (slug) => jobTitleFacetList.find((t) => t.slug === slug)?.name || slug,
  );
  const hasActiveCandFilters = Boolean(
    candFilters.q ||
      candFilters.city ||
      candFilters.skills ||
      candFilters.jobTitle ||
      candFilters.degree ||
      candFilters.languages ||
      candFilters.experienceYearsMin ||
      candFilters.experienceYearsMax ||
      candFilters.hasCertification ||
      candFilters.matchJobId,
  );
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

  const presenceMap = usePresence(
    ((candidates?.items || []) as Array<{ user?: { id?: string } }>).map((p) => p.user?.id),
  );

  const selectedJob = jobs.find((job) => job.id === candFilters.matchJobId);
  return (
    <section className={rw.root} aria-label={t('findTalent')}>
      <div className={rw.context}><strong>{t('rw.rankFor')}</strong><JobContextSelect jobs={jobs} value={candFilters.matchJobId} onChange={(id) => applyCand({ matchJobId: id })} />{selectedJob && <span className={rw.status} data-status={selectedJob.status}>{enumLabel('jobStatus', selectedJob.status)}</span>}{selectedJob && <Link className={rw.textButton} href={'/jobs/' + selectedJob.id}>{t('ew.viewJob')}<WorkspaceIcon kind="external" /></Link>}</div>
      <div className={rw.toolbar}><form role="search" onSubmit={(event) => { event.preventDefault(); applyCand({ q: query }); }} style={{ display:'flex', gap:10, flex:1 }}><SearchField value={query} onChange={setQuery} placeholder={t('findTalentSearchPlaceholder')} /><button type="submit" className={rw.primary}>{t('search')}</button></form><span className={rw.emptyNote}>{candFilters.matchJobId ? t('rw.rankedHint') : t('rw.browseWithout')}</span><button className={rw.textButton} onClick={() => applyCand({ matchJobId: '' })}>{candFilters.matchJobId ? t('rw.browseWithout') : ''}</button><button className={rw.secondary + ' ' + rw.filterToggle} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="talent-filters">{t('filters')}</button></div>
      {error && <ResourceError message={error} onRetry={() => { setError(''); setRetry((value) => value + 1); }} />}
      <div className={rw.talentLayout}>
        <aside id="talent-filters" className={rw.filterPanel} data-open={filtersOpen}>
          <header><strong>{t('filters')}</strong><button type="button" className={rw.textButton} onClick={resetFilters}>{t('clearFilters')}</button><button className={rw.icon + ' ' + rw.filterToggle} aria-label={t('close')} onClick={() => setFiltersOpen(false)}>×</button></header>
          <FilterFieldset legend={t('city')} className="filter-group"><input type="search" value={cityQ} onChange={(event) => setCityQ(event.target.value)} aria-label={t('city')} placeholder={t('city')} />
            <ExpandableList
              items={meta.cities.filter((city) => city.name.toLocaleLowerCase().includes(cityQ.toLocaleLowerCase()))}
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

          {jobTitleFacetList.length > 0 && (
            <FilterFieldset legend={t('jobTitleFilter')} className="filter-group">
              <ExpandableList
                items={jobTitleFacetList}
                initialCount={8}
                step={8}
                getKey={(t) => t.slug}
                renderItem={(t) => (
                  <label className="filter-check">
                    <input
                      type="checkbox"
                      checked={selectedJobTitles.includes(t.slug)}
                      onChange={() => applyCand({ jobTitle: toggleCsv(candFilters.jobTitle, t.slug) })}
                    />
                    <LabelText optional={false}>{t.name}</LabelText>
                    <span className="facet-count">({t.count})</span>
                  </label>
                )}
              />
            </FilterFieldset>
          )}

          <AdvancedFiltersPanel
            storageKey="jt_talent_advanced_filters"
            activeCount={candAdvancedCount}
            forceOpen={candAdvancedCount > 0}
          >
            <FilterFieldset
              legend={`${t('skills')} (${candFilters.skillMode})`}
              className="filter-group"
            >
              <label>
                <LabelText>{t('matchMode')}</LabelText>
                <select
                  value={candFilters.skillMode}
                  onChange={(e) => applyCand({ skillMode: e.target.value as 'AND' | 'OR' })}
                  style={{ marginBottom: '0.4rem' }}
                >
                  <option value="OR">{t('matchAny')}</option>
                  <option value="AND">{t('matchAll')}</option>
                </select>
              </label>
              <label>
                <LabelText>{t('filterSkills')}</LabelText>
                <input
                  value={skillQ}
                  onChange={(e) => setSkillQ(e.target.value)}
                  placeholder={t('skillSearchPlaceholder')}
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
                  <LabelText>{t('talent.minYears')}</LabelText>
                  <input
                    type="number"
                    min={0}
                    placeholder={t('talent.min')}
                    value={candFilters.experienceYearsMin}
                    onChange={(e) => applyCand({ experienceYearsMin: e.target.value })}
                  />
                </label>
                <label>
                  <LabelText>{t('talent.maxYears')}</LabelText>
                  <input
                    type="number"
                    min={0}
                    placeholder={t('talent.max')}
                    value={candFilters.experienceYearsMax}
                    onChange={(e) => applyCand({ experienceYearsMax: e.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="filter-group">
              <label>
                <LabelText>{t('talent.degree')}</LabelText>
                <select value={candFilters.degree} onChange={(e) => applyCand({ degree: e.target.value })}>
                  <option value="">{t('any')}</option>
                  {DEGREE_OPTS.map((d) => (
                    <option key={d} value={d}>
                      {enumLabel('degree', d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <FilterFieldset legend={t('languages')} className="filter-group">
              <ExpandableList
                items={meta.languages}
                initialCount={8}
                step={10}
                getKey={(l) => l.code}
                renderItem={(l) => (
                  <label className="filter-check">
                    <input
                      type="checkbox"
                      checked={csvHasLanguageCode(candFilters.languages, l.code)}
                      onChange={() =>
                        applyCand({ languages: toggleLanguageCsv(candFilters.languages, l.code, 'B1') })
                      }
                    />
                    <LabelText optional={false}>
                      {l.name}
                      {selectedCandLangs.some((tok) => tok.code === l.code)
                        ? ` ${selectedCandLangs.find((tok) => tok.code === l.code)?.minLevel}+`
                        : ''}
                    </LabelText>
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
                <LabelText optional={false}>{t('talent.hasCertification')}</LabelText>
              </label>
            </div>
          </AdvancedFiltersPanel>
        </aside>

        <div className={rw.results} aria-busy={candLoading}>
          <div className={rw.resultTools}><strong>{t('rw.candidateCount').replace('{n}', String(candidates?.total || 0))}</strong><WorkspaceSelect value={candFilters.sort} options={[{value:'relevance', label:t('talent.sortRelevance')}, {value:'newest', label:t('talent.sortNewest')}, ...(candFilters.matchJobId ? [{value:'match',label:t('talent.sortMatch')}] : [])]} label={t('sortBy')} onChange={(value) => applyCand({ sort:value as CandFilters['sort'] })} /><WorkspaceSelect value={String(candFilters.limit)} options={CAND_PAGE_SIZES.map((value) => ({value:String(value),label:t('talent.perPage').replace('{n}',String(value))}))} label={t('resultsPerPage')} onChange={(value) => applyCand({limit:Number(value)})} /></div>
          {(selectedTitleLabels.length > 0 || selectedCandSkills.length > 0 || candFilters.city) && <div className={rw.tags} style={{padding:'6px 24px'}}>{selectedTitleLabels.map((label,index) => <button className={rw.tag} key={label} onClick={() => applyCand({jobTitle:toggleCsv(candFilters.jobTitle,selectedJobTitles[index])})}>{label} ×</button>)}{selectedCandSkills.map((slug) => <button className={rw.tag} key={slug} onClick={() => applyCand({skills:toggleCsv(candFilters.skills,slug)})}>{meta.skills.find((skill) => skill.slug === slug)?.name || slug} ×</button>)}<button className={rw.textButton} onClick={resetFilters}>{t('clearFilters')}</button></div>}
          <div className={rw.candidateList}>
            {(candLoading && !candidates || !ready && !error) && <CandidateListSkeleton count={6} />}
            {ready && !candLoading && !error && !(candidates?.items || []).length && <WorkspaceEmpty icon="search" title={t('talent.noMatches')} hint={t('talent.noMatchesHint')}><button className={rw.secondary} onClick={resetFilters}>{t('clearFilters')}</button></WorkspaceEmpty>}
            {(candidates?.requestMatchJobId === candFilters.matchJobId ? candidates?.items || [] : []).map((candidate:any) => <article key={candidate.id} className={rw.candidateRow}>
              <RecruiterAvatar name={candidate.user?.fullName || ''} src={candidate.user?.avatarUrl} />
              <div><Link className={rw.candidateName} href={'/candidates/' + candidate.id + (candFilters.matchJobId ? '?matchJobId=' + candFilters.matchJobId : '')}>{candidate.user?.fullName}<PresenceDot status={presenceMap[candidate.user?.id] ?? candidate.presence} /></Link><span className={rw.sub}>{candidate.headline || '-'}</span><span className={rw.sub}>{[candidate.city?.name,t('talent.expYears').replace('{n}',String(candidate.experienceYears || 0))].filter(Boolean).join(' | ')}</span></div>
              <div className={rw.candidateSkills}><div className={rw.tags}>{(candidate.skills || []).slice(0,4).map((item:any) => <span key={item.id || item.skill?.slug} className={rw.tag}>{item.skill?.name || item.name}</span>)}</div></div>
              <div className={rw.score}>{candFilters.matchJobId && candidate.matchScore != null && <><span>{t('rw.matchForJob')}</span><strong>{Math.round(candidate.matchScore)}%</strong><Link className={rw.textButton} style={{fontSize:'.68rem'}} href={'/candidates/' + candidate.id + '?matchJobId=' + candFilters.matchJobId + '&section=match'}>{t('rw.matchDetails')}</Link></>}</div>
              <div className={rw.rowActions}><Link className={rw.secondary} href={'/candidates/' + candidate.id + (candFilters.matchJobId ? '?matchJobId=' + candFilters.matchJobId : '')}>{t('viewProfile')}</Link>{canColdChat ? <Link className={rw.textButton} href={'/messages?peer=' + candidate.user?.id + (candFilters.matchJobId ? '&job=' + candFilters.matchJobId : '') + '&role=RECRUITER'}>{t('talent.chat')}</Link> : <Link className={rw.textButton} style={{fontSize:'.7rem'}} href="/dashboard/recruiter?tab=billing">{t('talent.chatPremium')}</Link>}</div>
            </article>)}
          </div>
          {(candidates?.total || 0) > 0 && candTotalPages > 1 && <div className={rw.candidatePagination}><Pagination page={candidates?.page ?? candFilters.page} totalPages={candTotalPages} total={candidates?.total || 0} limit={candidates?.limit ?? candFilters.limit} disabled={candLoading} onPageChange={(page) => applyCand({page})} truncatedNote={candidates?.truncated ? t('talent.truncatedNote').replace('{n}',String(candidates.total)).replace('{m}',String(candidates.matchedTotal ?? candidates.total)) : null} /></div>}
        </div>
      </div>
    </section>
  );
}
