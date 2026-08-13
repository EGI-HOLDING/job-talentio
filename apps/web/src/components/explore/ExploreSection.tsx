'use client';

import { Link } from '@/lib/navigation';
import { ReactNode } from 'react';

type ExploreSectionProps = {
  title: string;
  subtitle?: string;
  viewAllHref: string;
  viewAllLabel: string;
  gridClassName?: string;
  /** Skip the default explore-grid wrapper (custom layouts such as a carousel). */
  bare?: boolean;
  children: ReactNode;
};

export function ExploreSection({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel,
  gridClassName,
  bare,
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
      {bare ? children : <div className={`explore-grid ${gridClassName || ''}`.trim()}>{children}</div>}
    </section>
  );
}
