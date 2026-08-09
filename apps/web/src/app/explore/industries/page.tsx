'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreIndustryCard } from '@/components/explore/ExploreIndustryCard';

type IndustryRow = { slug: string; name: string; sortOrder?: number };
type IndustryGroup = {
  slug: string;
  name: string;
  sortOrder?: number;
  industries: IndustryRow[];
};
type GroupedResponse = { group: 'industry'; groups: IndustryGroup[] };
type Facet = { slug: string; name: string; count: number; groupSlug?: string; groupName?: string };

export default function ExploreIndustriesPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<IndustryGroup[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);

  useEffect(() => {
    api<GroupedResponse>('/meta/industries?group=1', { auth: false })
      .then((res) => {
        if (res && typeof res === 'object' && 'groups' in res) {
          setGroups(res.groups || []);
        }
      })
      .catch(() => undefined);
    api<{ facets?: { industries?: Facet[] } }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => setFacets(r.facets?.industries || []))
      .catch(() => undefined);
  }, []);

  const countMap = useMemo(() => new Map(facets.map((f) => [f.slug, f.count])), [facets]);

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  return (
    <div className="shell">
      <section className="section" style={{ paddingTop: '2rem' }}>
        <p className="muted" style={{ marginBottom: '0.35rem' }}>
          <Link href="/">{t('home')}</Link>
          {' / '}
          <span>{t('exploreIndustriesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreIndustriesTitle')}
        </h1>
        <p className="muted">{t('exploreIndustriesSubtitle')}</p>

        <div style={{ marginTop: '1.5rem' }}>
          {groups.map((g) => (
            <div key={g.slug} className="explore-city-section">
              <h2 className="explore-city-section__title">{g.name}</h2>
              <div className="explore-grid">
                {g.industries.map((ind) => (
                  <ExploreIndustryCard
                    key={ind.slug}
                    name={ind.name}
                    slug={ind.slug}
                    count={countMap.get(ind.slug) ?? 0}
                    countLabel={rolesLabel(countMap.get(ind.slug) ?? 0)}
                  />
                ))}
              </div>
            </div>
          ))}
          {!groups.length && <p className="muted">{t('exploreEmpty')}</p>}
        </div>
      </section>
    </div>
  );
}
