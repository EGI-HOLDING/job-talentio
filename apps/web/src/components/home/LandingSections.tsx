'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@/lib/navigation';
import { getSession } from '@/lib/api';
import { authLink } from '@/lib/authReturn';
import { useI18n } from '@/lib/i18n';
import { sanitizeMojibake } from '@/lib/text';
import type { NewsListItem } from '@/lib/newsSeo';
import { formatNewsDate, NEWS_CATEGORY_LABEL_KEY } from '@/components/news/NewsCard';
import s from './LandingSections.module.css';

export type LandingFacet = { slug: string; name: string; count: number };
export type LandingCategory = LandingFacet & { icon?: string | null };
export type LandingLocation = LandingFacet & { country?: string; countrySlug?: string };
export type LandingJob = {
  id: string; title: string; workMode?: string | null;
  salaryMin?: number | null; salaryMax?: number | null; currency?: string; salaryPeriod?: string;
  company: { name: string; slug: string; logoUrl?: string | null };
  city?: { slug?: string; name: string } | null;
};

export function LandingIcon({ kind = 'arrow', className, icon }: { kind?: string; className?: string; icon?: string | null }) {
  if (icon) return <span className={className} aria-hidden="true">{icon}</span>;
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.4" /></>,
    person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3H4Z" /></>,
    document: <path d="M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h8m-8 4h6" />,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
    remote: <><path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0m-11 4a5 5 0 0 1 8 0" /><circle cx="12" cy="20" r="1" /></>,
    briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V3h8v4M2 12c6 4 14 4 20 0m-10 1v4" /></>,
  };
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] || paths.briefcase}</svg>;
}

function Heading({ title, subtitle, href, action }: { title: string; subtitle: string; href: string; action: string }) {
  return <div className={s.heading}><div><h2>{title}</h2><p>{subtitle}</p></div><Link href={href}>{action}<LandingIcon /></Link></div>;
}

const LOCATION_PHOTOS: Record<string, string> = {
  tashkent: '/images/location-tashkent.webp', samarkand: '/images/location-samarkand.webp',
  bukhara: '/images/location-bukhara.webp', andijan: '/images/location-andijan.webp',
};

