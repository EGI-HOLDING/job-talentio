'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminReport,
  REPORT_ENTITY_TYPES,
  REPORT_STATUSES,
  type ReportStatus,
  formatDateTime,
  humanize,
} from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import {
  BulkBar,
  FilterBar,
  Pager,
  SelectAllNotice,
  type ActiveFilter,
} from '@/components/data/TableChrome';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge, DateField, MultiSelect, SelectField } from '@/components/ui/primitives';

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'status',
  'entityType',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];

const STATUS_TONE: Record<ReportStatus, 'warn' | 'ok' | 'default'> = {
  OPEN: 'warn',
  RESOLVED: 'ok',
  DISMISSED: 'default',
};

export default function ReportsPage() {
  const table = useAdminTable<AdminReport>({
    path: '/admin/reports',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [pending, setPending] = useState<null | 'RESOLVED' | 'DISMISSED'>(null);

  const columns: Array<Column<AdminReport>> = [
    {
      key: 'createdAt',
      label: 'Reported',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'target',
      label: 'Target',
      render: (row) => (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span className="cell-strong">{humanize(row.entityType)}</span>
          <span className="cell-sub mono">{row.entityId}</span>
        </span>
      ),
    },
    {
      key: 'reason',
      label: 'Reason',
      render: (row) => (
        <span className="truncate" title={row.reason}>
          {row.reason}
        </span>
      ),
    },
    {
      key: 'reporter',
      label: 'Reporter',
      render: (row) => <span className="dim">{row.reporter?.email ?? 'Deleted user'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortKey: 'status',
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{humanize(row.status)}</Badge>,
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.status) activeFilters.push({ key: 'status', label: `Status: ${query.status}` });
  if (query.entityType)
    activeFilters.push({ key: 'entityType', label: `Type: ${query.entityType}` });
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  function exportCsv() {
    const rows = table.selected.size
      ? table.rows.filter((row) => table.selected.has(row.id))
      : table.rows;
    downloadCsv(timestampedName('reports'), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'entityType', value: (r) => r.entityType },
      { header: 'entityId', value: (r) => r.entityId },
      { header: 'reason', value: (r) => r.reason },
      { header: 'status', value: (r) => r.status },
      { header: 'reporter', value: (r) => r.reporter?.email ?? '' },
      { header: 'createdAt', value: (r) => r.createdAt },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${table.total} reports`}
        actions={
          <button
            type="button"
            className="secondary"
            onClick={exportCsv}
            disabled={!table.rows.length}
          >
            Export CSV
          </button>
        }
      />

      <div className="content">
        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search reason or target id"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <SelectField
              label=""
              value={query.status ?? ''}
              onChange={(next) => setFilter('status', next)}
              allLabel="Any status"
              options={REPORT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
            />
          }
          advanced={
            <>
              <MultiSelect
                label="Target type"
                options={REPORT_ENTITY_TYPES}
                value={query.entityType ?? ''}
                onChange={(next) => setFilter('entityType', next)}
                format={humanize}
              />
              <DateField
                label="Reported from"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="Reported to"
                value={query.createdTo ?? ''}
                onChange={(next) => setFilter('createdTo', next)}
              />
            </>
          }
        />

        <SelectAllNotice
          pageCount={table.rows.length}
          total={table.total}
          allMatchingSelected={table.allMatching.active}
          capped={table.allMatching.capped}
          onSelectAllMatching={table.selectAllMatching}
          onClear={table.clearSelection}
        />

        <DataTable
          rows={table.rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={table.loading}
          error={table.error}
          emptyTitle="No reports match these filters"
          emptyHint="An empty open queue is good news."
          selectable
          selected={table.selected}
          onSelectedChange={table.updateSelection}
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) =>
            row.status === 'OPEN' ? (
              <>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy}
                  onClick={() =>
                    table.runAction(
                      apiPost(`/admin/reports/${row.id}/resolve`, { status: 'RESOLVED' }),
                      'Report resolved',
                    )
                  }
                >
                  Resolve
                </button>
                <button
                  type="button"
                  className="ghost sm"
                  disabled={table.busy}
                  onClick={() =>
                    table.runAction(
                      apiPost(`/admin/reports/${row.id}/resolve`, { status: 'DISMISSED' }),
                      'Report dismissed',
                    )
                  }
                >
                  Dismiss
                </button>
              </>
            ) : (
              <span className="muted">Closed</span>
            )
          }
        />

        <Pager
          page={table.page}
          totalPages={table.totalPages}
          total={table.total}
          limit={table.limit}
          onPage={(next) => setFilter('page', next)}
          onLimit={(next) => setFilter('limit', next)}
        />

        <BulkBar count={table.selected.size} onClear={table.clearSelection}>
          <button type="button" className="secondary sm" onClick={() => setPending('RESOLVED')}>
            Resolve
          </button>
          <button type="button" className="secondary sm" onClick={() => setPending('DISMISSED')}>
            Dismiss
          </button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending === 'RESOLVED' ? 'Resolve selected reports' : 'Dismiss selected reports'}
        description={`${table.selected.size} reports will be closed. Reports that are already closed are skipped.`}
        confirmLabel={pending === 'RESOLVED' ? 'Resolve them' : 'Dismiss them'}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const status = pending;
          setPending(null);
          if (!status) return;
          await table.runBulk(
            '/admin/reports/bulk/resolve',
            { status },
            status === 'RESOLVED' ? 'resolved' : 'dismissed',
          );
        }}
      />
    </>
  );
}
