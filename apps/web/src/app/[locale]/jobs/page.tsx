'use client';
import { loginForCurrentPage } from '@/lib/authReturn';

import { Link } from '@/lib/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { FilterFieldset, FormField } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { JobListSkeleton } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { api, getSession, type AuthSession } from '@/lib/api';
import { sanitizeMojibake } from '@/lib/text';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { CatalogRoleFilter } from '@/components/ui/CatalogRoleFilter';
import { useRoleCatalog } from '@/lib/roleCatalog';
import { HeroLocationPicker } from '@/components/home/HeroLocationPicker';
import { JobDetailClient } from './[id]/JobDetailClient';
import { JobsIcon } from '@/components/jobs/JobsIcon';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { formatJobSalary } from '@/components/jobs/formatJobSalary';
import s from '@/components/jobs/JobsWorkspace.module.css';
import {
  csvHasLanguageCode,
  LanguageLevelCode,
  parseLanguagesCsv,
  scoreProfileCompleteness,
} from '@job-talentio/shared';

type MetaItem = { id: string; name: string; slug: string; icon?: string | null; code?: string; province?: { country?: { name: string; slug: string } } };
type LangMeta = { id: string; name: string; code: string };
type Job = {
  id: string;
  title: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  salaryPeriod?: string;
  workMode?: string;
  employmentType?: string;
  experienceLevel?: string | null;

  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string; slug: string } | null;
  category?: { name: string; slug: string } | null;
  jobSkills?: Array<{ skill: { name: string; slug: string } }>;
  benefits?: Array<{ benefit: { name: string; icon?: string | null } }>;
  jobLanguages?: Array<{ language: { name: string; code: string }; minLevel: string }>;
};

type SearchResponse = {
  items: Job[];
  total: number;
  matchedTotal?: number;
  truncated?: boolean;
  page: number;
  limit: number;
  sort: string;
  totalPages: number;
  facets?: {
    cities: Array<{ slug: string; name: string; count: number }>;
    categories: Array<{ slug: string; name: string; count: number }>;
    jobTitles?: Array<{ slug: string; name: string; count: number }>;
    companies?: Array<{ slug: string; name: string; logoUrl?: string | null; count: number }>;
    industries?: Array<{ slug: string; name: string; count: number; groupSlug?: string }>;
    skills?: Array<{ slug: string; name: string; count: number }>;
    languages?: Array<{ code: string; name: string; count: number }>;
    experienceLevels: Record<string, number>;
  };
};

type EmployeeProfile = {
  headline?: string | null;
  desiredPosition?: string | null;
  city?: { name: string } | null;
  skills?: Array<{ skill: { name: string } }>;
  experiences?: Array<{ title?: string | null }>;
  educations?: unknown[];
  languages?: unknown[];
  resumes?: unknown[];
};
type RecommendedItem = { job: Job };
type RecommendationPage = {items:RecommendedItem[];total:number;totalPages:number;page:number;mode:string};

function hasCareerSignal(profile: EmployeeProfile | null) {
  return Boolean(profile && (profile.skills?.length || profile.headline?.trim() || profile.desiredPosition?.trim() || profile.experiences?.some((item) => item.title?.trim())));
}

type Filters = {
  q: string;
  city: string;
  country: string;
  category: string;
  companySlug: string;
  industrySlug: string;
  jobTitle: string;
  skills: string;
  skillMode: string;
  benefits: string;
  languages: string;
  employmentType: string;
  workMode: string;
  experienceLevel: string;
  salaryMin: string;
  salaryMax: string;
  postedWithin: string;
  sort: string;
  page: number;
  limit: number;
};

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

const PAGE_SIZE_OPTIONS = [12, 24, 36] as const;
const DEFAULT_LIMIT = 12;

const EMPTY: Filters = {
  q: '',
  city: '',
  country: '',
  category: '',
  companySlug: '',
  industrySlug: '',
  jobTitle: '',
  skills: '',
  skillMode: 'OR',
  benefits: '',
  languages: '',
  employmentType: '',
  workMode: '',
  experienceLevel: '',
  salaryMin: '',
  salaryMax: '',
  postedWithin: '',
  sort: 'relevance',
  page: 1,
  limit: DEFAULT_LIMIT,
};

function defaultJobSort(): string {
  return 'relevance';
}

