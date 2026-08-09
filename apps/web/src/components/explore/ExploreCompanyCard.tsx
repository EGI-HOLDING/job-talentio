'use client';

import Link from 'next/link';

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
  return (
    <Link
      href={`/jobs?companySlug=${encodeURIComponent(slug)}`}
      className="explore-card explore-card--company"
      title={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={
          logoUrl ||
          `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
        }
        alt=""
      />
      <div className="explore-card-body">
        <strong>{name}</strong>
        {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
      </div>
    </Link>
  );
}
