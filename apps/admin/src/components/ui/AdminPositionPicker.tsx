'use client';

import { PositionPicker, type PositionResults, type PositionValue } from '@job-talentio/position-picker';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const labels = {
  placeholder: 'Search positions', loading: 'Loading positions…', empty: 'No positions found',
  failed: 'Position search failed.', retry: 'Retry', limited: 'Typo suggestions are temporarily limited.',
  group: 'Position group', role: 'Specific position', unavailable: 'Unavailable for selection', needsReview: 'Needs review',
  remove: 'Remove', more: 'Load more',
};

export function AdminPositionPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const [selected, setSelected] = useState<PositionValue>();
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ ids: 'ROLE:' + value });
    api<PositionResults>('/admin/positions/search?' + params, { cache: 'no-store', signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setSelected(response.items[0]); }).catch(() => {});
    return () => controller.abort();
  }, [value]);
  return <PositionPicker label={label} labels={labels}
    value={value ? [selected?.id === value ? selected : { id: value, kind: 'ROLE', name: value }] : []}
    onChange={([row]) => { setSelected(row); onChange(row?.id ?? ''); }}
    request={(q, page, signal) => api<PositionResults>('/admin/positions/search?' + new URLSearchParams({ q, page: String(page) }),
      { cache: 'no-store', signal })} />;
}
