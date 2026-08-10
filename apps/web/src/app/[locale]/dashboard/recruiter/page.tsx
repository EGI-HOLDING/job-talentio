'use client';

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, localeHref } from '@/lib/navigation';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { PLAN_LIMITS, PLAN_PRICES_UZS, HOT_JOB_DAYS } from '@job-talentio/shared';
import { api, getSession, saveSession, AuthSession } from '@/lib/api';
import { localizedJobLocation } from '@/lib/location';
import { formatUzs as formatUzsShared } from '@/lib/numberFormat';
import { sanitizeMojibake } from '@/lib/text';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { usePresence } from '@/lib/presence';
import { PresenceDot } from '@/components/presence/PresenceDot';
import {
  RECRUITER_TAB_KEY,
  readStoredDashboardTab,
  storeDashboardTab,
} from '@/lib/dashboardTab';
import { FormAlert, LabelText } from '@/components/ui/Field';
import { NumberInput } from '@/components/ui/NumberInput';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { MatchRing } from '@/components/ui/MatchRing';
import { MatchBreakdownPanel } from '@/components/ui/MatchBreakdownPanel';
import { BulkCommsPanel } from '@/components/bulk/BulkCommsPanel';
import { ImageCropUpload } from '@/components/ui/ImageCropUpload';
import { JobLanguageVersions } from '@/components/recruiter/JobLanguageVersions';

type Tab = 'jobs' | 'pipeline' | 'bulk' | 'analytics' | 'billing' | 'company';
const RECRUITER_TABS: Tab[] = ['jobs', 'pipeline', 'bulk', 'analytics', 'billing', 'company'];

function isRecruiterTab(v: string): v is Tab {
  return (RECRUITER_TABS as string[]).includes(v);
}
type PlanCode = 'FREE' | 'STANDARD' | 'PREMIUM' | 'VIP';
type CheckoutResponse = {
  payment: { id: string; status: string; amountUzs: number; purpose: string };
  checkoutUrl: string | null;
};

const PLAN_ORDER: PlanCode[] = ['FREE', 'STANDARD', 'PREMIUM', 'VIP'];
/** Dictionary keys, resolved with `t()` where the plan cards render. */
const PLAN_FEATURES: Record<PlanCode, string[]> = {
  FREE: [
    'rec.planFeature1Job',
    'rec.planFeatureContactsBlurred',
    'rec.planFeatureNoColdChat',
  ],
  STANDARD: [
    'rec.planFeature5Jobs',
    'rec.planFeatureContactsFull',
    'rec.planFeatureNoColdChat',
  ],
  PREMIUM: [
    'rec.planFeature20Jobs',
    'rec.planFeatureContactsFull',
    'rec.planFeatureColdChat20',
  ],
  VIP: [
    'rec.planFeature50Jobs',
    'rec.planFeatureContactsFull',
    'rec.planFeatureColdChat50',
    'rec.planFeatureVipBadge',
  ],
};

function formatUzs(n: number) {
  return formatUzsShared(n);
}

function planRank(plan: PlanCode) {
  return PLAN_ORDER.indexOf(plan);
}

const STAGES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
/** Distinguish same-title openings by location + status in selects */
function jobSelectLabel(
  j: {
    title: string;
    status?: string;
    workMode?: string | null;
    city?: { name: string } | null;
  },
  enumLabel: (group: string, value?: string | null) => string,
  t: (key: string) => string,
) {
  const location = localizedJobLocation(j, t);
  const status =
    j.status && j.status !== 'PUBLISHED' ? ` | ${enumLabel('jobStatus', j.status)}` : '';
  return `${j.title} - ${location}${status}`;
}

