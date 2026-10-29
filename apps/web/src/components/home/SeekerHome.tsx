'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { TopCompany } from './TopCompaniesCarousel';
import { SeekerHero, type PlatformStats } from './SeekerHero';
import { ForYouJobsSection } from './ForYouJobsSection';
import { LandingSections, type LandingCategory, type LandingJob, type LandingLocation, type LandingFacet } from './LandingSections';
import type { NewsListItem } from '@/lib/newsSeo';
import styles from './SeekerHero.module.css';

type CityMetadata = { slug: string; name: string; province?: { country?: { slug: string; name: string } } };
type Catalog = { cities: LandingLocation[]; categories: LandingCategory[]; titles: LandingFacet[] };

export function SeekerHome({ isEmployee = false }: { isEmployee?: boolean }) {
  const { locale } = useI18n();
  const [catalog, setCatalog] = useState<Catalog>({ cities: [], categories: [], titles: [] });
  const [featuredJobs, setFeaturedJobs] = useState<LandingJob[]>([]);
  const [topCompanies, setTopCompanies] = useState<TopCompany[]>([]);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [latestNews, setLatestNews] = useState<NewsListItem[]>([]);

  useEffect(() => {
    let active = true;
    api<PlatformStats>('/meta/platform-stats', { auth: false }).then((data) => { if (active) setPlatformStats(data); }).catch(() => undefined);
    api<{ items: LandingJob[] }>('/jobs?limit=6&sort=newest', { auth: false }).then((data) => { if (active) setFeaturedJobs(data.items); }).catch(() => undefined);
    api<{ items: TopCompany[] }>('/companies?sort=featured&limit=48', { auth: false }).then((data) => { if (active) setTopCompanies(data.items || []); }).catch(() => undefined);
    api<{ items: NewsListItem[] }>('/news?category=CAREER&limit=3', { auth: false }).then((data) => { if (active) setLatestNews(data.items); }).catch(() => undefined);
    Promise.all([
      api<Array<{ slug: string; name: string; icon?: string | null }>>('/meta/categories', { auth: false }),
      api<CityMetadata[]>('/meta/cities', { auth: false }).catch(() => [] as CityMetadata[]),
      api<{ facets?: { cities?: LandingFacet[]; categories?: LandingFacet[]; jobTitles?: LandingFacet[] } }>('/jobs?limit=1&sort=newest', { auth: false }),
    ]).then(([categories, metadata, result]) => {
      if (!active) return;
      const counts = new Map((result.facets?.categories || []).map((item) => [item.slug, item.count]));
      const cityLookup = new Map(metadata.map((item) => [item.slug, item]));
      const cityCounts = new Map((result.facets?.cities || []).map(item => [item.slug, item.count]));
      const cities = metadata.map((item) => ({
        ...item, count: cityCounts.get(item.slug) || 0,
        country: cityLookup.get(item.slug)?.province?.country?.name,
        countrySlug: cityLookup.get(item.slug)?.province?.country?.slug,
      })).sort((a, b) => b.count - a.count);
      setCatalog({
        cities,
        categories: categories.map((item) => ({ ...item, count: counts.get(item.slug) || 0 })).sort((a, b) => b.count - a.count),
        titles: (result.facets?.jobTitles || []).sort((a, b) => b.count - a.count).slice(0, 8),
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [locale]);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <SeekerHero stats={platformStats} cities={catalog.cities} companies={topCompanies} popularRoles={catalog.titles} />
        {isEmployee && <ForYouJobsSection />}
        <LandingSections jobs={featuredJobs} categories={catalog.categories} cities={catalog.cities} roles={catalog.titles} news={latestNews} showEmployerCta={!isEmployee} />
      </div>
    </div>
  );
}
