'use client';

import { Link } from '@/lib/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { api } from '@/lib/api';
import { sanitizeMojibake } from '@/lib/text';
import { localizedJobLocation } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { formatCompactCount, formatSalaryRange } from '@/lib/numberFormat';
import { ExploreSection } from '@/components/explore/ExploreSection';
import { ExploreCategoryCard } from '@/components/explore/ExploreCategoryCard';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';
import { ExploreCompanyCard } from '@/components/explore/ExploreCompanyCard';
import { ExploreTitleCard } from '@/components/explore/ExploreTitleCard';
import { NewsCard } from '@/components/news/NewsCard';
import type { NewsListItem } from '@/lib/newsSeo';

type PlatformStats = {
  openRoles: number;
  companies: number;
  talentProfiles: number;
  citiesCovered: number;
};

type Category = { name: string; slug: string; icon?: string | null };
type Job = {
  id: string;
  title: string;
  isHot?: boolean;
  boostUntil?: string | null;
  workMode?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string } | null;
};

function hotUrgencyLabel(t: (k: string) => string, boostUntil?: string | null) {
  if (!boostUntil) return t('ui.hotBoostLimited');
  const end = new Date(boostUntil).getTime();
  const days = Math.max(1, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days <= 1) return t('ui.hotEndsToday');
  if (days <= 3) return t('ui.hotDaysLeft').replace('{n}', String(days));
  return t('ui.hotMoreDays').replace('{n}', String(days));
}

type FacetItem = { slug: string; name: string; count: number; logoUrl?: string | null };

type VipCompany = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  plan?: string;
  openJobsCount: number;
};

function formatSalary(min?: number | null, max?: number | null) {
  if (!min && !max) return null;
  return formatSalaryRange(min, max) || null;
}

function rolesLabel(t: (k: string) => string, n: number) {
  return t('openRolesCount').replace('{n}', String(n));
}

