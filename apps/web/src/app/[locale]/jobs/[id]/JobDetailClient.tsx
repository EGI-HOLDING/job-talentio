'use client';
import { EmployeeJobMatch } from '@/components/jobs/EmployeeJobMatch';
import { authLink } from '@/lib/authReturn';

import { Link, localeHref } from '@/lib/navigation';
import { useEffect, useState, useRef } from 'react';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { usePromotionRefresh } from '@/lib/usePromotionRefresh';
import type { JobPromotion } from '@job-talentio/shared';
import { useParams, useSearchParams } from 'next/navigation';
import { jobBackHref, jobDetailHref } from '@/lib/accountNavigation';
import { trackJobEvent } from '@/lib/hr-events';
import { peekApi, api, getSession } from '@/lib/api';

import { CvUploadDialog } from '@/components/profile/CvUploadDialog';
import { useSessionIdentity } from '@/lib/useSessionIdentity';
import { CvApplicationPicker } from '@/components/jobs/CvApplicationPicker';
import { useI18n } from '@/lib/i18n';

import { JobPreview } from '@/components/jobs/JobPreview';
import workspaceStyles from '@/components/jobs/JobsWorkspace.module.css';

type ResumeOption = {
  id: string;
  title: string;
  isPrimary?: boolean;
  hasFile?: boolean;
  fileKey?: string | null;
  format?: string | null;
  updatedAt?: string;
};
type Job = {
  promotion?: JobPromotion | null;
  id: string;
  title: string;
  description: string;
  /** Language the title and description are served in (may differ from the UI). */
  contentLocale?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  salaryPeriod?: string;
  workMode?: string;
  employmentType?: string;
  experienceLevel?: string | null;
  experienceYearsMin?: number | null;

  chatPeerUserId?: string | null;
  jobTitleId?: string | null;
  jobTitle?: { id: string; name: string; slug: string } | null;
  company: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string | null;
    isVerified?: boolean;
    /** Confidential posting: placeholder company, nothing to link or follow. */
    anonymous?: boolean;
    _count?: { followers: number };
  };
  isAnonymous?: boolean;
  city?: { name: string } | null;
  category?: { name: string } | null;
  jobSkills?: Array<{ skill: { name: string }; isRequired: boolean }>;
  jobLanguages?: Array<{
    language: { name: string; code: string };
    minLevel: string;
    isRequired: boolean;
  }>;
  benefits?: Array<{ benefit: { name: string; slug?: string; icon?: string | null } }>;
  _count?: { applications: number; views: number };
  matchScore?: number | null;
  matchBreakdown?: MatchBreakdownState | null;
};


type MatchBreakdownState = {
  title?: number;
  skills?: number;
  experience?: number;
  location?: number;
  education?: number;
  language?: number;
  total?: number;
  details?: {
    matchedSkills?: string[];
    missingRequiredSkills?: string[];
    matchedLanguages?: string[];
    missingRequiredLanguages?: string[];
  } | null;
};

type MyApplicationState = {
  id: string;
  status: string;
  matchScore?: number | null;
  matchBreakdown?: MatchBreakdownState | null;
  createdAt: string;
  resumeTitle?: string | null;
  hasResumeFile?: boolean;
};

type DetailProps = { jobId?: string; embedded?: boolean; country?: string; onBack?: () => void; saveState?: { saved: boolean; pending: boolean; onToggle: () => Promise<void> } };

