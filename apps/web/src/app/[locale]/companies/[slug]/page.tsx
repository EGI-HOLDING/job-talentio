'use client';
import { loginForCurrentPage } from '@/lib/authReturn';

import { Link, localeHref } from '@/lib/navigation';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { accountReturnHref, employerWorkspaceHref, isEmployerRole, jobDetailHref } from '@/lib/accountNavigation';
import { api, getSession } from '@/lib/api';
import { DirectoryStatus } from '@/components/public/BrowsePage';
import { ShareButton } from '@/components/ui/ShareButton';
import { UgcText } from '@/components/ui/UgcText';
import { PreviewableImage } from '@/components/ui/ImagePreview';
import { isPreviewableImageUrl } from '@/lib/image-preview';
import { useI18n } from '@/lib/i18n';
import s from '@/components/public/PublicPages.module.css';
import { JobsIcon } from '@/components/jobs/JobsIcon';

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
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const [company, setCompany] = useState<Company | null>(null);
  const [following, setFollowing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const session = typeof window !== 'undefined' ? getSession() : null;
  const employer = isEmployerRole(session?.user.role);
  const ownsCompany = session?.user.memberships?.some((membership) => membership.companyId === company?.id);
  const returnTo = accountReturnHref(session?.user.role, searchParams.get('returnTo'));
  const backHref = returnTo || (employer ? employerWorkspaceHref(ownsCompany ? 'company' : 'jobs', ownsCompany ? company?.id : undefined) : '/explore/companies');
  const backLabel = returnTo ? t('back') : employer ? t(ownsCompany ? 'company' : 'jobs') : t('public.backCompanies');

  useEffect(() => {
    let active = true;
    setError('');
    setCompany(null);
    api<Company>(`/companies/slug/${slug}`, { auth: false })
      .then(async (c) => {
        if (!active) return;
        setCompany(c);
        if (session?.user.role === 'EMPLOYEE') {
          try {
            const f = await api<{ following: boolean }>(`/companies/${c.id}/following`);
            if (active) setFollowing(f.following);
          } catch {
            /* ignore */
          }
        }
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [slug, locale, retry]);

  async function toggleFollow() {
    if (employer) return;
    if (!session || !company) {
      window.location.href = localeHref(loginForCurrentPage());
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

  if (!company && error) return <div className={s.page}><div className={s.status}><p role="alert">{t('public.loadError')}</p><button className={s.primary} onClick={() => setRetry((value) => value + 1)}>{t('workspace.retry')}</button><p><Link href={backHref}>{backLabel}</Link></p></div></div>;
  if (!company) return <div className={s.page}><div className={s.container}><DirectoryStatus loading onRetry={() => setRetry((value) => value + 1)} /></div></div>;
  return <div className={s.page}><div className={s.container}>
    <Link href={backHref} className={s.back}><JobsIcon kind="back" />{backLabel}</Link>
    <header className={s.companyHeader}>
      <span className={s.companyLogo} aria-hidden={isPreviewableImageUrl(company.logoUrl) ? undefined : true}><PreviewableImage className="company-logo" fill src={company.logoUrl} fallbackSrc={'https://api.dicebear.com/9.x/initials/svg?seed=' + encodeURIComponent(company.name)} /></span>
      <div><h1>{company.name}{company.isVerified && <span aria-label={t('trustVerifiedChip')}> {'\u2713'}</span>}</h1><div className={s.meta}>
        {company.industry && (employer ? <span>{company.industry.name}</span> : <Link href={'/jobs?industrySlug=' + encodeURIComponent(company.industry.slug)}>{company.industry.name}</Link>)}
        {company.city && <span>{company.city.name}</span>}{company.size && <span>{company.size.replace('SIZE_', '').replace(/_/g, '-')}</span>}
        <span>{t('followersCount').replace('{n}', String(company._count?.followers ?? 0))}</span>
      </div></div>
      <div className={s.companyActions}>{!employer && <button type="button" className={following ? s.secondary : s.primary} disabled={followBusy} onClick={async () => { if (followBusy) return; setFollowBusy(true); try { await toggleFollow(); } catch (err) { setError((err as Error).message); } finally { setFollowBusy(false); } }}>{following ? t('following') : t('followCompany')}</button>}<ShareButton path={'/companies/' + company.slug} title={company.name} className={s.secondary} /></div>
    </header>
    {error && <p className={s.notice} role="alert">{error}</p>}
    <div className={s.companyBody}>
      <section><h2>{t('public.openPositions').replace('{n}', String(company.jobPosts.length))}</h2>
        {company.jobPosts.map((job) => <Link key={job.id} href={jobDetailHref(job.id, '/companies/' + company.slug)} className={s.job}><h3>{job.title}</h3><div className={s.meta}>{job.city && <span>{job.city.name}</span>}{job.category && <span>{job.category.name}</span>}<span>{t('landing.viewJob')} {'\u2192'}</span></div><div className={s.skills}>{job.jobSkills?.map((item, index) => <span key={index}>{item.skill.name}</span>)}</div></Link>)}
        {!company.jobPosts.length && <p className={s.notice}>{t('public.noPositions')}</p>}
      </section>
      <aside className={s.companyAbout}><h2>{t('public.aboutCompany')}</h2>
        {company.description && <UgcText text={company.description} contentLocale={company.contentLocale} isMachineTranslated={company.isMachineTranslated} paragraphs translating={translating} onTranslate={company.canMachineTranslate ? () => void machineTranslate() : undefined} />}
        {company.website && <p><a href={company.website} target="_blank" rel="noreferrer">{t('public.website')} {'\u2197'}</a></p>}
      </aside>
    </div>
  </div></div>;
}
