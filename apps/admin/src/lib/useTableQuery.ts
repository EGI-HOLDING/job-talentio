'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { QueryValue } from './api';

export type TableQuery = Record<string, string>;

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Table state lives in the URL so a filtered view can be bookmarked, shared with
 * another admin, and restored by the back button. Everything is stored as a
 * string; the API layer coerces types.
 */
export function useTableQuery(defaults: TableQuery) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => {
    const merged: TableQuery = { ...defaults };
    searchParams.forEach((value, key) => {
      merged[key] = value;
    });
    return merged;
    // defaults is a literal at the call site; only the URL drives changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const write = useCallback(
    (next: TableQuery) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        // A value equal to the default is implied, so it stays out of the URL.
        if (!value || value === defaults[key]) continue;
        params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router],
  );

  /** Any filter change resets paging, otherwise page 7 of a new filter is empty. */
  const setFilter = useCallback(
    (key: string, value: QueryValue) => {
      const next = { ...query, [key]: value === undefined || value === null ? '' : String(value) };
      if (key !== 'page') next.page = '1';
      write(next);
    },
    [query, write],
  );

  const setMany = useCallback(
    (patch: Record<string, QueryValue>) => {
      const next = { ...query };
      for (const [key, value] of Object.entries(patch)) {
        next[key] = value === undefined || value === null ? '' : String(value);
      }
      next.page = '1';
      write(next);
    },
    [query, write],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  /** Clicking the active column flips direction, a new column starts descending. */
  const toggleSort = useCallback(
    (column: string) => {
      const isActive = query.sort === column;
      write({
        ...query,
        sort: column,
        dir: isActive && query.dir === 'desc' ? 'asc' : isActive ? 'desc' : 'desc',
        page: '1',
      });
    },
    [query, write],
  );

  return { query, setFilter, setMany, reset, toggleSort };
}

/**
 * Keeps the text input responsive while the URL only updates once typing pauses,
 * so every keystroke does not become a history entry and a request.
 */
export function useDebouncedSearch(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = draft;
      onCommit(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, onCommit]);

  return [draft, setDraft] as const;
}
