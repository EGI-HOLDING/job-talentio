'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';

type CityRow = {
  name: string;
  slug: string;
  province?: { slug: string; name: string; type?: string };
};

type ProvinceSection = {
  province: { slug: string; name: string; type: string };
  cities: CityRow[];
};

type GroupedResponse = { group: 'province'; sections: ProvinceSection[] };

type Facet = { slug: string; name: string; count: number };

type GroupMode = 'province' | 'alpha';

export default function ExploreCitiesPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<GroupMode>('province');
  const [flat, setFlat] = useState<CityRow[]>([]);
  const [sections, setSections] = useState<ProvinceSection[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);

  useEffect(() => {
    api<CityRow[] | GroupedResponse>('/meta/cities?group=province', { auth: false })
      .then((res) => {
        if (res && typeof res === 'object' && 'group' in res && res.group === 'province') {
          setSections(res.sections || []);
          setFlat(res.sections.flatMap((s) => s.cities));
        } else if (Array.isArray(res)) {
          setFlat(res);
          setSections([]);
        }
      })
      .catch(() => undefined);
    api<{ facets?: { cities?: Facet[] } }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => setFacets(r.facets?.cities || []))
      .catch(() => undefined);
  }, []);

  const countMap = useMemo(() => new Map(facets.map((f) => [f.slug, f.count])), [facets]);

  const alphaSections = useMemo(() => {
    const map = new Map<string, CityRow[]>();
    for (const c of [...flat].sort((a, b) => a.name.localeCompare(b.name))) {
      const letter = (c.name[0] || '#').toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [flat]);

  const provinceSections = useMemo(() => {
    if (sections.length) {
      return sections.map((s) => ({
        key: s.province.slug,
        title: s.province.name,
        cities: [...s.cities].sort((a, b) => a.name.localeCompare(b.name)),
      }));
    }
    const map = new Map<string, { title: string; cities: CityRow[] }>();
    for (const c of flat) {
      const key = c.province?.slug || 'other';
      const title = c.province?.name || t('exploreCitiesOtherProvince');
      if (!map.has(key)) map.set(key, { title, cities: [] });
      map.get(key)!.cities.push(c);
    }
    return [...map.entries()]
      .map(([key, v]) => ({
        key,
        title: v.title,
        cities: v.cities.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [sections, flat, t]);

  function rolesLabel(n: number) {
    return t('openRolesCount').replace('{n}', String(n));
  }

  const displaySections =
    mode === 'province'
      ? provinceSections
      : alphaSections.map(([letter, cities]) => ({
          key: letter,
          title: letter,
          cities,
        }));

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

        <div className="explore-group-toggle" role="tablist" aria-label={t('exploreCitiesGroupBy')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'province'}
            className={mode === 'province' ? 'active' : ''}
            onClick={() => setMode('province')}
          >
            {t('exploreCitiesByProvince')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'alpha'}
            className={mode === 'alpha' ? 'active' : ''}
            onClick={() => setMode('alpha')}
          >
            {t('exploreCitiesAlphabetical')}
          </button>
        </div>

        <div style={{ marginTop: '1.5rem' }}>
          {displaySections.map((section) => (
            <div key={section.key} className="explore-city-section">
              <h2 className="explore-city-section__title">{section.title}</h2>
              <div className="explore-grid">
                {section.cities.map((c) => {
                  const count = countMap.get(c.slug) ?? 0;
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
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
