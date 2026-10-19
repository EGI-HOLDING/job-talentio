'use client';
import { authLink } from '@/lib/authReturn';

import { Link, localeHref } from '@/lib/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { readSource, rememberSource } from '@/lib/acquisition';

import { sanitizeMojibake } from '@/lib/text';

import { FormField, LabelText } from '@/components/ui/Field';
import { CreateResumeModal } from '@/components/resume/CreateResumeModal';
import { MatchBreakdownPanel } from '@/components/ui/MatchBreakdownPanel';
import { useI18n } from '@/lib/i18n';

import { JobPreview } from '@/components/jobs/JobPreview';
import workspaceStyles from '@/components/jobs/JobsWorkspace.module.css';

type Question = { id: string; question: string; type: string; isRequired: boolean };
type ResumeOption = {
  id: string;
  title: string;
  isPrimary?: boolean;
  hasFile?: boolean;
  fileKey?: string | null;
  targetJobTitle?: { id: string; name: string; slug: string } | null;
};
type Job = {
  id: string;
  title: string;
  description: string;
  /** Language the title and description are served in (may differ from the UI). */
  contentLocale?: string | null;
  isMachineTranslated?: boolean;
  canMachineTranslate?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  salaryPeriod?: string;
  workMode?: string;
  employmentType?: string;
  experienceLevel?: string | null;
  experienceYearsMin?: number | null;
  isHot?: boolean;
  boostUntil?: string | null;
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
  questions?: Question[];
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
};

type DetailProps = { jobId?: string; embedded?: boolean; country?: string; onBack?: () => void; saveState?: { saved: boolean; pending: boolean; onToggle: () => Promise<void> } };

