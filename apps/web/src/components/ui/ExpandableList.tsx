'use client';

import { ReactNode, useEffect, useId, useState } from 'react';
import { useI18n } from '@/lib/i18n';

type ExpandableListProps<T> = {
  items: T[];
  initialCount?: number;
  step?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
};

/** Progressive list: show initialCount, then append `step` more per View more click. */
export function ExpandableList<T>({
  items,
  initialCount = 10,
  step = 10,
  renderItem,
  getKey,
  className,
}: ExpandableListProps<T>) {
  const { t } = useI18n();
  const statusId = useId();
  const [visible, setVisible] = useState(initialCount);

  useEffect(() => {
    setVisible(initialCount);
  }, [items, initialCount]);

  const shown = Math.min(visible, items.length);
  const remaining = Math.max(0, items.length - shown);
  const canMore = remaining > 0;
  const canLess = shown > initialCount;

  if (!items.length) return null;

  return (
    <div className={className}>
      {items.slice(0, shown).map((item, i) => (
        <div key={getKey(item, i)}>{renderItem(item, i)}</div>
      ))}
      <p id={statusId} className="sr-only" aria-live="polite">
        {t('showingNofM').replace('{n}', String(shown)).replace('{m}', String(items.length))}
      </p>
      {(canMore || canLess) && (
        <div className="expandable-list-actions">
          {canMore && (
            <button
              type="button"
              className="linkish expandable-more"
              aria-controls={statusId}
              aria-expanded={shown >= items.length}
              onClick={() => setVisible((v) => Math.min(v + step, items.length))}
            >
              {t('viewMore')} (+{Math.min(step, remaining)})
            </button>
          )}
          {canLess && (
            <button
              type="button"
              className="linkish expandable-less"
              onClick={() => setVisible(initialCount)}
            >
              {t('showLess')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
