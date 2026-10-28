'use client';

import { JobPackageGrant } from '@/components/benefits/JobPackageGrant';
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
import { useToast } from '@/components/ui/Toaster';

const DEFAULTS = { page: '1', limit: '25', sort: 'updatedAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'status',
  'employmentType',
  'workMode',
  'experienceLevel',
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

type Pending = { kind: 'status'; status: JobStatus };

export default function JobsPage() {
  const table = useAdminTable<AdminJob>({
    path: '/admin/jobs',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [pending, setPending] = useState<Pending | null>(null);
  const { notify } = useToast();

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
          <Badge tone={STATUS_TONE[row.status]}>{humanize(row.status)}</Badge><JobPackageGrant jobId={row.id}/>
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
  if (query.locale) activeFilters.push({ key: 'locale', label: `Lang: ${query.locale}` });
  if (query.companyId) activeFilters.push({ key: 'companyId', label: 'Single company' });
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  async function exportCsv() {
    try {
      const rows = table.selected.size
        ? await apiPost<AdminJob[]>('/admin/jobs/selected', { ids: [...table.selected] })
        : table.rows;
      if (!rows.length) {
        notify('No jobs to export', 'error');
        return;
      }
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
      { header: 'publishedAt', value: (r) => r.publishedAt ?? '' },
      ]);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not export jobs', 'error');
    }
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
            onClick={() => void exportCsv()}
            disabled={!table.rows.length && !table.selected.size}
          >
            {table.selected.size ? `Export selected (${table.selected.size})` : 'Export CSV'}
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
          selectedOnPage={table.rows.filter((row) => table.selected.has(row.id)).length}
          selectedCount={table.selected.size}
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
        </BulkBar>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          `Move selected postings to ${pending?.status ?? ''}`
        }
        description={
          `${table.selected.size} postings will change status. Postings whose current status cannot legally become ${pending?.status} are skipped.`
        }
        confirmLabel="Change status"
        destructive={pending?.kind === 'status' && pending.status === 'CLOSED'}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const action = pending;
          if (!action) return;
          const saved = await table.runBulk('/admin/jobs/bulk/status', { status: action.status }, 'updated');
          if (saved) setPending(null);
        }}
      />
    </>
  );
}
