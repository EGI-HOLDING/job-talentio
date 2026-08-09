'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ExploreCategoryCard } from '@/components/explore/ExploreCategoryCard';

type Category = { name: string; slug: string; icon?: string | null };
type Facet = { slug: string; name: string; count: number };

export default function ExploreCategoriesPage() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    api<Category[]>('/meta/categories', { auth: false }).then(setCategories).catch(() => undefined);
    api<{ facets?: { categories?: Facet[] } }>('/jobs?limit=1&sort=newest', { auth: false })
      .then((r) => {
        const map: Record<string, number> = {};
        for (const c of r.facets?.categories || []) map[c.slug] = c.count;
        setCounts(map);
      })
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
          <span>{t('exploreCategoriesTitle')}</span>
        </p>
        <h1 className="section-title" style={{ fontSize: '1.75rem' }}>
          {t('exploreCategoriesTitle')}
        </h1>
        <p className="muted">{t('exploreCategoriesSubtitle')}</p>
        <div className="explore-grid" style={{ marginTop: '1.5rem' }}>
          {categories.map((c) => (
            <ExploreCategoryCard
              key={c.slug}
              name={c.name}
              slug={c.slug}
              icon={c.icon}
              count={counts[c.slug] ?? 0}
              countLabel={rolesLabel(counts[c.slug] ?? 0)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
