'use client';

import Link from 'next/link';

type ExploreIndustryCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
};

export function ExploreIndustryCard({ name, slug, count, countLabel }: ExploreIndustryCardProps) {
  return (
    <Link
      href={`/jobs?industrySlug=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--category"
    >
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
