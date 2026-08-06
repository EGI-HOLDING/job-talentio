'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { FilterFieldset, FormAlert, LabelText } from '@/components/ui/Field';

type Tab = 'jobs' | 'pipeline' | 'candidates' | 'analytics' | 'company';

const STAGES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const;
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

function buildCandPageItems(page: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: Array<number | '…'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push('…');
  items.push(totalPages);
  return items;
}

/** Distinguish same-title openings by location + status in selects */
function jobSelectLabel(j: {
  title: string;
  status?: string;
  workMode?: string | null;
  city?: { name: string } | null;
}) {
  const location = jobLocationLabel(j);
  const status = j.status && j.status !== 'PUBLISHED' ? ` · ${j.status}` : '';
  return `${j.title} — ${location}${status}`;
}

export default function RecruiterDashboard() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('jobs');
  const [memberships, setMemberships] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState('');
  const [applicants, setApplicants] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [candidates, setCandidates] = useState<any>(null);
  const [candFilters, setCandFilters] = useState<CandFilters>(DEFAULT_CAND_FILTERS);
  const [candLoading, setCandLoading] = useState(false);
  const [skillQ, setSkillQ] = useState('');
  const [meta, setMeta] = useState<{ cities: any[]; skills: any[]; categories: any[]; benefits: any[]; languages: any[] }>({
    cities: [],
    skills: [],
    categories: [],
    benefits: [],
    languages: [],
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [breakdownId, setBreakdownId] = useState<string | null>(null);
  const [industries, setIndustries] = useState<any[]>([]);

  const company = useMemo(
    () => memberships.find((m) => m.companyId === companyId)?.company,
    [memberships, companyId],
  );

  function applyCand(patch: Partial<CandFilters>) {
    setCandFilters((prev) => {
      const next = { ...prev, ...patch };
      if (!('page' in patch)) next.page = 1;
      if (next.matchJobId && next.sort !== 'match' && patch.matchJobId !== undefined) {
        next.sort = 'match';
      }
      if (!next.matchJobId && next.sort === 'match') next.sort = 'relevance';
      return next;
    });
  }

  async function bootstrap() {
    const session = getSession();
    if (!session || (session.user.role !== 'RECRUITER' && session.user.role !== 'SUPER_ADMIN')) {
      window.location.href = '/login';
      return;
    }
    const [mine, cities, skills, categories, benefits, inds, langs] = await Promise.all([
      api<any[]>('/companies/mine'),
      api('/meta/cities', { auth: false }),
      api('/meta/skills', { auth: false }),
      api('/meta/categories', { auth: false }),
      api('/meta/benefits', { auth: false }),
      api('/meta/industries', { auth: false }).catch(() => []),
      api('/meta/languages', { auth: false }).catch(() => []),
    ]);
    setMemberships(mine);
    setMeta({
      cities: cities as any[],
      skills: skills as any[],
      categories: categories as any[],
      benefits: benefits as any[],
      languages: langs as any[],
    });
    setIndustries(inds as any[]);
    const first = mine[0]?.companyId;
    if (first) {
      setCompanyId(first);
      await loadJobs(first);
    }
  }

  async function loadJobs(cid: string) {
    const list = await api<any[]>(`/jobs/company/${cid}`);
    setJobs(list);
    if (list[0] && !selectedJob) {
      setSelectedJob(list[0].id);
      await loadJobData(list[0].id);
    }
  }

  async function loadJobData(jobId: string) {
    if (!jobId) return;
    const [apps, reco, st] = await Promise.all([
      api<any[]>(`/applications/jobs/${jobId}?sort=match`),
      api(`/jobs/${jobId}/recommended-candidates`).catch(() => []),
      api(`/jobs/${jobId}/stats`).catch(() => null),
    ]);
    setApplicants(apps);
    setRecommended(reco as any[]);
    setStats(st);
  }

  useEffect(() => {
    bootstrap().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (selectedJob) loadJobData(selectedJob).catch((e) => setError(e.message));
  }, [selectedJob]);

  async function createJob(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const skillSlugs = String(fd.get('skills') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await api(`/jobs/company/${companyId}`, {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        description: fd.get('description'),
        citySlug: fd.get('citySlug') || undefined,
        categorySlug: fd.get('categorySlug') || undefined,
        experienceLevel: fd.get('experienceLevel') || undefined,
        experienceYearsMin: fd.get('experienceYearsMin')
          ? Number(fd.get('experienceYearsMin'))
          : null,
        salaryMin: fd.get('salaryMin') ? Number(fd.get('salaryMin')) : null,
        salaryMax: fd.get('salaryMax') ? Number(fd.get('salaryMax')) : null,
        workMode: fd.get('workMode') || 'ONSITE',
        skills: skillSlugs.map((slug) => ({ slug, isRequired: true, weight: 1 })),
        benefitSlugs: String(fd.get('benefits') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    setMsg('Job created as DRAFT');
    await loadJobs(companyId);
  }

  async function publish(jobId: string) {
    await api(`/jobs/${jobId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'PUBLISHED' }),
    });
    setMsg('Job published');
    await loadJobs(companyId);
  }

  async function setStatus(appId: string, status: string) {
    await api(`/applications/${appId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await loadJobData(selectedJob);
  }

  async function scheduleInterview(e: FormEvent<HTMLFormElement>, appId: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api(`/applications/${appId}/interviews`, {
      method: 'POST',
      body: JSON.stringify({
        scheduledAt: fd.get('scheduledAt'),
        meetingUrl: fd.get('meetingUrl'),
        note: fd.get('note'),
      }),
    });
    setMsg('Interview scheduled');
    await loadJobData(selectedJob);
  }

  async function updateCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api(`/companies/${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: fd.get('name'),
        description: fd.get('description') || undefined,
        website: fd.get('website') || '',
        citySlug: fd.get('citySlug') || undefined,
        industrySlug: fd.get('industrySlug') || undefined,
        size: fd.get('size') || undefined,
      }),
    });
    setMsg('Company profile updated');
    const mine = await api<any[]>('/companies/mine');
    setMemberships(mine);
  }

  async function fetchCandidates(f: CandFilters = candFilters) {
    setCandLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.q) params.set('q', f.q);
      if (f.city) params.set('city', f.city);
      if (f.skills) params.set('skills', f.skills);
      if (f.skillMode) params.set('skillMode', f.skillMode);
      if (f.degree) params.set('degree', f.degree);
      if (f.languages) params.set('languages', f.languages);
      if (f.experienceYearsMin) params.set('experienceYearsMin', f.experienceYearsMin);
      if (f.experienceYearsMax) params.set('experienceYearsMax', f.experienceYearsMax);
      if (f.hasCertification) params.set('hasCertification', 'true');
      if (f.matchJobId) params.set('matchJobId', f.matchJobId);
      params.set('sort', f.matchJobId ? 'match' : f.sort);
      params.set('page', String(f.page));
      params.set('limit', String(f.limit));
      const data = await api(`/profiles/candidates?${params.toString()}`);
      setCandidates(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates');
    } finally {
      setCandLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== 'candidates') return;
    fetchCandidates(candFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, candFilters]);

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of STAGES) map[s] = [];
    for (const a of applicants) {
      (map[a.status] || (map[a.status] = [])).push(a);
    }
    return map;
  }, [applicants]);

  const selectedCandCities = candFilters.city.split(',').filter(Boolean);
  const selectedCandSkills = candFilters.skills.split(',').filter(Boolean);
  const selectedCandLangs = candFilters.languages.split(',').filter(Boolean);
  const filteredSkills = meta.skills
    .filter((s) => !skillQ || s.name.toLowerCase().includes(skillQ.toLowerCase()))
    .slice(0, 25);
  const cityFacet = Object.fromEntries((candidates?.facets?.cities || []).map((c: any) => [c.slug, c.count]));
  const skillFacet = Object.fromEntries((candidates?.facets?.skills || []).map((s: any) => [s.slug, s.count]));
  const candTotalPages = candidates?.totalPages || Math.max(1, Math.ceil((candidates?.total || 0) / candFilters.limit));
  const candPageItems = buildCandPageItems(candFilters.page, candTotalPages);

  return (
    <div className="shell dash-grid">
      <aside className="dash-nav">
        {(
          [
            ['jobs', 'Jobs'],
            ['pipeline', 'Pipeline & match'],
            ['candidates', 'Find talent'],
            ['analytics', 'Analytics'],
            ['company', 'Company'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        {memberships.length > 1 && (
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              loadJobs(e.target.value);
            }}
            aria-label="Company"
            style={{ marginTop: '0.75rem' }}
          >
            {memberships.map((m) => (
              <option key={m.companyId} value={m.companyId}>
                {m.company.name}
              </option>
            ))}
          </select>
        )}
      </aside>

      <section>
        {error && <FormAlert>{error}</FormAlert>}
        {msg && <FormAlert tone="success">{msg}</FormAlert>}

        {tab === 'jobs' && (
          <div className="grid-2">
            <div className="card">
              <h3>Create job</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={createJob}>
                <label>
                  <LabelText required>Title</LabelText>
                  <input name="title" required minLength={3} />
                </label>
                <label>
                  <LabelText required>Description</LabelText>
                  <textarea name="description" rows={5} required minLength={20} />
                </label>
                <label>
                  <LabelText>City</LabelText>
                  <select name="citySlug">
                    <option value="">—</option>
                    {meta.cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>Category</LabelText>
                  <select name="categorySlug">
                    <option value="">—</option>
                    {meta.categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>Level</LabelText>
                  <select name="experienceLevel">
                    <option value="">—</option>
                    {['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>Min years</LabelText>
                  <input name="experienceYearsMin" type="number" />
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>Salary min</LabelText>
                    <input name="salaryMin" type="number" />
                  </label>
                  <label>
                    <LabelText>Salary max</LabelText>
                    <input name="salaryMax" type="number" />
                  </label>
                </div>
                <label>
                  <LabelText>Work mode</LabelText>
                  <select name="workMode" defaultValue="HYBRID">
                    <option>ONSITE</option>
                    <option>HYBRID</option>
                    <option>REMOTE</option>
                  </select>
                </label>
                <p className="muted" style={{ fontSize: '0.78rem', margin: '-0.35rem 0 0.5rem' }}>
                  Remote: city is optional (hiring region/timezone hub). Onsite/Hybrid: city required before publish.
                </p>
                <label>
                  <LabelText>Skill slugs (comma)</LabelText>
                  <input name="skills" placeholder="typescript,react,nestjs" />
                </label>
                <label>
                  <LabelText>Benefit slugs (comma)</LabelText>
                  <input name="benefits" placeholder="health-insurance,remote-work" />
                </label>
                <button type="submit">Create draft</button>
              </form>
            </div>
            <div>
              <h2 className="section-title">Your jobs</h2>
              {jobs.map((j) => (
                <div key={j.id} className="card" style={{ marginBottom: '0.5rem' }}>
                  <strong>{j.title}</strong>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>
                    {j.status} · {jobLocationLabel(j)} · {j._count?.applications ?? 0} apps · {j._count?.views ?? 0} views
                  </p>
                  <div className="chips">
                    {j.status === 'DRAFT' && (
                      <button type="button" className="chip active" onClick={() => publish(j.id)}>
                        Publish
                      </button>
                    )}
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setSelectedJob(j.id);
                        setTab('pipeline');
                      }}
                    >
                      Pipeline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'pipeline' && (
          <div className="pipeline-page">
            <div className="pipeline-toolbar">
              <h2 className="section-title" style={{ margin: 0 }}>
                Pipeline & candidate matching
              </h2>
              <select
                value={selectedJob}
                onChange={(e) => setSelectedJob(e.target.value)}
                className="job-select"
                title="Select job post"
                aria-label="Select job post"
              >
                {jobs.length === 0 && <option value="">No jobs yet</option>}
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobSelectLabel(j)}
                  </option>
                ))}
              </select>
            </div>

            <div className="pipeline">
              {STAGES.map((stage) => (
                <div key={stage} className="pipeline-col">
                  <h4>
                    {stage} ({byStage[stage]?.length || 0})
                  </h4>
                  {(byStage[stage] || []).map((a) => (
                    <div key={a.id} className="candidate-card">
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="avatar avatar-sm"
                          src={a.profile?.user?.avatarUrl || ''}
                          alt=""
                        />
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <strong style={{ fontSize: '0.9rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.profile?.user?.fullName}
                          </strong>
                          <div className="muted" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.profile?.headline}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="badge match"
                        style={{ marginTop: '0.5rem', border: 0, width: '100%' }}
                        onClick={() => setBreakdownId(breakdownId === a.id ? null : a.id)}
                      >
                        Match {a.matchScore ?? '—'}%
                      </button>
                      {breakdownId === a.id && a.matchBreakdown && (
                        <div style={{ fontSize: '0.75rem', marginTop: '0.35rem', color: 'var(--text)' }}>
                          <div>Skills: {a.matchBreakdown.skills}</div>
                          <div>Experience: {a.matchBreakdown.experience}</div>
                          <div>Location: {a.matchBreakdown.location}</div>
                          <div>Education: {a.matchBreakdown.education}</div>
                          <div>Language: {a.matchBreakdown.language}</div>
                        </div>
                      )}
                      <div className="match-bar">
                        <span style={{ width: `${a.matchScore || 0}%` }} />
                      </div>
                      <div className="chips" style={{ marginTop: '0.5rem' }}>
                        <Link href={`/candidates/${a.profile?.id}?matchJobId=${selectedJob}`} className="chip" style={{ fontSize: '0.72rem' }}>
                          View profile
                        </Link>
                        <Link href={`/messages?peer=${a.profile?.user?.id}&job=${selectedJob}`} className="chip" style={{ fontSize: '0.72rem' }}>
                          💬 Chat
                        </Link>
                      </div>
                      <select
                        style={{ marginTop: '0.5rem', fontSize: '0.8rem', width: '100%' }}
                        value={a.status}
                        onChange={(e) => setStatus(a.id, e.target.value)}
                        aria-label={`Status for ${a.profile?.user?.fullName || 'applicant'}`}
                      >
                        {STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      {stage === 'INTERVIEW' || stage === 'IN_REVIEW' ? (
                        <form
                          style={{ marginTop: '0.5rem', display: 'grid', gap: '0.25rem' }}
                          onSubmit={(e) => scheduleInterview(e, a.id)}
                        >
                          <label>
                            <LabelText required>Interview time</LabelText>
                            <input name="scheduledAt" type="datetime-local" required style={{ fontSize: '0.75rem', width: '100%' }} />
                          </label>
                          <label>
                            <LabelText>Meeting URL</LabelText>
                            <input name="meetingUrl" placeholder="Meet URL" style={{ fontSize: '0.75rem', width: '100%' }} />
                          </label>
                          <button type="submit" style={{ padding: '0.35rem', fontSize: '0.75rem' }}>
                            Schedule interview
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <h3 className="section-title" style={{ marginTop: '1.5rem' }}>
              Recommended candidates (not yet applied)
            </h3>
            <div className="pipeline-reco">
              {recommended.map((r) => (
                <div key={r.profile.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.profile.user.fullName}
                      </strong>
                      <p className="muted" style={{ margin: '0.25rem 0' }}>{r.profile.headline}</p>
                      <div className="chips">
                        {(r.profile.skills || []).slice(0, 5).map((s: any) => (
                          <span key={s.slug} className="badge skill">
                            {s.name}
                          </span>
                        ))}
                      </div>
                      <div className="chips" style={{ marginTop: '0.5rem' }}>
                        <Link href={`/candidates/${r.profile.id}?matchJobId=${selectedJob}`} className="chip" style={{ fontSize: '0.75rem' }}>
                          View profile
                        </Link>
                        <Link href={`/messages?peer=${r.profile.user.id}&job=${selectedJob}`} className="chip" style={{ fontSize: '0.75rem' }}>
                          💬 Chat
                        </Link>
                      </div>
                    </div>
                    <div className="match-ring">{r.matchScore}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'candidates' && (
          <div>
            <div className="jobs-toolbar" style={{ marginBottom: '1rem' }}>
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>
                  Find talent
                </h2>
                <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                  {candLoading
                    ? 'Loading candidates…'
                    : `${candidates?.total ?? 0} candidates found`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={candFilters.sort}
                  onChange={(e) =>
                    applyCand({ sort: e.target.value as CandFilters['sort'] })
                  }
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
                  <button type="button" className="secondary" onClick={() => setCandFilters(DEFAULT_CAND_FILTERS)}>
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
                    <input name="q" defaultValue={candFilters.q} key={candFilters.q} placeholder="Name, headline, skill…" />
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
                  {meta.cities.slice(0, 12).map((c) => (
                    <label key={c.slug} className="filter-check">
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
                  ))}
                </FilterFieldset>

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
                      placeholder="Filter skills…"
                    />
                  </label>
                  {filteredSkills.map((s) => (
                    <label key={s.slug} className="filter-check">
                      <input
                        type="checkbox"
                        checked={selectedCandSkills.includes(s.slug)}
                        onChange={() => applyCand({ skills: toggleCsv(candFilters.skills, s.slug) })}
                      />
                      <LabelText optional={false}>{s.name}</LabelText>
                      {skillFacet[s.slug] !== undefined && (
                        <span className="facet-count">({skillFacet[s.slug]})</span>
                      )}
                    </label>
                  ))}
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
                    <select
                      value={candFilters.degree}
                      onChange={(e) => applyCand({ degree: e.target.value })}
                    >
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
                  {meta.languages.map((l) => (
                    <label key={l.code} className="filter-check">
                      <input
                        type="checkbox"
                        checked={selectedCandLangs.includes(l.code)}
                        onChange={() =>
                          applyCand({ languages: toggleCsv(candFilters.languages, l.code) })
                        }
                      />
                      <LabelText optional={false}>{l.name}</LabelText>
                    </label>
                  ))}
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
              </aside>

              <div>
                {candLoading && !candidates && (
                  <p className="muted">Loading candidates…</p>
                )}
                {!candLoading && (candidates?.items || []).length === 0 && (
                  <div className="card">
                    <p className="muted" style={{ margin: 0 }}>
                      No candidates match these filters. Try clearing filters or broadening skills/city.
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
                        <span>{p.headline || '—'}</span>
                        {p.city?.name && <span>{p.city.name}</span>}
                        <span>{p.experienceYears ?? 0}y exp</span>
                        {p.contactsBlurred && <span>🔒 Contacts limited</span>}
                      </div>
                      <div className="chips" style={{ marginTop: '0.45rem' }}>
                        {(p.skills || []).slice(0, 6).map((s: any) => (
                          <span key={s.id} className="badge skill">
                            {s.skill?.name}
                            {s.level ? ` · ${s.level}` : ''}
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
                        <Link
                          href={`/messages?peer=${p.user?.id}${candFilters.matchJobId ? `&job=${candFilters.matchJobId}` : ''}`}
                          className="chip"
                          style={{ fontSize: '0.75rem' }}
                        >
                          💬 Chat
                        </Link>
                      </div>
                    </div>
                    {p.matchScore != null && <div className="match-ring">{p.matchScore}%</div>}
                  </div>
                ))}

                {candTotalPages > 1 && (
                  <div className="pagination" style={{ marginTop: '1.25rem' }}>
                    <span className="pagination-range">
                      Page {candFilters.page} of {candTotalPages}
                    </span>
                    <div className="pagination-pages">
                      <button
                        type="button"
                        className="pagination-page"
                        disabled={candFilters.page <= 1}
                        onClick={() => applyCand({ page: candFilters.page - 1 })}
                      >
                        ‹
                      </button>
                      {candPageItems.map((item, idx) =>
                        item === '…' ? (
                          <span key={`e-${idx}`} className="pagination-ellipsis">
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            className={`pagination-page${candFilters.page === item ? ' active' : ''}`}
                            onClick={() => applyCand({ page: item as number })}
                          >
                            {item}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        className="pagination-page"
                        disabled={candFilters.page >= candTotalPages}
                        onClick={() => applyCand({ page: candFilters.page + 1 })}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'analytics' && (
          <div className="grid-2">
            <div className="card">
              <h3>Job analytics</h3>
              <select
                value={selectedJob}
                onChange={(e) => setSelectedJob(e.target.value)}
                className="job-select"
                title="Select job post"
                aria-label="Select job post"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobSelectLabel(j)}
                  </option>
                ))}
              </select>
              {stats && (
                <div style={{ marginTop: '1rem' }}>
                  <p>
                    <strong>{stats.views}</strong> views
                  </p>
                  <p>
                    <strong>{stats.totalApplications}</strong> applications
                  </p>
                  <ul>
                    {Object.entries(stats.applicationsByStatus || {}).map(([k, v]) => (
                      <li key={k}>
                        {k}: {String(v)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="card">
              <h3>Plan</h3>
              <p>
                Current plan: <strong>{company?.subscription?.plan || 'FREE'}</strong>
              </p>
              <p className="muted">Upgrade via billing endpoints / admin for local MVP.</p>
            </div>
          </div>
        )}

        {tab === 'company' && company && (
          <div className="grid-2">
            <div className="card">
              <h2 className="section-title">{company.name}</h2>
              <p className="muted">{company.description}</p>
              <p>
                Members: {company._count?.members} · Jobs: {company._count?.jobPosts} · Followers:{' '}
                {company._count?.followers}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Public page: <a href={`/companies/${company.slug}`}>/companies/{company.slug}</a>
              </p>
            </div>
            <div className="card">
              <h3>Edit company profile</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={updateCompany} key={company.id}>
                <label>
                  <LabelText required>Name</LabelText>
                  <input name="name" defaultValue={company.name} required minLength={2} />
                </label>
                <label>
                  <LabelText>Description</LabelText>
                  <textarea name="description" rows={4} defaultValue={company.description || ''} />
                </label>
                <label>
                  <LabelText>Website</LabelText>
                  <input name="website" type="url" defaultValue={company.website || ''} placeholder="https://…" />
                </label>
                <label>
                  <LabelText>City</LabelText>
                  <select name="citySlug" defaultValue={company.city?.slug || ''}>
                    <option value="">—</option>
                    {meta.cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>Industry</LabelText>
                  <select name="industrySlug" defaultValue={company.industry?.slug || ''}>
                    <option value="">—</option>
                    {industries.map((i) => (
                      <option key={i.slug} value={i.slug}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>Company size</LabelText>
                  <select name="size" defaultValue={company.size || ''}>
                    <option value="">—</option>
                    <option value="SIZE_1_10">1–10</option>
                    <option value="SIZE_11_50">11–50</option>
                    <option value="SIZE_51_200">51–200</option>
                    <option value="SIZE_201_1000">201–1000</option>
                    <option value="SIZE_1000_PLUS">1000+</option>
                  </select>
                </label>
                <button type="submit">Save company</button>
              </form>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
