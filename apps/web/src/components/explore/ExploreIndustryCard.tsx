'use client';

import { Link } from '@/lib/navigation';
import { useAccountRole } from '@/lib/useAccountRole';
import { isEmployerRole } from '@/lib/accountNavigation';

type ExploreIndustryCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
};

export function ExploreIndustryCard({ name, slug, count, countLabel }: ExploreIndustryCardProps) {
  const employer = isEmployerRole(useAccountRole());
  return (
    <Link
      href={`${employer ? '/explore/companies' : '/jobs'}?industrySlug=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--category"
    >
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
