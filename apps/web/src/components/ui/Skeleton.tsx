'use client';

import { CSSProperties, ReactNode } from 'react';

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
};

/** Shimmer block for loading placeholders. */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return <span className={`skel ${className}`.trim()} style={style} aria-hidden />;
}

export function JobCardSkeleton() {
  return (
    <div className="card job-card skel-card" aria-hidden>
      <div className="skel skel-avatar" />
      <div className="skel-card-body">
        <span className="skel skel-line" style={{ width: '55%' }} />
        <span className="skel skel-line short" />
        <span className="skel skel-line" style={{ width: '70%' }} />
        <div className="skel-chip-row">
          <span className="skel skel-chip" />
          <span className="skel skel-chip" />
          <span className="skel skel-chip" />
        </div>
      </div>
    </div>
  );
}

export function CandidateCardSkeleton() {
  return (
    <div className="card skel-card" aria-hidden>
      <div className="skel skel-avatar" />
      <div className="skel-card-body">
        <span className="skel skel-line" style={{ width: '40%' }} />
        <span className="skel skel-line short" />
        <div className="skel-chip-row">
          <span className="skel skel-chip" />
          <span className="skel skel-chip" />
        </div>
      </div>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="shell" style={{ padding: '2rem' }} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="skel skel-line" style={{ width: '35%', height: '1.6rem', marginBottom: '1rem' }} />
      <div className="skel skel-line" style={{ width: '60%', marginBottom: '0.75rem' }} />
      <div className="skel skel-block" style={{ height: 160, marginBottom: '1rem' }} />
      <div className="skel-chip-row">
        <span className="skel skel-chip" />
        <span className="skel skel-chip" />
        <span className="skel skel-chip" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="shell dash-grid" aria-busy="true">
      <aside className="dash-nav">
        <span className="skel skel-line" style={{ width: '70%' }} />
        <span className="skel skel-line" style={{ width: '55%' }} />
        <span className="skel skel-line" style={{ width: '65%' }} />
      </aside>
      <div>
        <span className="skel skel-line" style={{ width: '30%', height: '1.4rem', marginBottom: '1rem' }} />
        <div className="card skel-card" style={{ marginBottom: '0.75rem' }}>
          <div className="skel-card-body" style={{ width: '100%' }}>
            <span className="skel skel-line" style={{ width: '50%' }} />
            <span className="skel skel-line short" />
            <span className="skel skel-block" style={{ height: 80 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="job-list-skel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading jobs</span>
      {Array.from({ length: count }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CandidateListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading candidates</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ marginBottom: '0.65rem' }}>
          <CandidateCardSkeleton />
        </div>
      ))}
    </div>
  );
}

export function FilterSidebarSkeleton() {
  return (
    <aside className="filters" aria-hidden>
      <span className="skel skel-line" style={{ width: '40%', marginBottom: '1rem' }} />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} style={{ marginBottom: '1rem' }}>
          <span className="skel skel-line short" style={{ marginBottom: '0.5rem' }} />
          <span className="skel skel-line" />
          <span className="skel skel-line" style={{ width: '80%' }} />
          <span className="skel skel-line" style={{ width: '65%' }} />
        </div>
      ))}
    </aside>
  );
}

export function SkeletonPage({ children }: { children?: ReactNode }) {
  return (
    <div aria-busy="true">
      {children}
    </div>
  );
}