export function LandingSections({ jobs, categories, cities, roles, news }: {
  jobs: LandingJob[]; categories: LandingCategory[]; cities: LandingLocation[]; roles: LandingFacet[]; news: NewsListItem[];
}) {
  const { t, locale } = useI18n();
  const [profileHref, setProfileHref] = useState(() => authLink('/register', '/dashboard/employee?tab=profile&section=cvs', 'EMPLOYEE'));

  useEffect(() => {
    const refreshProfileHref = () => setProfileHref(getSession()?.user.role === 'EMPLOYEE'
      ? '/dashboard/employee?tab=profile&section=cvs'
      : authLink('/register', '/dashboard/employee?tab=profile&section=cvs', 'EMPLOYEE'));
    refreshProfileHref();
    window.addEventListener('jt-session-updated', refreshProfileHref);
    window.addEventListener('storage', refreshProfileHref);
    return () => {
      window.removeEventListener('jt-session-updated', refreshProfileHref);
      window.removeEventListener('storage', refreshProfileHref);
    };
  }, []);

  const countLabel = (count: number) => t('openRolesCount').replace('{n}', String(count));
  const salary = (job: LandingJob) => {
    const min = job.salaryMin, max = job.salaryMax;
    if (min == null && max == null) return t('landing.salaryNegotiable');
    const fmt = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : locale === 'uz' ? 'uz-UZ' : locale === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 0 });
    const modifier = t(min != null ? 'landing.from' : 'landing.upTo');
    const singleAmount = fmt.format((min ?? max)!);
    const amount = min != null && max != null
      ? `${fmt.format(min)} - ${fmt.format(max)}`
      : locale === 'uz' ? `${singleAmount} ${modifier}` : `${modifier} ${singleAmount}`;
    const periods: Record<string, string> = { MONTHLY: 'landing.month', YEARLY: 'landing.year', HOURLY: 'landing.hour' };
    const period = periods[job.salaryPeriod || ''];
    return `${job.currency || ''} ${amount}${period ? ` / ${t(period)}` : ''}`.trim();
  };
  const jobLocation = (job: LandingJob) => {
    const city = cities.find((item) => item.slug === job.city?.slug);
    return [job.city?.name, city?.country].filter(Boolean).join(', ');
  };
  const featuredCities = cities.slice(0, 4);

  return <div className={s.sections}>
    <section className={s.featured}>
      <Heading title={t('landing.featured')} subtitle={t('landing.featuredSub')} href="/jobs" action={t('landing.viewJobs')} />
      <div className={s.jobs}>
        {jobs.map((job) => <Link data-job-impression={job.id} className={s.job} href={`/jobs/${job.id}`} key={job.id}>
          <div className={s.jobCompany}>
            <span className={s.logo}>{job.company.logoUrl ? <img src={job.company.logoUrl} alt="" loading="lazy" /> : job.company.name.slice(0, 1)}</span>
            <span>{job.company.name}</span><span className={s.badge}>{t('landing.badge')}</span>
          </div>
          <h3>{sanitizeMojibake(job.title)}</h3>
          <div className={s.jobLocation}>{jobLocation(job) && <span><LandingIcon kind="pin" />{jobLocation(job)}</span>}{job.workMode && <span className={s.workMode}>{t(`enum.workMode.${job.workMode}`)}</span>}</div>
          <div className={s.jobBottom}><strong>{salary(job)}</strong><span className={s.viewJob}>{t('landing.viewJob')}<LandingIcon /></span></div>
        </Link>)}
        {!jobs.length && <p className="muted">{t('hotJobsEmpty')}</p>}
      </div>
    </section>

    <section className={s.candidate}>
      <div className={s.candidateCopy}><span className={s.eyebrow}>{t('landing.forSeekers')}</span><h2>{t('landing.candidateTitle')}</h2><p>{t('landing.candidateSub')}</p><Link href={profileHref} className={s.primaryButton}>{t('landing.createProfile')}<LandingIcon /></Link></div>
      <ol className={s.steps}>{['person', 'document', 'search'].map((icon, index) => <li key={icon}><span className={s.stepIcon}><LandingIcon kind={icon} /></span><div><strong>{index + 1}. {t(`landing.step${index + 1}`)}</strong><span>{t(`landing.step${index + 1}Sub`)}</span></div></li>)}</ol>
      <div className={s.cvArt} aria-hidden="true"><div className={s.cvPaper}><div className={s.cvHeader}><LandingIcon kind="person" /><strong>CV</strong></div><i /><i /><i /><div className={s.cvChecks}><span>{'\u2713'}</span><span>{'\u2713'}</span><span>{'\u2713'}</span></div></div></div>
    </section>

    <section>
      <Heading title={t('landing.field')} subtitle={t('landing.fieldSub')} href="/explore/categories" action={t('landing.categories')} />
      <div className={s.categories}>{categories.slice(0, 8).map((item) => <Link className={s.category} key={item.slug} href={`/jobs?category=${encodeURIComponent(item.slug)}`}>
        {item.icon ? <LandingIcon icon={item.icon} /> : <LandingIcon kind="briefcase" />}<div><h3>{item.name}</h3><span>{countLabel(item.count)}</span></div>
      </Link>)}</div>
    </section>

    {cities.length > 0 && <section>
      <Heading title={t('landing.locationTitle')} subtitle={t('landing.locationSub')} href="/explore/cities" action={t('landing.exploreLocations')} />
      <div className={s.locations}>{featuredCities.map((city) => <Link className={s.location} key={city.slug} href={`/jobs?city=${encodeURIComponent(city.slug)}`}>
        {LOCATION_PHOTOS[city.slug] ? <img className={s.cityPhoto} src={LOCATION_PHOTOS[city.slug]} alt="" loading="lazy" /> : <div className={s.cityFallback}><LandingIcon kind="pin" /></div>}
        <div className={s.locationBody}><div><h3>{city.name}</h3><span>{city.country || countLabel(city.count)}</span></div><LandingIcon /></div>
      </Link>)}</div>
      <div className={s.moreLocations}>{cities.slice(4, 7).map((city) => <Link key={city.slug} href={`/jobs?city=${encodeURIComponent(city.slug)}`}><span>{city.name}{city.country && <small>{city.country}</small>}</span><LandingIcon /></Link>)}<Link href="/jobs?workMode=REMOTE" className={s.remote}><LandingIcon kind="remote" />{t('landing.remoteRoles')}<LandingIcon /></Link></div>
    </section>}

    {roles.length > 0 && <section>
      <Heading title={t('landing.roles')} subtitle={t('landing.rolesSub')} href="/explore/titles" action={t('landing.allRoles')} />
      <div className={s.roles}>{roles.map((role) => <Link key={role.slug} href={`/jobs?jobTitle=${encodeURIComponent(role.slug)}`}><strong>{role.name}</strong><span>{countLabel(role.count)}</span><LandingIcon /></Link>)}</div>
    </section>}

    {news.length > 0 && <section>
      <Heading title={t('landing.insights')} subtitle={t('landing.insightsSub')} href="/news" action={t('landing.allArticles')} />
      <div className={s.news}>{news.map((item) => <Link className={s.article} key={item.slug} href={`/news/${item.slug}`}>
        {item.coverUrl && <img src={item.coverUrl} alt="" loading="lazy" />}
        <div className={s.articleBody}><div className={s.articleMeta}><span className={s.badge}>{t(NEWS_CATEGORY_LABEL_KEY[item.category])}</span><time dateTime={item.publishedAt}>{formatNewsDate(item.publishedAt, locale)}</time></div><h3>{item.title}</h3><p>{item.excerpt}</p><span className={s.readMore}>{t('readMore')}<LandingIcon /></span></div>
      </Link>)}</div>
    </section>}

    <section className={s.employer}><LandingIcon kind="briefcase" /><div><h2>{t('landing.employerTitle')}</h2><p>{t('landing.employerSub')}</p></div><Link href="/register?role=RECRUITER" className={s.outlineButton}>{t('postAJob')}<LandingIcon /></Link></section>
  </div>;
}
