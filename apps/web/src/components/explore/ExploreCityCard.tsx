'use client';

import Link from 'next/link';

type ExploreCityCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
  /** Override default jobs browse link */
  href?: string;
};

export function ExploreCityCard({ name, slug, count, countLabel, href }: ExploreCityCardProps) {
  return (
    <Link
      href={href || `/jobs?city=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--city"
    >
      <span className="explore-card-motif" aria-hidden />
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