export function SeekerHome() {
  const router = useRouter();
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [hotJobs, setHotJobs] = useState<Job[]>([]);
  const [cityFacets, setCityFacets] = useState<FacetItem[]>([]);
  const [topCompanies, setTopCompanies] = useState<VipCompany[]>([]);
  const [titleFacets, setTitleFacets] = useState<FacetItem[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [latestNews, setLatestNews] = useState<NewsListItem[]>([]);

  useEffect(() => {
    api<Category[]>('/meta/categories', { auth: false }).then(setCategories).catch(() => undefined);
    api<{ items: NewsListItem[] }>('/news/latest?limit=4', { auth: false })
      .then((r) => setLatestNews(r.items))
      .catch(() => undefined);
    api<PlatformStats>('/meta/platform-stats', { auth: false })
      .then(setPlatformStats)
      .catch(() => undefined);
    api<{ items: Job[] }>('/jobs?hotOnly=true&limit=6&sort=relevance', { auth: false })
      .then((r) => setHotJobs(r.items))
      .catch(() => undefined);
    api<{ items: VipCompany[] }>('/companies?plan=VIP&limit=12&sort=jobs', { auth: false })
      .then((r) => setTopCompanies(r.items || []))
      .catch(() => undefined);
    api<{
      facets?: {
        cities?: FacetItem[];
        categories?: FacetItem[];
        jobTitles?: FacetItem[];
      };
    }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => {
        setCityFacets((r.facets?.cities || []).slice(0, 8));
        const titles = (r.facets?.jobTitles || []).slice(0, 8);
        setTitleFacets(titles);
        const map: Record<string, number> = {};
        for (const c of r.facets?.categories || []) map[c.slug] = c.count;
        setCategoryCounts(map);
        if (!titles.length) {
          return api<{ items: FacetItem[] }>('/meta/job-titles?page=1&limit=8', { auth: false }).then(
            (list) => {
              setTitleFacets(
                (list.items || []).map((row) => ({
                  slug: row.slug,
                  name: row.name,
                  count: row.count ?? 0,
                })),
              );
            },
          );
        }
      })
      .catch(() => undefined);
  }, []);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q') as string;
    router.push(`/jobs?q=${encodeURIComponent(q || '')}`);
  }

  return (
    <div className="shell">
      <section className="hero">
        <span className="badge">{t('heroBadge')}</span>
        <h1>{t('heroTitle')}</h1>
        <p>{t('heroSubtitle')}</p>
        <form className="hero-search" onSubmit={onSearch}>
          <input name="q" placeholder={t('searchPlaceholder')} aria-label={t('searchJobs')} />
          <button type="submit" className="cta">
            {t('searchJobs')}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '0.85rem', fontSize: '0.9rem' }}>
          {t('hiringCtaPrompt')}{' '}
          <Link href="/register">{t('hiringCtaLink')}</Link>
        </p>
      </section>

      <section className="section">
        <div className="stats-row">
          <div className="stat">
            <strong title={platformStats ? String(platformStats.openRoles) : undefined}>
              {platformStats ? formatCompactCount(platformStats.openRoles) : '-'}
            </strong>
            <span>{t('openRoles')}</span>
          </div>
          <div className="stat">
            <strong title={platformStats ? String(platformStats.companies) : undefined}>
              {platformStats ? formatCompactCount(platformStats.companies) : '-'}
            </strong>
            <span>{t('companiesStat')}</span>
          </div>
          <div className="stat">
            <strong title={platformStats ? String(platformStats.talentProfiles) : undefined}>
              {platformStats ? formatCompactCount(platformStats.talentProfiles) : '-'}
            </strong>
            <span>{t('talentProfiles')}</span>
          </div>
          <div className="stat">
            <strong title={platformStats ? String(platformStats.citiesCovered) : undefined}>
              {platformStats ? formatCompactCount(platformStats.citiesCovered) : '-'}
            </strong>
            <span>{t('citiesCovered')}</span>
          </div>
        </div>
      </section>

      {topCompanies.length > 0 && (
        <ExploreSection
          title={t('topCompanies')}
          subtitle={t('topCompaniesSubtitle')}
          viewAllHref="/explore/companies?tab=vip"
          viewAllLabel={t('viewAll')}
          gridClassName="explore-grid--company"
        >
          {topCompanies.map((c) => (
            <ExploreCompanyCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              logoUrl={c.logoUrl}
              plan={c.plan || 'VIP'}
              vipLabel={t('vipBadge')}
              count={c.openJobsCount}
              countLabel={rolesLabel(t, c.openJobsCount)}
            />
          ))}
        </ExploreSection>
      )}

      <section className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="section-title section-hot-title">{t('hotJobs')}</h2>
          <Link href="/jobs?hotOnly=true" className="muted">
            {t('viewAll')} →
          </Link>
        </div>
        <div className="grid-2">
          {hotJobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="card job-card job-card--hot"
              style={{ margin: 0, gridTemplateColumns: '56px 1fr' }}
            >
              <span className="company-logo-tile" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="company-logo"
                  src={
                    job.company.logoUrl ||
                    `https://api.dicebear.com/9.x/initials/svg?seed=${job.company.name}`
                  }
                  alt=""
                />
              </span>
              <div>
                <span className="badge hot">{t('hot')}</span>
                <h3>{sanitizeMojibake(job.title)}</h3>
                <div className="job-meta">
                  <span>{job.company.name}</span>
                  <span>{localizedJobLocation(job, t)}</span>
                  {formatSalary(job.salaryMin, job.salaryMax) && (
                    <span className="salary" style={{ fontSize: '0.9rem' }}>
                      {formatSalary(job.salaryMin, job.salaryMax)}
                    </span>
                  )}
                </div>
                <div className="hot-urgency">{hotUrgencyLabel(t, job.boostUntil)}</div>
              </div>
            </Link>
          ))}
          {!hotJobs.length && <p className="muted">{t('hotJobsEmpty')}</p>}
        </div>
      </section>

      <ExploreSection
        title={t('exploreByCategory')}
        subtitle={t('exploreByCategorySubtitle')}
        viewAllHref="/explore/categories"
        viewAllLabel={t('viewAll')}
      >
        {categories.slice(0, 8).map((c) => (
          <ExploreCategoryCard
            key={c.slug}
            name={c.name}
            slug={c.slug}
            icon={c.icon}
            count={categoryCounts[c.slug] ?? 0}
            countLabel={rolesLabel(t, categoryCounts[c.slug] ?? 0)}
          />
        ))}
      </ExploreSection>

      {cityFacets.length > 0 && (
        <ExploreSection
          title={t('exploreByCity')}
          subtitle={t('exploreByCitySubtitle')}
          viewAllHref="/explore/cities"
          viewAllLabel={t('viewAll')}
        >
          {cityFacets.map((c) => (
            <ExploreCityCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              count={c.count}
              countLabel={rolesLabel(t, c.count)}
            />
          ))}
        </ExploreSection>
      )}

      {titleFacets.length > 0 && (
        <ExploreSection
          title={t('exploreByTitle')}
          subtitle={t('exploreByTitleSubtitle')}
          viewAllHref="/explore/titles"
          viewAllLabel={t('viewAll')}
        >
          {titleFacets.map((item) => (
            <ExploreTitleCard
              key={item.slug}
              name={item.name}
              slug={item.slug}
              count={item.count}
              countLabel={rolesLabel(t, item.count)}
            />
          ))}
        </ExploreSection>
      )}

      <section className="section grid-3">
        <div className="card">
          <h3>{t('forCandidates')}</h3>
          <p className="muted">{t('forCandidatesDesc')}</p>
        </div>
        <div className="card">
          <h3>{t('forCompanies')}</h3>
          <p className="muted">{t('forCompaniesDesc')}</p>
          <Link href="/register" className="chip" style={{ marginTop: '0.75rem', display: 'inline-flex' }}>
            {t('hiringCtaLink')}
          </Link>
        </div>
        <div className="card">
          <h3>{t('enterpriseReady')}</h3>
          <p className="muted">{t('enterpriseReadyDesc')}</p>
        </div>
      </section>

      {latestNews.length > 0 && (
        <ExploreSection
          title={t('latestNews')}
          subtitle={t('latestNewsSubtitle')}
          viewAllHref="/news"
          viewAllLabel={t('viewAll')}
        >
          {latestNews.map((item) => (
            <NewsCard key={item.slug} item={item} />
          ))}
        </ExploreSection>
      )}
    </div>
  );
}
