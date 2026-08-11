'use client';

import { useI18n } from '@/lib/i18n';
import { lastSeenLabel, type PresenceStatus } from '@/lib/presence';

/**
 * Small presence indicator: green dot when online, gray otherwise.
 * With `showLabel`, renders "Online" / "Last seen 5 min" next to the dot.
 */
export function PresenceDot({
  status,
  showLabel = false,
}: {
  status?: PresenceStatus | null;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  if (!status) return null;

  const ago = lastSeenLabel(status.lastSeenAt);
  const label = status.isOnline
    ? t('online')
    : status.lastSeenAt
      ? `${t('lastSeen')} ${ago ?? t('justNow')}`
      : t('offline');

  return (
    <span className="presence-wrap" title={label}>
      <span
        className={`presence-dot${status.isOnline ? ' presence-dot--online' : ''}`}
        aria-hidden
      />
      {showLabel && (
        <span className={`presence-label${status.isOnline ? ' presence-label--online' : ''}`}>
          {label}
        </span>
      )}
      {!showLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}
