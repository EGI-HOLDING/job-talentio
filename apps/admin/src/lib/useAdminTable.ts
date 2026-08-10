'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiList, toQueryString } from './api';
import type { BulkResult, ListEnvelope, MatchingIds } from './api';
import { useTableQuery } from './useTableQuery';
import type { TableQuery } from './useTableQuery';
import { useToast } from '@/components/ui/Toaster';

type Options = {
  /** API path without query string, e.g. `/admin/users`. */
  path: string;
  defaults: TableQuery;
  /** Query keys this table sends to the API. */
  filterKeys: string[];
};

/**
 * One place for the behaviour every admin table shares: read the URL, fetch the
 * page, track selection across "this page" and "everything matching", and run
 * bulk actions with a single reload afterwards.
 */
export function useAdminTable<T extends { id: string }>({ path, defaults, filterKeys }: Options) {
  const { query, setFilter, setMany, reset, toggleSort } = useTableQuery(defaults);
  const { notify } = useToast();

  const [data, setData] = useState<ListEnvelope<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState<{ active: boolean; capped: boolean }>({
    active: false,
    capped: false,
  });
  const [busy, setBusy] = useState(false);

  const params = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = query[key];
      if (value) out[key] = value;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const paramKey = JSON.stringify(params);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiList<T>(path, params);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setData(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // A different filter means the previous selection no longer describes what is
  // on screen, so it is dropped rather than silently carried over.
  useEffect(() => {
    setSelected(new Set());
    setAllMatching({ active: false, capped: false });
  }, [paramKey]);

  const selectAllMatching = useCallback(async () => {
    try {
      const result = await api<MatchingIds>(`${path}/ids${toQueryString(params)}`);
      setSelected(new Set(result.ids));
      setAllMatching({ active: true, capped: result.capped });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not select all matching', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramKey, notify]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAllMatching({ active: false, capped: false });
  }, []);

  const updateSelection = useCallback((next: Set<string>) => {
    setSelected(next);
    setAllMatching({ active: false, capped: false });
  }, []);

  /**
   * Runs a bulk endpoint and reports exactly what happened. Partial results are
   * the normal case, so "applied" and "skipped" are both surfaced.
   */
  const runBulk = useCallback(
    async (endpoint: string, body: Record<string, unknown>, verb: string) => {
      const ids = [...selected];
      if (!ids.length) return;
      setBusy(true);
      try {
        const result = await api<BulkResult>(endpoint, {
          method: 'POST',
          body: JSON.stringify({ ids, ...body }),
        });
        const skipped = result.skipped.length;
        if (result.applied === 0) {
          notify(`Nothing was ${verb}. ${describeSkips(result)}`, 'error');
        } else if (skipped) {
          notify(`${result.applied} ${verb}, ${skipped} skipped. ${describeSkips(result)}`, 'info');
        } else {
          notify(`${result.applied} ${verb}.`);
        }
        clearSelection();
        await load();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Bulk action failed', 'error');
      } finally {
        setBusy(false);
      }
    },
    [selected, notify, clearSelection, load],
  );

  /** Single-row actions share the reload and error reporting. */
  const runAction = useCallback(
    async (request: Promise<unknown>, message: string) => {
      setBusy(true);
      try {
        await request;
        notify(message);
        await load();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Action failed', 'error');
      } finally {
        setBusy(false);
      }
    },
    [notify, load],
  );

  return {
    query,
    setFilter,
    setMany,
    reset,
    toggleSort,
    rows: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    limit: data?.limit ?? Number(defaults.limit ?? 25),
    totalPages: data?.totalPages ?? 1,
    loading,
    error,
    selected,
    updateSelection,
    clearSelection,
    selectAllMatching,
    allMatching,
    busy,
    runBulk,
    runAction,
    reload: load,
    params,
  };
}

/** Groups skip reasons so a toast stays readable with 200 rows. */
function describeSkips(result: BulkResult): string {
  if (!result.skipped.length) return '';
  const counts = new Map<string, number>();
  for (const skip of result.skipped) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => `${reason} (${count})`).join(', ');
}
