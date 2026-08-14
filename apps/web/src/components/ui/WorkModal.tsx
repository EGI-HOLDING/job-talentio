'use client';

import { useEffect } from 'react';

type Props = {
  open: boolean;
  title: string;
  message?: string;
};

/** Centered blocking dialog for long work. No dismiss while it is open. */
export function WorkModal({ open, title, message }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop work-modal-backdrop" role="presentation">
      <div
        className="modal work-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-modal-title"
        aria-busy="true"
      >
        <span className="busy-spinner" aria-hidden />
        <h2 id="work-modal-title">{title}</h2>
        {message ? (
          <p className="muted" style={{ margin: 0 }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
