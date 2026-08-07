'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { FilterFieldset, FormAlert, LabelText } from '@/components/ui/Field';
import { ExpandableList } from '@/components/ui/ExpandableList';
import { AdvancedFiltersPanel } from '@/components/ui/AdvancedFiltersPanel';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { CandidateListSkeleton } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { MatchRing } from '@/components/ui/MatchRing';

type Tab = 'jobs' | 'pipeline' | 'candidates' | 'analytics' | 'company';

const STAGES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
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

function RecruiterDashboard() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const jobFromUrl = searchParams.get('job') || '';
  const [tab, setTab] = useState<Tab>(() => (jobFromUrl ? 'pipeline' : 'jobs'));
  const [memberships, setMemberships] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState(jobFromUrl);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [candidates, setCandidates] = useState<any>(null);
  const [candFilters, setCandFilters] = useState<CandFilters>(DEFAULT_CAND_FILTERS);
  const [candLoading, setCandLoading] = useState(false);
  const [skillQ, setSkillQ] = useState('');
  const [draftJobSkills, setDraftJobSkills] = useState<Array<{ slug: string; name: string }>>([]);
  const [draftJobBenefits, setDraftJobBenefits] = useState<Array<{ slug: string; name: string }>>([]);
  const [meta, setMeta] = useState<{ cities: any[]; skills: any[]; categories: any[]; benefits: any[]; languages: any[] }>({
    cities: [],
    skills: [],
    categories: [],
    benefits: [],
    languages: [],
  });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState<'success' | 'error'>('success');
  const [breakdownId, setBreakdownId] = useState<string | null>(null);
  const [industries, setIndustries] = useState<any[]>([]);

  const company = useMemo(
    () => memberships.find((m) => m.companyId === companyId)?.company,
    [memberships, companyId],
  );
  const planCode = (company?.subscription?.plan || 'FREE') as 'FREE' | 'STANDARD' | 'PREMIUM';
  const canColdChat = planCode === 'PREMIUM';

  function flash(message: string, tone: 'success' | 'error' = 'success') {
    setMsgTone(tone);
    setMsg(message);
  }

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
      api('/meta/skills?sort=popular&take=120', { auth: false }),
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
    const preferred =
      (jobFromUrl && list.some((j) => j.id === jobFromUrl) && jobFromUrl) ||
      (selectedJob && list.some((j) => j.id === selectedJob) && selectedJob) ||
      list[0]?.id ||
      '';
    if (preferred && preferred !== selectedJob) {
      setSelectedJob(preferred);
    } else if (preferred) {
      await loadJobData(preferred);
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
        skills: draftJobSkills.map((s) =>
          s.slug
            ? { slug: s.slug, isRequired: true, weight: 1 }
            : { name: s.name, isRequired: true, weight: 1 },
        ),
        benefits: draftJobBenefits.map((b) =>
          b.slug ? { slug: b.slug } : { name: b.name },
        ),
      }),
    });
    setDraftJobSkills([]);
    setDraftJobBenefits([]);
    flash('Job created as DRAFT');
    await loadJobs(companyId);
  }

  async function changeJobStatus(jobId: string, status: string, okMsg: string) {
    try {
      await api(`/jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      flash(okMsg, 'success');
      await loadJobs(companyId);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to update job status', 'error');
    }
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
    flash('Interview scheduled');
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
    flash('Company profile updated');
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
      const data = await api<any>(`/profiles/candidates?${params.toString()}`);
      setCandidates(data);
      if (data?.page != null && data.page !== f.page) {
        setCandFilters((prev) => ({ ...prev, page: data.page as number }));
      }
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
        {msg && <FormAlert tone={msgTone}>{msg}</FormAlert>}

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
                <div>
                  <LabelText>Skills</LabelText>
                  <div className="chips" style={{ margin: '0.4rem 0' }}>
                    {draftJobSkills.map((s) => (
                      <span key={s.slug || s.name} className="badge">
                        {s.name}
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 6, padding: 0 }}
                          onClick={() =>
                            setDraftJobSkills((prev) =>
                              prev.filter((x) => (x.slug || x.name) !== (s.slug || s.name)),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <SkillCombobox
                    levelSelect={false}
                    submitLabel="Add skill to job"
                    onPick={(skill) => {
                      setDraftJobSkills((prev) => {
                        const key = skill.slug || skill.name;
                        if (prev.some((p) => (p.slug || p.name) === key)) return prev;
                        return [...prev, { slug: skill.slug, name: skill.name }];
                      });
                    }}
                  />
                </div>
                <div>
                  <LabelText>Benefits</LabelText>
                  <div className="chips" style={{ margin: '0.4rem 0' }}>
                    {draftJobBenefits.map((b) => (
                      <span key={b.slug || b.name} className="badge">
                        {b.name}
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 6, padding: 0 }}
                          onClick={() =>
                            setDraftJobBenefits((prev) =>
                              prev.filter((x) => (x.slug || x.name) !== (b.slug || b.name)),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <LookupCombobox
                    kind="benefits"
                    allowCreate
                    submitLabel={t('addBenefit')}
                    placeholder={t('benefitSearchPlaceholder')}
                    onPick={(item) => {
                      setDraftJobBenefits((prev) => {
                        const key = item.slug || item.name;
                        if (prev.some((p) => (p.slug || p.name) === key)) return prev;
                        return [...prev, { slug: item.slug, name: item.name }];
                      });
                    }}
                  />
                </div>
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
                      <button
                        type="button"
                        className="chip active"
                        onClick={() => changeJobStatus(j.id, 'PUBLISHED', 'Job published')}
                      >
                        Publish
                      </button>
                    )}
                    {(j.status === 'CLOSED' || j.status === 'PAUSED') && (
                      <button
                        type="button"
                        className="chip active"
                        onClick={() =>
                          changeJobStatus(
                            j.id,
                            'PUBLISHED',
                            j.status === 'CLOSED' ? 'Job reopened' : 'Job resumed',
                          )
                        }
                      >
                        {j.status === 'CLOSED' ? 'Reopen' : 'Resume'}
                      </button>
                    )}
                    {j.status === 'PUBLISHED' && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => changeJobStatus(j.id, 'PAUSED', 'Job paused')}
                      >
                        Pause
                      </button>
                    )}
                    {(j.status === 'DRAFT' || j.status === 'PUBLISHED' || j.status === 'PAUSED') && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => changeJobStatus(j.id, 'CLOSED', 'Job closed')}
                      >
                        Close
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
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>
                  Pipeline & matching
                </h2>
                <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.9rem' }}>
                  Move applicants through stages and review match scores for this job.
                </p>
              </div>
              <label style={{ display: 'grid', gap: '0.3rem' }}>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Job post
                </span>
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
              </label>
            </div>

            {!selectedJob ? (
              <div className="card">
                <p className="muted" style={{ margin: 0 }}>
                  Create or select a job post to open the pipeline.
                </p>
              </div>
            ) : (
              <>
                <div className="pipeline">
                  {STAGES.map((stage) => {
                    const cards = byStage[stage] || [];
                    return (
                      <div key={stage} className="pipeline-col">
                        <h4>
                          <span>{STAGE_LABEL[stage]}</span>
                          <span className="pipeline-col-count">{cards.length}</span>
                        </h4>
                        {cards.length === 0 && (
                          <div className="pipeline-empty">No candidates</div>
                        )}
                        {cards.map((a) => {
                          const name = a.profile?.user?.fullName || 'Candidate';
                          const avatar =
                            a.profile?.user?.avatarUrl ||
                            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;
                          const score = a.matchScore != null ? Math.round(a.matchScore) : null;
                          return (
                            <div key={a.id} className="candidate-card">
                              <div className="candidate-card-head">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className="avatar avatar-sm" src={avatar} alt="" />
                                <div className="candidate-card-meta">
                                  <strong
                                    style={{
                                      fontSize: '0.9rem',
                                      display: 'block',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {name}
                                  </strong>
                                  <div
                                    className="muted"
                                    style={{
                                      fontSize: '0.75rem',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {a.profile?.headline || '—'}
                                  </div>
                                </div>
                                {score != null && <MatchRing score={score} size="sm" />}
                              </div>
                              {score != null && (
                                <>
                                  <button
                                    type="button"
                                    className="badge match"
                                    style={{ marginTop: '0.55rem', border: 0, width: '100%', cursor: 'pointer' }}
                                    onClick={() => setBreakdownId(breakdownId === a.id ? null : a.id)}
                                  >
                                    Match {score}% · details
                                  </button>
                                  {breakdownId === a.id && a.matchBreakdown && (
                                    <div className="match-breakdown">
                                      {(
                                        [
                                          ['Skills', a.matchBreakdown.skills],
                                          ['Experience', a.matchBreakdown.experience],
                                          ['Location', a.matchBreakdown.location],
                                          ['Education', a.matchBreakdown.education],
                                          ['Language', a.matchBreakdown.language],
                                        ] as const
                                      ).map(([label, value]) => (
                                        <div key={label} className="match-breakdown-row">
                                          <span className="muted">{label}</span>
                                          <div className="match-breakdown-track">
                                            <i style={{ width: `${Math.round(Number(value) || 0)}%` }} />
                                          </div>
                                          <span>{Math.round(Number(value) || 0)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="match-bar">
                                    <span style={{ width: `${score}%` }} />
                                  </div>
                                </>
                              )}
                              <div className="chips" style={{ marginTop: '0.55rem' }}>
                                <Link
                                  href={`/candidates/${a.profile?.id}?matchJobId=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.72rem' }}
                                >
                                  View profile
                                </Link>
                                <Link
                                  href={`/messages?peer=${a.profile?.user?.id}&job=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.72rem' }}
                                >
                                  Chat
                                </Link>
                              </div>
                              <select
                                style={{ marginTop: '0.5rem', fontSize: '0.8rem', width: '100%' }}
                                value={a.status}
                                onChange={(e) => setStatus(a.id, e.target.value)}
                                aria-label={`Status for ${name}`}
                              >
                                {STAGES.map((s) => (
                                  <option key={s} value={s}>
                                    {STAGE_LABEL[s]}
                                  </option>
                                ))}
                              </select>
                              {stage === 'INTERVIEW' || stage === 'IN_REVIEW' ? (
                                <form
                                  style={{ marginTop: '0.5rem', display: 'grid', gap: '0.25rem' }}
                                  onSubmit={(e) => scheduleInterview(e, a.id)}
                                >
                                  <label>
                                    <LabelText required>Interview time</LabelText>
                                    <input
                                      name="scheduledAt"
                                      type="datetime-local"
                                      required
                                      style={{ fontSize: '0.75rem', width: '100%' }}
                                    />
                                  </label>
                                  <label>
                                    <LabelText>Meeting URL</LabelText>
                                    <input
                                      name="meetingUrl"
                                      placeholder="Meet URL"
                                      style={{ fontSize: '0.75rem', width: '100%' }}
                                    />
                                  </label>
                                  <button type="submit" style={{ padding: '0.35rem', fontSize: '0.75rem' }}>
                                    Schedule interview
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                <div className="pipeline-section-head">
                  <div>
                    <h3 className="section-title" style={{ margin: 0 }}>
                      Recommended candidates
                    </h3>
                    <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                      Strong matches who have not applied yet.
                    </p>
                  </div>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {recommended.length} suggested
                  </span>
                </div>
                {recommended.length === 0 ? (
                  <div className="card">
                    <p className="muted" style={{ margin: 0 }}>
                      No recommendations yet. Add required skills on the job post to improve matching.
                    </p>
                  </div>
                ) : (
                  <div className="pipeline-reco">
                    {recommended.map((r) => {
                      const name = r.profile.user.fullName;
                      const avatar =
                        r.profile.user.avatarUrl ||
                        `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;
                      return (
                        <div key={r.profile.id} className="card pipeline-reco-card">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className="avatar" src={avatar} alt="" style={{ width: 44, height: 44 }} />
                          <div className="card-body">
                            <strong
                              style={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {name}
                            </strong>
                            <p
                              className="muted"
                              style={{
                                margin: '0.2rem 0 0.45rem',
                                fontSize: '0.85rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {r.profile.headline || '—'}
                            </p>
                            <div className="chips">
                              {(r.profile.skills || []).slice(0, 4).map((s: any) => (
                                <span key={s.slug || s.name} className="badge skill">
                                  {s.name}
                                </span>
                              ))}
                            </div>
                              <div className="chips" style={{ marginTop: '0.55rem' }}>
                                <Link
                                  href={`/candidates/${r.profile.id}?matchJobId=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  View profile
                                </Link>
                              {canColdChat ? (
                                <Link
                                  href={`/messages?peer=${r.profile.user.id}&job=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  Chat
                                </Link>
                              ) : (
                                <span
                                  className="chip muted"
                                  title="Cold outreach requires Premium"
                                  style={{ fontSize: '0.75rem', cursor: 'not-allowed', opacity: 0.7 }}
                                >
                                  Chat (Premium)
                                </span>
                              )}
                            </div>
                          </div>
                          <MatchRing score={r.matchScore} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
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
                  {candLoading && !candidates
                    ? 'Searching talent…'
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
                        placeholder="Filter skills…"
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
                          {s.count !== undefined && (
                            <span className="facet-count">({s.count})</span>
                          )}
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
                            onChange={() =>
                              applyCand({ languages: toggleCsv(candFilters.languages, l.code) })
                            }
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
                        {p.contactsBlurred && <span>Contacts limited</span>}
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
                        {canColdChat ? (
                          <Link
                            href={`/messages?peer=${p.user?.id}${candFilters.matchJobId ? `&job=${candFilters.matchJobId}` : ''}`}
                            className="chip"
                            style={{ fontSize: '0.75rem' }}
                          >
                            Chat
                          </Link>
                        ) : (
                          <span
                            className="chip muted"
                            title="Cold outreach requires Premium"
                            style={{ fontSize: '0.75rem', cursor: 'not-allowed', opacity: 0.7 }}
                          >
                            Chat (Premium)
                          </span>
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

export default function RecruiterDashboardPage() {
  return (
    <Suspense fallback={<div className="shell" style={{ padding: '2rem 1.5rem' }}>Loading…</div>}>
      <RecruiterDashboard />
    </Suspense>
  );
}
