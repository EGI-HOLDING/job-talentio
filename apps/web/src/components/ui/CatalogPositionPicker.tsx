'use client';

import { PositionPicker, type PositionResults, type PositionValue } from '@job-talentio/position-picker';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useEffect, useState } from 'react';

export type { PositionValue };
export const positionRef = ({ kind, id }: Pick<PositionValue, 'kind' | 'id'>) => kind + ':' + id;

export function usePositionLabels(ids: string, slugs = '') {
  const [result, setResult] = useState<{ key: string; rows: PositionValue[] }>();
  const key = ids + '|' + slugs;
  useEffect(() => {
    if (!ids && !slugs) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '24', ...(ids ? { ids } : {}), ...(slugs ? { slugs } : {}) });
    api<PositionResults>('/meta/positions/search?' + params, { auth: false, cacheMode: 'no-store', signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setResult({ key, rows: response.items }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, rows: [] }); });
    return () => controller.abort();
  }, [ids, slugs, key]);
  return result?.key === key ? result.rows : undefined;
}

export function CatalogPositionPicker({ label, value, onChange, scope = 'role', max, disabled }: {
  label: string;
  value: PositionValue[];
  onChange: (value: PositionValue[]) => void;
  scope?: 'candidate' | 'role' | 'hr';
  max?: number;
  disabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const labels = {
    placeholder: locale === 'id' ? 'Cari posisi' : 'Search positions',
    loading: t('jobTitleLoading'),
    empty: t('jobTitleNoMatches'),
    failed: t('jobTitleLoadError'),
    retry: t('workspace.retry'),
    limited: locale === 'id' ? 'Saran salah ketik sedang terbatas.' : 'Typo suggestions are temporarily limited.',
    group: scope === 'hr' ? (locale === 'id' ? 'Kelompok posisi' : 'Position group')
      : (locale === 'id' ? 'Semua posisi dalam kelompok' : 'All positions in this group'),
    role: locale === 'id' ? 'Posisi spesifik' : 'Specific position',
    unavailable: locale === 'id' ? 'Belum tersedia untuk dipilih' : 'Unavailable for selection',
    needsReview: locale === 'id' ? 'Perlu ditinjau' : 'Needs review',
    remove: t('emp.remove'),
    more: locale === 'id' ? 'Muat lebih banyak' : 'Load more',
  };
  return <PositionPicker key={scope + ':' + locale} label={label} labels={labels} value={value}
    onChange={onChange} max={max} disabled={disabled}
    request={(q, page, signal) => api<PositionResults>('/meta/positions/search?' + new URLSearchParams({
      q, page: String(page), limit: '24', scope,
    }), { auth: false, cacheMode: 'no-store', signal })} />;
}
