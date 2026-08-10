'use client';

import { ReactNode, useId, useState } from 'react';
import { SearchIcon } from '@/components/ui/primitives';
import { useDebouncedSearch } from '@/lib/useTableQuery';

export function Pager({
  page,
  totalPages,
  total,
  limit,
  onPage,
  onLimit,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (next: number) => void;
  onLimit: (next: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav className="pager" aria-label="Pagination">
      <span className="num">
        {first}-{last} of {total}
      </span>
      <div className="pager-controls">
        <label className="field-inline" style={{ marginRight: '0.5rem' }}>
          <span className="sr-only">Rows per page</span>
          <select
            value={String(limit)}
            onChange={(e) => onLimit(Number(e.target.value))}
            style={{ width: 'auto' }}
            aria-label="Rows per page"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary sm"
          onClick={() => onPage(1)}
          disabled={page <= 1}
          aria-label="First page"
        >
          First
        </button>
        <button
          type="button"
          className="secondary sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>
        <span className="num" style={{ padding: '0 0.4rem' }}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="secondary sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
        <button
          type="button"
          className="secondary sm"
          onClick={() => onPage(totalPages)}
          disabled={page >= totalPages}
          aria-label="Last page"
        >
          Last
        </button>
      </div>
    </nav>
  );
}

export function SearchInput({
  value,
  onCommit,
  placeholder = 'Search',
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useDebouncedSearch(value, onCommit);
  return (
    <div className="search-field">
      <SearchIcon />
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

export type ActiveFilter = { key: string; label: string };

export function FilterBar({
  search,
  onSearch,
  searchPlaceholder,
  quick,
  advanced,
  activeFilters,
  onClearFilter,
  onClearAll,
  trailing,
}: {
  search: string;
  onSearch: (next: string) => void;
  searchPlaceholder?: string;
  quick?: ReactNode;
  advanced?: ReactNode;
  activeFilters: ActiveFilter[];
  onClearFilter: (key: string) => void;
  onClearAll: () => void;
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="card">
      <div className="toolbar">
        <SearchInput value={search} onCommit={onSearch} placeholder={searchPlaceholder} />
        {quick}
        {advanced ? (
          <button
            type="button"
            className="secondary"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            Filters
            {activeFilters.length ? ` (${activeFilters.length})` : ''}
          </button>
        ) : null}
        {trailing}
      </div>

      {advanced ? (
        <div className="filter-panel" id={panelId} hidden={!open}>
          {advanced}
        </div>
      ) : null}

      {activeFilters.length > 0 && (
        <div className="chips" style={{ marginTop: '0.7rem' }}>
          {activeFilters.map((filter) => (
            <span key={filter.key} className="chip">
              {filter.label}
              <button
                type="button"
                onClick={() => onClearFilter(filter.key)}
                aria-label={`Remove filter ${filter.label}`}
              >
                x
              </button>
            </span>
          ))}
          <button type="button" className="ghost sm" onClick={onClearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Bridges "everything on this page" and "everything the filter matches". The
 * second is bounded by the server cap, which is stated plainly rather than
 * silently trimming the selection.
 */
export function SelectAllNotice({
  pageCount,
  total,
  allMatchingSelected,
  capped,
  onSelectAllMatching,
  onClear,
}: {
  pageCount: number;
  total: number;
  allMatchingSelected: boolean;
  capped: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
}) {
  if (total <= pageCount) return null;

  return (
    <div className="select-all-note">
      {allMatchingSelected ? (
        <>
          <span>
            {capped
              ? `Selected the first ${pageCount} of ${total} matching rows (server limit).`
              : `All ${total} matching rows are selected.`}
          </span>
          <button type="button" className="ghost sm" onClick={onClear}>
            Clear selection
          </button>
        </>
      ) : (
        <>
          <span>{pageCount} on this page selected.</span>
          <button type="button" className="sm" onClick={onSelectAllMatching}>
            Select all {total} matching
          </button>
        </>
      )}
    </div>
  );
}

export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>
      <div className="btn-row">{children}</div>
      <button type="button" className="ghost sm" style={{ marginLeft: 'auto' }} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
