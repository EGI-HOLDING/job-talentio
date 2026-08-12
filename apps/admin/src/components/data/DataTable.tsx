'use client';

import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { EmptyState, TableSkeleton } from '@/components/ui/primitives';

export type Column<T> = {
  key: string;
  label: string;
  /** Column ids the API accepts for `sort`; omitted means not sortable. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: T) => ReactNode;
};

type Props<T> = {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string;
  emptyTitle?: string;
  emptyHint?: string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  sort?: string;
  dir?: string;
  onSort?: (column: string) => void;
  /** Row-level buttons, rendered in a trailing actions column. */
  actions?: (row: T) => ReactNode;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading = false,
  error,
  emptyTitle = 'Nothing to show',
  emptyHint = 'Try widening the filters.',
  selectable = false,
  selected,
  onSelectedChange,
  sort,
  dir,
  onSort,
  actions,
}: Props<T>) {
  const headerBox = useRef<HTMLInputElement>(null);
  // Remembers the last clicked row so shift-click can fill the range between.
  const lastIndex = useRef<number | null>(null);

  const ids = rows.map(rowKey);
  const selectedCount = selected ? ids.filter((id) => selected.has(id)).length : 0;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleRow = useCallback(
    (index: number, shiftKey: boolean) => {
      if (!selected || !onSelectedChange) return;
      const id = ids[index];
      const next = new Set(selected);

      if (shiftKey && lastIndex.current !== null) {
        const [from, to] = [lastIndex.current, index].sort((a, b) => a - b);
        const turningOn = !selected.has(id);
        for (let i = from; i <= to; i += 1) {
          if (turningOn) next.add(ids[i]);
          else next.delete(ids[i]);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      lastIndex.current = index;
      onSelectedChange(next);
    },
    [ids, onSelectedChange, selected],
  );

  function toggleAllOnPage() {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    if (allSelected) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectedChange(next);
  }

  if (loading) return <TableSkeleton cols={columns.length + (selectable ? 1 : 0)} />;
  if (error) {
    return (
      <div className="table-wrap">
        <EmptyState title="Could not load this view" hint={error} />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="table-wrap">
        <EmptyState title={emptyTitle} hint={emptyHint} />
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selectable && (
              <th className="col-select">
                <input
                  ref={headerBox}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAllOnPage}
                  aria-label={allSelected ? 'Clear selection on this page' : 'Select all on this page'}
                />
              </th>
            )}
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width, textAlign: col.align ?? 'left' }}>
                {col.sortKey && onSort ? (
                  <button
                    type="button"
                    className="th-sort"
                    data-active={sort === col.sortKey}
                    onClick={() => onSort(col.sortKey as string)}
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <span className="sort-arrow" aria-hidden>
                      {sort === col.sortKey ? (dir === 'asc' ? '^' : 'v') : ''}
                    </span>
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
            {actions && <th style={{ textAlign: 'right' }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = ids[index];
            const isSelected = selected?.has(id) ?? false;
            return (
              <tr key={id} data-selected={isSelected}>
                {selectable && (
                  <td className="col-select">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) =>
                        toggleRow(index, (e.nativeEvent as MouseEvent).shiftKey === true)
                      }
                      onClick={(e) => {
                        if (e.shiftKey) {
                          e.preventDefault();
                          toggleRow(index, true);
                        }
                      }}
                      aria-label={`Select row ${index + 1}`}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                    {col.render(row)}
                  </td>
                ))}
                {actions && (
                  <td>
                    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                      {actions(row)}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
