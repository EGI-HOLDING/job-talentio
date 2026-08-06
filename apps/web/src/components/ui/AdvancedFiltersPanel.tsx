'use client';

import { ReactNode, useEffect, useId, useState } from 'react';
import { useI18n } from '@/lib/i18n';

type AdvancedFiltersPanelProps = {
  storageKey: string;
  activeCount?: number;
  /** Force open when filters already applied in URL */
  forceOpen?: boolean;
  children: ReactNode;
};

export function AdvancedFiltersPanel({
  storageKey,
  activeCount = 0,
  forceOpen = false,
  children,
}: AdvancedFiltersPanelProps) {
  const { t } = useI18n();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (forceOpen) setOpen(true);
      else if (stored === '1') setOpen(true);
      else if (stored === '0') setOpen(false);
      else setOpen(false);
    } catch {
      setOpen(forceOpen);
    }
    setHydrated(true);
  }, [storageKey, forceOpen]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="advanced-filters">
      <button
        type="button"
        className="advanced-filters-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="advanced-filters-label">
          {open ? t('hideAdvancedFilters') : t('showAdvancedFilters')}
          {!open && activeCount > 0 ? (
            <span className="advanced-filters-badge" aria-label={t('activeFiltersCount').replace('{n}', String(activeCount))}>
              {activeCount}
            </span>
          ) : null}
        </span>
        <span className={`advanced-filters-chevron ${open ? 'open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      <div
        id={panelId}
        className="advanced-filters-panel"
        hidden={hydrated ? !open : true}
        inert={open ? undefined : true}
      >
        {children}
      </div>
    </div>
  );
}
