'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { sanitizeMojibake } from '@/lib/text';
import { jobLocationLabel } from '@/lib/location';
import { useI18n } from '@/lib/i18n';
import { formatSalaryRange } from '@/lib/numberFormat';
import { ExploreSection } from '@/components/explore/ExploreSection';
import { ExploreCategoryCard } from '@/components/explore/ExploreCategoryCard';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';
import { ExploreCompanyCard } from '@/components/explore/ExploreCompanyCard';
import { ExploreTitleCard } from '@/components/explore/ExploreTitleCard';
import { ExploreIndustryCard } from '@/components/explore/ExploreIndustryCard';

type Category = { name: string; slug: string; icon?: string | null };
type Job = {
  id: string;
  title: string;
  isHot?: boolean;
  workMode?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  company: { name: string; logoUrl?: string | null; slug: string };
  city?: { name: string } | null;
};

type FacetItem = { slug: string; name: string; count: number; logoUrl?: string | null };

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
  const [companyFacets, setCompanyFacets] = useState<FacetItem[]>([]);
  const [titleFacets, setTitleFacets] = useState<FacetItem[]>([]);
  const [industryFacets, setIndustryFacets] = useState<FacetItem[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    api<Category[]>('/meta/categories', { auth: false }).then(setCategories).catch(() => undefined);
    api<{ items: Job[] }>('/jobs?hotOnly=true&limit=6&sort=relevance', { auth: false })
      .then((r) => setHotJobs(r.items))
      .catch(() => undefined);
    api<{
      facets?: {
        cities?: FacetItem[];
        companies?: FacetItem[];
        categories?: FacetItem[];
        jobTitles?: FacetItem[];
        industries?: FacetItem[];
      };
    }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => {
        setCityFacets((r.facets?.cities || []).slice(0, 8));
        setCompanyFacets((r.facets?.companies || []).slice(0, 8));
        setIndustryFacets((r.facets?.industries || []).slice(0, 8));
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
            <strong>90+</strong>
            <span>{t('openRoles')}</span>
          </div>
          <div className="stat">
            <strong>20</strong>
            <span>{t('companiesStat')}</span>
          </div>
          <div className="stat">
            <strong>60+</strong>
            <span>{t('talentProfiles')}</span>
          </div>
          <div className="stat">
            <strong>15</strong>
            <span>{t('citiesCovered')}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="section-title">{t('hotJobs')}</h2>
          <Link href="/jobs?hotOnly=true" className="muted">
            {t('viewAll')} →
          </Link>
        </div>
        <div className="grid-2">
          {hotJobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="card job-card"
              style={{ margin: 0, gridTemplateColumns: '48px 1fr' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="company-logo"
                src={
                  job.company.logoUrl ||
                  `https://api.dicebear.com/9.x/initials/svg?seed=${job.company.name}`
                }
                alt=""
                style={{ width: 48, height: 48 }}
              />
              <div>
                <span className="badge hot">{t('hot')}</span>
                <h3>{sanitizeMojibake(job.title)}</h3>
                <div className="job-meta">
                  <span>{job.company.name}</span>
                  <span>{jobLocationLabel(job)}</span>
                  {formatSalary(job.salaryMin, job.salaryMax) && (
                    <span className="salary" style={{ fontSize: '0.9rem' }}>
                      {formatSalary(job.salaryMin, job.salaryMax)}
                    </span>
                  )}
                </div>
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

      {industryFacets.length > 0 && (
        <ExploreSection
          title={t('exploreByIndustry')}
          subtitle={t('exploreByIndustrySubtitle')}
          viewAllHref="/explore/industries"
          viewAllLabel={t('viewAll')}
        >
          {industryFacets.map((item) => (
            <ExploreIndustryCard
              key={item.slug}
              name={item.name}
              slug={item.slug}
              count={item.count}
              countLabel={rolesLabel(t, item.count)}
            />
          ))}
        </ExploreSection>
      )}

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

      {companyFacets.length > 0 && (
        <ExploreSection
          title={t('exploreByCompany')}
          subtitle={t('exploreByCompanySubtitle')}
          viewAllHref="/explore/companies"
          viewAllLabel={t('viewAll')}
        >
          {companyFacets.map((c) => (
            <ExploreCompanyCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              logoUrl={c.logoUrl}
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

      <section className="section grid-3" style={{ paddingBottom: '3rem' }}>
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
    </div>
  );
}
