'use client';

import { Link } from '@/lib/navigation';
import { categoryIconLabel } from '@/lib/icons';
import { useAccountRole } from '@/lib/useAccountRole';
import { isEmployerRole } from '@/lib/accountNavigation';

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
  const employer = isEmployerRole(useAccountRole());
  return (
    <Link href={employer ? '/dashboard/recruiter?tab=jobs' : `/jobs?category=${encodeURIComponent(slug)}`} className="explore-card explore-card--category">
      <span className="explore-card-icon" aria-hidden>
        {categoryIconLabel(slug, icon)}
      </span>
      <strong>{name}</strong>
      {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
    </Link>
  );
}
