'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminJob,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  JOB_STATUSES,
  LOCALES,
  WORK_MODES,
  type JobStatus,
  formatDate,
  humanize,
  isHot,
  soleFilterValue,
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

const DEFAULTS = { page: '1', limit: '25', sort: 'updatedAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'status',
  'employmentType',
  'workMode',
  'experienceLevel',
  'hotOnly',
  'companyId',
  'locale',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];

const STATUS_TONE: Record<JobStatus, 'default' | 'ok' | 'warn' | 'danger'> = {
  DRAFT: 'default',
  PUBLISHED: 'ok',
  PAUSED: 'warn',
  CLOSED: 'danger',
  EXPIRED: 'danger',
};

type Pending = { kind: 'status'; status: JobStatus } | { kind: 'hot'; days: 7 | 14 | 30 };

export default function JobsPage() {
  const table = useAdminTable<AdminJob>({
    path: '/admin/jobs',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [pending, setPending] = useState<Pending | null>(null);

  const columns: Array<Column<AdminJob>> = [
    {
      key: 'title',
      label: 'Posting',
      sortKey: 'title',
      render: (row) => (
        <span style={{ minWidth: 0, display: 'block' }}>
          <span className="cell-strong truncate">{row.title}</span>
          <span className="cell-sub truncate">{row.company.name}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="btn-row">
          <Badge tone={STATUS_TONE[row.status]}>{humanize(row.status)}</Badge>
          {isHot(row) && <Badge tone="warn">Hot</Badge>}
        </div>
      ),
    },
    { key: 'workMode', label: 'Mode', render: (row) => humanize(row.workMode) },
    { key: 'locale', label: 'Lang', render: (row) => row.locale.toUpperCase() },
    {
      key: 'applications',
      label: 'Apps',
      sortKey: 'applications',
      align: 'right',
      render: (row) => <span className="num">{row._count.applications}</span>,
    },
    {
      key: 'views',
      label: 'Views',
      align: 'right',
      render: (row) => <span className="num">{row._count.views}</span>,
    },
    {
      key: 'publishedAt',
      label: 'Published',
      sortKey: 'publishedAt',
      render: (row) => <span className="num">{formatDate(row.publishedAt)}</span>,
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.status) activeFilters.push({ key: 'status', label: `Status: ${query.status}` });
  if (query.employmentType)
    activeFilters.push({ key: 'employmentType', label: `Type: ${query.employmentType}` });
  if (query.workMode) activeFilters.push({ key: 'workMode', label: `Mode: ${query.workMode}` });
  if (query.experienceLevel)
    activeFilters.push({ key: 'experienceLevel', label: `Level: ${query.experienceLevel}` });
  if (query.hotOnly === 'true') activeFilters.push({ key: 'hotOnly', label: 'Boosted only' });
  if (query.locale) activeFilters.push({ key: 'locale', label: `Lang: ${query.locale}` });
  if (query.companyId) activeFilters.push({ key: 'companyId', label: 'Single company' });
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  function exportCsv() {
    const rows = table.selected.size
      ? table.rows.filter((row) => table.selected.has(row.id))
      : table.rows;
    downloadCsv(timestampedName('jobs'), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'title', value: (r) => r.title },
      { header: 'company', value: (r) => r.company.name },
      { header: 'status', value: (r) => r.status },
      { header: 'locale', value: (r) => r.locale },
      { header: 'workMode', value: (r) => r.workMode },
      { header: 'employmentType', value: (r) => r.employmentType },
      { header: 'applications', value: (r) => r._count.applications },
      { header: 'views', value: (r) => r._count.views },
      { header: 'boosted', value: (r) => isHot(r) },
      { header: 'publishedAt', value: (r) => r.publishedAt ?? '' },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={`${table.total} postings`}
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
          searchPlaceholder="Search title or company"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <SelectField
              label=""
              value={soleFilterValue(query.status)}
              onChange={(next) => setFilter('status', next)}
              allLabel="Any status"
              options={JOB_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
            />
          }
          advanced={
            <>
              <MultiSelect
                label="Status"
                options={JOB_STATUSES}
                value={query.status ?? ''}
                onChange={(next) => setFilter('status', next)}
                format={humanize}
              />
              <MultiSelect
                label="Employment type"
                options={EMPLOYMENT_TYPES}
                value={query.employmentType ?? ''}
                onChange={(next) => setFilter('employmentType', next)}
                format={humanize}
              />
              <MultiSelect
                label="Work mode"
                options={WORK_MODES}
                value={query.workMode ?? ''}
                onChange={(next) => setFilter('workMode', next)}
                format={humanize}
              />
              <MultiSelect
                label="Experience level"
                options={EXPERIENCE_LEVELS}
                value={query.experienceLevel ?? ''}
                onChange={(next) => setFilter('experienceLevel', next)}
                format={humanize}
              />
              <MultiSelect
                label="Language"
                options={LOCALES}
                value={query.locale ?? ''}
                onChange={(next) => setFilter('locale', next)}
                format={(v) => v.toUpperCase()}
              />
              <SelectField
                label="Boost"
                value={query.hotOnly ?? ''}
                onChange={(next) => setFilter('hotOnly', next)}
                allLabel="All postings"
                options={[{ value: 'true', label: 'Boosted right now' }]}
              />
              <DateField
                label="Created from"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="Created to"
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
          emptyTitle="No postings match these filters"
          selectable
          selected={table.selected}
          onSelectedChange={table.updateSelection}
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) => (
            <>
              {row.status === 'PUBLISHED' && (
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy}
                  onClick={() =>
                    table.runAction(
                      apiPost(`/admin/jobs/${row.id}/status`, { status: 'PAUSED' }),
                      'Posting paused',
                    )
                  }
                >
                  Pause
                </button>
              )}
              {row.status === 'PAUSED' && (
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy}
                  onClick={() =>
                    table.runAction(
                      apiPost(`/admin/jobs/${row.id}/status`, { status: 'PUBLISHED' }),
                      'Posting published',
                    )
                  }
                >
                  Publish
                </button>
              )}
              <button
                type="button"
                className="secondary sm"
                disabled={table.busy}
                onClick={() =>
                  table.runAction(apiPost(`/admin/jobs/${row.id}/hot`, { days: 7 }), 'Boosted for 7 days')
                }
              >
                Boost 7d
              </button>
            </>
          )}
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
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'status', status: 'PAUSED' })}
          >
            Pause
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'status', status: 'PUBLISHED' })}
          >
            Publish
          </button>
          <button
            type="button"
            className="danger sm"
            onClick={() => setPending({ kind: 'status', status: 'CLOSED' })}
          >
            Close
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'hot', days: 7 })}
          >
            Boost 7d
          </button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'hot'
            ? `Boost selected postings for ${pending.days} days`
            : `Move selected postings to ${pending?.status ?? ''}`
        }
        description={
          pending?.kind === 'hot'
            ? `${table.selected.size} postings will be promoted in search for ${pending.days} days.`
            : `${table.selected.size} postings will change status. Postings whose current status cannot legally become ${pending?.status} are skipped.`
        }
        confirmLabel={pending?.kind === 'hot' ? 'Boost them' : 'Change status'}
        destructive={pending?.kind === 'status' && pending.status === 'CLOSED'}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === 'hot') {
            await table.runBulk('/admin/jobs/bulk/hot', { days: action.days }, 'boosted');
          } else {
            await table.runBulk('/admin/jobs/bulk/status', { status: action.status }, 'updated');
          }
        }}
      />
    </>
  );
}
