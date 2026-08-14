'use client';

import type { ReactNode } from 'react';

type Props = {
  active: boolean;
  label: string;
  children: ReactNode;
  className?: string;
};

/** Dimmed cover on a relative parent while that block is working. */
export function BusyOverlay({ active, label, children, className }: Props) {
  return (
    <div
      className={['busy-overlay-host', className].filter(Boolean).join(' ')}
      aria-busy={active || undefined}
    >
      {children}
      {active ? (
        <div className="busy-overlay" role="status" aria-live="polite">
          <span className="busy-spinner" aria-hidden />
          <span>{label}</span>
        </div>
      ) : null}
    </div>
  );
}
