'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { allowEmployerContextChange } from '@/components/recruiter/useEmployerUnsaved';
import { RecruiterJobs } from '@/components/recruiter/RecruiterJobs';
import { RecruiterPipeline } from '@/components/recruiter/RecruiterPipeline';
import { RecruiterCompany } from '@/components/recruiter/RecruiterCompany';
import { preferredCompany, rememberCompany } from '@/components/recruiter/RecruiterPrimitives';
import { WorkspaceEmpty, WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import rw from '@/components/recruiter/RecruiterWorkspace.module.css';
import { Link, localeHref } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { api, getSession, saveSession, AuthSession } from '@/lib/api';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import {
  RECRUITER_TAB_KEY,
  readStoredDashboardTab,
  storeDashboardTab,
} from '@/lib/dashboardTab';
import { RecruiterAnalyticsView } from '@/components/recruiter/RecruiterAnalyticsView';
import { RecruiterTemplates } from '@/components/recruiter/RecruiterTemplates';
import { employerJobHref, employerWorkspaceHref } from '@/lib/accountNavigation';
import { RoleGate } from '@/components/auth/RoleGate';

type Tab = 'jobs' | 'pipeline' | 'bulk' | 'analytics' | 'company';
const RECRUITER_TABS: Tab[] = ['jobs', 'pipeline', 'bulk', 'analytics', 'company'];

function isRecruiterTab(v: string): v is Tab {
  return (RECRUITER_TABS as string[]).includes(v);
}

/** Pipeline and bulk deep-link a job. Other tabs must not write `job` or the URL fights the tab. */
const JOB_QUERY_TABS: Tab[] = ['pipeline', 'bulk'];

function canonicalQuery(input: { toString(): string }): string {
  const params = new URLSearchParams(input.toString());
  return [...params.entries()]
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function dashboardQuery(tab: Tab, selectedJob: string, base: { toString(): string }): URLSearchParams {
  const params = new URLSearchParams(base.toString());
  params.set('tab', tab);
  if (JOB_QUERY_TABS.includes(tab) && selectedJob) params.set('job', selectedJob);
  else params.delete('job');
  return params;
}

function RecruiterDashboard() {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobFromUrl = searchParams.get('job') || '';
  const tabFromUrl = searchParams.get('tab') || '';
  const focusFromUrl = searchParams.get('focus') || '';
  const [tab, setTab] = useState<Tab>(() => {
    if (tabFromUrl === 'candidates' || tabFromUrl === 'billing') return 'jobs';
    // An explicit tab wins. `job` opens Pipeline only when the URL never named a tab.
    if (isRecruiterTab(tabFromUrl)) return tabFromUrl;
    if (jobFromUrl) return 'pipeline';
    const stored = readStoredDashboardTab(RECRUITER_TAB_KEY);
    if (stored && isRecruiterTab(stored)) return stored;
    return 'jobs';
  });
  const [selectedJob, setSelectedJob] = useState(jobFromUrl);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const routerRef = useRef(router);
  routerRef.current = router;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const selectedJobRef = useRef(selectedJob);
  selectedJobRef.current = selectedJob;
  const urlWrites = useRef(new Map<number, string>());
  const urlWriteGen = useRef(0);
  const latestWrittenQuery = useRef<string | null>(null);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const companyIdRef = useRef(companyId); companyIdRef.current = companyId;
  const [bootLoading, setBootLoading] = useState(true);
  const bootGeneration = useRef(0);
  const companyGeneration = useRef(0);
  const jobGeneration = useRef(0);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
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
  const [industryGroups, setIndustryGroups] = useState<
    Array<{ slug: string; name: string; industries: Array<{ slug: string; name: string }> }>
  >([]);
  const [bulkTemplates, setBulkTemplates] = useState<Array<{ id: string; name: string; body: string }>>(
    [],
  );
  const [companyDetail, setCompanyDetail] = useState<any>(null);

  const company = useMemo(
    () => companyDetail || memberships.find((m) => m.companyId === companyId)?.company,
    [memberships, companyId, companyDetail],
  );
  const canManageTeam = useMemo(() => {
    const role = memberships.find((m) => m.companyId === companyId)?.role;
    return role === 'OWNER' || role === 'ADMIN';
  }, [memberships, companyId]);
  const isOwner = useMemo(
    () => memberships.find((m) => m.companyId === companyId)?.role === 'OWNER',
    [memberships, companyId],
  );

  function flash(message: string, tone: 'success' | 'error' = 'success') {
    setMsgTone(tone);
    setMsg(message);
  }

  async function refreshMemberships() {
    const mine = await api<any[]>('/companies/mine');
    setMemberships(mine);
  }

  async function selectTab(next: Tab) { if (await allowEmployerContextChange()) setTab(next); }
  async function bootstrap() {
    const session = getSession();
    if (!session) {
      window.location.href = localeHref('/login?role=RECRUITER&next=' + encodeURIComponent('/dashboard/recruiter?' + searchParams.toString()));
      return;
    }
    if (session.user.role !== 'RECRUITER' && session.user.role !== 'SUPER_ADMIN') {
      window.location.href = localeHref(session.user.role === 'EMPLOYEE' ? '/jobs' : '/');
      return;
    }
    const [mine, cities, skills, categories, benefits, inds, langs, me] = await Promise.all([
      api<any[]>('/companies/mine'),
      api('/meta/cities', { auth: false }),
      api('/meta/skills?sort=popular&take=120', { auth: false }),
      api('/meta/categories', { auth: false }),
      api('/meta/benefits', { auth: false }),
      api<{ groups?: Array<{ slug: string; name: string; industries: Array<{ slug: string; name: string }> }> }>(
        '/meta/industries?group=1',
        { auth: false },
      ).catch(() => ({ groups: [] })),
      api('/meta/languages', { auth: false }).catch(() => []),
      api<AuthSession>('/auth/me').catch(() => null),
    ]);
    if (me) {
      saveSession(me);
    }
    setMemberships(mine);
    setMeta({
      cities: cities as any[],
      skills: skills as any[],
      categories: categories as any[],
      benefits: benefits as any[],
      languages: langs as any[],
    });
    setIndustryGroups(Array.isArray(inds) ? [] : inds.groups || []);
    const requested = searchParams.get('company');
    const first = mine.find((item) => item.companyId === requested)?.companyId || preferredCompany(mine)?.companyId;
    if (first) {
      setCompanyId(first);
      rememberCompany(first);
      await loadJobs(first);
    }
  }

  async function loadJobs(cid: string) {
    const generation = ++companyGeneration.current;
    setJobsLoading(true);
    try {
    const list = await api<any[]>(`/jobs/company/${cid}`);
    if (generation !== companyGeneration.current || companyIdRef.current !== cid) return;
    setJobs(list);
    const preferred =
      (searchParamsRef.current.get('job') && list.some((j) => j.id === searchParamsRef.current.get('job')) && searchParamsRef.current.get('job')) ||
      (selectedJobRef.current && list.some((j) => j.id === selectedJobRef.current) && selectedJobRef.current) ||
      list[0]?.id ||
      '';
    if (preferred !== selectedJobRef.current) {
      setSelectedJob(preferred);
    } else if (preferred) {
      await loadJobData(preferred);
    }
    } finally { if (generation === companyGeneration.current) setJobsLoading(false); }
  }

  async function loadJobData(jobId: string) {
    if (!jobId || selectedJobRef.current !== jobId) return;
    const generation = ++jobGeneration.current;
    setApplicantsLoading(true);
    try {
    const result = await api<{items:any[]}>(`/applications/jobs/${jobId}/search?sort=match&limit=24`);
    const apps=result.items;
    if (generation !== jobGeneration.current || selectedJobRef.current !== jobId) return;
    setApplicants(apps);
    } finally { if (generation === jobGeneration.current) setApplicantsLoading(false); }
  }

  useEffect(() => {
    const generation = ++bootGeneration.current;
    setBootLoading(true);
    bootstrap().catch((e) => { if (generation === bootGeneration.current) setError(e.message); }).finally(() => { if (generation === bootGeneration.current) setBootLoading(false); });
  }, []);

  useEffect(() => {
    setApplicants([]); ++jobGeneration.current;
    if (selectedJob) {

      loadJobData(selectedJob).catch((e) => setError(e.message));
    }
  }, [selectedJob]);

  useEffect(() => {
    if (!companyId) return;
    setCompanyDetail(null); setJobs([]); setJobsLoading(true); setSelectedJob(''); setApplicants([]); ++jobGeneration.current;
    loadBulkTemplates(companyId).catch(() => { if (companyIdRef.current === companyId) setBulkTemplates([]); });
    loadCompanyDetail(companyId).catch((reason) => { if (companyIdRef.current === companyId) flash(reason.message, 'error'); });
    void loadJobs(companyId).catch((reason) => flash(reason.message, 'error'));
  }, [companyId]);

  useEffect(() => {
    if ((tab === 'pipeline' || tab === 'bulk') && companyId) {
      loadBulkTemplates(companyId).catch(() => setBulkTemplates([]));
    }
  }, [tab, companyId]);

  useEffect(() => {
    if (tabFromUrl === 'candidates') {
      router.replace(jobFromUrl ? employerJobHref(jobFromUrl, 'applicants', searchParams.get('company')) : employerWorkspaceHref());
      return;
    }
    if (tabFromUrl === 'billing') { setTab('jobs'); routerRef.current.replace('/dashboard/recruiter?tab=jobs'); return; }
    const seen = canonicalQuery(searchParams);
    let matchedGen: number | null = null;
    for (const [gen, qs] of urlWrites.current) {
      if (qs === seen) matchedGen = gen;
    }
    if (matchedGen != null) {
      urlWrites.current.delete(matchedGen);
      const newerInFlight = [...urlWrites.current.keys()].some((gen) => gen > matchedGen);
      if (newerInFlight) return;
      const latest = latestWrittenQuery.current;
      const latestKey = latest == null ? null : canonicalQuery(new URLSearchParams(latest));
      if (latest != null && latestKey != null && seen !== latestKey) {
        const gen = ++urlWriteGen.current;
        urlWrites.current.set(gen, latestKey);
        routerRef.current.replace(latest ? `/dashboard/recruiter?${latest}` : '/dashboard/recruiter');
      }
      return;
    }
    if (isRecruiterTab(tabFromUrl) && tabFromUrl !== tabRef.current) {
      setTab(tabFromUrl);
    }
    const explicitTab = isRecruiterTab(tabFromUrl) ? tabFromUrl : tabRef.current;
    if (
      jobFromUrl &&
      (explicitTab === 'pipeline' || explicitTab === 'bulk') &&
      jobFromUrl !== selectedJobRef.current
    ) {
      setSelectedJob(jobFromUrl);
    }
  }, [tabFromUrl, jobFromUrl, searchParams]);

  useEffect(() => {
    const requested = searchParams.get('company');
    if (requested && requested !== companyId && memberships.some((membership) => membership.companyId === requested)) {
      setCompanyDetail(null); setApplicants([]); setSelectedJob(jobFromUrl); setCompanyId(requested); rememberCompany(requested);
    }
  }, [searchParams, memberships]);

  // One writer. It does not depend on searchParams or router identity, so its own replace cannot schedule another.
  useEffect(() => {
    storeDashboardTab(RECRUITER_TAB_KEY, tab);
    if (bootLoading || jobsLoading || !companyId) return;
    const params = dashboardQuery(tab, selectedJob, searchParamsRef.current);
    if (companyId) params.set('company', companyId);
    if (tab !== 'pipeline' || selectedJob !== searchParamsRef.current.get('job') || (searchParamsRef.current.get('company') && companyId !== searchParamsRef.current.get('company'))) params.delete('application');
    if (tab !== 'jobs') params.delete('focus');
    const next = canonicalQuery(params);
    if (next === canonicalQuery(searchParamsRef.current)) return;
    const gen = ++urlWriteGen.current;
    const qs = params.toString();
    urlWrites.current.set(gen, next);
    latestWrittenQuery.current = qs;
    routerRef.current.replace(qs ? `/dashboard/recruiter?${qs}` : '/dashboard/recruiter');
  }, [tab, selectedJob, companyId, bootLoading, jobsLoading]);

  async function changeJobStatus(jobId: string, status: string, okMsg: string) {
    try {
      await api(`/jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      flash(okMsg, 'success');
      await loadJobs(companyId);
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.jobStatusFailed'), 'error');
    }
  }

  async function loadBulkTemplates(cid: string) {
    if (!cid) return;
    try {
      const list = await api<Array<{ id: string; name: string; body: string }>>(
        `/bulk-comms/templates?companyId=${cid}`,
      );
      if (companyIdRef.current === cid) setBulkTemplates(list);
    } catch {
      if (companyIdRef.current === cid) setBulkTemplates([]);
    }
  }

  async function loadCompanyDetail(cid: string) {
    if (!cid) return;
    const detail = await api(`/companies/${cid}`);
    if (companyIdRef.current === cid) setCompanyDetail(detail);
  }

  return (
    <div className={rw.root} aria-label={t('employers.badge')}>
      {(tab === 'pipeline' || tab === 'bulk') && <div className={rw.context}>
        <nav className={rw.actions} aria-label={t('jobs')}><button className={rw.textButton} onClick={() => void selectTab('jobs')}>{t('rw.backJobs')}</button><button className={tab === 'pipeline' ? rw.secondary : rw.textButton} onClick={() => void selectTab('pipeline')}>{t('applications')}</button><button className={tab === 'bulk' ? rw.secondary : rw.textButton} onClick={() => void selectTab('bulk')}>{t('rec.templatesHistory')}</button></nav>
      </div>}


      <section className={rw.body}>
        {bootLoading && <WorkspaceLoading />}
        {!bootLoading && !companyId && !error && <WorkspaceEmpty title={t('rw.noCompany')} hint={t('rw.noCompanyHint')} />}
        {error && <div className={rw.notice} role="alert"><span>{error}</span><button className={rw.textButton} onClick={() => { setError(''); setBootLoading(true); void bootstrap().catch((reason) => setError(reason.message)).finally(() => setBootLoading(false)); }}>{t('workspace.retry')}</button></div>}
        {msg && <div className={rw.notice} data-tone={msgTone} role="status"><span>{msg}</span><button className={rw.icon} aria-label={t('close')} onClick={() => setMsg('')}>×</button></div>}

        {tab === 'jobs' && !bootLoading && companyId && <RecruiterJobs companyId={companyId} company={company} jobs={jobs} loading={jobsLoading} meta={meta} createRequested={focusFromUrl === 'create'} onCloseCreate={() => { const next = new URLSearchParams(searchParams.toString()); next.delete('focus'); router.replace('/dashboard/recruiter?' + next.toString(), { scroll: false }); }} onReload={() => loadJobs(companyId)} onApplicants={(id) => router.push(employerJobHref(id,'applicants',companyId))} onStatus={changeJobStatus} onFlash={flash} />}
        {tab === 'pipeline' && !bootLoading && companyId && <RecruiterPipeline meta={meta} companyId={companyId} jobs={jobs} selectedJob={selectedJob} onJobChange={setSelectedJob} applicants={applicants} companyName={company?.name || ''} loading={applicantsLoading} applicationId={searchParams.get('application') || undefined} templates={bulkTemplates} onReload={() => loadJobData(selectedJob)} onTemplates={() => setTab('bulk')} onFlash={flash} />}

        {tab === 'bulk' && companyId && <RecruiterTemplates key={companyId} companyId={companyId} jobPostId={selectedJob || undefined} />}
        {tab === 'analytics' && companyId && <RecruiterAnalyticsView key={companyId} companyId={companyId} jobs={jobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} />}

        {tab === 'company' && company && <RecruiterCompany key={companyId} company={company} companyId={companyId} meta={meta} industryGroups={industryGroups} canManage={canManageTeam} isOwner={isOwner} onReload={async () => { await refreshMemberships(); await loadCompanyDetail(companyId); }} onFlash={flash} />}

      </section>
    </div>
  );
}

export default function RecruiterDashboardPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<div className="shell" style={{ padding: '2rem 1.5rem' }}>{t('rec.loading')}</div>}
    >
      <RoleGate role="RECRUITER"><RecruiterDashboard /></RoleGate>
    </Suspense>
  );
}
