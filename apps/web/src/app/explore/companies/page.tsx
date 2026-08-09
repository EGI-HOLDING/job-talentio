'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreCompanyCard } from '@/components/explore/ExploreCompanyCard';

type CompanyFacet = {
  slug: string;
  name: string;
  logoUrl?: string | null;
  count: number;
};

export default function ExploreCompaniesPage() {
  const { t } = useI18n();
  const [companies, setCompanies] = useState<CompanyFacet[]>([]);

  useEffect(() => {
    api<{ facets?: { companies?: CompanyFacet[] } }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => setCompanies(r.facets?.companies || []))
      .catch(() => undefined);
  }, []);

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '2rem' }}>
        <p className="muted" style={{ marginBottom: '0.35rem' }}>
          <Link href="/">{t('home')}</Link>
          {' / '}
          <span>{t('exploreCompaniesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreCompaniesTitle')}
        </h1>
        <p className="muted">{t('exploreCompaniesSubtitle')}</p>
        <div className="explore-grid explore-grid--company" style={{ marginTop: '1.5rem' }}>
          {companies.map((c) => (
            <ExploreCompanyCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              logoUrl={c.logoUrl}
              count={c.count}
              countLabel={rolesLabel(c.count)}
            />
          ))}
          {!companies.length && <p className="muted">{t('exploreEmpty')}</p>}
        </div>
      </section>
    </div>
  );
}
