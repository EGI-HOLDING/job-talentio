'use client';

import { Link, localeHref } from '@/lib/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { benefitIconLabel } from '@/lib/icons';
import { sanitizeMojibake } from '@/lib/text';
import { jobLocationLabel } from '@/lib/location';
import { FormField, LabelText } from '@/components/ui/Field';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';
import { CreateResumeModal } from '@/components/resume/CreateResumeModal';
import { MatchBreakdownPanel } from '@/components/ui/MatchBreakdownPanel';
import { useI18n } from '@/lib/i18n';
import { formatSalaryRange } from '@/lib/numberFormat';

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
  salaryMin?: number | null;
  salaryMax?: number | null;
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
    _count?: { followers: number };
  };
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

function formatSalary(min?: number | null, max?: number | null) {
  if (!min && !max) return 'Negotiable';
  return formatSalaryRange(min, max) || 'Negotiable';
}

type MatchBreakdownState = {
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

export function JobDetailClient() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showApply, setShowApply] = useState(false);
  const [showCreateResume, setShowCreateResume] = useState(false);
  const [following, setFollowing] = useState(false);
  const [myApplication, setMyApplication] = useState<MyApplicationState | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  async function loadResumes() {
    const p = await api<{ resumes?: ResumeOption[] }>('/profiles/me');
    const list = p.resumes || [];
    setResumes(list);
    const primary = list.find((r) => r.isPrimary) || list[0];
    setSelectedResumeId(primary?.id || '');
    return list;
  }

  useEffect(() => {
    api<Job>(`/jobs/${id}`)
      .then(async (j) => {
        setJob({
          ...j,
          isHot: !!(j.boostUntil && new Date(j.boostUntil).getTime() > Date.now()),
        });
        if (session) {
          try {
            const f = await api<{ following: boolean }>(`/companies/${j.company.id}/following`);
            setFollowing(f.following);
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
            setMyApplication(mine.application);
          } catch {
            /* ignore - guest / network */
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function toggleFollow() {
    if (!session || !job) {
      window.location.href = localeHref('/login');
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
      window.location.href = localeHref('/login');
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
        }),
      });
      setMyApplication({
        id: created.id,
        status: created.status || 'NEW',
        matchScore: created.matchScore,
        matchBreakdown: created.matchBreakdown,
        createdAt: created.createdAt || new Date().toISOString(),
      });
      setSuccess('Application submitted! Match score was calculated for the recruiter.');
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

  async function saveJob() {
    if (!session) {
      window.location.href = localeHref('/login');
      return;
    }
    await api(`/profiles/me/saved-jobs/${id}`, { method: 'POST' });
    setSuccess('Job saved to your list.');
  }

  if (!job && !error) return <DetailPageSkeleton />;
  if (error && !job) return <div className="shell"><div className="error">{error}</div></div>;
  if (!job) return null;

  return (
    <div className="shell" style={{ padding: '1.5rem 0 3rem' }}>
      <div className={`job-detail-header${job.isHot ? ' job-detail-header--hot' : ''}`}>
        <span className="company-logo-tile" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="company-logo"
            src={
              job.company.logoUrl ||
              `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(job.company.name)}`
            }
            alt=""
          />
        </span>
        <div>
          <div className="chips" style={{ marginBottom: '0.5rem' }}>
            {job.isHot && <span className="badge hot">Hot Job</span>}
            {job.category && <span className="badge">{job.category.name}</span>}
            {job.experienceLevel && <span className="badge skill">{job.experienceLevel}</span>}
          </div>
          <h1 style={{ margin: '0 0 0.35rem', fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>
            {sanitizeMojibake(job.title)}
          </h1>
          <div className="job-meta">
            <Link href={`/companies/${job.company.slug}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>
              {job.company.name}
              {job.company.isVerified ? ' ✓' : ''}
            </Link>
            <span>{jobLocationLabel(job)}</span>
            {job.employmentType && <span>{job.employmentType.replace('_', ' ')}</span>}
            {job._count && (
              <span className="muted">
                {job._count.views} views | {job._count.applications} applicants
              </span>
            )}
          </div>
          <p className="salary">{formatSalary(job.salaryMin, job.salaryMax)}</p>
          {job.isHot && (
            <div className="hot-urgency">
              {job.boostUntil
                ? `Boosted until ${new Date(job.boostUntil).toLocaleDateString()} - limited window`
                : 'Limited-time hot boost'}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {alreadyApplied ? (
            <>
              <div className="badge match" style={{ justifyContent: 'center', textAlign: 'center' }}>
                Applied | {myApplication?.status}
              </div>
              <Link
                href="/dashboard/employee?tab=applications"
                className="secondary"
                style={{ textAlign: 'center', padding: '0.55rem 1rem', borderRadius: 10 }}
              >
                View my applications
              </Link>
            </>
          ) : (
            (session?.user.role === 'EMPLOYEE' || !session) && (
              <button
                type="button"
                className="cta"
                onClick={async () => {
                  if (!session) {
                    window.location.href = localeHref('/login');
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
                }}
                disabled={submitting}
              >
                Apply now
              </button>
            )
          )}
          <button type="button" className="secondary" onClick={saveJob}>
            Save job
          </button>
          <button type="button" className="secondary" onClick={toggleFollow}>
            {following ? 'Following company' : 'Follow company'}
          </button>
          {session?.user.role === 'EMPLOYEE' && job.chatPeerUserId && (
            <Link
              href={`/messages?peer=${job.chatPeerUserId}&job=${job.id}`}
              className="secondary"
              style={{ textAlign: 'center', padding: '0.55rem 1rem', borderRadius: 10 }}
            >
              Chat with recruiter
            </Link>
          )}
        </div>
      </div>

      {success && <div className="success" style={{ marginTop: '1rem' }}>{success}</div>}
      {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="grid-2" style={{ marginTop: '1.25rem' }}>
        <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          <div className="card">
            <h2 className="section-title">About the role</h2>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{sanitizeMojibake(job.description)}</div>
          </div>
          {session?.user.role === 'EMPLOYEE' && viewerMatchBreakdown && (
            <div className="card">
              <h2 className="section-title" style={{ marginBottom: '0.35rem' }}>
                Your match
                {viewerMatchScore != null ? ` ${viewerMatchScore}%` : ''}
              </h2>
              <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                How your profile scores against this role
              </p>
              <MatchBreakdownPanel breakdown={viewerMatchBreakdown} />
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card">
            <h3>Skills</h3>
            <div className="chips" style={{ marginTop: '0.75rem' }}>
              {(job.jobSkills || []).map((js, i) => (
                <span key={i} className={`badge ${js.isRequired ? '' : 'skill'}`}>
                  {js.skill.name}
                  {js.isRequired ? ' *' : ''}
                </span>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Benefits</h3>
            <div className="chips" style={{ marginTop: '0.75rem' }}>
              {(job.benefits || []).map((b, i) => (
                <span key={i} className="chip">
                  {benefitIconLabel(b.benefit.slug, b.benefit.icon)}
                  {b.benefit.name}
                </span>
              ))}
              {!job.benefits?.length && <span className="muted">No benefits listed</span>}
            </div>
          </div>
          {(job.jobLanguages || []).length > 0 && (
            <div className="card">
              <h3>{t('languages')}</h3>
              <div className="chips" style={{ marginTop: '0.75rem' }}>
                {(job.jobLanguages || []).map((jl, i) => (
                  <span key={i} className={`badge ${jl.isRequired ? '' : 'skill'}`}>
                    {jl.language.name} {jl.minLevel}+
                    {jl.isRequired ? ' *' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          {job.experienceYearsMin != null && (
            <div className="card">
              <h3>Experience</h3>
              <p className="muted">{job.experienceYearsMin}+ years preferred</p>
            </div>
          )}
        </div>
      </div>

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
            setSuccess(
              'Resume draft created. Export a PDF from the builder before applying with a file, or continue without a PDF.',
            );
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
                  <LabelText>Resume</LabelText>
                  <select
                    value={selectedResumeId}
                    onChange={(e) => setSelectedResumeId(e.target.value)}
                    required={resumes.length > 0}
                  >
                    {resumes.length === 0 && <option value="">No resumes on profile</option>}
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                        {r.targetJobTitle?.name ? ` - ${r.targetJobTitle.name}` : ''}
                        {r.isPrimary ? ' (primary)' : ''}
                        {r.hasFile || r.fileKey ? '' : ' - no PDF'}
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
                    Selected resume has no PDF file yet. Export from the resume builder or attach a file before applying.
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
                        <option value="">Select...</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
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
                {submitting ? 'Submitting...' : t('submitApplication')}
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
    </div>
  );
}