function filtersFromParams(sp: URLSearchParams, implicitSort: string): Filters {
  const rawLimit = Number(sp.get('limit') || DEFAULT_LIMIT);
  const limit = PAGE_SIZE_OPTIONS.includes(rawLimit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawLimit
    : DEFAULT_LIMIT;
  return {
    q: sp.get('q') ?? '',
    city: sp.get('city') ?? '',
    country: sp.get('country') ?? '',
    category: sp.get('category') ?? '',
    companySlug: sp.get('companySlug') ?? '',
    industrySlug: sp.get('industrySlug') ?? '',
    jobTitle: sp.get('jobTitle') ?? '',
    skills: sp.get('skills') ?? '',
    skillMode: sp.get('skillMode') ?? 'OR',
    benefits: sp.get('benefits') ?? '',
    languages: sp.get('languages') ?? '',
    employmentType: sp.get('employmentType') ?? '',
    workMode: sp.get('workMode') ?? '',
    experienceLevel: sp.get('experienceLevel') ?? '',
    salaryMin: sp.get('salaryMin') ?? '',
    salaryMax: sp.get('salaryMax') ?? '',
    postedWithin: sp.get('postedWithin') ?? '',
    sort: sp.get('sort') ?? implicitSort,
    page: Math.max(1, Number(sp.get('page') || 1)),
    limit,
  };
}

function toParams(f: Filters, view?: string | null, implicitSort = 'relevance'): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(EMPTY) as Array<keyof Filters>).forEach((key) => {
    const value = f[key];
    if (key === 'page') {
      if (Number(value) > 1) p.set('page', String(value));
      return;
    }
    if (key === 'limit') {
      // Always send limit - API default is not guaranteed to match UI default (12).
      p.set('limit', String(value || DEFAULT_LIMIT));
      return;
    }
    if (key === 'sort') {
      if (value !== implicitSort) p.set('sort', String(value));
      return;
    }
    if (key === 'skillMode') {
      if (value !== 'OR') p.set('skillMode', String(value));
      return;
    }

    if (value) p.set(key, String(value));
  });
  if (view === 'companies') p.set('view', 'companies');
  return p;
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
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => { setSession(getSession()); setAuthReady(true); }, []);
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const implicitSort = defaultJobSort();
  const filterParams = new URLSearchParams(searchParams.toString());
  filterParams.delete('job');
  const filterKey = filterParams.toString();
  const filters = useMemo(
    () => filtersFromParams(new URLSearchParams(filterKey), implicitSort),
    [filterKey, implicitSort],
  );
  const browseCompanies = searchParams.get('view') === 'companies';
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cities, setCities] = useState<MetaItem[]>([]);
  const [countries, setCountries] = useState<MetaItem[]>([]);
  const [categories, setCategories] = useState<MetaItem[]>([]);
  const [skills, setSkills] = useState<MetaItem[]>([]);
  const [benefits, setBenefits] = useState<MetaItem[]>([]);
  const [languages, setLanguages] = useState<LangMeta[]>([]);
  const [skillQ, setSkillQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [discoveryRetry, setDiscoveryRetry] = useState(0);
  const [recommendationPage,setRecommendationPage]=useState(1);
  const [recommendationMeta,setRecommendationMeta]=useState({total:0,totalPages:1,mode:"LATEST"});
  const [discovery, setDiscovery] = useState<{ status: 'loading' | 'ready' | 'error'; profile: EmployeeProfile | null; rows: RecommendedItem[] }>({ status: 'loading', profile: null, rows: [] });
  const requestedMode = searchParams.get('mode');
  const hasSearchIntent = Object.keys(EMPTY).some((key) => !['limit', 'skillMode'].includes(key) && filterParams.has(key)) || browseCompanies;
  const personalized = Boolean(isEmployee && (requestedMode === 'for-you' || (requestedMode !== 'all' && !hasSearchIntent && hasCareerSignal(discovery.profile) && discovery.rows.length > 0)));
  const decidingMode = !authReady || Boolean(isEmployee && !['all', 'for-you'].includes(requestedMode || '') && !hasSearchIntent && !discovery.profile && discovery.status === 'loading');

  useEffect(() => {
    if (!isEmployee) return;
    let active = true;
    setDiscovery((current) => ({ ...current, status: 'loading' }));
    Promise.all([api<EmployeeProfile>('/profiles/me'), api<RecommendationPage>(`/jobs/recommended?page=${recommendationPage}&limit=24`)])
      .then(([profile, result]) => { if (active) { setDiscovery({ status: 'ready', profile, rows:result.items }); setRecommendationMeta(result); setRecommendationPage(result.page); } })
      .catch(() => { if (active) setDiscovery((current) => ({ ...current, status: 'error' })); });
    return () => { active = false; };
  }, [isEmployee, locale, discoveryRetry,recommendationPage]);
  const [hiringCompanies, setHiringCompanies] = useState<
    Array<{ slug: string; name: string; logoUrl?: string | null; count: number }>
  >([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<MetaItem[]>('/meta/cities', { auth: false }),
      api<MetaItem[]>('/meta/categories', { auth: false }),
      api<MetaItem[]>('/meta/skills?sort=popular&take=120', { auth: false }),
      api<MetaItem[]>('/meta/benefits', { auth: false }),
      api<LangMeta[]>('/meta/languages', { auth: false }),
      api<MetaItem[]>('/meta/countries', { auth: false }),
    ])
      .then(([c, cat, sk, b, langs, countryRows]) => {
        if (!active) return;
        setCities(c);
        setCountries(countryRows);
        setCategories(cat);
        setSkills(sk);
        setBenefits(b);
        setLanguages(langs || []);
      })
      .catch(() => undefined);
    api<SearchResponse>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => { if (active) { setHiringCompanies(r.facets?.companies || []); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [locale]);

  const apply = useCallback(
    (patch: Partial<Filters>, opts?: { keepBrowse?: boolean }) => {
      listScroll.current = 0;
      if (listRef.current) listRef.current.scrollTop = 0;
      const next = { ...filters, ...patch };
      if (patch.page === undefined && !('page' in patch)) next.page = 1;
      const keepBrowse = opts?.keepBrowse ?? browseCompanies;
      const params = toParams(next, keepBrowse ? 'companies' : null, implicitSort);
      if (isEmployee) params.set('mode', 'all');
      router.push(`/jobs?${params}`, { scroll: false });
    },
    [filters, router, browseCompanies, implicitSort, isEmployee],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const p = toParams(filters, null, implicitSort);
    // All jobs keeps its own explicit search sorting; For you uses /jobs/recommended.
    p.set('sort', filters.sort);
    // Send auth when logged in so sort=match can use the employee profile
    api<SearchResponse>(`/jobs?${p.toString()}`)
      .then((res) => {
        if (!active) return;
        setData(res);
        // Keep URL in sync when the API clamps an out-of-range page.
        if (requestedMode !== 'for-you' && res.page !== filters.page) {
          router.replace(
            `/jobs?${new URLSearchParams({ ...Object.fromEntries(toParams({ ...filters, page: res.page }, browseCompanies ? 'companies' : null, implicitSort)), ...(requestedMode ? { mode: requestedMode } : {}) })}`,
          );
        }
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, router, browseCompanies, implicitSort, retry, requestedMode]);

  const selectedSkills = filters.skills.split(',').filter(Boolean);
  const selectedCities = filters.city.split(',').filter(Boolean);
  const selectedCats = filters.category.split(',').filter(Boolean);
  const selectedBenefits = filters.benefits.split(',').filter(Boolean);
  const selectedLanguageTokens = parseLanguagesCsv(filters.languages);
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

  const catFacet = Object.fromEntries((data?.facets?.categories || []).map((c) => [c.slug, c.count]));
  const companyFacetList = hiringCompanies.length
    ? hiringCompanies
    : data?.facets?.companies || [];
  const expFacet = data?.facets?.experienceLevels || {};

  const { roles: titleCatalog } = useRoleCatalog();
  const titleFacetList = titleCatalog;
  const singleJobTitleSlug =
    filters.jobTitle && !filters.jobTitle.includes(',') ? filters.jobTitle : '';
  const activeJobTitle =
    (singleJobTitleSlug && titleFacetList.find((x) => x.slug === singleJobTitleSlug)) ||
    (singleJobTitleSlug
      ? { slug: singleJobTitleSlug, name: singleJobTitleSlug, count: data?.total ?? 0 }
      : null);

  const industryFacetList = data?.facets?.industries || [];
  const singleIndustrySlug =
    filters.industrySlug && !filters.industrySlug.includes(',') ? filters.industrySlug : '';
  const activeIndustry =
    (singleIndustrySlug && industryFacetList.find((x) => x.slug === singleIndustrySlug)) ||
    (singleIndustrySlug
      ? { slug: singleIndustrySlug, name: singleIndustrySlug, count: data?.total ?? 0 }
      : null);

  const advancedActiveCount = [
    filters.industrySlug,
    filters.jobTitle,
    filters.skills,
    filters.benefits,
    filters.languages,
    filters.postedWithin,
    filters.employmentType,
    filters.skillMode !== 'OR' ? filters.skillMode : '',
  ].filter(Boolean).length;
  const activeFilterCount =
    advancedActiveCount + [filters.q, filters.city, filters.country, filters.category, filters.companySlug, filters.experienceLevel, filters.workMode, filters.salaryMin, filters.salaryMax].filter(Boolean).length;
  const forceAdvancedOpen = advancedActiveCount > 0;

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const location = String(fd.get('location') || '');
    const city = location.startsWith('country:') ? '' : location;
    const country = location.startsWith('country:') ? location.slice(8) : '';
    apply({ q: String(fd.get('q') || '').trim(), city, country });
  }


  const [companyQ, setCompanyQ] = useState('');
  const [locationDraft, setLocationDraft] = useState(filters.country ? `country:${filters.country}` : filters.city);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState('');
  const saveInFlight = useRef(new Set<string>());
  const rootRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const openedLocally = useRef(false);
  const requestedJob = searchParams.get('job');
  const selectedId = requestedJob;
  const selectedJob = data?.items.find((job) => job.id === selectedId) || discovery.rows.find((item) => item.job.id === selectedId)?.job;
  const searchCities = cities;
  const countryForCity = (slug?: string, name?: string) => cities.find((city) => city.slug === slug || (!slug && city.name === name))?.province?.country?.name;

  useEffect(() => { setLocationDraft(filters.country ? `country:${filters.country}` : filters.city); }, [filters.city, filters.country]);
  useEffect(() => {
    if (!isEmployee) return;
    let active = true;
    api<Array<{ jobPostId: string }>>('/profiles/me/saved-jobs')
      .then((rows) => { if (active) setSavedIds(new Set(rows.map((row) => row.jobPostId))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [isEmployee]);

  useEffect(() => {
    const nav = document.querySelector('.nav-wrap');
    if (!nav) return;
    const measure = () => rootRef.current?.style.setProperty('--jobs-nav-height', `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requestedJob) {
      const frame = requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listScroll.current; });
      return () => cancelAnimationFrame(frame);
    }
  }, [requestedJob]);

  useEffect(() => {
    if (!filtersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => filtersRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setFiltersOpen(false); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(filtersRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]') || []).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    function onResize() { if (window.innerWidth >= 1440) setFiltersOpen(false); }
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      filterButtonRef.current?.focus();
    };
  }, [filtersOpen]);

  function openJob(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    listScroll.current = listRef.current?.scrollTop || 0;
    const params = new URLSearchParams(searchParams.toString());
    params.set('job', id);
    if (requestedJob) router.replace(`/jobs?${params}`, { scroll: false });
    else { openedLocally.current = true; router.push(`/jobs?${params}`, { scroll: false }); }
  }

  function closeJob() {
    if (openedLocally.current) { openedLocally.current = false; router.back(); return; }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('job');
    router.replace(params.size ? `/jobs?${params}` : '/jobs', { scroll: false });
  }

  async function toggleSaved(id: string) {
    if (!session) { router.push(loginForCurrentPage()); return; }
    if (!isEmployee || saveInFlight.current.has(id)) return;
    saveInFlight.current.add(id);
    setSaveError('');
    setSavingIds((current) => new Set(current).add(id));
    try {
      const saved = savedIds.has(id);
      await api(`/profiles/me/saved-jobs/${id}`, { method: saved ? 'DELETE' : 'POST' });
      setSavedIds((current) => { const next = new Set(current); if (saved) next.delete(id); else next.add(id); return next; });
    } catch (error) { setSaveError((error as Error).message); }
    finally {
      saveInFlight.current.delete(id);
      setSavingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }

  function chooseMode(mode: 'all' | 'for-you') {
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', mode);
    params.delete('job');
    openedLocally.current = false;
    setFiltersOpen(false);
    router.push(`/jobs?${params}`, { scroll: false });
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  const profile = discovery.profile;
  const completeness = profile ? scoreProfileCompleteness({ ...profile, email: session?.user.email, emailVerified: session?.user.emailVerified, telegramLinked: session?.user.telegramLinked, avatarUrl: session?.user.avatarUrl }).percent : 0;
  const recommendations = discovery.rows.map((item) => item.job);
  const visibleJobs = personalized ? recommendations : data?.items || [];
  const resultsLoading = decidingMode || (personalized ? discovery.status === 'loading' : loading);
  const resultsError = personalized ? discovery.status === 'error' ? t('workspace.recommendationError') : '' : error;

  const activeChips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.q) activeChips.push({ key: 'q', label: filters.q, remove: () => apply({ q: '' }) });
  filters.country.split(',').filter(Boolean).forEach(slug => activeChips.push({ key: `country-${slug}`, label: countries.find(country => country.slug === slug)?.name || slug, remove: () => apply({ country: toggleCsv(filters.country, slug) }) }));
  if (selectedCities.length > 2) activeChips.push({ key: 'cities', label: t('workspace.locationCount').replace('{n}', String(selectedCities.length)), remove: () => apply({ city: '' }) });
  else selectedCities.forEach((slug) => activeChips.push({ key: `city-${slug}`, label: cities.find((city) => city.slug === slug)?.name || slug, remove: () => apply({ city: toggleCsv(filters.city, slug) }) }));
  selectedCats.forEach((slug) => activeChips.push({ key: `category-${slug}`, label: categories.find((item) => item.slug === slug)?.name || slug, remove: () => apply({ category: toggleCsv(filters.category, slug) }) }));
  selectedCompanies.forEach((slug) => activeChips.push({ key: `company-${slug}`, label: companyFacetList.find((item) => item.slug === slug)?.name || slug, remove: () => apply({ companySlug: toggleCsv(filters.companySlug, slug) }) }));
  selectedSkills.forEach((slug) => activeChips.push({ key: `skill-${slug}`, label: skills.find((item) => item.slug === slug)?.name || slug, remove: () => apply({ skills: toggleCsv(filters.skills, slug) }) }));
  filters.jobTitle.split(',').filter(Boolean).forEach(slug => activeChips.push({ key: `title-${slug}`, label: titleCatalog.find(role => role.slug === slug)?.name || slug, remove: () => apply({ jobTitle: toggleCsv(filters.jobTitle, slug) }) }));
  if (activeIndustry) activeChips.push({ key: 'industry', label: activeIndustry.name, remove: () => apply({ industrySlug: '' }) });

  return (
    <div ref={rootRef} className={`${s.page} ${isEmployee ? s.employeePage : ''} ${personalized ? s.personalized : ''} ${requestedJob ? `${s.mobileDetail} ${s.withPreview}` : ''}`}>
      <header className={s.searchHeader} inert={filtersOpen ? true : undefined}>
        <h1 className="sr-only">{t('home.findJobs')}</h1>
        <form className={s.searchForm} role="search" aria-label={t('searchJobs')} onSubmit={onSearch}>
          <label className={s.keyword}><JobsIcon /><span className="sr-only">{t('searchPlaceholder')}</span><input type="search" name="q" defaultValue={filters.q} key={filters.q} placeholder={t('searchPlaceholder')} /></label>
          <div className={s.locationControl}><HeroLocationPicker cities={searchCities.map((city) => ({ ...city, country: city.province?.country?.name, countrySlug: city.province?.country?.slug }))} value={locationDraft} onChange={setLocationDraft} /></div>
          <button className={s.searchButton} type="submit">{t('search')}</button>
        </form>
      </header>
      {isEmployee && <nav className={s.modeBar} aria-label={t('home.findJobs')} inert={filtersOpen ? true : undefined}>
        <Link href="/jobs?mode=for-you" aria-current={personalized ? 'page' : undefined} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); chooseMode('for-you'); }}>{t('home.forYou')}{discovery.status === 'ready' && discovery.rows.length > 0 && <span>{recommendationMeta.total}</span>}</Link>
        <Link href="/jobs?mode=all" aria-current={!personalized && !decidingMode ? 'page' : undefined} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); chooseMode('all'); }}>{t('workspace.allJobs')}</Link>
        <Link className={s.profileShortcut} href="/dashboard/employee?tab=profile">{t('workspace.profileCv')}<JobsIcon kind="external" /></Link>
      </nav>}
      <div className={s.workspace}>
        {filtersOpen && <div className={s.filterBackdrop} onClick={() => setFiltersOpen(false)} aria-hidden="true" />}
        {personalized ? <aside className={s.profileRail} aria-label={t('workspace.yourProfile')}>
          <div className={s.profilePerson}>{session?.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : <span>{session?.user.fullName.charAt(0)}</span>}<strong>{session?.user.fullName}</strong><p>{profile?.desiredPosition || profile?.headline || t('workspace.addRole')}</p>{profile?.city && <small><JobsIcon kind="pin" />{profile.city.name}</small>}</div>
          {profile ? <><div className={s.completeness}><div><span>{t('workspace.profileComplete')}</span><strong>{completeness}%</strong></div><progress max={100} value={completeness} aria-label={t('workspace.profileComplete')} /><p>{t('workspace.profileHint')}</p></div><div className={s.profileSkills}>{profile.skills?.slice(0, 6).map((item) => <span key={item.skill.name}>{item.skill.name}</span>)}</div></> : discovery.status === 'error' ? <p>{t('workspace.profileUnavailable')}</p> : null}
          <Link href="/dashboard/employee?tab=profile" className={s.outlineButton}>{t('workspace.editProfile')}</Link><p className={s.profileFootnote}>{t('workspace.cvHint')}</p>
          <div className={s.filterLegal}><Link href="/terms">{t('termsOfService')}</Link><Link href="/privacy">{t('privacyPolicy')}</Link></div>
        </aside> : <aside ref={filtersRef} id="jobs-filters" className={`${s.filters} ${filtersOpen ? s.filtersOpen : ''}`} role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? true : undefined} aria-label={t('filters')}>
          <div className={s.filterHeading}><h2>{t('filters')}</h2><button className={s.textButton} type="button" onClick={() => apply({ ...EMPTY, sort: implicitSort })}>{t('workspace.reset')}</button><button className={s.closeFilters} type="button" onClick={() => setFiltersOpen(false)} aria-label={t('workspace.closeFilters')}><JobsIcon kind="close" /></button></div>
          <div className={s.filterScroll}>
            <details className={s.filterSection} open><summary>{t('category')}<JobsIcon kind="chevron" /></summary>
              <ExpandableList items={[...categories].sort((a, b) => Number(selectedCats.includes(b.slug)) - Number(selectedCats.includes(a.slug)) || (catFacet[b.slug] || 0) - (catFacet[a.slug] || 0))} initialCount={5} step={20} getKey={(item) => item.slug} renderItem={(item) => <label className={s.filterCheck}><input type="checkbox" checked={selectedCats.includes(item.slug)} onChange={() => apply({ category: toggleCsv(filters.category, item.slug) })} /><span>{item.name}</span>{catFacet[item.slug] != null && <small>{catFacet[item.slug]}</small>}</label>} />
            </details>
            <details className={s.filterSection} open><summary>{t('workMode')}<JobsIcon kind="chevron" /></summary>{['', 'ONSITE', 'HYBRID', 'REMOTE'].map((mode) => <label key={mode} className={s.filterCheck}><input type="radio" name="workMode" checked={filters.workMode === mode} onChange={() => apply({ workMode: mode })} /><span>{mode ? enumLabel('workMode', mode) : t('any')}</span></label>)}</details>
            <details className={s.filterSection} open><summary>{t('experience')}<JobsIcon kind="chevron" /></summary>
              <ExpandableList items={['JUNIOR', 'MIDDLE', 'SENIOR', 'INTERN', 'LEAD', 'EXECUTIVE'].sort((a, b) => Number(selectedLevels.includes(b)) - Number(selectedLevels.includes(a)))} initialCount={3} step={3} getKey={(level) => level} renderItem={(level) => <label className={s.filterCheck}><input type="checkbox" checked={selectedLevels.includes(level)} onChange={() => apply({ experienceLevel: toggleCsv(filters.experienceLevel, level) })} /><span>{enumLabel('experienceLevel', level)}</span>{expFacet[level] != null && <small>{expFacet[level]}</small>}</label>} />
            </details>
            <details className={s.filterSection} open><summary>{t('company')}<JobsIcon kind="chevron" /></summary>
              <details className={s.companyMenu} open={browseCompanies || undefined}><summary>{selectedCompanies.length ? t('workspace.companyCount').replace('{n}', String(selectedCompanies.length)) : t('workspace.allCompanies')}<JobsIcon kind="chevron" /></summary><label className={s.companySearch}><span className="sr-only">{t('workspace.searchCompany')}</span><input value={companyQ} onChange={(event) => setCompanyQ(event.target.value)} placeholder={t('workspace.searchCompany')} /></label><div className={s.companyOptions}>{companyFacetList.filter((item) => item.name.toLocaleLowerCase().includes(companyQ.toLocaleLowerCase())).map((item) => <label className={s.filterCheck} key={item.slug}><input type="checkbox" checked={selectedCompanies.includes(item.slug)} onChange={() => apply({ companySlug: toggleCsv(filters.companySlug, item.slug) })} /><span>{item.name}</span><small>{item.count}</small></label>)}</div></details>
            </details>
            <details className={s.filterSection} open><summary>{t('workspace.salary')}<JobsIcon kind="chevron" /></summary><div className={s.salaryFields}>
              <FormField label={t('job.salaryMin')}><NumberInput min={0} placeholder={t('workspace.min')} value={filters.salaryMin ? Number(filters.salaryMin) : null} onValueChange={(value) => apply({ salaryMin: value == null ? '' : String(value) })} aria-label={t('job.salaryMin')} /></FormField>
              <FormField label={t('job.salaryMax')}><NumberInput min={0} placeholder={t('workspace.max')} value={filters.salaryMax ? Number(filters.salaryMax) : null} onValueChange={(value) => apply({ salaryMax: value == null ? '' : String(value) })} aria-label={t('job.salaryMax')} /></FormField>
            </div>{data && new Set(data.items.map((job) => job.currency).filter(Boolean)).size === 1 && <small className={s.currencyNote}>{data.items[0]?.currency}</small>}</details>
            <details className={s.moreFilters} open={forceAdvancedOpen || undefined}><summary><JobsIcon kind="filter" />{t('workspace.moreFilters')}{advancedActiveCount > 0 && <span>{advancedActiveCount}</span>}<JobsIcon kind="chevron" /></summary>


          <CatalogRoleFilter value={filters.jobTitle} onChange={jobTitle => apply({ jobTitle })} />
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
                  {b.name}
                </label>
              )}
            />
          </FilterFieldset>

          <FilterFieldset legend={t('languages')} className="filter-group">
            <ExpandableList
              items={(() => {
                const byCode = new Map<string, LangMeta & { count?: number }>();
                for (const l of data?.facets?.languages || []) {
                  byCode.set(l.code, { id: l.code, code: l.code, name: l.name, count: l.count });
                }
                for (const l of languages) {
                  if (!byCode.has(l.code)) byCode.set(l.code, { ...l, count: undefined });
                  else {
                    const cur = byCode.get(l.code)!;
                    byCode.set(l.code, { ...cur, name: l.name || cur.name });
                  }
                }
                return [...byCode.values()].sort(
                  (a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name),
                );
              })()}
              initialCount={8}
              step={10}
              getKey={(l) => l.code}
              renderItem={(l) => (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={csvHasLanguageCode(filters.languages, l.code)}
                    onChange={() => apply({ languages: toggleLanguageCsv(filters.languages, l.code, 'B1') })}
                  />
                  {l.name}
                  {'count' in l && l.count !== undefined && (
                    <span className="facet-count">({l.count})</span>
                  )}
                </label>
              )}
            />
          </FilterFieldset>

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


              <FilterFieldset legend={t('workspace.employment')} className="filter-group"><select aria-label={t('workspace.employment')} value={filters.employmentType} onChange={(event) => apply({ employmentType: event.target.value })}><option value="">{t('any')}</option>{['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'].map((type) => <option key={type} value={type}>{enumLabel('employmentType', type)}</option>)}</select></FilterFieldset>
            </details>
            <div className={s.filterLegal}><Link href="/terms">{t('termsOfService')}</Link><Link href="/privacy">{t('privacyPolicy')}</Link></div>
          </div>
          <button className={s.showResults} type="button" onClick={() => setFiltersOpen(false)}>{t('workspace.showResults')} {data ? `(${data.total})` : ''}</button>
        </aside>}
        <section className={s.results} aria-label={t('jobs')} inert={filtersOpen ? true : undefined}>
          <div className={s.resultsToolbar}>{personalized ? <><div className={s.recommendationHeading}><strong>{t('workspace.personalized')}</strong><p>{recommendationMeta.mode === 'LATEST' ? t('workspace.latestOpeningsHint') : t('workspace.recommendationHint')}</p></div><button className={s.refreshButton} type="button" aria-label={t('workspace.refresh')} title={t('workspace.refresh')} disabled={resultsLoading} onClick={() => setDiscoveryRetry((value) => value + 1)}><JobsIcon kind="refresh" /></button></> : <><button ref={filterButtonRef} className={s.filterButton} type="button" onClick={() => setFiltersOpen(true)} aria-controls="jobs-filters" aria-expanded={filtersOpen}><JobsIcon kind="filter" />{t('filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</button><strong className={s.resultsCount}>{data?.total ?? '-'} <span>{t('jobs')}</span></strong><div className={s.resultControls}><WorkspaceSelect className={s.sortSelect} value={filters.sort} label={t('sortBy')} onChange={(sort) => apply({ sort })} options={['relevance', 'featured', 'newest', 'salary_high', 'salary_low', 'experience', ...(isEmployee ? ['match'] : [])].map((sort) => ({ value: sort, label: sort === 'experience' ? t('experience') : t({ relevance: 'job.sortRelevance', featured: 'job.sortFeatured', newest: 'job.sortNewest', salary_high: 'job.sortSalaryHigh', salary_low: 'job.sortSalaryLow', match: 'job.sortBestMatch' }[sort] || sort) }))} /></div></>}</div>
          {!personalized && !!activeChips.length && <div className={s.activeChips}>{activeChips.map((chip) => <button key={chip.key} type="button" onClick={chip.remove}>{chip.label}<JobsIcon kind="close" /></button>)}</div>}
          <div ref={listRef} className={s.resultsScroll} aria-busy={resultsLoading}>
            {saveError && <div className={s.error} role="alert">{saveError}</div>}
            {isEmployee && !personalized && !decidingMode && discovery.status !== 'loading' && (discovery.status === 'error' || !hasCareerSignal(profile) || !discovery.rows.length) && <div className={s.personalizeBanner}><JobsIcon kind="sparkles" /><div><strong>{t(discovery.status === 'error' ? 'workspace.recommendationError' : !hasCareerSignal(profile) ? 'workspace.unlockTitle' : 'workspace.noMatchesTitle')}</strong>{discovery.status !== 'error' && <p>{t(!hasCareerSignal(profile) ? 'workspace.unlockCopy' : 'workspace.noMatchesCopy')}</p>}</div>{discovery.status === 'error' ? <button type="button" className={s.textButton} onClick={() => setDiscoveryRetry((value) => value + 1)}>{t('workspace.retry')}</button> : <Link href="/dashboard/employee?tab=profile">{t('workspace.editProfile')}<JobsIcon kind="external" /></Link>}</div>}
            {resultsError && <div className={s.message} role="alert"><p>{resultsError}</p><button type="button" className={s.outlineButton} onClick={() => personalized ? setDiscoveryRetry((value) => value + 1) : setRetry((value) => value + 1)}>{t('workspace.retry')}</button></div>}
            {resultsLoading ? <div className={s.listSkeleton} role="status" aria-label={t('ui.loading')}>{Array.from({ length: 6 }, (_, index) => <div key={index}><i /><span /><span /><span /></div>)}</div> : !resultsError && visibleJobs.map((job) => <article key={job.id} data-job-impression={job.id} className={`${s.jobRow} ${selectedId === job.id ? s.selectedRow : ''}`}>
              <Link href={`/jobs/${job.id}`} className={s.jobLink} onClick={(event) => openJob(event, job.id)} aria-current={selectedId === job.id ? 'true' : undefined}>
                <span className={s.jobLogo}>{job.company.logoUrl ? <img src={job.company.logoUrl} alt="" loading="lazy" /> : job.company.name.charAt(0)}</span>
                <div className={s.jobCopy}><div className={s.rowHeading}><h2>{sanitizeMojibake(job.title)}</h2></div><p>{job.company.name}</p><div className={s.jobMeta}>{job.city?.name && <span><JobsIcon kind="pin" />{[job.city.name, countryForCity(job.city.slug)].filter(Boolean).join(', ')}</span>}{job.workMode && <span><JobsIcon kind="briefcase" />{enumLabel('workMode', job.workMode)}</span>}{job.employmentType && <span><JobsIcon kind="document" />{enumLabel('employmentType', job.employmentType)}</span>}</div><strong className={s.jobSalary}>{formatJobSalary(job, locale, t)}</strong></div>
              </Link>
              {(!session || isEmployee) && <button className={s.saveButton} type="button" aria-label={`${t('saveJob')}: ${job.title}`} aria-pressed={savedIds.has(job.id)} disabled={savingIds.has(job.id)} onClick={() => void toggleSaved(job.id)}><JobsIcon kind={savedIds.has(job.id) ? 'check' : 'bookmark'} /></button>}
            </article>)}
            {!resultsLoading && !resultsError && visibleJobs.length === 0 && (personalized ? <div className={s.discoveryEmpty}><JobsIcon kind="sparkles" /><h2>{t(hasCareerSignal(profile) ? 'workspace.noMatchesTitle' : 'workspace.unlockTitle')}</h2><p>{t(hasCareerSignal(profile) ? 'workspace.noMatchesCopy' : 'workspace.unlockCopy')}</p><div><button type="button" className={s.primaryButton} onClick={() => chooseMode('all')}>{t('workspace.allJobs')}</button><Link href="/dashboard/employee?tab=profile" className={s.outlineButton}>{t('workspace.editProfile')}</Link></div></div> : <div className={s.message}><JobsIcon kind="search" /><h2>{t('job.noResults')}</h2><button className={s.primaryButton} type="button" onClick={() => apply({ ...EMPTY, sort: implicitSort })}>{t('clearFilters')}</button></div>)}
            {personalized && !resultsLoading && !resultsError && visibleJobs.length > 0 && <div className={s.recommendationEnd}><span>{t('workspace.recommendationCount').replace('{n}', String(recommendationMeta.total))}</span><button type="button" className={s.textButton} onClick={() => chooseMode('all')}>{t('workspace.allJobs')} →</button></div>}
          </div>
          {personalized && recommendationMeta.total > 0 && <div className={s.pagination}><Pagination page={recommendationPage} totalPages={recommendationMeta.totalPages} total={recommendationMeta.total} limit={24} onPageChange={setRecommendationPage} disabled={resultsLoading} /></div>}
          {!personalized && !decidingMode && data && data.total > 0 && <div className={s.pagination}><WorkspaceSelect className={s.perPage} value={String(filters.limit)} label={t('resultsPerPage')} onChange={(limit) => apply({ limit: Number(limit) })} options={PAGE_SIZE_OPTIONS.map((count) => ({ value: String(count), label: t('job.perPage').replace('{n}', String(count)) }))} /><Pagination page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={(page) => { listScroll.current = 0; if (listRef.current) listRef.current.scrollTop = 0; apply({ page }); }} disabled={loading} jumpWhenAbove={1000} truncatedNote={data.truncated ? t('job.truncatedNote').replace('{n}', String(data.total)).replace('{m}', String(data.matchedTotal ?? data.total)) : null} /></div>}
        </section>
        <aside className={s.previewPane} aria-label={t('workspace.details')} inert={filtersOpen ? true : undefined}>
          {selectedId ? <JobDetailClient key={`${selectedId}:${locale}`} jobId={selectedId} embedded country={countryForCity(selectedJob?.city?.slug, selectedJob?.city?.name)} onBack={closeJob} saveState={{ saved: savedIds.has(selectedId), pending: savingIds.has(selectedId), onToggle: () => toggleSaved(selectedId) }} /> : <div className={s.previewEmpty}><JobsIcon kind="document" /><p>{t('workspace.choose')}</p></div>}
        </aside>
      </div>
    </div>
  );
}

export default function JobsPage() {
  return <Suspense fallback={<div className="shell"><JobListSkeleton count={6} /></div>}><JobsInner /></Suspense>;
}
