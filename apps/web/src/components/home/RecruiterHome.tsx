'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreSection } from '@/components/explore/ExploreSection';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';
import { ExploreTitleCard } from '@/components/explore/ExploreTitleCard';
import { CompanyTrustBanner } from '@/components/home/CompanyTrustBanner';
import { sanitizeMojibake } from '@/lib/text';
import { NewsCard } from '@/components/news/NewsCard';
import type { NewsListItem } from '@/lib/newsSeo';

type FacetItem = { slug: string; name: string; count: number };
type Job = {
  id: string;
  title: string;
  status?: string;
  workMode?: string | null;
  city?: { name: string } | null;
};

function talentCountLabel(t: (k: string) => string, n: number) {
  return t('talentAvailableCount').replace('{n}', String(n));
}

export function RecruiterHome() {
  const router = useRouter();
  const { t } = useI18n();
  const [company, setCompany] = useState<any>(null);
  const [cityFacets, setCityFacets] = useState<FacetItem[]>([]);
  const [skillFacets, setSkillFacets] = useState<FacetItem[]>([]);
  const [titleFacets, setTitleFacets] = useState<FacetItem[]>([]);
  const [openJobs, setOpenJobs] = useState<Job[]>([]);
  const [latestNews, setLatestNews] = useState<NewsListItem[]>([]);

  useEffect(() => {
    api<{ items: NewsListItem[] }>('/news/latest?limit=4', { auth: false })
      .then((r) => setLatestNews(r.items))
      .catch(() => undefined);
    api<any[]>('/companies/mine')
      .then(async (mine) => {
        const row = mine[0];
        setCompany(row?.company || null);
        if (row?.companyId) {
          const jobs = await api<Job[]>(`/jobs/company/${row.companyId}`).catch(() => []);
          setOpenJobs(
            (jobs || []).filter((j) => j.status === 'PUBLISHED' || j.status === 'PAUSED').slice(0, 3),
          );
        }
      })
      .catch(() => undefined);

    api<{
      facets?: { cities?: FacetItem[]; skills?: FacetItem[]; jobTitles?: FacetItem[] };
    }>('/profiles/candidates?limit=1&sort=newest')
      .then((r) => {
        setCityFacets((r.facets?.cities || []).slice(0, 8));
        setSkillFacets((r.facets?.skills || []).slice(0, 8));
        setTitleFacets((r.facets?.jobTitles || []).filter((t) => t.count > 0).slice(0, 8));
      })
      .catch(() => undefined);
  }, []);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q') as string;
    router.push(`/talent?q=${encodeURIComponent(q || '')}`);
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '1.25rem', paddingBottom: 0 }}>
        <CompanyTrustBanner company={company} />
      </section>

      <section className="hero hero--recruiter">
        <span className="badge">{t('recruiterHeroBadge')}</span>
        <h1>{t('recruiterHeroTitle')}</h1>
        <p>{t('recruiterHeroSubtitle')}</p>
        <form className="hero-search" onSubmit={onSearch}>
          <input
            name="q"
            placeholder={t('findTalentSearchPlaceholder')}
            aria-label={t('findTalent')}
          />
          <button type="submit" className="cta">
            {t('findTalent')}
          </button>
        </form>
        <div className="chips" style={{ marginTop: '1rem', justifyContent: 'center' }}>
          <Link href="/dashboard/recruiter?tab=jobs&focus=create" className="chip">
            {t('postAJob')}
          </Link>
          <Link href="/dashboard/recruiter" className="chip">
            {t('dashboard')}
          </Link>
          <Link href="/talent" className="chip">
            {t('browseTalent')}
          </Link>
        </div>
      </section>

      {openJobs.length > 0 && (
        <section className="section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="section-title">{t('yourOpenJobs')}</h2>
            <Link href="/dashboard/recruiter?tab=pipeline" className="muted">
              {t('viewAll')} →
            </Link>
          </div>
          <div className="grid-2">
            {openJobs.map((job) => (
              <Link
                key={job.id}
                href={`/dashboard/recruiter?tab=pipeline&job=${job.id}`}
                className="card"
                style={{ margin: 0 }}
              >
                <h3 style={{ marginTop: 0 }}>{sanitizeMojibake(job.title)}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {job.city?.name || job.workMode || job.status}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {cityFacets.length > 0 && (
        <ExploreSection
          title={t('talentByCity')}
          subtitle={t('talentByCitySubtitle')}
          viewAllHref="/talent"
          viewAllLabel={t('viewAll')}
        >
          {cityFacets.map((c) => (
            <ExploreCityCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              count={c.count}
              countLabel={talentCountLabel(t, c.count)}
              href={`/talent?city=${encodeURIComponent(c.slug)}`}
            />
          ))}
        </ExploreSection>
      )}

      {skillFacets.length > 0 && (
        <ExploreSection
          title={t('talentBySkill')}
          subtitle={t('talentBySkillSubtitle')}
          viewAllHref="/talent"
          viewAllLabel={t('viewAll')}
        >
          {skillFacets.map((s) => (
            <Link
              key={s.slug}
              href={`/talent?skills=${encodeURIComponent(s.slug)}`}
              className="explore-card explore-card--title"
            >
              <strong>{s.name}</strong>
              <span>{talentCountLabel(t, s.count)}</span>
            </Link>
          ))}
        </ExploreSection>
      )}

      {titleFacets.length > 0 && (
        <ExploreSection
          title={t('talentByTitle')}
          subtitle={t('talentByTitleSubtitle')}
          viewAllHref="/talent"
          viewAllLabel={t('viewAll')}
        >
          {titleFacets.map((item) => (
            <ExploreTitleCard
              key={item.slug}
              name={item.name}
              slug={item.slug}
              count={item.count}
              countLabel={talentCountLabel(t, item.count)}
              href={`/talent?jobTitle=${encodeURIComponent(item.slug)}`}
            />
          ))}
        </ExploreSection>
      )}

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

      <section className="section" style={{ paddingBottom: '3rem' }}>
        <div className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ marginTop: 0 }}>{t('recruiterReadyTitle')}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {t('recruiterReadySubtitle')}
            </p>
          </div>
          <Link href="/dashboard/recruiter?tab=jobs&focus=create" className="cta">
            {t('postAJob')}
          </Link>
        </div>
      </section>
    </div>
  );
}
