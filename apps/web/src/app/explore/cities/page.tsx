'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';

type City = { name: string; slug: string };
type Facet = { slug: string; name: string; count: number };

export default function ExploreCitiesPage() {
  const { t } = useI18n();
  const [cities, setCities] = useState<City[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);

  useEffect(() => {
    api<City[]>('/meta/cities', { auth: false }).then(setCities).catch(() => undefined);
    api<{ facets?: { cities?: Facet[] } }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => setFacets(r.facets?.cities || []))
      .catch(() => undefined);
  }, []);

  const ordered = useMemo(() => {
    const countMap = new Map(facets.map((f) => [f.slug, f.count]));
    const withJobs = [...cities].sort(
      (a, b) => (countMap.get(b.slug) || 0) - (countMap.get(a.slug) || 0) || a.name.localeCompare(b.name),
    );
    return withJobs;
  }, [cities, facets]);

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '2rem' }}>
        <p className="muted" style={{ marginBottom: '0.35rem' }}>
          <Link href="/">{t('home')}</Link>
          {' / '}
          <span>{t('exploreCitiesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreCitiesTitle')}
        </h1>
        <p className="muted">{t('exploreCitiesSubtitle')}</p>
        <div className="explore-grid" style={{ marginTop: '1.5rem' }}>
          {ordered.map((c) => {
            const count = facets.find((f) => f.slug === c.slug)?.count ?? 0;
            return (
              <ExploreCityCard
                key={c.slug}
                name={c.name}
                slug={c.slug}
                count={count}
                countLabel={rolesLabel(count)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
