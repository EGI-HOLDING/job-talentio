'use client';

import { Link } from '@/lib/navigation';
import { useAccountRole } from '@/lib/useAccountRole';
import { isEmployerRole } from '@/lib/accountNavigation';

type ExploreTitleCardProps = {
  name: string;
  slug: string;
  count?: number;
  countLabel?: string;
  href?: string;
};

export function ExploreTitleCard({ name, slug, count, countLabel, href }: ExploreTitleCardProps) {
  const employer = isEmployerRole(useAccountRole());
  return (
    <Link
      href={href || (employer ? '/dashboard/recruiter?tab=jobs' : `/jobs?jobTitle=${encodeURIComponent(slug)}`)}
      className="explore-card explore-card--title"
    >
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
