'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { jobLocationLabel } from '@/lib/location';
import { CvReviewModal, ParsedCv } from '@/components/CvReviewModal';
import { FormAlert, LabelText } from '@/components/ui/Field';
import { SkillCombobox } from '@/components/ui/SkillCombobox';
import { LookupCombobox } from '@/components/ui/LookupCombobox';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { MatchRing } from '@/components/ui/MatchRing';
import { categoryIconLabel } from '@/lib/icons';
import { sanitizeMojibake } from '@/lib/text';
import { useI18n } from '@/lib/i18n';

type Tab = 'overview' | 'recommended' | 'applications' | 'saved' | 'alerts' | 'profile';

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

function dateInputValue(d?: string | Date | null) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
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
const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
const LANG_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'] as const;

export default function EmployeeDashboard() {
  const { t } = useI18n();
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
  const [draftAlertSkills, setDraftAlertSkills] = useState<Array<{ slug: string; name: string }>>([]);
  const [cvReview, setCvReview] = useState<{ resumeId: string; parsed: ParsedCv } | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [expandedExp, setExpandedExp] = useState<string | null>(null);

  const editingExpId = openForm?.startsWith('edit-exp:') ? openForm.slice('edit-exp:'.length) : null;
  const editingEduId = openForm?.startsWith('edit-edu:') ? openForm.slice('edit-edu:'.length) : null;
  const editingCertId = openForm?.startsWith('edit-cert:') ? openForm.slice('edit-cert:'.length) : null;
  const editingExp = editingExpId
    ? (profile?.experiences || []).find((x: any) => x.id === editingExpId)
    : null;
  const editingEdu = editingEduId
    ? (profile?.educations || []).find((x: any) => x.id === editingEduId)
    : null;
  const editingCert = editingCertId
    ? (profile?.certifications || []).find((x: any) => x.id === editingCertId)
    : null;

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
        phone: fd.get('phone') || undefined,
        visibility: fd.get('visibility') || undefined,
        desiredPosition: fd.get('desiredPosition'),
        desiredSalaryMin: fd.get('desiredSalaryMin')
          ? Number(fd.get('desiredSalaryMin'))
          : null,
      }),
    });
    setMsg('Profile updated');
    await load();
  }

  async function addSkillPick(skill: {
    slug: string;
    name: string;
    isNew?: boolean;
    level?: string;
  }) {
    await api('/profiles/me/skills', {
      method: 'POST',
      body: JSON.stringify(
        skill.slug
          ? { slug: skill.slug, level: skill.level || 'INTERMEDIATE' }
          : { name: skill.name, level: skill.level || 'INTERMEDIATE' },
      ),
    });
    setMsg(
      skill.isNew
        ? `Skill “${skill.name}” resolved and saved`
        : `Skill “${skill.name}” added`,
    );
    await load();
  }

  async function updateSkillLevel(id: string, level: string) {
    await api(`/profiles/me/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    });
    await load();
  }

  async function updateLanguageLevel(id: string, level: string) {
    await api(`/profiles/me/languages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    });
    await load();
  }

  async function removeItem(kind: string, id: string) {
    await api(`/profiles/me/${kind}/${id}`, { method: 'DELETE' });
    await load();
  }

  async function saveExperience(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      companyName: fd.get('companyName'),
      title: fd.get('title'),
      description: fd.get('description') || undefined,
      citySlug: fd.get('citySlug') || undefined,
      startDate: fd.get('startDate'),
      endDate: fd.get('endDate') || null,
      isCurrent: fd.get('isCurrent') === 'on',
    };
    if (editingExpId) {
      await api(`/profiles/me/experiences/${editingExpId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg('Experience updated');
    } else {
      await api('/profiles/me/experiences', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg('Experience added');
    }
    setOpenForm(null);
    await load();
  }

  async function saveEducation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      school: fd.get('school'),
      degree: fd.get('degree') || undefined,
      field: fd.get('field') || undefined,
      startDate: fd.get('startDate') || null,
      endDate: fd.get('endDate') || null,
    };
    if (editingEduId) {
      await api(`/profiles/me/educations/${editingEduId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg('Education updated');
    } else {
      await api('/profiles/me/educations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg('Education added');
    }
    setOpenForm(null);
    await load();
  }

  async function saveCertification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get('name'),
      issuer: fd.get('issuer') || undefined,
      issuedAt: fd.get('issuedAt') || null,
      expiresAt: fd.get('expiresAt') || null,
      credentialUrl: fd.get('credentialUrl') || '',
    };
    if (editingCertId) {
      await api(`/profiles/me/certifications/${editingCertId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMsg('Certification updated');
    } else {
      await api('/profiles/me/certifications', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMsg('Certification added');
    }
    setOpenForm(null);
    await load();
  }

  async function addLanguagePick(item: {
    slug: string;
    name: string;
    code?: string;
    isNew?: boolean;
    level?: string;
  }) {
    await api('/profiles/me/languages', {
      method: 'POST',
      body: JSON.stringify(
        item.code || item.slug
          ? { code: item.code || item.slug, level: item.level || 'B1' }
          : { name: item.name, level: item.level || 'B1' },
      ),
    });
    setMsg(item.isNew ? `Language “${item.name}” resolved and saved` : `Language “${item.name}” added`);
    await load();
  }

  async function setPrimaryResume(id: string) {
    await api(`/profiles/me/resumes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: true }),
    });
    setMsg('Primary resume updated');
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
        skillSlugs: draftAlertSkills.map((s) => s.slug).filter(Boolean),
        frequency: fd.get('frequency'),
      }),
    });
    setDraftAlertSkills([]);
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

  const showExpForm = openForm === 'exp' || Boolean(editingExpId);
  const showEduForm = openForm === 'edu' || Boolean(editingEduId);
  const showCertForm = openForm === 'cert' || Boolean(editingCertId);

  if (!profile && !error) return <DashboardSkeleton />;

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
            setTab('profile');
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
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </aside>

      <section>
        {error && <FormAlert>{error}</FormAlert>}
        {msg && <FormAlert tone="success">{msg}</FormAlert>}

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
                        onClick={() => setTab('profile')}
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
                  <p className="muted" style={{ margin: '0.25rem 0' }}>{sanitizeMojibake(profile?.headline)}</p>
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
                  src={
                    item.job.company?.logoUrl ||
                    `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(item.job.company?.name || 'Co')}`
                  }
                  alt=""
                />
                <div>
                  <h3>{sanitizeMojibake(item.job.title)}</h3>
                  <div className="job-meta">
                    <span>{item.job.company?.name}</span>
                    <span>{jobLocationLabel(item.job)}</span>
                    {item.job.category && (
                      <span>
                        {categoryIconLabel(item.job.category.slug, item.job.category.icon)}
                        {item.job.category.name}
                      </span>
                    )}
                  </div>
                  <div className="match-bar">
                    <span style={{ width: `${item.matchScore}%` }} />
                  </div>
                </div>
                <MatchRing score={item.matchScore} />
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
                      {sanitizeMojibake(a.jobPost.title)}
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
                    {a.jobPost.company?.chatPeerUserId ? (
                      <Link
                        href={`/messages?peer=${a.jobPost.company.chatPeerUserId}&job=${a.jobPost.id}`}
                        className="chip"
                        style={{ fontSize: '0.78rem' }}
                      >
                        Chat with recruiter
                      </Link>
                    ) : null}
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
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={createAlert}>
                <label>
                  <LabelText required>Name</LabelText>
                  <input name="name" required />
                </label>
                <label>
                  <LabelText>Keywords</LabelText>
                  <input name="query" />
                </label>
                <label>
                  <LabelText>City</LabelText>
                  <select name="citySlug">
                    <option value="">Any</option>
                    {cities.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <LabelText>Skills</LabelText>
                  <div className="chips" style={{ margin: '0.4rem 0' }}>
                    {draftAlertSkills.map((s) => (
                      <span key={s.slug} className="badge">
                        {s.name}
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 6, padding: 0 }}
                          onClick={() =>
                            setDraftAlertSkills((prev) => prev.filter((x) => x.slug !== s.slug))
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <SkillCombobox
                    levelSelect={false}
                    allowCreate={false}
                    submitLabel="Add skill to alert"
                    onPick={(skill) => {
                      if (!skill.slug) return;
                      setDraftAlertSkills((prev) =>
                        prev.some((p) => p.slug === skill.slug)
                          ? prev
                          : [...prev, { slug: skill.slug, name: skill.name }],
                      );
                    }}
                  />
                </div>
                <label>
                  <LabelText>Frequency</LabelText>
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
          <div className="career-page">
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Edit profile</h3>
              <p className="required-note">{t('requiredFieldsNote')}</p>
              <form className="form-stack" onSubmit={updateProfile} key={`profile-${profile.updatedAt || profile.id}`}>
                <label>
                  <LabelText>Headline</LabelText>
                  <input name="headline" defaultValue={sanitizeMojibake(profile.headline) || ''} />
                </label>
                <label>
                  <LabelText>Summary</LabelText>
                  <textarea name="summary" rows={4} defaultValue={sanitizeMojibake(profile.summary) || ''} />
                </label>
                <div className="grid-2">
                  <label>
                    <LabelText>Phone</LabelText>
                    <input name="phone" type="tel" defaultValue={profile.phone || ''} placeholder="+998…" />
                  </label>
                  <label>
                    <LabelText>Visibility</LabelText>
                    <select name="visibility" defaultValue={profile.visibility || 'TO_REGISTERED_RECRUITERS'}>
                      <option value="PUBLIC">Public</option>
                      <option value="TO_REGISTERED_RECRUITERS">Visible to registered recruiters</option>
                      <option value="PRIVATE">Private</option>
                    </select>
                  </label>
                </div>
                <label>
                  <LabelText>City</LabelText>
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
                  <LabelText>Desired position</LabelText>
                  <input name="desiredPosition" defaultValue={sanitizeMojibake(profile.desiredPosition) || ''} />
                </label>
                <label>
                  <LabelText>Desired salary (UZS)</LabelText>
                  <input
                    name="desiredSalaryMin"
                    type="number"
                    defaultValue={profile.desiredSalaryMin || ''}
                  />
                </label>
                <button type="submit">Save</button>
              </form>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="jobs-toolbar" style={{ marginBottom: 0 }}>
                <div>
                  <h2 className="section-title" style={{ margin: 0 }}>Career history</h2>
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                    Experience, education, skills, languages & resumes — detailed for recruiters to review.
                  </p>
                </div>
                <form onSubmit={uploadCv} className="cv-upload-inline">
                  <label>
                    <LabelText required>{t('uploadCv')}</LabelText>
                    <input
                      type="file"
                      accept="application/pdf"
                      required
                      disabled={uploading}
                      aria-label={t('uploadCv')}
                    />
                  </label>
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
                        <span key={s.id} className={`badge skill skill-${lvl.toLowerCase()}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {s.skill?.name}
                          <select
                            aria-label={`Level for ${s.skill?.name}`}
                            value={s.level || 'INTERMEDIATE'}
                            onChange={(e) => updateSkillLevel(s.id, e.target.value)}
                            style={{ width: 'auto', padding: '0.15rem 0.35rem', fontSize: '0.72rem', borderRadius: 6 }}
                          >
                            {SKILL_LEVELS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <button type="button" className="ghost" style={{ marginLeft: 2, padding: 0 }} onClick={() => removeItem('skills', s.id)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
              {!(profile.skills || []).length && <p className="muted">No skills yet — add manually or import from CV.</p>}
              {openForm === 'skill' && (
                <div style={{ marginTop: '1rem' }}>
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <SkillCombobox
                    onPick={async (s) => {
                      await addSkillPick(s);
                      setOpenForm(null);
                    }}
                    submitLabel="Save skill"
                  />
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="cv-section-head">
                <h3 style={{ margin: 0 }}>Work experience</h3>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setOpenForm(showExpForm && !editingExpId ? null : 'exp')}
                >
                  {showExpForm && !editingExpId ? 'Close' : '+ Add'}
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
                          <button type="button" className="ghost" onClick={() => setOpenForm(`edit-exp:${x.id}`)}>Edit</button>
                          <button type="button" className="ghost" onClick={() => removeItem('experiences', x.id)}>×</button>
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
              {showExpForm && (
                <form
                  className="form-stack"
                  key={editingExpId || 'new-exp'}
                  onSubmit={saveExperience}
                  style={{ marginTop: '1rem' }}
                >
                  <p className="required-note">{t('requiredFieldsNote')}</p>
                  <div className="grid-2">
                    <label>
                      <LabelText required>Job title</LabelText>
                      <input name="title" required defaultValue={editingExp?.title || ''} />
                    </label>
                    <label>
                      <LabelText required>Company</LabelText>
                      <input name="companyName" required defaultValue={editingExp?.companyName || ''} />
                    </label>
                  </div>
                  <div className="grid-2">
                    <label>
                      <LabelText required>Start date</LabelText>
                      <input name="startDate" type="date" required defaultValue={dateInputValue(editingExp?.startDate)} />
                    </label>
                    <label>
                      <LabelText>End date</LabelText>
                      <input name="endDate" type="date" defaultValue={dateInputValue(editingExp?.endDate)} />
                    </label>
                  </div>
                  <label>
                    <LabelText>City</LabelText>
                    <select name="citySlug" defaultValue={editingExp?.city?.slug || ''}>
                      <option value="">—</option>
                      {cities.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <LabelText>Description</LabelText>
                    <textarea name="description" rows={3} defaultValue={editingExp?.description || ''} />
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input name="isCurrent" type="checkbox" style={{ width: 'auto' }} defaultChecked={Boolean(editingExp?.isCurrent)} />
                    <LabelText optional={false}>Currently work here</LabelText>
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit">{editingExpId ? 'Update experience' : 'Save experience'}</button>
                    {editingExpId && (
                      <button type="button" className="secondary" onClick={() => setOpenForm(null)}>Cancel</button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Education</h3>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setOpenForm(showEduForm && !editingEduId ? null : 'edu')}
                  >
                    {showEduForm && !editingEduId ? 'Close' : '+ Add'}
                  </button>
                </div>
                {(profile.educations || []).map((x: any) => (
                  <div key={x.id} className="detail-card">
                    <div className="detail-card-head">
                      <strong>{x.school}</strong>
                      <div>
                        <button type="button" className="ghost" onClick={() => setOpenForm(`edit-edu:${x.id}`)}>Edit</button>
                        <button type="button" className="ghost" onClick={() => removeItem('educations', x.id)}>×</button>
                      </div>
                    </div>
                    <div className="chips" style={{ marginTop: '0.35rem' }}>
                      {x.degree && <span className={`badge degree-${String(x.degree).toLowerCase()}`}>{String(x.degree).replace(/_/g, ' ')}</span>}
                      {x.field && <span className="badge skill">{x.field}</span>}
                    </div>
                    {(x.startDate || x.endDate) && (
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        {x.startDate ? new Date(x.startDate).getFullYear() : '—'} — {x.endDate ? new Date(x.endDate).getFullYear() : 'Present'}
                      </div>
                    )}
                  </div>
                ))}
                {!(profile.educations || []).length && <p className="muted">No education entries yet.</p>}
                {showEduForm && (
                  <form
                    className="form-stack"
                    key={editingEduId || 'new-edu'}
                    onSubmit={saveEducation}
                    style={{ marginTop: '1rem' }}
                  >
                    <p className="required-note">{t('requiredFieldsNote')}</p>
                    <label>
                      <LabelText required>School / University</LabelText>
                      <input name="school" required defaultValue={editingEdu?.school || ''} />
                    </label>
                    <div className="grid-2">
                      <label>
                        <LabelText>Degree</LabelText>
                        <select name="degree" defaultValue={editingEdu?.degree || ''}>
                          <option value="">—</option>
                          {['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'].map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <LabelText>Field</LabelText>
                        <input name="field" defaultValue={editingEdu?.field || ''} />
                      </label>
                    </div>
                    <div className="grid-2">
                      <label>
                        <LabelText>Start</LabelText>
                        <input name="startDate" type="date" defaultValue={dateInputValue(editingEdu?.startDate)} />
                      </label>
                      <label>
                        <LabelText>End</LabelText>
                        <input name="endDate" type="date" defaultValue={dateInputValue(editingEdu?.endDate)} />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="submit">{editingEduId ? 'Update education' : 'Save education'}</button>
                      {editingEduId && (
                        <button type="button" className="secondary" onClick={() => setOpenForm(null)}>Cancel</button>
                      )}
                    </div>
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
                        <select
                          aria-label={`Level for ${x.language?.name}`}
                          value={x.level || 'B1'}
                          onChange={(e) => updateLanguageLevel(x.id, e.target.value)}
                          style={{ width: 'auto', marginTop: 4, padding: '0.2rem 0.4rem', fontSize: '0.78rem' }}
                        >
                          {LANG_LEVELS.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <button type="button" className="ghost" onClick={() => removeItem('languages', x.id)}>×</button>
                    </div>
                  ))}
                </div>
                {!(profile.languages || []).length && <p className="muted">No languages yet.</p>}
                {openForm === 'lang' && (
                  <div style={{ marginTop: '1rem' }}>
                    <p className="required-note">{t('requiredFieldsNote')}</p>
                    <LookupCombobox
                      kind="languages"
                      allowCreate
                      submitLabel={t('addLanguage')}
                      placeholder={t('languageSearchPlaceholder')}
                      defaultLevel="B1"
                      levelOptions={LANG_LEVELS.map((l) => ({
                        value: l,
                        label: l,
                      }))}
                      onPick={async (item) => {
                        await addLanguagePick(item);
                        setOpenForm(null);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Certifications</h3>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setOpenForm(showCertForm && !editingCertId ? null : 'cert')}
                  >
                    {showCertForm && !editingCertId ? 'Close' : '+ Add'}
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
                        {x.expiresAt && (
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            Expires {new Date(x.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                        {x.credentialUrl && (
                          <a href={x.credentialUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                            View credential →
                          </a>
                        )}
                      </div>
                      <div>
                        <button type="button" className="ghost" onClick={() => setOpenForm(`edit-cert:${x.id}`)}>Edit</button>
                        <button type="button" className="ghost" onClick={() => removeItem('certifications', x.id)}>×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {!(profile.certifications || []).length && <p className="muted">No certifications yet.</p>}
                {showCertForm && (
                  <form
                    className="form-stack"
                    key={editingCertId || 'new-cert'}
                    onSubmit={saveCertification}
                    style={{ marginTop: '1rem' }}
                  >
                    <p className="required-note">{t('requiredFieldsNote')}</p>
                    <label>
                      <LabelText required>Name</LabelText>
                      <input name="name" required defaultValue={editingCert?.name || ''} />
                    </label>
                    <div className="grid-2">
                      <label>
                        <LabelText>Issuer</LabelText>
                        <input name="issuer" defaultValue={editingCert?.issuer || ''} />
                      </label>
                      <label>
                        <LabelText>Issued at</LabelText>
                        <input name="issuedAt" type="date" defaultValue={dateInputValue(editingCert?.issuedAt)} />
                      </label>
                    </div>
                    <label>
                      <LabelText>Expires at</LabelText>
                      <input name="expiresAt" type="date" defaultValue={dateInputValue(editingCert?.expiresAt)} />
                    </label>
                    <label>
                      <LabelText>Credential URL</LabelText>
                      <input name="credentialUrl" type="url" placeholder="https://…" defaultValue={editingCert?.credentialUrl || ''} />
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="submit">{editingCertId ? 'Update certification' : 'Save certification'}</button>
                      {editingCertId && (
                        <button type="button" className="secondary" onClick={() => setOpenForm(null)}>Cancel</button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              <div className="card">
                <div className="cv-section-head">
                  <h3 style={{ margin: 0 }}>Resumes</h3>
                  <Link href="/dashboard/employee/resume-builder" className="chip" style={{ fontWeight: 600 }}>
                    Open resume builder
                  </Link>
                </div>
                {(profile.resumes || []).map((r: any) => (
                  <div key={r.id} className="detail-card">
                    <div className="detail-card-head">
                      <div>
                        <strong>{r.title}</strong>
                        {r.isPrimary && <span className="badge match" style={{ marginLeft: 8 }}>Primary</span>}
                        {(r.hasFile || r.fileKey) && (
                          <span className="badge skill" style={{ marginLeft: 6 }}>
                            hasFile
                          </span>
                        )}
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
                      <button type="button" className="ghost" onClick={() => removeItem('resumes', r.id)}>×</button>
                    </div>
                    <div className="chips" style={{ marginTop: '0.5rem' }}>
                      <Link
                        href={`/dashboard/employee/resume-builder?resumeId=${r.id}`}
                        className="chip"
                      >
                        Edit in builder
                      </Link>
                      {!r.isPrimary && (
                        <button type="button" className="chip" onClick={() => setPrimaryResume(r.id)}>
                          Set primary
                        </button>
                      )}
                      {(r.hasFile || r.fileKey) && (
                        <button type="button" className="chip" onClick={() => downloadResume(r.id)}>
                          Download
                        </button>
                      )}
                      <label className="chip" style={{ cursor: 'pointer' }}>
                        {r.hasFile || r.fileKey ? 'Replace file' : 'Attach PDF'}
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
                {!(profile.resumes || []).length && (
                  <p className="muted">
                    No resumes yet —{' '}
                    <Link href="/dashboard/employee/resume-builder">create one in the builder</Link>
                    {' '}or upload a PDF above.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
