'use client';

import Link from 'next/link';
import { VipBadge } from '@/components/ui/VipBadge';

type ExploreCompanyCardProps = {
  name: string;
  slug: string;
  logoUrl?: string | null;
  count?: number;
  countLabel?: string;
  plan?: string | null;
  vipLabel?: string;
};

export function ExploreCompanyCard({
  name,
  slug,
  logoUrl,
  count,
  countLabel,
  plan,
  vipLabel = 'VIP Elite',
}: ExploreCompanyCardProps) {
  const isVip = plan === 'VIP';
  return (
    <Link
      href={`/jobs?companySlug=${encodeURIComponent(slug)}`}
      className={`explore-card explore-card--company${isVip ? ' explore-card--vip' : ''}`}
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
          {isVip ? <VipBadge label={vipLabel} /> : null}
        </strong>
        {typeof count === 'number' && countLabel ? <span>{countLabel}</span> : null}
      </div>
    </Link>
  );
}
