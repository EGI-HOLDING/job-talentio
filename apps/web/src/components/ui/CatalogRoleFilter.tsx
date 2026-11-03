'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useRoleCatalog } from '@/lib/roleCatalog';
import { FilterFieldset } from './Field';
import { ExpandableList } from './ExpandableList';

export function CatalogRoleFilter({ value, onChange,enabled=true }: { value: string; onChange: (value: string) => void;enabled?:boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const { roles, loading, error, retry,hasMore,loadMore } = useRoleCatalog(enabled,query);
  const selected = value.split(',').filter(Boolean);
  const needle = query.trim().toLocaleLowerCase();
  return <FilterFieldset legend={t('jobTitleFilter')} className="filter-group">
    <input type="search" aria-label={t('jobTitleFilter')} placeholder={t('jobTitleFilter')} value={query} onChange={event => setQuery(event.target.value)} />
    {loading && <p role="status">{t('loading')}</p>}
    {error && <button type="button" onClick={retry}>{t('workspace.retry')}</button>}
    <ExpandableList items={roles.filter(role => `${role.name} ${role.canonicalName || ''}`.toLocaleLowerCase().includes(needle))} initialCount={8} step={16} getKey={role => role.slug} renderItem={role => <label className="filter-check"><input type="checkbox" checked={selected.includes(role.slug)} onChange={() => onChange((selected.includes(role.slug) ? selected.filter(slug => slug !== role.slug) : [...selected, role.slug]).join(','))} />{role.name}</label>} />
    {hasMore&&<button type="button" disabled={loading} onClick={loadMore}>{t('jobTitleLoadingMore')}</button>}
  </FilterFieldset>;
}
