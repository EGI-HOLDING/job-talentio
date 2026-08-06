'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';

type Company = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  isVerified?: boolean;
  city?: { name: string } | null;
  industry?: { name: string } | null;
  size?: string | null;
  _count?: { followers: number; jobPosts: number };
  jobPosts: Array<{
    id: string;
    title: string;
    city?: { name: string } | null;
    category?: { name: string } | null;
    salaryMin?: number | null;
    salaryMax?: number | null;
    jobSkills?: Array<{ skill: { name: string } }>;
  }>;
};

export default function CompanyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [company, setCompany] = useState<Company | null>(null);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState('');
  const session = typeof window !== 'undefined' ? getSession() : null;

  useEffect(() => {
    api<Company>(`/companies/slug/${slug}`, { auth: false })
      .then(async (c) => {
        setCompany(c);
        if (session) {
          try {
            const f = await api<{ following: boolean }>(`/companies/${c.id}/following`);
            setFollowing(f.following);
          } catch {
            /* ignore */
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  async function toggleFollow() {
    if (!session || !company) {
      window.location.href = '/login';
      return;
    }
    const method = following ? 'DELETE' : 'POST';
    const r = await api<{ following: boolean; followers: number }>(
      `/companies/${company.id}/follow`,
      { method },
    );
    setFollowing(r.following);
    setCompany({ ...company, _count: { ...company._count!, followers: r.followers } });
  }

  if (error) return <div className="shell"><div className="error">{error}</div></div>;
  if (!company) return <DetailPageSkeleton />;

  return (
    <div className="shell" style={{ padding: '1.5rem 0 3rem' }}>
      <div className="job-detail-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            company.logoUrl ||
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(company.name)}`
          }
          alt=""
        />
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>
            {company.name} {company.isVerified ? '✓' : ''}
          </h1>
          <div className="job-meta">
            {company.industry && <span>{company.industry.name}</span>}
            {company.city && <span>{company.city.name}</span>}
            {company.size && <span>{company.size.replace('SIZE_', '').replace(/_/g, '-')}</span>}
            <span>{company._count?.followers ?? 0} followers</span>
          </div>
          {company.website && (
            <a href={company.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              {company.website}
            </a>
          )}
          <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>{company.description}</p>
        </div>
        <button type="button" className={following ? 'secondary' : 'cta'} onClick={toggleFollow}>
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>
        Open positions ({company.jobPosts.length})
      </h2>
      {company.jobPosts.map((job) => (
        <Link key={job.id} href={`/jobs/${job.id}`} className="job-card">
          <div />
          <div>
            <h3>{job.title}</h3>
            <div className="job-meta">
              {job.city && <span>{job.city.name}</span>}
              {job.category && <span>{job.category.name}</span>}
            </div>
            <div className="chips">
              {(job.jobSkills || []).map((js, i) => (
                <span key={i} className="badge skill">
                  {js.skill.name}
                </span>
              ))}
            </div>
          </div>
          <div />
        </Link>
      ))}
      {!company.jobPosts.length && <p className="muted">No open jobs right now.</p>}
    </div>
  );
}
