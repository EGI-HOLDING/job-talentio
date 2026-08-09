'use client';

import Link from 'next/link';
import { categoryIconLabel } from '@/lib/icons';

type ExploreCategoryCardProps = {
  name: string;
  slug: string;
  icon?: string | null;
  count?: number;
  countLabel?: string;
};

export function ExploreCategoryCard({
  name,
  slug,
  icon,
  count,
  countLabel,
}: ExploreCategoryCardProps) {
  return (
    <Link href={`/jobs?category=${encodeURIComponent(slug)}`} className="explore-card explore-card--category">
      <span className="explore-card-icon" aria-hidden>
        {categoryIconLabel(slug, icon)}
      </span>
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
