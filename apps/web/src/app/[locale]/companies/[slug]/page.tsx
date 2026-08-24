'use client';

import { Link, localeHref } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getSession } from '@/lib/api';
import { DetailPageSkeleton } from '@/components/ui/Skeleton';
import { UgcText } from '@/components/ui/UgcText';
import { PreviewableImage } from '@/components/ui/ImagePreview';
import { isPreviewableImageUrl } from '@/lib/image-preview';
import { useI18n } from '@/lib/i18n';

type Company = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  /** Language the description is served in (may differ from the UI). */
  contentLocale?: string | null;
  isMachineTranslated?: boolean;
  canMachineTranslate?: boolean;
  website?: string | null;
  logoUrl?: string | null;
  isVerified?: boolean;
  city?: { name: string } | null;
  industry?: { name: string; slug: string } | null;
  size?: string | null;
  _count?: { followers: number; jobPosts: number };
  jobPosts: Array<{
    id: string;
    title: string;
    contentLocale?: string | null;
    city?: { name: string } | null;
    category?: { name: string } | null;
    salaryMin?: number | null;
    salaryMax?: number | null;
    jobSkills?: Array<{ skill: { name: string } }>;
  }>;
};

export default function CompanyPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useI18n();
  const [company, setCompany] = useState<Company | null>(null);
  const [following, setFollowing] = useState(false);
  const [translating, setTranslating] = useState(false);
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
      window.location.href = localeHref('/login');
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

  async function machineTranslate() {
    setTranslating(true);
    setError('');
    try {
      const res = await api<{ status: string; company: Company }>(
        `/companies/slug/${slug}/translate/${locale}`,
        { method: 'POST' },
      );
      if (res.company) setCompany(res.company);
      if (res.status === 'disabled' || res.status === 'budget-exceeded') {
        setError(t('ui.translateFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.translateFailed'));
    } finally {
      setTranslating(false);
    }
  }

  if (error) return <div className="shell"><div className="error">{error}</div></div>;
  if (!company) return <DetailPageSkeleton />;

  return (
    <div className="shell" style={{ padding: '1.5rem 0 3rem' }}>
      <div className="job-detail-header">
        <span
          className="company-logo-tile"
          aria-hidden={isPreviewableImageUrl(company.logoUrl) ? undefined : true}
        >
          <PreviewableImage
            className="company-logo"
            fill
            src={company.logoUrl}
            fallbackSrc={`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(company.name)}`}
          />
        </span>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>
            {company.name} {company.isVerified ? '✓' : ''}
          </h1>
          <div className="job-meta">
            {company.industry && (
              <Link href={`/jobs?industrySlug=${encodeURIComponent(company.industry.slug)}`}>
                {company.industry.name}
              </Link>
            )}
            {company.city && <span>{company.city.name}</span>}
            {company.size && <span>{company.size.replace('SIZE_', '').replace(/_/g, '-')}</span>}
            <span>{company._count?.followers ?? 0} followers</span>
          </div>
          {company.website && (
            <a href={company.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              {company.website}
            </a>
          )}
          {company.description && (
            <UgcText
              text={company.description}
              contentLocale={company.contentLocale}
              isMachineTranslated={company.isMachineTranslated}
              preserveLineBreaks
              className="company-about"
              translating={translating}
              onTranslate={
                company.canMachineTranslate ? () => void machineTranslate() : undefined
              }
            />
          )}
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