function RecruiterDashboard() {
  const { t } = useI18n();
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobFromUrl = searchParams.get('job') || '';
  const tabFromUrl = searchParams.get('tab') || '';
  const focusFromUrl = searchParams.get('focus') || '';
  const [tab, setTab] = useState<Tab>(() => {
    if (tabFromUrl === 'candidates') return 'jobs';
    if (isRecruiterTab(tabFromUrl)) return tabFromUrl;
    const stored = readStoredDashboardTab(RECRUITER_TAB_KEY);
    if (stored && isRecruiterTab(stored)) return stored;
    if (jobFromUrl) return 'pipeline';
    return 'jobs';
  });
  const [memberships, setMemberships] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState(jobFromUrl);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [draftJobSkills, setDraftJobSkills] = useState<Array<{ slug: string; name: string }>>([]);
  const [draftJobBenefits, setDraftJobBenefits] = useState<Array<{ slug: string; name: string }>>([]);
  const [draftJobLanguages, setDraftJobLanguages] = useState<
    Array<{ code: string; name: string; minLevel: string; isRequired: boolean }>
  >([]);
  const [editJobLanguages, setEditJobLanguages] = useState<
    Array<{ code: string; name: string; minLevel: string; isRequired: boolean }>
  >([]);
  const [draftJobLocale, setDraftJobLocale] = useState<'uz' | 'ru' | 'en'>('uz');
  const localeLangSuggested = useRef(false);
  const [draftJobLevel, setDraftJobLevel] = useState('');
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
  const [industryGroups, setIndustryGroups] = useState<
    Array<{ slug: string; name: string; industries: Array<{ slug: string; name: string }> }>
  >([]);
  const [subscription, setSubscription] = useState<{
    plan: PlanCode;
    activePublishedJobs: number;
    prices: typeof PLAN_PRICES_UZS;
    endsAt?: string | null;
  } | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [bulkTemplates, setBulkTemplates] = useState<Array<{ id: string; name: string; body: string }>>(
    [],
  );
  const [bulkToStatus, setBulkToStatus] = useState('');
  const [bulkTemplateId, setBulkTemplateId] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [companyDetail, setCompanyDetail] = useState<any>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

  const company = useMemo(
    () => companyDetail || memberships.find((m) => m.companyId === companyId)?.company,
    [memberships, companyId, companyDetail],
  );
  const planCode = (subscription?.plan || company?.subscription?.plan || 'FREE') as PlanCode;
  const canColdChat = planCode === 'PREMIUM' || planCode === 'VIP';
  const activeJobLimit = PLAN_LIMITS[planCode].activeJobs;
  const activePublishedJobs =
    subscription?.activePublishedJobs ??
    jobs.filter((j) => j.status === 'PUBLISHED').length;

  async function requestEmailVerification() {
    setVerifyBusy(true);
    try {
      const r = await api<{ message?: string; alreadyVerified?: boolean; email: string }>(
        '/auth/request-verification',
        { method: 'POST' },
      );
      if (r.alreadyVerified) {
        setEmailVerified(true);
        const session = getSession();
        if (session) {
          saveSession({
            ...session,
            user: { ...session.user, emailVerified: true },
          });
        }
        flash(t('emailVerifiedBadge'));
      } else {
        flash(r.message || `${t('verifyEmailSentTo')} ${r.email}`);
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : t('verifyEmailFailed'), 'error');
    } finally {
      setVerifyBusy(false);
    }
  }

  function flash(message: string, tone: 'success' | 'error' = 'success') {
    setMsgTone(tone);
    setMsg(message);
  }

  async function refreshMemberships() {
    const mine = await api<any[]>('/companies/mine');
    setMemberships(mine);
  }

  async function loadSubscription(cid: string) {
    if (!cid) return;
    const sub = await api<{
      plan: PlanCode;
      activePublishedJobs: number;
      prices: typeof PLAN_PRICES_UZS;
      endsAt?: string | null;
    }>(`/billing/companies/${cid}/subscription`);
    setSubscription(sub);
  }

  async function startCheckout(res: CheckoutResponse, successMsg: string) {
    if (res.checkoutUrl) {
      try {
        sessionStorage.setItem(`billing:payment:${res.payment.id}`, JSON.stringify(res.payment));
      } catch {
        /* ignore */
      }
      window.location.href = res.checkoutUrl;
      return;
    }
    flash(successMsg);
    await refreshMemberships();
    await loadSubscription(companyId);
    await loadJobs(companyId);
  }

  async function upgradePlan(plan: 'STANDARD' | 'PREMIUM' | 'VIP') {
    if (!companyId || billingBusy) return;
    setBillingBusy(true);
    try {
      const res = await api<CheckoutResponse>(`/billing/companies/${companyId}/upgrade`, {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      await startCheckout(res, t('rec.planUpgraded').replace('{plan}', enumLabel('plan', plan)));
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.upgradeFailed'), 'error');
    } finally {
      setBillingBusy(false);
    }
  }

  async function buyHotBoost(jobId: string, days: 7 | 14 | 30) {
    if (!companyId || billingBusy) return;
    setBillingBusy(true);
    try {
      const res = await api<CheckoutResponse>(
        `/billing/companies/${companyId}/jobs/${jobId}/hot`,
        { method: 'POST', body: JSON.stringify({ days }) },
      );
      await startCheckout(res, t('rec.hotBoostActivated').replace('{n}', String(days)));
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.hotBoostFailed'), 'error');
    } finally {
      setBillingBusy(false);
    }
  }

  async function bootstrap() {
    const session = getSession();
    if (!session || (session.user.role !== 'RECRUITER' && session.user.role !== 'SUPER_ADMIN')) {
      window.location.href = localeHref('/login');
      return;
    }
    setAccountEmail(session.user.email);
    setEmailVerified(session.user.emailVerified ?? null);
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
      setAccountEmail(me.user.email);
      setEmailVerified(Boolean(me.user.emailVerified));
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
    const first = mine[0]?.companyId;
    if (first) {
      setCompanyId(first);
      await loadJobs(first);
    }
  }

  useEffect(() => {
    if (localeLangSuggested.current || draftJobLanguages.length > 0) return;
    const lang = meta.languages.find((l) => l.code === draftJobLocale);
    if (!lang) return;
    localeLangSuggested.current = true;
    setDraftJobLanguages([
      { code: lang.code, name: lang.name, minLevel: 'B1', isRequired: true },
    ]);
  }, [meta.languages, draftJobLocale, draftJobLanguages.length]);

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
    if (selectedJob) {
      setSelectedAppIds([]);
      loadJobData(selectedJob).catch((e) => setError(e.message));
    }
  }, [selectedJob]);

  useEffect(() => {
    if (companyId) {
      loadSubscription(companyId).catch(() => setSubscription(null));
      loadBulkTemplates(companyId).catch(() => setBulkTemplates([]));
      loadCompanyDetail(companyId).catch(() => setCompanyDetail(null));
    }
  }, [companyId]);

  useEffect(() => {
    if ((tab === 'pipeline' || tab === 'bulk') && companyId) {
      loadBulkTemplates(companyId).catch(() => setBulkTemplates([]));
    }
  }, [tab, companyId]);

  useEffect(() => {
    if (tabFromUrl === 'candidates') {
      window.location.replace('/talent');
      return;
    }
    if (isRecruiterTab(tabFromUrl) && tabFromUrl !== tab) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (jobFromUrl && jobFromUrl !== selectedJob) {
      setSelectedJob(jobFromUrl);
    }
  }, [jobFromUrl]);

  // Keep URL + sessionStorage in sync so browser Back returns to the last section.
  useEffect(() => {
    storeDashboardTab(RECRUITER_TAB_KEY, tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    if (selectedJob) params.set('job', selectedJob);
    else params.delete('job');
    const qs = params.toString();
    const current = searchParams.toString();
    if (qs !== current) {
      router.replace(qs ? `/dashboard/recruiter?${qs}` : '/dashboard/recruiter');
    }
  }, [tab, selectedJob, router, searchParams]);

  useEffect(() => {
    if (tab === 'jobs' && focusFromUrl === 'create') {
      document.getElementById('create-job-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [tab, focusFromUrl]);

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
        salaryPeriod: fd.get('salaryPeriod') || 'MONTHLY',
        currency: fd.get('currency') || 'UZS',
        employmentType: fd.get('employmentType') || 'FULL_TIME',
        workMode: fd.get('workMode') || 'ONSITE',
        locale: draftJobLocale,
        skills: draftJobSkills.map((s) =>
          s.slug
            ? { slug: s.slug, isRequired: true, weight: 1 }
            : { name: s.name, isRequired: true, weight: 1 },
        ),
        benefits: draftJobBenefits.map((b) =>
          b.slug ? { slug: b.slug } : { name: b.name },
        ),
        languages: draftJobLanguages.map((l) => ({
          code: l.code,
          name: l.name,
          minLevel: l.minLevel,
          isRequired: l.isRequired,
        })),
      }),
    });
    setDraftJobSkills([]);
    setDraftJobBenefits([]);
    setDraftJobLanguages([]);
    localeLangSuggested.current = false;
    setDraftJobLevel('');
    flash(t('rec.jobCreatedDraft'));
    await loadJobs(companyId);
  }

  async function updateJob(e: FormEvent<HTMLFormElement>, jobId: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/jobs/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: fd.get('title'),
          description: fd.get('description'),
          citySlug: fd.get('citySlug') || undefined,
          experienceLevel: fd.get('experienceLevel') || undefined,
          salaryMin: fd.get('salaryMin') ? Number(fd.get('salaryMin')) : null,
          salaryMax: fd.get('salaryMax') ? Number(fd.get('salaryMax')) : null,
          salaryPeriod: fd.get('salaryPeriod') || 'MONTHLY',
          currency: fd.get('currency') || 'UZS',
          employmentType: fd.get('employmentType') || 'FULL_TIME',
          workMode: fd.get('workMode') || 'ONSITE',
          languages: editJobLanguages.map((l) => ({
            code: l.code,
            name: l.name,
            minLevel: l.minLevel,
            isRequired: l.isRequired,
          })),
        }),
      });
      setEditingJobId(null);
      setEditJobLanguages([]);
      flash(t('rec.jobUpdated'));
      await loadJobs(companyId);
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.jobUpdateFailed'), 'error');
    }
  }

  function hydrateEditLanguages(job: any) {
    setEditJobLanguages(
      (job.jobLanguages || []).map((jl: any) => ({
        code: jl.language?.code || '',
        name: jl.language?.name || jl.language?.code || '',
        minLevel: jl.minLevel || 'B1',
        isRequired: jl.isRequired !== false,
      })).filter((l: { code: string }) => l.code),
    );
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
      flash(err instanceof Error ? err.message : t('rec.jobStatusFailed'), 'error');
    }
  }

  async function setStatus(appId: string, status: string) {
    await api(`/applications/${appId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await loadJobData(selectedJob);
  }

  async function viewApplicationCv(appId: string) {
    try {
      const res = await api<{ url: string }>(`/applications/${appId}/resume-download`);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      flash(err instanceof Error ? err.message : t('viewCvFailed'), 'error');
    }
  }

  async function loadBulkTemplates(cid: string) {
    if (!cid) return;
    try {
      const list = await api<Array<{ id: string; name: string; body: string }>>(
        `/bulk-comms/templates?companyId=${cid}`,
      );
      setBulkTemplates(list);
    } catch {
      setBulkTemplates([]);
    }
  }

  function toggleAppSelected(appId: string) {
    setSelectedAppIds((prev) =>
      prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId],
    );
  }

  function toggleStageSelect(stage: string) {
    const ids = (byStage[stage] || []).map((a: any) => a.id as string);
    const allSelected = ids.length > 0 && ids.every((id) => selectedAppIds.includes(id));
    setSelectedAppIds((prev) => {
      if (allSelected) return prev.filter((id) => !ids.includes(id));
      const set = new Set(prev);
      ids.forEach((id) => set.add(id));
      return Array.from(set);
    });
  }

  async function runBulkAction() {
    if (!companyId || !selectedJob || selectedAppIds.length === 0) return;
    if (!bulkToStatus && !bulkTemplateId && !bulkMessage.trim()) {
      flash(t('rec.bulkChooseTarget'), 'error');
      return;
    }
    setBulkBusy(true);
    try {
      const campaign = await api<any>('/bulk-comms/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          jobPostId: selectedJob,
          applicationIds: selectedAppIds,
          toStatus: bulkToStatus || undefined,
          templateId: bulkTemplateId || undefined,
          messageBody: bulkMessage.trim() || undefined,
        }),
      });
      const sent = campaign.recipients?.filter((r: any) => r.deliveryStatus === 'SENT').length ?? 0;
      const skipped =
        campaign.recipients?.filter((r: any) => r.deliveryStatus === 'SKIPPED_OPTED_OUT').length ?? 0;
      const failed = campaign.recipients?.filter((r: any) => r.deliveryStatus === 'FAILED').length ?? 0;
      flash(
        `${t('rec.bulkDoneSent').replace('{n}', String(sent))}${
          skipped ? t('rec.bulkDoneSkipped').replace('{n}', String(skipped)) : ''
        }${failed ? t('rec.bulkDoneFailed').replace('{n}', String(failed)) : ''}`,
      );
      setSelectedAppIds([]);
      setBulkMessage('');
      await loadJobData(selectedJob);
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.bulkActionFailed'), 'error');
    } finally {
      setBulkBusy(false);
    }
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
    flash(t('rec.interviewScheduled'));
    await loadJobData(selectedJob);
  }

  async function loadCompanyDetail(cid: string) {
    if (!cid) return;
    const detail = await api(`/companies/${cid}`);
    setCompanyDetail(detail);
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
    flash(t('rec.companyUpdated'));
    await refreshMemberships();
    await loadCompanyDetail(companyId);
  }

  async function inviteMember(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviteBusy) return;
    setInviteBusy(true);
    try {
      await api(`/companies/${companyId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'RECRUITER' }),
      });
      setInviteEmail('');
      flash(t('rec.memberInvited'));
      await loadCompanyDetail(companyId);
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.inviteFailed'), 'error');
    } finally {
      setInviteBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (!confirm(t('rec.confirmRemoveMember'))) return;
    try {
      await api(`/companies/${companyId}/members/${userId}`, { method: 'DELETE' });
      flash(t('rec.memberRemoved'));
      await loadCompanyDetail(companyId);
    } catch (err) {
      flash(err instanceof Error ? err.message : t('rec.removeFailed'), 'error');
    }
  }

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of STAGES) map[s] = [];
    for (const a of applicants) {
      (map[a.status] || (map[a.status] = [])).push(a);
    }
    return map;
  }, [applicants]);

  const pipelinePresence = usePresence(
    applicants.map((a: any) => a.profile?.user?.id as string | undefined),
  );

  return (
    <div className="shell dash-grid">
      <aside className="dash-nav">
        {(
          [
            ['jobs', 'jobs'],
            ['pipeline', 'rec.tabPipeline'],
            ['bulk', 'rec.tabBulk'],
            ['analytics', 'rec.tabAnalytics'],
            ['billing', 'rec.tabBilling'],
            ['company', 'company'],
          ] as Array<[Tab, string]>
        ).map(([k, labelKey]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {t(labelKey)}
          </button>
        ))}
        {memberships.length > 1 && (
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              loadJobs(e.target.value);
            }}
            aria-label={t('company')}
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

        {emailVerified === false && (
          <div
            className="card"
            style={{
              marginBottom: '1rem',
              background: 'rgba(245, 158, 11, 0.12)',
              borderColor: 'rgba(245, 158, 11, 0.35)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>{t('verifyEmailTitle')}</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
              {accountEmail} - <strong>{t('emailUnverifiedBadge')}</strong>
            </p>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              {t('verifyEmailProfileHint')}
            </p>
            <button type="button" disabled={verifyBusy} onClick={() => requestEmailVerification()}>
              {verifyBusy ? t('verifyEmailSending') : t('verifyEmailCta')}
            </button>
            <p className="muted" style={{ marginBottom: 0, marginTop: '0.65rem', fontSize: '0.85rem' }}>
              {t('rec.orOpen')}{' '}
              <Link href="/settings" style={{ color: 'var(--accent)' }}>
                {t('settings')}
              </Link>
              .
            </p>
          </div>
        )}

        {tab === 'jobs' && (
          <div className="grid-2">
            <div className="card" id="create-job-form">
              <h3>{t('rec.createJob')}</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={createJob}>
                <label>
                  <LabelText required>{t('jobTitleFilter')}</LabelText>
                  <JobTitleInput
                    name="title"
                    required
                    minLength={3}
                    placeholder={t('rec.jobTitlePlaceholder')}
                    onInferredLevel={(level) => {
                      setDraftJobLevel((prev) => prev || level);
                    }}
                  />
                  <span className="muted" style={{ fontSize: '0.78rem', display: 'block', marginTop: '0.35rem' }}>
                    {t('jobTitleHint')}
                  </span>
                </label>
                <label>
                  <LabelText required>{t('rec.description')}</LabelText>
                  <textarea name="description" rows={5} required minLength={20} />
                </label>
                <label>
                  <LabelText>{t('city')}</LabelText>
                  <select name="citySlug">
                    <option value="">-</option>
                    {meta.cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>{t('category')}</LabelText>
                  <select name="categorySlug">
                    <option value="">-</option>
                    {meta.categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>{t('experienceLevel')}</LabelText>
                  <select
                    name="experienceLevel"
                    value={draftJobLevel}
                    onChange={(e) => setDraftJobLevel(e.target.value)}
                  >
                    <option value="">-</option>
                    {['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map((l) => (
                      <option key={l} value={l}>
                        {enumLabel('experienceLevel', l)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>{t('rec.minYears')}</LabelText>
                  <input name="experienceYearsMin" type="number" />
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>{t('rec.salaryMin')}</LabelText>
                    <NumberInput
                      name="salaryMin"
                      placeholder={t('rec.salaryMinPlaceholder')}
                      min={0}
                    />
                  </label>
                  <label>
                    <LabelText>{t('rec.salaryMax')}</LabelText>
                    <NumberInput
                      name="salaryMax"
                      placeholder={t('rec.salaryMaxPlaceholder')}
                      min={0}
                    />
                  </label>
                </div>
                <label>
                  <LabelText>{t('workMode')}</LabelText>
                  <select name="workMode" defaultValue="HYBRID">
                    <option value="ONSITE">{enumLabel('workMode', 'ONSITE')}</option>
                    <option value="HYBRID">{enumLabel('workMode', 'HYBRID')}</option>
                    <option value="REMOTE">{enumLabel('workMode', 'REMOTE')}</option>
                  </select>
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>{t('employmentType')}</LabelText>
                    <select name="employmentType" defaultValue="FULL_TIME">
                      <option value="FULL_TIME">{enumLabel('employmentType', 'FULL_TIME')}</option>
                      <option value="PART_TIME">{enumLabel('employmentType', 'PART_TIME')}</option>
                      <option value="CONTRACT">{enumLabel('employmentType', 'CONTRACT')}</option>
                      <option value="INTERNSHIP">
                        {enumLabel('employmentType', 'INTERNSHIP')}
                      </option>
                    </select>
                  </label>
                  <label>
                    <LabelText>{t('rec.salaryPeriod')}</LabelText>
                    <select name="salaryPeriod" defaultValue="MONTHLY">
                      <option value="MONTHLY">{t('rec.periodMonthly')}</option>
                      <option value="YEARLY">{t('rec.periodYearly')}</option>
                      <option value="HOURLY">{t('rec.periodHourly')}</option>
                    </select>
                  </label>
                </div>
                <div className="grid-2">
                  <label>
                    <LabelText>{t('rec.currency')}</LabelText>
                    <select name="currency" defaultValue="UZS">
                      <option value="UZS">UZS</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label>
                    <LabelText>{t('postLocale')}</LabelText>
                    <select
                      name="locale"
                      value={draftJobLocale}
                      onChange={(e) => {
                        const next = e.target.value as 'uz' | 'ru' | 'en';
                        setDraftJobLocale(next);
                        if (!localeLangSuggested.current || draftJobLanguages.length <= 1) {
                          const lang = meta.languages.find((l) => l.code === next);
                          if (lang) {
                            localeLangSuggested.current = true;
                            setDraftJobLanguages([
                              { code: lang.code, name: lang.name, minLevel: 'B1', isRequired: true },
                            ]);
                          }
                        }
                      }}
                    >
                      <option value="uz">uz</option>
                      <option value="ru">ru</option>
                      <option value="en">en</option>
                    </select>
                  </label>
                </div>
                <p className="muted" style={{ fontSize: '0.78rem', margin: '-0.35rem 0 0.5rem' }}>
                  {t('rec.cityRuleHint')}
                </p>
                <div>
                  <LabelText>{t('skills')}</LabelText>
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
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <SkillCombobox
                    levelSelect={false}
                    submitLabel={t('rec.addSkillToJob')}
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
                  <LabelText>{t('benefits')}</LabelText>
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
                          x
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
                <div>
                  <LabelText>{t('languages')}</LabelText>
                  <p className="muted" style={{ fontSize: '0.78rem', margin: '0.25rem 0 0.4rem' }}>
                    {t('jobLanguagesHint')}
                  </p>
                  <div className="chips" style={{ margin: '0.4rem 0' }}>
                    {draftJobLanguages.map((l) => (
                      <span key={l.code} className="badge">
                        {l.name} {l.minLevel}
                        {l.isRequired ? '' : ` (${t('optional')})`}
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 6, padding: 0 }}
                          onClick={() =>
                            setDraftJobLanguages((prev) => prev.filter((x) => x.code !== l.code))
                          }
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  {draftJobLanguages.length < 4 && (
                    <LookupCombobox
                      kind="languages"
                      allowCreate={false}
                      submitLabel={t('addLanguage')}
                      placeholder={t('languageSearchPlaceholder')}
                      levelOptions={['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'].map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      defaultLevel="B1"
                      onPick={(item) => {
                        const code = item.code || item.slug;
                        if (!code) return;
                        setDraftJobLanguages((prev) => {
                          if (prev.some((p) => p.code === code) || prev.length >= 4) return prev;
                          return [
                            ...prev,
                            {
                              code,
                              name: item.name,
                              minLevel: item.level || 'B1',
                              isRequired: true,
                            },
                          ];
                        });
                      }}
                    />
                  )}
                </div>
                <button type="submit">{t('rec.createDraft')}</button>
              </form>
            </div>
            <div>
              <h2 className="section-title">{t('rec.yourJobs')}</h2>
              {jobs.map((j) => (
                <div key={j.id} className="card" style={{ marginBottom: '0.5rem' }}>
                  <strong>{j.title}</strong>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>
                    {enumLabel('jobStatus', j.status)} | {localizedJobLocation(j, t)} |{' '}
                    {j._count?.applications ?? 0} {t('rec.appsWord')} | {j._count?.views ?? 0}{' '}
                    {t('rec.viewsWord')}
                    {j.boostUntil && new Date(j.boostUntil) > new Date()
                      ? ` | ${t('rec.hotUntil').replace(
                          '{date}',
                          new Date(j.boostUntil).toLocaleDateString(),
                        )}`
                      : ''}
                  </p>
                  <div className="chips">
                    {j.status === 'DRAFT' && (
                      <button
                        type="button"
                        className="chip active"
                        onClick={() => changeJobStatus(j.id, 'PUBLISHED', t('rec.jobPublished'))}
                      >
                        {t('rec.publish')}
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
                            j.status === 'CLOSED' ? t('rec.jobReopened') : t('rec.jobResumed'),
                          )
                        }
                      >
                        {j.status === 'CLOSED' ? t('rec.reopen') : t('rec.resumeJob')}
                      </button>
                    )}
                    {j.status === 'PUBLISHED' && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => changeJobStatus(j.id, 'PAUSED', t('rec.jobPaused'))}
                      >
                        {t('rec.pause')}
                      </button>
                    )}
                    {(j.status === 'DRAFT' || j.status === 'PUBLISHED' || j.status === 'PAUSED') && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => changeJobStatus(j.id, 'CLOSED', t('rec.jobClosed'))}
                      >
                        {t('rec.closeJob')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        if (editingJobId === j.id) {
                          setEditingJobId(null);
                          setEditJobLanguages([]);
                        } else {
                          setEditingJobId(j.id);
                          hydrateEditLanguages(j);
                        }
                      }}
                    >
                      {editingJobId === j.id ? t('rec.cancelEdit') : t('rec.edit')}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setSelectedJob(j.id);
                        setTab('pipeline');
                      }}
                    >
                      {t('rec.pipeline')}
                    </button>
                    {j.status === 'PUBLISHED' &&
                      HOT_JOB_DAYS.map((days) => (
                        <button
                          key={days}
                          type="button"
                          className="chip"
                          disabled={billingBusy}
                          title={formatUzs(PLAN_PRICES_UZS[`HOT_JOB_${days}D`])}
                          onClick={() => buyHotBoost(j.id, days)}
                        >
                          {t('rec.boostDays').replace('{n}', String(days))}
                        </button>
                      ))}
                  </div>
                  {editingJobId === j.id && (
                    <>
                      <form
                        className="form-stack"
                        style={{ marginTop: '0.75rem' }}
                        onSubmit={(e) => updateJob(e, j.id)}
                      >
                        <label>
                          <LabelText required>{t('jobTitleFilter')}</LabelText>
                          <input name="title" defaultValue={j.title} required minLength={2} />
                        </label>
                        <label>
                          <LabelText required>{t('rec.description')}</LabelText>
                          <textarea
                            name="description"
                            rows={4}
                            defaultValue={j.description || ''}
                            required
                            minLength={20}
                          />
                        </label>
                        <label>
                          <LabelText>{t('city')}</LabelText>
                          <select name="citySlug" defaultValue={j.city?.slug || ''}>
                            <option value="">-</option>
                            {meta.cities.map((c) => (
                              <option key={c.slug} value={c.slug}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="grid-2">
                          <label>
                            <LabelText>{t('experienceLevel')}</LabelText>
                            <select name="experienceLevel" defaultValue={j.experienceLevel || ''}>
                              <option value="">-</option>
                              {['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'].map((l) => (
                                <option key={l} value={l}>
                                  {enumLabel('experienceLevel', l)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <LabelText>{t('workMode')}</LabelText>
                            <select name="workMode" defaultValue={j.workMode || 'HYBRID'}>
                              <option value="ONSITE">{enumLabel('workMode', 'ONSITE')}</option>
                              <option value="HYBRID">{enumLabel('workMode', 'HYBRID')}</option>
                              <option value="REMOTE">{enumLabel('workMode', 'REMOTE')}</option>
                            </select>
                          </label>
                        </div>
                        <div className="grid-2">
                          <label>
                            <LabelText>{t('employmentType')}</LabelText>
                            <select name="employmentType" defaultValue={j.employmentType || 'FULL_TIME'}>
                              <option value="FULL_TIME">
                                {enumLabel('employmentType', 'FULL_TIME')}
                              </option>
                              <option value="PART_TIME">
                                {enumLabel('employmentType', 'PART_TIME')}
                              </option>
                              <option value="CONTRACT">
                                {enumLabel('employmentType', 'CONTRACT')}
                              </option>
                              <option value="INTERNSHIP">
                                {enumLabel('employmentType', 'INTERNSHIP')}
                              </option>
                            </select>
                          </label>
                          <label>
                            <LabelText>{t('rec.salaryPeriod')}</LabelText>
                            <select name="salaryPeriod" defaultValue={j.salaryPeriod || 'MONTHLY'}>
                              <option value="MONTHLY">{t('rec.periodMonthly')}</option>
                              <option value="YEARLY">{t('rec.periodYearly')}</option>
                              <option value="HOURLY">{t('rec.periodHourly')}</option>
                            </select>
                          </label>
                        </div>
                        <div className="grid-2">
                          <label>
                            <LabelText>{t('rec.salaryMin')}</LabelText>
                            <NumberInput name="salaryMin" defaultValue={j.salaryMin ?? undefined} min={0} />
                          </label>
                          <label>
                            <LabelText>{t('rec.salaryMax')}</LabelText>
                            <NumberInput name="salaryMax" defaultValue={j.salaryMax ?? undefined} min={0} />
                          </label>
                        </div>
                        <label>
                          <LabelText>{t('rec.currency')}</LabelText>
                          <select name="currency" defaultValue={j.currency || 'UZS'}>
                            <option value="UZS">UZS</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </label>
                        <div>
                          <LabelText>{t('languages')}</LabelText>
                          <p className="muted" style={{ fontSize: '0.78rem', margin: '0.25rem 0 0.4rem' }}>
                            {t('jobLanguagesHint')}
                          </p>
                          <div className="chips" style={{ margin: '0.4rem 0' }}>
                            {editJobLanguages.map((l) => (
                              <span key={l.code} className="badge">
                                {l.name} {l.minLevel}
                                {l.isRequired ? '' : ` (${t('optional')})`}
                                <button
                                  type="button"
                                  className="ghost"
                                  style={{ marginLeft: 6, padding: 0 }}
                                  onClick={() =>
                                    setEditJobLanguages((prev) => prev.filter((x) => x.code !== l.code))
                                  }
                                >
                                  x
                                </button>
                              </span>
                            ))}
                          </div>
                          {editJobLanguages.length < 4 && (
                            <LookupCombobox
                              kind="languages"
                              allowCreate={false}
                              submitLabel={t('addLanguage')}
                              placeholder={t('languageSearchPlaceholder')}
                              levelOptions={['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'].map((v) => ({
                                value: v,
                                label: v,
                              }))}
                              defaultLevel="B1"
                              onPick={(item) => {
                                const code = item.code || item.slug;
                                if (!code) return;
                                setEditJobLanguages((prev) => {
                                  if (prev.some((p) => p.code === code) || prev.length >= 4) return prev;
                                  return [
                                    ...prev,
                                    {
                                      code,
                                      name: item.name,
                                      minLevel: item.level || 'B1',
                                      isRequired: true,
                                    },
                                  ];
                                });
                              }}
                            />
                          )}
                        </div>
                        <button type="submit">{t('rec.saveChanges')}</button>
                      </form>
                      <JobLanguageVersions jobId={j.id} onFlash={flash} />
                    </>
                  )}
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
                  {t('rec.pipelineTitle')}
                </h2>
                <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.9rem' }}>
                  {t('rec.pipelineSubtitle')}
                </p>
              </div>
              <label style={{ display: 'grid', gap: '0.3rem' }}>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {t('rec.jobPost')}
                </span>
                <select
                  value={selectedJob}
                  onChange={(e) => setSelectedJob(e.target.value)}
                  className="job-select"
                  title={t('rec.selectJobPost')}
                  aria-label={t('rec.selectJobPost')}
                >
                  {jobs.length === 0 && <option value="">{t('rec.noJobsYet')}</option>}
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {jobSelectLabel(j, enumLabel, t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!selectedJob ? (
              <div className="card">
                <p className="muted" style={{ margin: 0 }}>
                  {t('rec.pipelineEmpty')}
                </p>
              </div>
            ) : (
              <>
                {selectedAppIds.length > 0 && (
                  <div className="bulk-action-bar card">
                    <div className="bulk-action-bar-head">
                      <strong>
                        {t('rec.selectedCount').replace('{n}', String(selectedAppIds.length))}
                      </strong>
                      <button type="button" className="chip" onClick={() => setSelectedAppIds([])}>
                        {t('rec.clear')}
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => setTab('bulk')}
                      >
                        {t('rec.templatesHistory')}
                      </button>
                    </div>
                    <div className="bulk-action-fields">
                      <label>
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          {t('rec.moveToStage')}
                        </span>
                        <select
                          value={bulkToStatus}
                          onChange={(e) => setBulkToStatus(e.target.value)}
                          aria-label={t('rec.bulkTargetStage')}
                        >
                          <option value="">{t('rec.keepStage')}</option>
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {enumLabel('applicationStatus', s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          {t('rec.template')}
                        </span>
                        <select
                          value={bulkTemplateId}
                          onChange={(e) => {
                            setBulkTemplateId(e.target.value);
                            const t = bulkTemplates.find((x) => x.id === e.target.value);
                            if (t) setBulkMessage(t.body);
                          }}
                          aria-label={t('rec.bulkTemplateAria')}
                        >
                          <option value="">{t('rec.customNone')}</option>
                          {bulkTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="bulk-action-message">
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          {t('rec.messageOptional')}
                        </span>
                        <textarea
                          value={bulkMessage}
                          onChange={(e) => setBulkMessage(e.target.value)}
                          rows={2}
                          placeholder={t('rec.bulkMessagePlaceholder')}
                        />
                      </label>
                      <button
                        type="button"
                        className="chip active"
                        disabled={bulkBusy}
                        onClick={() => runBulkAction()}
                      >
                        {bulkBusy ? t('rec.running') : t('rec.applyToSelected')}
                      </button>
                    </div>
                    <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
                      {t('rec.bulkOptOutNote')}
                    </p>
                  </div>
                )}

                <div className="pipeline">
                  {STAGES.map((stage) => {
                    const cards = byStage[stage] || [];
                    const stageIds = cards.map((a: any) => a.id as string);
                    const allSelected =
                      stageIds.length > 0 && stageIds.every((id) => selectedAppIds.includes(id));
                    return (
                      <div key={stage} className="pipeline-col">
                        <h4>
                          <label className="pipeline-col-select">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              disabled={cards.length === 0}
                              onChange={() => toggleStageSelect(stage)}
                              aria-label={t('rec.selectAllIn').replace(
                                '{name}',
                                enumLabel('applicationStatus', stage),
                              )}
                            />
                            <span>{enumLabel('applicationStatus', stage)}</span>
                          </label>
                          <span className="pipeline-col-count">{cards.length}</span>
                        </h4>
                        {cards.length === 0 && (
                          <div className="pipeline-empty">{t('rec.noCandidates')}</div>
                        )}
                        {cards.map((a) => {
                          const name = a.profile?.user?.fullName || t('rec.candidateFallback');
                          const avatar =
                            a.profile?.user?.avatarUrl ||
                            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;
                          const score = a.matchScore != null ? Math.round(a.matchScore) : null;
                          const selected = selectedAppIds.includes(a.id);
                          return (
                            <div
                              key={a.id}
                              className={`candidate-card${selected ? ' selected' : ''}`}
                            >
                              <div className="candidate-card-head">
                                <label className="bulk-card-check">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleAppSelected(a.id)}
                                    aria-label={t('rec.selectCandidate').replace('{name}', name)}
                                  />
                                </label>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className="avatar avatar-sm" src={avatar} alt="" />
                                <div className="candidate-card-meta">
                                  <strong
                                    style={{
                                      fontSize: '0.9rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.35rem',
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {name}
                                    </span>
                                    <PresenceDot status={pipelinePresence[a.profile?.user?.id]} />
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
                                    {a.profile?.headline || '-'}
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
                                    {t('rec.matchDetails').replace('{n}', String(score))}
                                  </button>
                                  {breakdownId === a.id && a.matchBreakdown && (
                                    <MatchBreakdownPanel
                                      breakdown={a.matchBreakdown}
                                      showSkillChips={false}
                                    />
                                  )}
                                  <div className="match-bar">
                                    <span style={{ width: `${score}%` }} />
                                  </div>
                                </>
                              )}
                              <div className="chips" style={{ marginTop: '0.55rem' }}>
                                {a.hasResumeFile ? (
                                  <button
                                    type="button"
                                    className="chip"
                                    style={{ fontSize: '0.72rem' }}
                                    onClick={() => viewApplicationCv(a.id)}
                                  >
                                    {t('viewCv')}
                                  </button>
                                ) : null}
                                <Link
                                  href={`/candidates/${a.profile?.id}?matchJobId=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.72rem' }}
                                >
                                  {t('viewProfile')}
                                </Link>
                                <Link
                                  href={`/messages?peer=${a.profile?.user?.id}&job=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.72rem' }}
                                >
                                  {t('rec.chat')}
                                </Link>
                              </div>
                              <select
                                style={{ marginTop: '0.5rem', fontSize: '0.8rem', width: '100%' }}
                                value={a.status}
                                onChange={(e) => setStatus(a.id, e.target.value)}
                                aria-label={t('rec.statusFor').replace('{name}', name)}
                              >
                                {STAGES.map((s) => (
                                  <option key={s} value={s}>
                                    {enumLabel('applicationStatus', s)}
                                  </option>
                                ))}
                              </select>
                              {stage === 'INTERVIEW' || stage === 'IN_REVIEW' ? (
                                <form
                                  style={{ marginTop: '0.5rem', display: 'grid', gap: '0.25rem' }}
                                  onSubmit={(e) => scheduleInterview(e, a.id)}
                                >
                                  <label>
                                    <LabelText required>{t('rec.interviewTime')}</LabelText>
                                    <input
                                      name="scheduledAt"
                                      type="datetime-local"
                                      required
                                      style={{ fontSize: '0.75rem', width: '100%' }}
                                    />
                                  </label>
                                  <label>
                                    <LabelText>{t('rec.meetingUrl')}</LabelText>
                                    <input
                                      name="meetingUrl"
                                      placeholder={t('rec.meetingUrlPlaceholder')}
                                      style={{ fontSize: '0.75rem', width: '100%' }}
                                    />
                                  </label>
                                  <button type="submit" style={{ padding: '0.35rem', fontSize: '0.75rem' }}>
                                    {t('rec.scheduleInterview')}
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
                      {t('rec.recommendedCandidates')}
                    </h3>
                    <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                      {t('rec.recommendedSubtitle')}
                    </p>
                  </div>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {t('rec.suggestedCount').replace('{n}', String(recommended.length))}
                  </span>
                </div>
                {recommended.length === 0 ? (
                  <div className="card">
                    <p className="muted" style={{ margin: 0 }}>
                      {t('rec.recommendedEmpty')}
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
                              {r.profile.headline || '-'}
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
                                  {t('viewProfile')}
                                </Link>
                              {canColdChat ? (
                                <Link
                                  href={`/messages?peer=${r.profile.user.id}&job=${selectedJob}`}
                                  className="chip"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  {t('rec.chat')}
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  className="chip muted"
                                  title={t('rec.coldChatLocked')}
                                  style={{ fontSize: '0.75rem' }}
                                  onClick={() => setTab('billing')}
                                >
                                  {t('rec.chatPremium')}
                                </button>
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


        {tab === 'bulk' && companyId && (
          <BulkCommsPanel companyId={companyId} jobPostId={selectedJob || undefined} />
        )}

        {tab === 'analytics' && (
          <div className="grid-2">
            <div className="card">
              <h3>{t('rec.jobAnalytics')}</h3>
              <select
                value={selectedJob}
                onChange={(e) => setSelectedJob(e.target.value)}
                className="job-select"
                title={t('rec.selectJobPost')}
                aria-label={t('rec.selectJobPost')}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jobSelectLabel(j, enumLabel, t)}
                  </option>
                ))}
              </select>
              {stats && (
                <div style={{ marginTop: '1rem' }}>
                  <p>
                    <strong>{stats.views}</strong> {t('rec.viewsWord')}
                  </p>
                  <p>
                    <strong>{stats.totalApplications}</strong> {t('rec.applicationsWord')}
                  </p>
                  <ul>
                    {Object.entries(stats.applicationsByStatus || {}).map(([k, v]) => (
                      <li key={k}>
                        {enumLabel('applicationStatus', k)}: {String(v)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="card">
              <h3>{t('rec.plan')}</h3>
              <p>
                {t('rec.currentPlan')}: <strong>{enumLabel('plan', planCode)}</strong>
              </p>
              <p className="muted" style={{ marginBottom: '0.75rem' }}>
                {t('rec.publishedJobs')}: {activePublishedJobs} / {activeJobLimit}
              </p>
              <button type="button" className="chip active" onClick={() => setTab('billing')}>
                {t('rec.managePlanBilling')}
              </button>
            </div>
          </div>
        )}

        {tab === 'billing' && (
          <div>
            <h2 className="section-title">{t('rec.tabBilling')}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {t('rec.currentPlan')}: <strong>{enumLabel('plan', planCode)}</strong>
              {subscription?.endsAt
                ? ` | ${t('rec.renewsEnds').replace(
                    '{date}',
                    new Date(subscription.endsAt).toLocaleDateString(),
                  )}`
                : ''}
              {' | '}
              {t('rec.publishedJobs')}: {activePublishedJobs} / {activeJobLimit}
            </p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {t('rec.demoCheckoutNote')}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1rem',
                marginTop: '1.25rem',
              }}
            >
              {PLAN_ORDER.map((plan) => {
                const price = PLAN_PRICES_UZS[plan];
                const current = planCode === plan;
                const canUpgrade =
                  plan !== 'FREE' && planRank(plan) > planRank(planCode) && !billingBusy;
                return (
                  <div
                    key={plan}
                    className="card"
                    style={{
                      borderColor: current ? 'var(--accent, #0f766e)' : undefined,
                      outline: current ? '2px solid var(--accent, #0f766e)' : undefined,
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>{enumLabel('plan', plan)}</h3>
                    <p style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0.35rem 0' }}>
                      {price === 0 ? t('rec.free') : `${formatUzs(price)}${t('rec.perMonth')}`}
                    </p>
                    <ul style={{ margin: '0.75rem 0 1rem', paddingLeft: '1.1rem' }}>
                      {PLAN_FEATURES[plan].map((f) => (
                        <li key={f} style={{ marginBottom: '0.25rem' }}>
                          {t(f)}
                        </li>
                      ))}
                    </ul>
                    {current ? (
                      <span className="chip muted">{t('rec.currentPlan')}</span>
                    ) : canUpgrade ? (
                      <button
                        type="button"
                        disabled={billingBusy}
                        onClick={() => upgradePlan(plan as 'STANDARD' | 'PREMIUM' | 'VIP')}
                      >
                        {t('rec.upgradeTo').replace('{plan}', enumLabel('plan', plan))}
                      </button>
                    ) : (
                      <span className="chip muted">
                        {plan === 'FREE' ? t('rec.included') : t('rec.alreadyHigherPlan')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <h3 style={{ marginTop: 0 }}>{t('rec.hotJobBoosts')}</h3>
              <p className="muted" style={{ marginBottom: '0.75rem' }}>
                {t('rec.hotBoostHint')}
              </p>
              {!jobs.filter((j) => j.status === 'PUBLISHED').length && (
                <p className="muted">{t('rec.noPublishedJobs')}</p>
              )}
              {jobs
                .filter((j) => j.status === 'PUBLISHED')
                .map((j) => (
                  <div
                    key={j.id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.65rem 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <strong>{j.title}</strong>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {localizedJobLocation(j, t)}
                        {j.boostUntil && new Date(j.boostUntil) > new Date()
                          ? ` | ${t('rec.hotUntil').replace(
                              '{date}',
                              new Date(j.boostUntil).toLocaleDateString(),
                            )}`
                          : ''}
                      </div>
                    </div>
                    <div className="chips">
                      {HOT_JOB_DAYS.map((days) => (
                        <button
                          key={days}
                          type="button"
                          className="chip"
                          disabled={billingBusy}
                          onClick={() => buyHotBoost(j.id, days)}
                        >
                          {t('rec.daysShort').replace('{n}', String(days))} |{' '}
                          {formatUzs(PLAN_PRICES_UZS[`HOT_JOB_${days}D`])}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {tab === 'company' && company && (
          <div className="grid-2">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('verifyEmailTitle')}</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                {accountEmail || '-'} -{' '}
                {emailVerified ? (
                  <span style={{ color: '#047857', fontWeight: 600 }}>{t('emailVerifiedBadge')}</span>
                ) : (
                  <span style={{ color: '#b45309', fontWeight: 600 }}>{t('emailUnverifiedBadge')}</span>
                )}
              </p>
              {!emailVerified && (
                <>
                  <p className="muted" style={{ fontSize: '0.9rem' }}>
                    {t('verifyEmailProfileHint')}
                  </p>
                  <button
                    type="button"
                    disabled={verifyBusy}
                    onClick={() => requestEmailVerification()}
                  >
                    {verifyBusy ? t('verifyEmailSending') : t('verifyEmailCta')}
                  </button>
                </>
              )}
            </div>
            <div className="card">
              <h2 className="section-title">{sanitizeMojibake(company.name)}</h2>
              <p className="muted">{sanitizeMojibake(company.description)}</p>
              <p>
                {t('rec.members')}: {company.members?.length ?? company._count?.members} |{' '}
                {t('jobs')}: {company._count?.jobPosts} | {t('rec.followers')}:{' '}
                {company._count?.followers}
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {t('rec.publicPage')}:{' '}
                <a href={`/companies/${company.slug}`}>/companies/{company.slug}</a>
              </p>
              <div style={{ marginTop: '1rem' }}>
                <ImageCropUpload
                  mode="logo"
                  label={t('rec.companyLogo')}
                  value={company.logoUrl}
                  uploadPath={`/companies/${companyId}/logo`}
                  clearPath={`/companies/${companyId}/logo`}
                  onUploaded={async () => {
                    await refreshMemberships();
                    await loadCompanyDetail(companyId);
                    flash(t('rec.logoUpdated'));
                  }}
                />
              </div>
            </div>
            <div className="card">
              <h3>{t('rec.editCompanyProfile')}</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={updateCompany} key={company.id}>
                <label>
                  <LabelText required>{t('companyName')}</LabelText>
                  <input name="name" defaultValue={company.name} required minLength={2} />
                </label>
                <label>
                  <LabelText>{t('rec.description')}</LabelText>
                  <textarea name="description" rows={4} defaultValue={company.description || ''} />
                </label>
                <label>
                  <LabelText>{t('trustItemWebsite')}</LabelText>
                  <input name="website" type="url" defaultValue={company.website || ''} placeholder="https://..." />
                </label>
                <label>
                  <LabelText>{t('city')}</LabelText>
                  <select name="citySlug" defaultValue={company.city?.slug || ''}>
                    <option value="">-</option>
                    {meta.cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>{t('trustItemIndustry')}</LabelText>
                  <select name="industrySlug" defaultValue={company.industry?.slug || ''}>
                    <option value="">-</option>
                    {industryGroups.map((g) => (
                      <optgroup key={g.slug} label={g.name}>
                        {g.industries.map((i) => (
                          <option key={i.slug} value={i.slug}>
                            {i.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  <LabelText>{t('trustItemSize')}</LabelText>
                  <select name="size" defaultValue={company.size || ''}>
                    <option value="">-</option>
                    <option value="SIZE_1_10">1-10</option>
                    <option value="SIZE_11_50">11-50</option>
                    <option value="SIZE_51_200">51-200</option>
                    <option value="SIZE_201_1000">201-1000</option>
                    <option value="SIZE_1000_PLUS">1000+</option>
                  </select>
                </label>
                <button type="submit">{t('rec.saveCompany')}</button>
              </form>
            </div>
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h3>{t('rec.team')}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
                {(company.members || []).map((m: any) => (
                  <li
                    key={m.userId || m.user?.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.45rem 0',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                    }}
                  >
                    <span>
                      {m.user?.fullName || m.user?.email}{' '}
                      <span className="muted">({m.role})</span>
                    </span>
                    {m.role !== 'OWNER' && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => removeMember(m.userId || m.user?.id)}
                      >
                        {t('rec.remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form className="form-stack" onSubmit={inviteMember}>
                <label>
                  <LabelText>{t('rec.inviteByEmail')}</LabelText>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="recruiter@company.uz"
                    required
                  />
                </label>
                <button type="submit" disabled={inviteBusy}>
                  {inviteBusy ? t('rec.inviting') : t('rec.inviteMember')}
                </button>
              </form>
            </div>
          </div>
        )}
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
      <RecruiterDashboard />
    </Suspense>
  );
}
