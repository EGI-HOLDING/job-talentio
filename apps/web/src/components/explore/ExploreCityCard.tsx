'use client';

import Link from 'next/link';

type ExploreCityCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
};

export function ExploreCityCard({ name, slug, count, countLabel }: ExploreCityCardProps) {
  return (
    <Link href={`/jobs?city=${encodeURIComponent(slug)}`} className="explore-card explore-card--city">
      <span className="explore-card-motif" aria-hidden />
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
