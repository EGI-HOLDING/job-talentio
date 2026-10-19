'use client';

import Image from 'next/image';
import type { FormEvent } from 'react';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { formatCompactCount } from '@/lib/numberFormat';
import type { TopCompany } from './TopCompaniesCarousel';
import styles from './SeekerHero.module.css';
import { HeroLocationPicker } from './HeroLocationPicker';

export type PlatformStats = {
  openRoles: number;
  companies: number;
  talentProfiles: number;
  citiesCovered: number;
};

type Props = {
  stats: PlatformStats | null;
  cities: Array<{ slug: string; name: string; country?: string; countrySlug?: string }>;
  companies: TopCompany[];
};

const POPULAR_ROLES = [
  { key: 'home.popularFrontend', slug: 'frontend-developer' },
  { key: 'home.popularAccountant', slug: 'accountant' },
  { key: 'home.popularSales', slug: 'sales-manager' },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={diagonal ? 'M7 17 17 7M7 7h10v10' : 'M4 12h15m-6-6 6 6-6 6'}
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export function SeekerHero({ stats, cities, companies }: Props) {
  const { t } = useI18n();
  const router = useRouter();

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const query = String(data.get('q') || '').trim();
    const location = String(data.get('location') || '');
    const city = location.startsWith('country:')
      ? cities.filter((item) => item.countrySlug === location.slice(8)).map((item) => item.slug).join(',')
      : location;
    if (query) params.set('q', query);
    if (city) params.set('city', city);
    router.push(params.size ? `/jobs?${params}` : '/jobs');
  }

  return (
    <>
      <section className={styles.hero} aria-labelledby="seeker-hero-title">
        <Image
          src="/images/talentio-hero-global-hd.webp"
          alt=""
          fill
          priority
          quality={95}
          // The panoramic photo covers a tall mobile hero, so its painted width
          // is much larger than the image box. Keep enough pixels for that crop.
          sizes="(max-width: 760px) 1800px, (max-width: 1608px) calc(100vw - 3rem), 1560px"
          className={styles.photo}
        />
        <div className={styles.overlay} aria-hidden="true" />
        <div className={styles.content}>
          <p className={styles.eyebrow}>{t('home.heroEyebrow')}</p>
          <h1 id="seeker-hero-title" className={styles.title}>
            <span>{t('landing.title1')}</span>
            <span>{t('landing.title2')}</span>
          </h1>
          <p className={styles.subtitle}>
            <span>{t('landing.subtitle1')}</span>
            <span>{t('landing.subtitle2')}</span>
          </p>
        </div>

        <form className={styles.search} role="search" aria-label={t('searchJobs')} onSubmit={onSearch}>
          <label className={styles.queryField}>
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.8" stroke="currentColor" strokeWidth="1.7" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="sr-only">{t('searchPlaceholder')}</span>
            <input name="q" type="search" placeholder={t('searchPlaceholder')} />
          </label>
          <div className={styles.cityField}>
            <HeroLocationPicker cities={cities} />
          </div>
          <button className={styles.searchButton} type="submit">
            {t('searchJobs')}<Arrow />
          </button>
        </form>

        <div className={styles.popular}>
          <span>{t('home.popular')}</span>
          {POPULAR_ROLES.map((role) => (
            <Link key={role.slug} href={`/jobs?jobTitle=${role.slug}`}>{t(role.key)}</Link>
          ))}
          <Link className={styles.remoteLink} href="/jobs?workMode=REMOTE">{t('landing.remoteJobs')}</Link>
        </div>
      </section>

      <dl className={styles.stats} aria-label={t('home.platformStats')}>
        {([
          ['openRoles', 'openRoles'],
          ['companies', 'landing.companiesHiring'],
          ['citiesCovered', 'landing.locations'],
        ] as const).map(([field, label]) => (
          <div key={field}>
            <dt>{t(label)}</dt>
            <dd title={stats ? String(stats[field]) : undefined}>{stats ? formatCompactCount(stats[field]) : '-'}</dd>
          </div>
        ))}
      </dl>

      {companies.length > 0 && (
        <section className={styles.employers} aria-labelledby="featured-employers-title">
          <div className={styles.employersHeading}>
            <h2 id="featured-employers-title">{t('home.hiringCompanies')}</h2>
            <Link href="/explore/companies">{t('viewAll')}<Arrow diagonal /></Link>
          </div>
          <div className={styles.companyRow}>
            {companies.slice(0, 5).map((company) => (
              <Link key={company.slug} href={`/jobs?companySlug=${company.slug}`} className={styles.company}>
                {company.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logoUrl} alt="" width="56" height="56" loading="lazy" />
                )}
                <span>{company.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
