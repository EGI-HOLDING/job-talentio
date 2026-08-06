'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, getSession, AuthSession } from '@/lib/api';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';
import { useI18n } from '@/lib/i18n';

type CandidateDetail = {
  id: string;
  headline?: string | null;
  about?: string | null;
  phone?: string | null;
  desiredSalary?: number | null;
  desiredSalaryCurrency?: string | null;
  visibility: string;
  contactsBlurred: boolean;
  experienceYears: number;
  city?: { name: string } | null;
  user: { id: string; fullName: string; email?: string; avatarUrl?: string | null };
  skills: Array<{ id: string; level?: string | null; skill: { name: string } }>;
  experiences: Array<{
    id: string;
    title: string;
    companyName: string;
    startDate: string;
    endDate?: string | null;
    description?: string | null;
    city?: { name: string } | null;
  }>;
  educations: Array<{
    id: string;
    school: string;
    degree?: string | null;
    field?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  certifications: Array<{ id: string; name: string; issuer?: string | null; issuedAt?: string | null }>;
  languages: Array<{ id: string; level?: string | null; language: { name: string } }>;
  resumes: Array<{ id: string; title: string; fileUrl?: string | null }>;
  match?: {
    total: number;
    skills?: { score: number };
    experience?: { score: number };
    location?: { score: number };
    education?: { score: number };
    language?: { score: number };
  } | null;
};

function fmtDate(d?: string | null) {
  if (!d) return 'now';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function CandidateInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { t } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [data, setData] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (s.user.role !== 'RECRUITER' && s.user.role !== 'SUPER_ADMIN') {
      router.replace('/');
      return;
    }
    setSession(s);
    const matchJobId = search.get('matchJobId');
    api<CandidateDetail>(
      `/profiles/candidates/${id}${matchJobId ? `?matchJobId=${matchJobId}` : ''}`,
    )
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!session) return null;
  if (error) {
    return (
      <div className="shell" style={{ padding: '3rem 1.5rem' }}>
        <div className="card" style={{ color: '#be123c' }}>{error}</div>
      </div>
    );
  }
  if (!data) return <DetailPageSkeleton />;

  return (
    <div className="shell" style={{ padding: '2.5rem 1.5rem', maxWidth: 900 }}>
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.user.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(data.user.fullName)}`}
            alt=""
            className="avatar"
            style={{ width: 72, height: 72 }}
          />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{data.user.fullName}</h1>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              {data.headline || '—'}
              {data.city ? ` · ${data.city.name}` : ''}
              {` · ${data.experienceYears} ${t('years')} ${t('experience').toLowerCase()}`}
            </p>
            {data.contactsBlurred ? (
              <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                🔒 Contacts hidden — upgrade to Standard/Premium or wait for the candidate to apply.
              </p>
            ) : (
              <p style={{ marginTop: '0.4rem', fontSize: '0.9rem' }}>
                {data.user.email && <span>✉ {data.user.email}</span>}
                {data.phone && <span style={{ marginLeft: '1rem' }}>☎ {data.phone}</span>}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            {data.match && (
              <span className="chip" style={{ background: 'var(--accent)', color: '#fff', border: 0, fontWeight: 700 }}>
                {t('match')}: {Math.round(data.match.total)}%
              </span>
            )}
            <Link href={`/messages?peer=${data.user.id}`} className="chip">
              💬 {t('chatWithCandidate')}
            </Link>
          </div>
        </div>
      </div>

      {data.about && (
        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <h3>About</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{data.about}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3>{t('skills')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
          {data.skills.length === 0 && <span className="muted">—</span>}
          {data.skills.map((s) => (
            <span key={s.id} className="chip">
              {s.skill.name}
              {s.level ? ` · ${s.level}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3>{t('experience')}</h3>
        {data.experiences.length === 0 && <p className="muted">—</p>}
        {data.experiences.map((e) => (
          <div key={e.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
            <strong>{e.title}</strong> · {e.companyName}
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {fmtDate(e.startDate)} — {fmtDate(e.endDate)}
              {e.city ? ` · ${e.city.name}` : ''}
            </div>
            {e.description && <p style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>{e.description}</p>}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3>{t('education')}</h3>
        {data.educations.length === 0 && <p className="muted">—</p>}
        {data.educations.map((e) => (
          <div key={e.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
            <strong>{e.school}</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {[e.degree, e.field].filter(Boolean).join(' · ')} · {fmtDate(e.startDate)} — {fmtDate(e.endDate)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <div className="card">
          <h3>{t('languages')}</h3>
          {data.languages.length === 0 && <p className="muted">—</p>}
          {data.languages.map((l) => (
            <div key={l.id} style={{ padding: '0.4rem 0' }}>
              {l.language.name} {l.level && <span className="muted">· {l.level}</span>}
            </div>
          ))}
        </div>
        <div className="card">
          <h3>{t('certifications')}</h3>
          {data.certifications.length === 0 && <p className="muted">—</p>}
          {data.certifications.map((c) => (
            <div key={c.id} style={{ padding: '0.4rem 0' }}>
              {c.name} {c.issuer && <span className="muted">· {c.issuer}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CandidatePage() {
  return (
    <Suspense fallback={null}>
      <CandidateInner />
    </Suspense>
  );
}
