'use client';

import { Link } from '@/lib/navigation';
import { useAccountRole } from '@/lib/useAccountRole';
import { isEmployerRole } from '@/lib/accountNavigation';

type ExploreCompanyCardProps = {
  name: string;
  slug: string;
  logoUrl?: string | null;
  count?: number;
  countLabel?: string;
};

export function ExploreCompanyCard({
  name,
  slug,
  logoUrl,
  count,
  countLabel,
}: ExploreCompanyCardProps) {
  const employer = isEmployerRole(useAccountRole());
  return (
    <Link
      href={employer ? `/companies/${encodeURIComponent(slug)}` : `/jobs?companySlug=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--company"
      title={name}
    >
      <span className="company-logo-tile" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="company-logo"
          src={
            logoUrl ||
            `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
          }
          alt=""
        />
      </span>
      <div className="explore-card-body">
        <strong>
          {name}
        </strong>
        {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
      </div>
    </Link>
  );
}
