'use client';

import { Link } from '@/lib/navigation';
import { ReactNode } from 'react';

type ExploreSectionProps = {
  title: string;
  subtitle?: string;
  viewAllHref: string;
  viewAllLabel: string;
  gridClassName?: string;
  children: ReactNode;
};

export function ExploreSection({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel,
  gridClassName,
  children,
}: ExploreSectionProps) {
  return (
    <section className="section">
      <div className="explore-section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        <Link href={viewAllHref} className="hiring-view-all">
          {viewAllLabel}
          <span aria-hidden>→</span>
        </Link>
      </div>
      <div className={`explore-grid ${gridClassName || ''}`.trim()}>{children}</div>
    </section>
  );
}
