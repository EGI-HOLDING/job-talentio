'use client';

import Link from 'next/link';

type ExploreTitleCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
};

export function ExploreTitleCard({ name, slug, count, countLabel }: ExploreTitleCardProps) {
  return (
    <Link href={`/jobs?jobTitle=${encodeURIComponent(slug)}`} className="explore-card explore-card--title">
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
