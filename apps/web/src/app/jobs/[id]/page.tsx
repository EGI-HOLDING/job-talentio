'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';

type Question = { id: string; question: string; type: string; isRequired: boolean };
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
  company: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string | null;
    isVerified?: boolean;
    members?: Array<{ userId: string; role: string }>;
    _count?: { followers: number };
  };
  city?: { name: string } | null;
  category?: { name: string } | null;
  jobSkills?: Array<{ skill: { name: string }; isRequired: boolean }>;
  benefits?: Array<{ benefit: { name: string; icon?: string | null } }>;
  questions?: Question[];
  _count?: { applications: number; views: number };
};

function formatSalary(min?: number | null, max?: number | null) {
  if (!min && !max) return 'Negotiable';
  const fmt = (n: number) => n.toLocaleString('uz-UZ');
  if (min && max) return `${fmt(min)} – ${fmt(max)} UZS`;
  return `${fmt(min || max!)} UZS`;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showApply, setShowApply] = useState(false);
  const [following, setFollowing] = useState(false);
  const session = typeof window !== 'undefined' ? getSession() : null;

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
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function toggleFollow() {
    if (!session || !job) {
      window.location.href = '/login';
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
      window.location.href = '/login';
      return;
    }
    const fd = new FormData(e.currentTarget);
    const answers = (job?.questions || []).map((q) => ({
      questionId: q.id,
      answer: String(fd.get(`q_${q.id}`) || ''),
    }));
    try {
      await api(`/applications/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({
          coverLetter: fd.get('coverLetter'),
          answers,
        }),
      });
      setSuccess('Application submitted! Match score was calculated for the recruiter.');
      setShowApply(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveJob() {
    if (!session) {
      window.location.href = '/login';
      return;
    }
    await api(`/profiles/me/saved-jobs/${id}`, { method: 'POST' });
    setSuccess('Job saved to your list.');
  }

  if (!job && !error) return <div className="shell" style={{ padding: '2rem' }}>Loading…</div>;
  if (error && !job) return <div className="shell"><div className="error">{error}</div></div>;
  if (!job) return null;

  return (
    <div className="shell" style={{ padding: '1.5rem 0 3rem' }}>
      <div className="job-detail-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            job.company.logoUrl ||
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(job.company.name)}`
          }
          alt=""
        />
        <div>
          <div className="chips" style={{ marginBottom: '0.5rem' }}>
            {job.isHot && <span className="badge hot">Hot Job</span>}
            {job.category && <span className="badge">{job.category.name}</span>}
            {job.experienceLevel && <span className="badge skill">{job.experienceLevel}</span>}
          </div>
          <h1 style={{ margin: '0 0 0.35rem', fontFamily: 'var(--font-display)', fontSize: '1.75rem' }}>
            {job.title}
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
                {job._count.views} views · {job._count.applications} applicants
              </span>
            )}
          </div>
          <p className="salary">{formatSalary(job.salaryMin, job.salaryMax)}</p>
        </div>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {(session?.user.role === 'EMPLOYEE' || !session) && (
            <button type="button" className="cta" onClick={() => setShowApply(true)}>
              Apply now
            </button>
          )}
          <button type="button" className="secondary" onClick={saveJob}>
            Save job
          </button>
          <button type="button" className="secondary" onClick={toggleFollow}>
            {following ? 'Following company' : 'Follow company'}
          </button>
          {session?.user.role === 'EMPLOYEE' && (job.company.members || []).length > 0 && (
            <Link
              href={`/messages?peer=${(job.company.members!.find((m) => m.role === 'OWNER') || job.company.members![0]).userId}&job=${job.id}`}
              className="secondary"
              style={{ textAlign: 'center', padding: '0.55rem 1rem', borderRadius: 10 }}
            >
              💬 Chat with recruiter
            </Link>
          )}
        </div>
      </div>

      {success && <div className="success" style={{ marginTop: '1rem' }}>{success}</div>}
      {error && <div className="error" style={{ marginTop: '1rem' }}>{error}</div>}

      <div className="grid-2" style={{ marginTop: '1.25rem' }}>
        <div className="card">
          <h2 className="section-title">About the role</h2>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{job.description}</div>
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
                  {b.benefit.icon} {b.benefit.name}
                </span>
              ))}
              {!job.benefits?.length && <span className="muted">No benefits listed</span>}
            </div>
          </div>
          {job.experienceYearsMin != null && (
            <div className="card">
              <h3>Experience</h3>
              <p className="muted">{job.experienceYearsMin}+ years preferred</p>
            </div>
          )}
        </div>
      </div>

      {showApply && (
        <div className="modal-backdrop" onClick={() => setShowApply(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Apply — {job.title}</h2>
            <form className="form-stack" onSubmit={onApply}>
              <label>
                Cover letter
                <textarea name="coverLetter" rows={4} placeholder="Why are you a great fit?" />
              </label>
              {(job.questions || []).map((q) => (
                <label key={q.id}>
                  {q.question} {q.isRequired && '*'}
                  {q.type === 'YES_NO' ? (
                    <select name={`q_${q.id}`} required={q.isRequired}>
                      <option value="">Select…</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  ) : (
                    <input
                      name={`q_${q.id}`}
                      type={q.type === 'NUMBER' ? 'number' : 'text'}
                      required={q.isRequired}
                    />
                  )}
                </label>
              ))}
              <button type="submit" className="cta">
                Submit application
              </button>
              <button type="button" className="secondary" onClick={() => setShowApply(false)}>
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
