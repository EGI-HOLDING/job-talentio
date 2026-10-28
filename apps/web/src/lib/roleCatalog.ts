'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useI18n } from './i18n';

export type CatalogRole = { id: string; slug: string; name: string; canonicalName?: string; count?: number };
type Page = { items: CatalogRole[]; totalPages: number };
const pending = new Map<string, Promise<CatalogRole[]>>();
function load(locale: string) {
  if (!pending.has(locale)) {
    const request = (async () => {
      const first = await api<Page>('/meta/job-titles?limit=100', { auth: false, headers: { 'X-Locale': locale } });
      const rows = [...first.items];
      for (let page = 2; page <= first.totalPages; page++) {
        rows.push(...(await api<Page>(`/meta/job-titles?limit=100&page=${page}`, { auth: false, headers: { 'X-Locale': locale } })).items);
      }
      return rows;
    })().catch(error => { pending.delete(locale); throw error; });
    pending.set(locale, request);
  }
  return pending.get(locale)!;
}
export function useRoleCatalog() {
  const { locale } = useI18n();
  const [roles, setRoles] = useState<CatalogRole[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(false), [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setRoles([]); setLoading(true); setError(false);
    load(locale).then(items => { if (active) setRoles(items); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, version]);
  return { roles, loading, error, retry: () => { pending.delete(locale); setVersion(value => value + 1); } };
}
