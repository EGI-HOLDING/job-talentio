'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';
import { CvReviewModal, ParsedCv } from '@/components/CvReviewModal';

type Tab = 'overview' | 'recommended' | 'applications' | 'saved' | 'alerts' | 'profile' | 'career';

function monthsBetween(start: string | Date, end?: string | Date | null) {
  const a = new Date(start);
  const b = end ? new Date(end) : new Date();
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

function formatDuration(start: string, end?: string | null, isCurrent?: boolean) {
  const months = monthsBetween(start, isCurrent || !end ? null : end);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y}y ${m}mo`;
  if (y) return `${y}y`;
  return `${m || 1}mo`;
}

function completeness(profile: any) {
  const checks = [
    { ok: Boolean(profile?.user?.avatarUrl), label: 'Add a profile photo' },
    { ok: Boolean(profile?.headline), label: 'Add a headline' },
    { ok: Boolean(profile?.city), label: 'Set your city' },
    { ok: (profile?.skills || []).length >= 3, label: 'Add at least 3 skills' },
    { ok: (profile?.experiences || []).length >= 1, label: 'Add work experience' },
    { ok: (profile?.educations || []).length >= 1, label: 'Add education' },
    { ok: (profile?.languages || []).length >= 1, label: 'Add a language' },
    { ok: (profile?.resumes || []).length >= 1, label: 'Upload or create a resume' },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { percent: Math.round((done / checks.length) * 100), checks, missing: checks.filter((c) => !c.ok) };
}

const LEVEL_ORDER = ['EXPERT', 'ADVANCED', 'INTERMEDIATE', 'BEGINNER'] as const;

export default function EmployeeDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<any>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [skillsMeta, setSkillsMeta] = useState<any[]>([]);
  const [languagesMeta, setLanguagesMeta] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [cvReview, setCvReview] = useState<{ resumeId: string; parsed: ParsedCv } | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [expandedExp, setExpandedExp] = useState<string | null>(null);

  async function load() {
    const session = getSession();
    if (!session || session.user.role !== 'EMPLOYEE') {
      window.location.href = '/login';
      return;
    }
    const [p, a, r, al, c, sk, langs, sv] = await Promise.all([
      api('/profiles/me'),
      api('/applications/mine'),
      api('/jobs/recommended').catch(() => []),
      api('/alerts'),
      api('/meta/cities', { auth: false }),
      api('/meta/skills', { auth: false }),
      api('/meta/languages', { auth: false }).catch(() => []),
      api('/profiles/me/saved-jobs').catch(() => []),
    ]);
    setProfile(p);
    setApps(a as any[]);
    setRecommended(r as any[]);
    setAlerts(al as any[]);
    setCities(c as any[]);
    setSkillsMeta(sk as any[]);
    setLanguagesMeta(langs as any[]);
    setSaved(sv as any[]);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function updateProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({
        headline: fd.get('headline'),
        summary: fd.get('summary'),
        citySlug: fd.get('citySlug') || null,
        desiredPosition: fd.get('desiredPosition'),
        desiredSalaryMin: fd.get('desiredSalaryMin')
          ? Number(fd.get('desiredSalaryMin'))
          : null,
      }),
    });
    setMsg('Profile updated');
    await load();
  }

  async function addSkill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/skills', {
      method: 'POST',
      body: JSON.stringify({ slug: fd.get('slug'), level: fd.get('level') }),
    });
    await load();
  }

  async function removeItem(kind: string, id: string) {
    await api(`/profiles/me/${kind}/${id}`, { method: 'DELETE' });
    await load();
  }

  async function addExperience(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/experiences', {
      method: 'POST',
      body: JSON.stringify({
        companyName: fd.get('companyName'),
        title: fd.get('title'),
        description: fd.get('description') || undefined,
        citySlug: fd.get('citySlug') || undefined,
        startDate: fd.get('startDate'),
        endDate: fd.get('endDate') || null,
        isCurrent: fd.get('isCurrent') === 'on',
      }),
    });
    (e.target as HTMLFormElement).reset();
    setMsg('Experience added');
    await load();
  }

  async function addEducation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/educations', {
      method: 'POST',
      body: JSON.stringify({
        school: fd.get('school'),
        degree: fd.get('degree') || undefined,
        field: fd.get('field') || undefined,
        startDate: fd.get('startDate') || null,
        endDate: fd.get('endDate') || null,
      }),
    });
    (e.target as HTMLFormElement).reset();
    setMsg('Education added');
    await load();
  }

  async function addCertification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/certifications', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        issuer: fd.get('issuer') || undefined,
        issuedAt: fd.get('issuedAt') || null,
        credentialUrl: fd.get('credentialUrl') || '',
      }),
    });
    (e.target as HTMLFormElement).reset();
    setMsg('Certification added');
    await load();
  }

  async function addLanguage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/languages', {
      method: 'POST',
      body: JSON.stringify({ code: fd.get('code'), level: fd.get('level') }),
    });
    (e.target as HTMLFormElement).reset();
    setMsg('Language added');
    await load();
  }

  async function addResume(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/profiles/me/resumes', {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        content: fd.get('content') || undefined,
        isPrimary: fd.get('isPrimary') === 'on',
      }),
    });
    (e.target as HTMLFormElement).reset();
    setMsg('Resume created');
    await load();
  }

  async function uploadCv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.querySelector<HTMLInputElement>('input[type=file]');
    if (!input?.files?.[0]) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', input.files[0]);
      const resume = await api<{ id: string; parsedData: ParsedCv; needsReview?: boolean }>(
        '/profiles/me/resumes/upload',
        { method: 'POST', body: fd },
      );
      form.reset();
      setMsg('CV uploaded — review what to import');
      await load();
      if (resume.parsedData) {
        setCvReview({ resumeId: resume.id, parsed: resume.parsedData });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function downloadResume(id: string) {
    const res = await api<{ url: string }>(`/profiles/me/resumes/${id}/download`);
    window.open(res.url, '_blank', 'noopener,noreferrer');
  }

  async function attachFileToResume(resumeId: string, file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resume = await api<{ id: string; parsedData: ParsedCv }>(
        `/profiles/me/resumes/${resumeId}/file`,
        { method: 'POST', body: fd },
      );
      setMsg('File attached — review parsed data');
      await load();
      if (resume.parsedData) setCvReview({ resumeId: resume.id, parsed: resume.parsedData });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attach failed');
    } finally {
      setUploading(false);
    }
  }

  async function unsaveJob(jobId: string) {
    await api(`/profiles/me/saved-jobs/${jobId}`, { method: 'DELETE' });
    await load();
  }

  async function createAlert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api('/alerts', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        query: fd.get('query'),
        citySlug: fd.get('citySlug') || undefined,
        skillSlugs: String(fd.get('skills') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        frequency: fd.get('frequency'),
      }),
    });
    await load();
  }

  const complete = useMemo(() => (profile ? completeness(profile) : null), [profile]);
  const skillsByLevel = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const lvl of LEVEL_ORDER) map[lvl] = [];
    for (const s of profile?.skills || []) {
      const lvl = s.level || 'INTERMEDIATE';
      (map[lvl] || (map[lvl] = [])).push(s);
    }
    return map;
  }, [profile]);

  if (!profile && !error) return <div className="shell" style={{ padding: '2rem' }}>Loading…</div>;

  return (
    <div className="shell dash-grid">
      {cvReview && (
        <CvReviewModal
          resumeId={cvReview.resumeId}
          parsed={cvReview.parsed}
          onClose={() => setCvReview(null)}
          onImported={async () => {
            setCvReview(null);
            setMsg('Selected CV data imported into your profile');
            setTab('career');
            await load();
          }}
        />
      )}
      <aside className="dash-nav">
        {(
          [
            ['overview', 'Overview'],
            ['recommended', 'Recommended'],
            ['applications', 'Applications'],
            ['saved', 'Saved jobs'],
            ['alerts', 'Job alerts'],
            ['profile', 'Profile'],
            ['career', 'Career history'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </aside>

      <section>
        {error && <div className="error">{error}</div>}
        {msg && <div className="success">{msg}</div>}

        {tab === 'overview' && (
          <div>
            {complete && (
              <div className="card completeness-card" style={{ marginBottom: '1rem' }}>
                <div className="completeness-head">
                  <div>
                    <h3 style={{ margin: 0 }}>Profile strength</h3>
                    <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                      Stronger profiles get better job matches
                    </p>
                  </div>
                  <div className="completeness-score">{complete.percent}%</div>
                </div>
                <div className="completeness-bar">
                  <span style={{ width: `${complete.percent}%` }} />
                </div>
                {complete.missing.length > 0 && (
                  <div className="chips" style={{ marginTop: '0.75rem' }}>
                    {complete.missing.slice(0, 4).map((m) => (
                      <button
                        key={m.label}
                        type="button"
                        className="chip"
                        onClick={() => setTab(m.label.includes('resume') || m.label.includes('experience') || m.label.includes('education') || m.label.includes('language') ? 'career' : 'profile')}
                      >
                        + {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid-2">
            <div className="card">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="avatar avatar-lg"
                  src={profile?.user?.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${profile?.user?.fullName}`}
                  alt=""
                />
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>{profile?.user?.fullName}</h2>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>{profile?.headline}</p>
                  <p className="muted" style={{ margin: 0 }}>{profile?.city?.name}</p>
                </div>
              </div>
            </div>
            <div className="card">
              <h3>Quick stats</h3>
              <p><strong>{apps.length}</strong> applications</p>
              <p><strong>{recommended.length}</strong> recommended jobs</p>
              <p><strong>{(profile?.skills || []).length}</strong> skills</p>
              <p>
                Upcoming interviews:{' '}
                {apps.reduce((n, a) => n + (a.interviews?.length || 0), 0)}
              </p>
            </div>
          </div>
          </div>
        )}

        {tab === 'recommended' && (
          <div>
            <h2 className="section-title">Jobs matched to your profile</h2>
            {recommended.map((item) => (
              <Link key={item.job.id} href={`/jobs/${item.job.id}`} className="job-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="company-logo"
                  src={item.job.company?.logoUrl || ''}
                  alt=""
                />
                <div>
                  <h3>{item.job.title}</h3>
                  <div className="job-meta">
                    <span>{item.job.company?.name}</span>
                    <span>{jobLocationLabel(item.job)}</span>
                  </div>
                  <div className="match-bar">
                    <span style={{ width: `${item.matchScore}%` }} />
                  </div>
                </div>
                <div className="match-ring">{item.matchScore}%</div>
              </Link>
            ))}
            {!recommended.length && <p className="muted">Add skills to your profile to get recommendations.</p>}
          </div>
        )}

        {tab === 'applications' && (
          <div>
            <h2 className="section-title">My applications</h2>
            {apps.map((a) => (
              <div key={a.id} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <div>
                    <Link href={`/jobs/${a.jobPost.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {a.jobPost.title}
                    </Link>
                    <p className="muted" style={{ margin: '0.25rem 0' }}>
                      {a.jobPost.company?.name} · {a.status}
                    </p>
                    {a.matchScore != null && (
                      <span className="badge match">Match {a.matchScore}%</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {(a.interviews || []).map((iv: any) => (
                      <div key={iv.id} className="badge" style={{ display: 'block', marginBottom: 4 }}>
                        Interview {new Date(iv.scheduledAt).toLocaleString()}
                      </div>
                    ))}
                    {(() => {
                      const members = a.jobPost.company?.members || [];
                      const rec = members.find((m: any) => m.role === 'OWNER') || members[0];
                      return rec ? (
                        <Link href={`/messages?peer=${rec.userId}&job=${a.jobPost.id}`} className="chip" style={{ fontSize: '0.78rem' }}>
                          💬 Chat with recruiter
                        </Link>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'saved' && (
          <div>
            <h2 className="section-title">Saved jobs</h2>
            {saved.length === 0 && <p className="muted">You have not saved any jobs yet.</p>}
            {saved.map((s) => (
              <div key={s.id} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <Link href={`/jobs/${s.jobPost.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {s.jobPost.title}
                    </Link>
                    <p className="muted" style={{ margin: '0.25rem 0' }}>
                      {s.jobPost.company?.name} · {jobLocationLabel(s.jobPost)} · {s.jobPost.status}
                    </p>
                  </div>
                  <button type="button" className="secondary" onClick={() => unsaveJob(s.jobPost.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'alerts' && (
          <div className="grid-2">
            <div className="card">
              <h3>Create alert</h3>
              <form className="form-stack" onSubmit={createAlert}>
                <label>
                  Name
                  <input name="name" required />
                </label>
                <label>
                  Keywords
                  <input name="query" />
                </label>
                <label>
                  City
                  <select name="citySlug">
                    <option value="">Any</option>
                    {cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Skill slugs (comma)
                  <input name="skills" placeholder="typescript,react" />
                </label>
                <label>
                  Frequency
                  <select name="frequency" defaultValue="DAILY">
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                  </select>
                </label>
                <button type="submit">Save alert</button>
              </form>
            </div>
            <div>
              {alerts.map((a) => (
                <div key={a.id} className="card" style={{ marginBottom: '0.5rem' }}>
                  <strong>{a.name}</strong>
                  <p className="muted" style={{ margin: '0.25rem 0' }}>
                    {a.city?.name || 'Any city'} · {a.frequency}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'profile' && profile && (
          <div className="grid-2">
            <div className="card">
              <h3>Edit profile</h3>
              <form className="form-stack" onSubmit={updateProfile}>
                <label>
                  Headline
                  <input name="headline" defaultValue={profile.headline || ''} />
                </label>
                <label>
                  Summary
                  <textarea name="summary" rows={4} defaultValue={profile.summary || ''} />
                </label>
                <label>
                  City
                  <select name="citySlug" defaultValue={profile.city?.slug || ''}>
                    <option value="">—</option>
                    {cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Desired position
                  <input name="desiredPosition" defaultValue={profile.desiredPosition || ''} />
                </label>
                <label>
                  Desired salary (UZS)
                  <input
                    name="desiredSalaryMin"
                    type="number"
                    defaultValue={profile.desiredSalaryMin || ''}
                  />
                </label>
                <button type="submit">Save</button>
              </form>
            </div>
            <div className="card">
              <h3>Skills</h3>
              <div className="chips" style={{ margin: '0.75rem 0' }}>
                {(profile.skills || []).map((s: any) => (
                  <span key={s.id} className="badge">
                    {s.skill?.name || s.name} · {s.level}
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginLeft: '0.35rem', padding: 0 }}
                      onClick={() => removeItem('skills', s.id)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <form className="form-stack" onSubmit={addSkill}>
                <label>
                  Skill
                  <select name="slug" required>
                    {skillsMeta.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Level
                  <select name="level" defaultValue="INTERMEDIATE">
                    <option>BEGINNER</option>
                    <option>INTERMEDIATE</option>
                    <option>ADVANCED</option>
                    <option>EXPERT</option>
                  </select>
                </label>
                <button type="submit">Add skill</button>
              </form>
            </div>
          </div>
        )}
        {tab === 'career' && profile && (
          <div className="career-page">
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="jobs-toolbar" style={{ marginBottom: 0 }}>
                <div>
                  <h2 className="section-title" style={{ margin: 0 }}>Career history</h2>
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                    Experience, education, skills, languages & resumes — detailed for recruiters to review.
                  </p>
                </div>
                <form onSubmit={uploadCv} className="cv-upload-inline">
                  <input type="file" accept="application/pdf" required disabled={uploading} />
                  <button type="submit" disabled={uploading}>
                    {uploading ? 'Uploading…' : 'Upload CV & parse'}
                  </button>
                </form>
              </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>Skills</h3>
                <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'skill' ? null : 'skill')}>
                  {openForm === 'skill' ? 'Close' : '+ Add skill'}
                </button>
              </div>
              {LEVEL_ORDER.map((lvl) =>
                (skillsByLevel[lvl] || []).length ? (
                  <div key={lvl} style={{ marginTop: '0.75rem' }}>
                    <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                      {lvl}
                    </div>
                    <div className="chips">
                      {skillsByLevel[lvl].map((s: any) => (
                        <span key={s.id} className={`badge skill skill-${lvl.toLowerCase()}`}>
                          {s.skill?.name}
                          <button type="button" className="ghost" style={{ marginLeft: 6, padding: 0 }} onClick={() => removeItem('skills', s.id)}>
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
              {!(profile.skills || []).length && <p className="muted">No skills yet — add manually or import from CV.</p>}
              {openForm === 'skill' && (
                <form className="form-stack" onSubmit={async (e) => { await addSkill(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                  <div className="grid-2">
                    <label>
                      Skill
                      <select name="slug" required>
                        {skillsMeta.map((s) => (
                          <option key={s.slug} value={s.slug}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Level
                      <select name="level" defaultValue="INTERMEDIATE">
                        {LEVEL_ORDER.slice().reverse().map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button type="submit">Save skill</button>
                </form>
              )}
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>Work experience</h3>
                <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'exp' ? null : 'exp')}>
                  {openForm === 'exp' ? 'Close' : '+ Add'}
                </button>
              </div>
              <div className="timeline">
                {(profile.experiences || []).length === 0 && (
                  <p className="muted">No experience yet.</p>
                )}
                {(profile.experiences || []).map((x: any) => (
                  <div key={x.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-card">
                      <div className="timeline-card-head">
                        <div>
                          <strong>{x.title}</strong>
                          <div className="muted" style={{ fontSize: '0.85rem' }}>
                            {x.companyName}
                            {x.city ? ` · ${x.city.name}` : ''}
                          </div>
                        </div>
                        <div className="timeline-meta">
                          {x.isCurrent && <span className="badge match">Current</span>}
                          <span className="badge">{formatDuration(x.startDate, x.endDate, x.isCurrent)}</span>
                          <button type="button" className="ghost" onClick={() => removeItem('experiences', x.id)}>✕</button>
                        </div>
                      </div>
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                        {new Date(x.startDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                        {' — '}
                        {x.isCurrent || !x.endDate
                          ? 'Present'
                          : new Date(x.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                      </div>
                      {x.description && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <p style={{ margin: 0, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                            {expandedExp === x.id || x.description.length < 180
                              ? x.description
                              : `${x.description.slice(0, 180)}…`}
                          </p>
                          {x.description.length >= 180 && (
                            <button type="button" className="ghost" onClick={() => setExpandedExp(expandedExp === x.id ? null : x.id)}>
                              {expandedExp === x.id ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {openForm === 'exp' && (
                <form className="form-stack" onSubmit={async (e) => { await addExperience(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                  <div className="grid-2">
                    <label>Job title<input name="title" required /></label>
                    <label>Company<input name="companyName" required /></label>
                  </div>
                  <div className="grid-2">
                    <label>Start date<input name="startDate" type="date" required /></label>
                    <label>End date<input name="endDate" type="date" /></label>
                  </div>
                  <label>
                    City
                    <select name="citySlug">
                      <option value="">—</option>
                      {cities.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>Description<textarea name="description" rows={3} /></label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input name="isCurrent" type="checkbox" style={{ width: 'auto' }} /> Currently work here
                  </label>
                  <button type="submit">Save experience</button>
                </form>
              )}
            </div>

            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Education</h3>
                  <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'edu' ? null : 'edu')}>
                    {openForm === 'edu' ? 'Close' : '+ Add'}
                  </button>
                </div>
                {(profile.educations || []).map((x: any) => (
                  <div key={x.id} className="detail-card">
                    <div className="detail-card-head">
                      <strong>{x.school}</strong>
                      <button type="button" className="ghost" onClick={() => removeItem('educations', x.id)}>✕</button>
                    </div>
                    <div className="chips" style={{ marginTop: '0.35rem' }}>
                      {x.degree && <span className={`badge degree-${String(x.degree).toLowerCase()}`}>{String(x.degree).replace(/_/g, ' ')}</span>}
                      {x.field && <span className="badge skill">{x.field}</span>}
                    </div>
                    {(x.startDate || x.endDate) && (
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        {x.startDate ? new Date(x.startDate).getFullYear() : '?'} — {x.endDate ? new Date(x.endDate).getFullYear() : 'Present'}
                      </div>
                    )}
                  </div>
                ))}
                {!(profile.educations || []).length && <p className="muted">No education entries yet.</p>}
                {openForm === 'edu' && (
                  <form className="form-stack" onSubmit={async (e) => { await addEducation(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                    <label>School / University<input name="school" required /></label>
                    <div className="grid-2">
                      <label>
                        Degree
                        <select name="degree">
                          <option value="">—</option>
                          {['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'].map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </label>
                      <label>Field<input name="field" /></label>
                    </div>
                    <div className="grid-2">
                      <label>Start<input name="startDate" type="date" /></label>
                      <label>End<input name="endDate" type="date" /></label>
                    </div>
                    <button type="submit">Save education</button>
                  </form>
                )}
              </div>

              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Languages</h3>
                  <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'lang' ? null : 'lang')}>
                    {openForm === 'lang' ? 'Close' : '+ Add'}
                  </button>
                </div>
                <div className="lang-grid">
                  {(profile.languages || []).map((x: any) => (
                    <div key={x.id} className="lang-pill">
                      <div>
                        <strong>{x.language?.name}</strong>
                        <div className={`cefr cefr-${String(x.level || 'B1').toLowerCase()}`}>{x.level}</div>
                      </div>
                      <button type="button" className="ghost" onClick={() => removeItem('languages', x.id)}>✕</button>
                    </div>
                  ))}
                </div>
                {!(profile.languages || []).length && <p className="muted">No languages yet.</p>}
                {openForm === 'lang' && (
                  <form className="form-stack" onSubmit={async (e) => { await addLanguage(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                    <div className="grid-2">
                      <label>
                        Language
                        <select name="code" required>
                          {languagesMeta.map((l) => (
                            <option key={l.code} value={l.code}>{l.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Level
                        <select name="level" defaultValue="B1">
                          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'].map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button type="submit">Save language</button>
                  </form>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Certifications</h3>
                  <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'cert' ? null : 'cert')}>
                    {openForm === 'cert' ? 'Close' : '+ Add'}
                  </button>
                </div>
                {(profile.certifications || []).map((x: any) => (
                  <div key={x.id} className="detail-card">
                    <div className="detail-card-head">
                      <div>
                        <strong>{x.name}</strong>
                        {x.issuer && <div className="muted" style={{ fontSize: '0.85rem' }}>{x.issuer}</div>}
                        {x.issuedAt && (
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            Issued {new Date(x.issuedAt).toLocaleDateString()}
                          </div>
                        )}
                        {x.credentialUrl && (
                          <a href={x.credentialUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                            View credential →
                          </a>
                        )}
                      </div>
                      <button type="button" className="ghost" onClick={() => removeItem('certifications', x.id)}>✕</button>
                    </div>
                  </div>
                ))}
                {!(profile.certifications || []).length && <p className="muted">No certifications yet.</p>}
                {openForm === 'cert' && (
                  <form className="form-stack" onSubmit={async (e) => { await addCertification(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                    <label>Name<input name="name" required /></label>
                    <div className="grid-2">
                      <label>Issuer<input name="issuer" /></label>
                      <label>Issued at<input name="issuedAt" type="date" /></label>
                    </div>
                    <label>Credential URL<input name="credentialUrl" type="url" placeholder="https://…" /></label>
                    <button type="submit">Save certification</button>
                  </form>
                )}
              </div>

              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Resumes</h3>
                  <button type="button" className="chip" onClick={() => setOpenForm(openForm === 'resume' ? null : 'resume')}>
                    {openForm === 'resume' ? 'Close' : '+ Create'}
                  </button>
                </div>
                {(profile.resumes || []).map((r: any) => (
                  <div key={r.id} className="detail-card">
                    <div className="detail-card-head">
                      <div>
                        <strong>{r.title}</strong>
                        {r.isPrimary && <span className="badge match" style={{ marginLeft: 8 }}>Primary</span>}
                        {r.fileKey && <span className="badge skill" style={{ marginLeft: 6 }}>PDF attached</span>}
                        {r.parsedData && (
                          <button
                            type="button"
                            className="ghost"
                            style={{ display: 'block', marginTop: 4 }}
                            onClick={() => setCvReview({ resumeId: r.id, parsed: r.parsedData })}
                          >
                            Review parsed data →
                          </button>
                        )}
                      </div>
                      <button type="button" className="ghost" onClick={() => removeItem('resumes', r.id)}>✕</button>
                    </div>
                    <div className="chips" style={{ marginTop: '0.5rem' }}>
                      {r.fileKey && (
                        <button type="button" className="chip" onClick={() => downloadResume(r.id)}>
                          Download
                        </button>
                      )}
                      <label className="chip" style={{ cursor: 'pointer' }}>
                        {r.fileKey ? 'Replace file' : 'Attach PDF'}
                        <input
                          type="file"
                          accept="application/pdf"
                          hidden
                          disabled={uploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) attachFileToResume(r.id, f);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {!(profile.resumes || []).length && <p className="muted">No resumes yet — upload a PDF or create one.</p>}
                {openForm === 'resume' && (
                  <form className="form-stack" onSubmit={async (e) => { await addResume(e); setOpenForm(null); }} style={{ marginTop: '1rem' }}>
                    <label>Title<input name="title" required placeholder="e.g. Frontend Developer CV" /></label>
                    <label>Content (builder)<textarea name="content" rows={4} placeholder="Write or paste your CV…" /></label>
                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input name="isPrimary" type="checkbox" style={{ width: 'auto' }} /> Set as primary
                    </label>
                    <button type="submit">Create resume</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