export function JobDetailClient({ jobId, embedded = false, country, onBack, saveState }: DetailProps = {}) {
  const actorIdentity=useSessionIdentity();
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();
  const id = jobId || params.id || '';
  const { t, locale } = useI18n();
  const [job, setJob] = useState<Job | null>(()=>peekApi<Job>('/jobs/'+id)||null);
  const [error, setError] = useState('');
  const [showCvPicker, setShowCvPicker] = useState(false);
  const [showCvUpload, setShowCvUpload] = useState(false);
  const [resumeLoadError, setResumeLoadError] = useState('');
  const [resumesLoading, setResumesLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [myApplication, setMyApplication] = useState<MyApplicationState | null>(null);
  const [submittedCvBusy, setSubmittedCvBusy] = useState(false);
  const [submittedCvError, setSubmittedCvError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const applicationSubmitPending = useRef<symbol|null>(null);
  const session = typeof window !== 'undefined' ? getSession() : null;
  const promotionRead = useRef(0);
  const promotionContext = useRef('');
  promotionContext.current = id + ':' + locale + ':' + (session?.user.id ?? '');
  usePromotionRefresh(job ? [job] : [], () => {
    const request = ++promotionRead.current, context = promotionContext.current;
    api<Job>('/jobs/' + encodeURIComponent(id)).then(fresh => {
      if (request === promotionRead.current && context === promotionContext.current) setJob(current => current?.id === fresh.id ? {...current,promotion:fresh.promotion} : current);
    }).catch(() => { if (request === promotionRead.current && context === promotionContext.current) setJob(current => current ? {...current,promotion:null} : current); });
  });
  const alreadyApplied = Boolean(myApplication);
  const isEmployee = session?.user.role === 'EMPLOYEE';
  const applicationRead = useRef(0), applicationContext = useRef('');
  const submittedCvRequest = useRef(0), submittedCvPending = useRef(false);
  applicationContext.current = id + ':' + locale + ':' + session?.user.id;
  useEffect(()=>{applicationSubmitPending.current=null;setShowCvPicker(false);setShowCvUpload(false);setResumes([]);setSelectedResumeId('');setResumeLoadError('');setResumesLoading(false);setSubmittingApplication(false);},[id,actorIdentity]);
  async function refreshApplication() {
    if (!isEmployee) return;
    const context = applicationContext.current, sequence = ++applicationRead.current;
    const mine = await api<{applied:boolean;application:MyApplicationState|null}>(`/applications/mine/jobs/${id}`, {signal:AbortSignal.timeout(15000)});
    if (context === applicationContext.current && sequence === applicationRead.current) setMyApplication(mine.application);
  }
  useLiveRefresh('applications', refreshApplication, isEmployee, applicationContext.current);
  const ownsCompany = session?.user.memberships?.some((membership) => membership.companyId === job?.company.id);
  const backHref = jobBackHref(session?.user.role, searchParams.get('returnTo'), ownsCompany ? job?.company.id : undefined);
  useEffect(() => {
    if (embedded || !isEmployee) return;
    let active = true;
    api<Array<{jobPostId: string}>>('/profiles/me/saved-jobs').then((rows) => { if (active) setSaved(rows.some((row) => row.jobPostId === id)); }).catch(() => undefined);
    return () => { active = false; };
  }, [id, embedded, isEmployee]);

  async function loadResumes() {
    const actor=getSession()?.user.id,context=applicationContext.current;
    const p = await api<{ resumes?: ResumeOption[] }>('/profiles/me');
    if(actor!==getSession()?.user.id||context!==applicationContext.current)throw Error('Konteks lamaran berubah. Buka kembali pilihan CV.');
    const list = (p.resumes || []).filter(row=>row.hasFile||row.fileKey);
    setResumes(list);
    const primary = list.find((r) => r.isPrimary) || list[0];
    setSelectedResumeId(primary?.id || '');
    return list;
  }

  useEffect(() => {
    let active = true;
    setError('');
    setJob(peekApi<Job>('/jobs/'+id)||null);
    setFollowing(false);
    setMyApplication(null);
    api<Job>(`/jobs/${id}`)
      .then(async (j) => {
        if (!active) return;
        void trackJobEvent(id,'DETAIL_VIEW');
        setJob({
          ...j,
        });
        if (isEmployee) {
          try {
            const f = await api<{ following: boolean }>(`/companies/${j.company.id}/following`);
            if (active) setFollowing(f.following);
          } catch {
            /* ignore */
          }
        }
        if (session?.user.role === 'EMPLOYEE') {
          try {
            await refreshApplication();
          } catch {
            /* ignore - guest / network */
          }
        }
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, locale, retry, session?.user.id]);

  useEffect(() => {
    ++submittedCvRequest.current;
    submittedCvPending.current = false;
    setSubmittedCvBusy(false);
    setSubmittedCvError('');
    return () => { ++submittedCvRequest.current; };
  }, [id, session?.user.id, myApplication?.id]);

  async function viewSubmittedCv() {
    const application = myApplication;
    if (!application?.id || !application.hasResumeFile || submittedCvPending.current) return;
    submittedCvPending.current = true;
    setSubmittedCvBusy(true);
    setSubmittedCvError('');
    const request = ++submittedCvRequest.current;
    const identity = applicationContext.current;
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const result = await api<{ url: string }>(`/applications/${encodeURIComponent(application.id)}/resume-download`);
      if (request !== submittedCvRequest.current || identity !== applicationContext.current) { tab?.close(); return; }
      if (tab) tab.location.href = result.url;
      else window.location.assign(result.url);
    } catch (reason) {
      tab?.close();
      if (request === submittedCvRequest.current && identity === applicationContext.current) {
        setSubmittedCvError(reason instanceof Error ? reason.message : t('viewCvFailed'));
      }
    } finally {
      if (request === submittedCvRequest.current) {
        submittedCvPending.current = false;
        setSubmittedCvBusy(false);
      }
    }
  }

  async function toggleFollow() {
    if (session && !isEmployee) return;
    if (!session || !job) {
      window.location.href = localeHref(authLink('/login', `/jobs/${id}`));
      return;
    }
    if (following) {
      const r = await api<{ following: boolean }>(`/companies/${job.company.id}/follow`, {
        method: 'DELETE',
      });
      setFollowing(r.following);
    } else {
      const r = await api<{ following: boolean }>(`/companies/${job.company.id}/follow`, {
        method: 'POST',
      });
      setFollowing(r.following);
    }
  }

  async function beginApply() {
    if (!session) {
      window.location.href = localeHref(authLink('/login', `/jobs/${id}`));
      return;
    }
    if (resumesLoading) return;
    const actor=session?.user.id,context=applicationContext.current;
    setResumeLoadError('');
    setShowCvPicker(true);
    setResumesLoading(true);
    void trackJobEvent(id, 'APPLY_START');
    try {
      await loadResumes();
    } catch {
      if(actor!==getSession()?.user.id||context!==applicationContext.current)return;
      setResumes([]);
      setSelectedResumeId('');
      setResumeLoadError(t('job.cvLoadError'));
    } finally {
      if(actor===getSession()?.user.id&&context===applicationContext.current)setResumesLoading(false);
    }
  }

  async function saveJob() {
    if (!session) {
      window.location.href = localeHref(authLink('/login', `/jobs/${id}`));
      return;
    }
    if (saving || !isEmployee) return;
    setSaving(true);
    try {
      await api(`/profiles/me/saved-jobs/${id}`, { method: saved ? 'DELETE' : 'POST' });
      setSaved(!saved);
    } finally { setSaving(false); }
  }

  if (!job && !error) return <div className={`${workspaceStyles.previewLoading} ${embedded ? '' : workspaceStyles.standalone}`} role="status" aria-label={t('ui.loading')}><span /><span /><span /><span /></div>;
  if (error && !job) return <div className={workspaceStyles.previewLoading}><p className="error" role="alert">{t('public.loadError')}</p><button type="button" className={workspaceStyles.primaryButton} onClick={() => setRetry((value) => value + 1)}>{t('workspace.retry')}</button><p>{onBack ? <button type="button" className={workspaceStyles.textAction} onClick={onBack}>{t('workspace.back')}</button> : <Link href={backHref}>{t('workspace.back')}</Link>}</p></div>;
  if (!job) return null;

  async function submitSelectedCv() {
    if (!selectedResumeId || applicationSubmitPending.current || !isEmployee) return;
    const actor=session?.user.id,context=applicationContext.current,attempt=Symbol('apply');
    const current=()=>actor===getSession()?.user.id&&context===applicationContext.current&&applicationSubmitPending.current===attempt;
    applicationSubmitPending.current = attempt; setSubmittingApplication(true); setResumeLoadError('');
    const reconcile=async()=>{const mine=await api<{applied:boolean;application:MyApplicationState|null}>('/applications/mine/jobs/'+encodeURIComponent(id),{cacheMode:'no-store'});if(current()&&mine.application){setMyApplication(mine.application);setShowCvPicker(false);return true;}return false;};
    try {
      const submitted = await api<MyApplicationState>('/applications/jobs/' + encodeURIComponent(id), {
        method: 'POST', body: JSON.stringify({ resumeId: selectedResumeId }),
      });
      if (!current()) return;
      if (submitted?.id && submitted.status) {
        setMyApplication({
          id: submitted.id,
          status: submitted.status,
          createdAt: submitted.createdAt,
          hasResumeFile: true,
          resumeTitle: resumes.find(resume => resume.id === selectedResumeId)?.title,
        });
        setShowCvPicker(false);
      } else if (!await reconcile() && current()) {
        setResumeLoadError(t('job.cvLoadError'));
      }
    } catch (error) {
      if(current()){let applied=false;try{applied=await reconcile();}catch{}if(!applied&&current())setResumeLoadError(error instanceof Error ? error.message : t('job.cvLoadError'));}
    } finally { if(applicationSubmitPending.current===attempt){applicationSubmitPending.current=null;setSubmittingApplication(false);} }
  }
  const applicationDialogs = <>
    {showCvPicker && <CvApplicationPicker
      resumes={resumes}
      selectedResumeId={selectedResumeId}
      submitting={submittingApplication}
      onApply={() => void submitSelectedCv()}
      loading={resumesLoading}
      error={resumeLoadError}
      onSelect={setSelectedResumeId}
      onUpload={() => setShowCvUpload(true)}
      onClose={() => setShowCvPicker(false)}
    />}
    {showCvUpload && <CvUploadDialog
      onClose={() => setShowCvUpload(false)}
      onUploaded={async (resumeId) => {
        setResumeLoadError('');
        const list = await loadResumes();
        if (!list.some((resume) => resume.id === resumeId)) throw new Error(t('job.cvLoadError'));
        setSelectedResumeId(resumeId);
      }}
    />}
  </>;

  return <JobPreview matchReasons={isEmployee?<EmployeeJobMatch jobId={id}/>:undefined} standalone={!embedded}
    backHref={backHref}
    companyHref={'/companies/' + job.company.slug + '?returnTo=' + encodeURIComponent(jobDetailHref(id, backHref))}
    chatHref={isEmployee && myApplication && myApplication.status !== 'WITHDRAWN' && job.chatPeerUserId
      ? `/messages?peer=${encodeURIComponent(job.chatPeerUserId)}&job=${encodeURIComponent(id)}&application=${encodeURIComponent(myApplication.id)}`
      : undefined}
    whatsappApplicationId={isEmployee && myApplication && myApplication.status !== 'WITHDRAWN' && job.chatPeerUserId
      ? myApplication.id
      : undefined}
    job={job} country={country} onBack={onBack}
    onApply={!alreadyApplied && (!session || session.user.role === 'EMPLOYEE') ? () => {void trackJobEvent(id,'APPLY_CLICK');void beginApply();} : undefined}
    onSave={() => { if (saveState) void saveState.onToggle(); else void saveJob().catch((error) => setError(error.message)); }}
    saved={saveState?.saved ?? saved} saving={saveState?.pending ?? saving}
    canSave={!session || session.user.role === 'EMPLOYEE'}
    onFollow={!session || isEmployee ? () => void toggleFollow().catch((error) => setError(error.message)) : undefined} following={following}
    appliedStatus={myApplication?.status} guest={!session} busy={resumesLoading}
    submittedCvAvailable={Boolean(myApplication?.hasResumeFile)} submittedCvTitle={myApplication?.resumeTitle}
    submittedCvBusy={submittedCvBusy} submittedCvError={submittedCvError} onViewSubmittedCv={viewSubmittedCv}
    error={error}
  >{applicationDialogs}</JobPreview>;
}