export function JobDetailClient({ jobId, embedded = false, country, onBack, saveState }: DetailProps = {}) {
  const params = useParams<{ id?: string }>();
  const id = jobId || params.id || '';
  const { t, locale } = useI18n();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showApply, setShowApply] = useState(false);
  const [showCreateResume, setShowCreateResume] = useState(false);
  const [following, setFollowing] = useState(false);
  const [myApplication, setMyApplication] = useState<MyApplicationState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const session = typeof window !== 'undefined' ? getSession() : null;
  const alreadyApplied = Boolean(myApplication);
  const selectedResume = resumes.find((r) => r.id === selectedResumeId);
  const selectedHasFile = Boolean(selectedResume?.hasFile || selectedResume?.fileKey);
  const jobTitleId = job?.jobTitleId || job?.jobTitle?.id || null;
  const defaultApplyRole = job?.jobTitle?.name || job?.title || '';
  const viewerMatchBreakdown = myApplication?.matchBreakdown || job?.matchBreakdown || null;
  const viewerMatchScore =
    myApplication?.matchScore != null ? myApplication.matchScore : job?.matchScore ?? null;
  const isEmployee = session?.user.role === 'EMPLOYEE';
  useEffect(() => {
    if (embedded || !isEmployee) return;
    let active = true;
    api<Array<{jobPostId: string}>>('/profiles/me/saved-jobs').then((rows) => { if (active) setSaved(rows.some((row) => row.jobPostId === id)); }).catch(() => undefined);
    return () => { active = false; };
  }, [id, embedded, isEmployee]);

  async function loadResumes() {
    const p = await api<{ resumes?: ResumeOption[] }>('/profiles/me');
    const list = p.resumes || [];
    setResumes(list);
    const primary = list.find((r) => r.isPrimary) || list[0];
    setSelectedResumeId(primary?.id || '');
    return list;
  }

  useEffect(() => {
    let active = true;
    setError('');
    setJob(null);
    setFollowing(false);
    setMyApplication(null);
    // Keep the utm source from the link (Telegram, PWA, share) for the apply call.
    rememberSource(id);
    api<Job>(`/jobs/${id}`)
      .then(async (j) => {
        if (!active) return;
        setJob({
          ...j,
          isHot: !!(j.boostUntil && new Date(j.boostUntil).getTime() > Date.now()),
        });
        if (session) {
          try {
            const f = await api<{ following: boolean }>(`/companies/${j.company.id}/following`);
            if (active) setFollowing(f.following);
          } catch {
            /* ignore */
          }
        }
        if (session?.user.role === 'EMPLOYEE') {
          try {
            const mine = await api<{
              applied: boolean;
              application: MyApplicationState | null;
            }>(`/applications/mine/jobs/${id}`);
            if (active) setMyApplication(mine.application);
          } catch {
            /* ignore - guest / network */
          }
        }
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, locale, retry]);

  async function toggleFollow() {
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

  async function onApply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!session) {
      window.location.href = localeHref(authLink('/login', `/jobs/${id}`));
      return;
    }
    if (alreadyApplied || submitting) return;

    const fd = new FormData(e.currentTarget);
    // Only send non-empty answers. Optional blanks must not hit Zod min(1).
    // Use nullish coalescing so NUMBER answers of 0 are kept.
    const answers = (job?.questions || [])
      .map((q) => {
        const raw = fd.get(`q_${q.id}`);
        const answer = raw == null ? '' : String(raw).trim();
        return { questionId: q.id, answer };
      })
      .filter((a) => a.answer.length > 0);
    setSubmitting(true);
    try {
      const created = await api<MyApplicationState>(`/applications/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          coverLetter: String(fd.get('coverLetter') || '').trim() || undefined,
          answers,
          resumeId: selectedResumeId || undefined,
          source: readSource(id),
        }),
      });
      setMyApplication({
        id: created.id,
        status: created.status || 'NEW',
        matchScore: created.matchScore,
        matchBreakdown: created.matchBreakdown,
        createdAt: created.createdAt || new Date().toISOString(),
      });
      setSuccess(t('job.applySuccess'));
      setShowApply(false);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (/already applied/i.test(message)) {
        try {
          const mine = await api<{
            applied: boolean;
            application: MyApplicationState | null;
          }>(`/applications/mine/jobs/${id}`);
          setMyApplication(mine.application);
          setShowApply(false);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setSubmitting(false);
    }
  }


  async function beginApply() {
                  if (!session) {
                    window.location.href = localeHref(authLink('/login', `/jobs/${id}`));
                    return;
                  }
                  try {
                    const list = await loadResumes();
                    if (list.length === 0) {
                      setShowCreateResume(true);
                      return;
                    }
                  } catch {
                    setResumes([]);
                    setSelectedResumeId('');
                    setShowCreateResume(true);
                    return;
                  }
                  setShowApply(true);
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

  /** Machine translation is cached server-side, so this costs at most once. */
  async function machineTranslate() {
    setTranslating(true);
    setError('');
    try {
      const res = await api<{ status: string; job: Job }>(`/jobs/${id}/translate/${locale}`, {
        method: 'POST',
      });
      if (res.job) setJob(res.job);
      if (res.status === 'disabled' || res.status === 'budget-exceeded') {
        setError(t('ui.translateFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.translateFailed'));
    } finally {
      setTranslating(false);
    }
  }

  if (!job && !error) return <div className={`${workspaceStyles.previewLoading} ${embedded ? '' : workspaceStyles.standalone}`} role="status" aria-label={t('ui.loading')}><span /><span /><span /><span /></div>;
  if (error && !job) return <div className={workspaceStyles.previewLoading}><p className="error" role="alert">{t('public.loadError')}</p><button type="button" className={workspaceStyles.primaryButton} onClick={() => setRetry((value) => value + 1)}>{t('workspace.retry')}</button><p>{onBack ? <button type="button" className={workspaceStyles.textAction} onClick={onBack}>{t('workspace.back')}</button> : <Link href="/jobs">{t('workspace.back')}</Link>}</p></div>;
  if (!job) return null;

  const applicationDialogs = <>
      <CreateResumeModal
        open={showCreateResume && !alreadyApplied}
        defaultJobTitle={defaultApplyRole}
        defaultTitle={defaultApplyRole}
        secondaryLabel={t('continueWithoutResume')}
        onSecondary={() => {
          setShowCreateResume(false);
          setShowApply(true);
        }}
        onCancel={() => setShowCreateResume(false)}
        onCreated={async (result) => {
          setShowCreateResume(false);
          try {
            await loadResumes();
            setSelectedResumeId(result.id);
          } catch {
            /* ignore */
          }
          setShowApply(true);
          if (result.method === 'builder') {
            setSuccess(t('job.resumeDraftCreated'));
          }
        }}
      />

      {showApply && !alreadyApplied && (
        <div
          className="modal-backdrop"
          onClick={() => !submitting && setShowApply(false)}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="apply-dialog-title">
              {t('applyFor')} - {sanitizeMojibake(job.title)}
            </h2>
            <p className="required-note">{t('requiredFieldsNote')}</p>
            <form className="form-stack" onSubmit={onApply}>
              <fieldset disabled={submitting} style={{ border: 0, margin: 0, padding: 0 }}>
                <label>
                  <LabelText>{t('job.resume')}</LabelText>
                  <select
                    value={selectedResumeId}
                    onChange={(e) => setSelectedResumeId(e.target.value)}
                    required={resumes.length > 0}
                  >
                    {resumes.length === 0 && (
                      <option value="">{t('job.noResumesOnProfile')}</option>
                    )}
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                        {r.targetJobTitle?.name ? ` - ${r.targetJobTitle.name}` : ''}
                        {r.isPrimary ? ` (${t('job.resumePrimary')})` : ''}
                        {r.hasFile || r.fileKey ? '' : ` - ${t('job.resumeNoPdf')}`}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedResume &&
                  jobTitleId &&
                  selectedResume.targetJobTitle?.id === jobTitleId && (
                    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                      {t('resumeMatchesRole')}
                    </p>
                  )}
                {selectedResumeId && !selectedHasFile && (
                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--hot)' }}>
                    {t('job.resumeNoPdfWarning')}
                  </p>
                )}
                <FormField label={t('coverLetter')}>
                  <textarea name="coverLetter" rows={4} placeholder={t('coverLetter')} />
                </FormField>
                {(job.questions || []).map((q) => (
                  <label key={q.id}>
                    <LabelText required={q.isRequired} optional={!q.isRequired}>
                      {q.question}
                    </LabelText>
                    {q.type === 'YES_NO' ? (
                      <select name={`q_${q.id}`} required={q.isRequired} aria-required={q.isRequired}>
                        <option value="">{t('job.selectOption')}</option>
                        <option value="Yes">{t('job.yes')}</option>
                        <option value="No">{t('job.no')}</option>
                      </select>
                    ) : (
                      <input
                        name={`q_${q.id}`}
                        type={q.type === 'NUMBER' ? 'number' : 'text'}
                        required={q.isRequired}
                        aria-required={q.isRequired || undefined}
                      />
                    )}
                  </label>
                ))}
              </fieldset>
              <button type="submit" className="cta" disabled={submitting}>
                {submitting ? t('job.submitting') : t('submitApplication')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={submitting}
                onClick={() => setShowApply(false)}
              >
                {t('cancel')}
              </button>
            </form>
          </div>
        </div>
      )}
  </>;

  return <JobPreview standalone={!embedded}
    chatHref={isEmployee && job.chatPeerUserId ? `/messages?peer=${job.chatPeerUserId}&job=${id}` : undefined}
    job={job} country={country} onBack={onBack}
    onApply={!alreadyApplied && (!session || session.user.role === 'EMPLOYEE') ? () => void beginApply() : undefined}
    onSave={() => { if (saveState) void saveState.onToggle(); else void saveJob().catch((error) => setError(error.message)); }}
    saved={saveState?.saved ?? saved} saving={saveState?.pending ?? saving}
    canSave={!session || session.user.role === 'EMPLOYEE'}
    onFollow={() => void toggleFollow().catch((error) => setError(error.message))} following={following}
    appliedStatus={myApplication?.status} guest={!session} busy={submitting}
    success={success} error={error} translating={translating}
    onTranslate={job.canMachineTranslate ? () => void machineTranslate() : undefined}
    matchContent={session?.user.role === 'EMPLOYEE' && viewerMatchBreakdown ? <section><h3>{t('job.yourMatch')}{viewerMatchScore != null ? ' ' + viewerMatchScore + '%' : ''}</h3><MatchBreakdownPanel breakdown={viewerMatchBreakdown} /></section> : null}
  >{applicationDialogs}</JobPreview>;
}
