'use client';

import { useState } from 'react';
import { CatalogCityFilter } from '@/components/ui/CatalogCityFilter';
import { apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminCompany,
  COMPANY_SIZES,
  formatDate,
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

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'verified',
  'banned',
  'size',
  'industrySlug',
  'citySlug',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];


type Pending =
  | { kind: 'single'; row: AdminCompany; banned: boolean }
  | { kind: 'bulk'; banned: boolean };

export default function CompaniesPage() {
  const table = useAdminTable<AdminCompany>({
    path: '/admin/companies',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [pending, setPending] = useState<Pending | null>(null);
  const { notify } = useToast();

  const columns: Array<Column<AdminCompany>> = [
    {
      key: 'company',
      label: 'Company',
      sortKey: 'name',
      render: (row) => (
        <div className="cell-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="avatar"
            src={
              row.logoUrl ||
              `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(row.name)}`
            }
            alt=""
          />
          <span style={{ minWidth: 0 }}>
            <span className="cell-strong truncate">{row.name}</span>
            <span className="cell-sub truncate">{row.industry?.name ?? 'No industry'}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="btn-row">
          {row.isBanned ? <Badge tone="danger">Banned</Badge> : <Badge tone="ok">Active</Badge>}
          {row.isVerified && <Badge tone="accent">Verified</Badge>}
        </div>
      ),
    },
    {
      key: 'jobs',
      label: 'Jobs',
      sortKey: 'jobs',
      align: 'right',
      render: (row) => <span className="num">{row._count.jobPosts}</span>,
    },
    {
      key: 'members',
      label: 'Team',
      align: 'right',
      render: (row) => <span className="num">{row._count.members}</span>,
    },
    { key: 'city', label: 'City', render: (row) => row.city?.name ?? '-' },
    {
      key: 'createdAt',
      label: 'Created',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDate(row.createdAt)}</span>,
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.banned)
    activeFilters.push({ key: 'banned', label: query.banned === 'true' ? 'Banned' : 'Not banned' });
  if (query.verified)
    activeFilters.push({
      key: 'verified',
      label: query.verified === 'true' ? 'Verified' : 'Unverified',
    });
  if (query.size) activeFilters.push({ key: 'size', label: `Size: ${query.size}` });
  if (query.industrySlug)
    activeFilters.push({ key: 'industrySlug', label: `Industry: ${query.industrySlug}` });
  if (query.citySlug) activeFilters.push({ key: 'citySlug', label: `City: ${query.citySlug}` });
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  async function exportCsv() {
    try {
      const rows = table.selected.size
        ? await apiPost<AdminCompany[]>('/admin/companies/selected', { ids: [...table.selected] })
        : table.rows;
      if (!rows.length) {
        notify('No companies to export', 'error');
        return;
      }
      downloadCsv(timestampedName('companies'), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'name', value: (r) => r.name },
      { header: 'slug', value: (r) => r.slug },
      { header: 'verified', value: (r) => r.isVerified },
      { header: 'banned', value: (r) => r.isBanned },
      { header: 'jobs', value: (r) => r._count.jobPosts },
      { header: 'members', value: (r) => r._count.members },
      { header: 'city', value: (r) => r.city?.name ?? '' },
      { header: 'industry', value: (r) => r.industry?.name ?? '' },
      { header: 'createdAt', value: (r) => r.createdAt },
      ]);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not export companies', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${table.total} companies`}
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
          searchPlaceholder="Search name or slug"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <SelectField
              label=""
              value={query.banned ?? ''}
              onChange={(next) => setFilter('banned', next)}
              allLabel="Any status"
              options={[
                { value: 'false', label: 'Active only' },
                { value: 'true', label: 'Banned only' },
              ]}
            />
          }
          advanced={
            <>
              <MultiSelect
                label="Size"
                options={COMPANY_SIZES}
                value={query.size ?? ''}
                onChange={(next) => setFilter('size', next)}
                format={(v) => v.replace('SIZE_', '').replace(/_/g, '-')}
              />
              <SelectField
                label="Verified"
                value={query.verified ?? ''}
                onChange={(next) => setFilter('verified', next)}
                options={[
                  { value: 'true', label: 'Verified' },
                  { value: 'false', label: 'Not verified' },
                ]}
              />
              <label>
                Industry slug
                <input
                  value={query.industrySlug ?? ''}
                  onChange={(e) => setFilter('industrySlug', e.target.value)}
                  placeholder="information-technology"
                />
              </label>
              <CatalogCityFilter value={query.citySlug ?? ''} onChange={next => setFilter('citySlug', next)} />
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
          emptyTitle="No companies match these filters"
          selectable
          selected={table.selected}
          onSelectedChange={table.updateSelection}
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) => (
            <button
              type="button"
              className={row.isBanned ? 'secondary sm' : 'danger sm'}
              disabled={table.busy}
              onClick={() => setPending({ kind: 'single', row, banned: !row.isBanned })}
            >
              {row.isBanned ? 'Unban' : 'Ban'}
            </button>
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
            className="danger sm"
            onClick={() => setPending({ kind: 'bulk', banned: true })}
          >
            Ban
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'bulk', banned: false })}
          >
            Unban
          </button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'single'
            ? pending.banned ? `Ban ${pending.row.name}?` : `Unban ${pending.row.name}?`
            : pending?.banned ? 'Ban selected companies' : 'Unban selected companies'
        }
        description={
          pending?.kind === 'single'
            ? pending.banned
              ? `${pending.row.name} will be banned and its published jobs paused.`
              : `${pending.row.name} will be restored. Its jobs stay paused until reopened.`
            : pending?.banned
              ? `${table.selected.size} companies will be banned and their published jobs paused.`
              : `${table.selected.size} companies will be restored. Their jobs stay paused until reopened.`
        }
        confirmLabel={pending?.banned ? 'Ban them' : 'Unban them'}
        destructive={Boolean(pending?.banned)}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const action = pending;
          if (!action) return;
          if (action.kind === 'single') {
            const saved = await table.runAction(
              apiPost(`/admin/companies/${action.row.id}/ban`, { banned: action.banned }),
              action.banned ? 'Company banned' : 'Company unbanned',
            );
            if (saved) setPending(null);
            return;
          }
          const saved = await table.runBulk(
              '/admin/companies/bulk/ban',
              { banned: action.banned },
              action.banned ? 'banned' : 'unbanned',
            );
          if (saved) setPending(null);
        }}
      />
    </>
  );
}
