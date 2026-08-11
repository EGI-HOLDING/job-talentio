'use client';

import { Link } from '@/lib/navigation';

type ExploreTitleCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
  href?: string;
};

export function ExploreTitleCard({ name, slug, count, countLabel, href }: ExploreTitleCardProps) {
  return (
    <Link
      href={href || `/jobs?jobTitle=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--title"
    >
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
