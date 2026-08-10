'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminCompany,
  COMPANY_SIZES,
  PLAN_CODES,
  type PlanCode,
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

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'plan',
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

const PLAN_TONE: Record<PlanCode, 'default' | 'accent' | 'ok' | 'warn'> = {
  FREE: 'default',
  STANDARD: 'default',
  PREMIUM: 'accent',
  VIP: 'warn',
};

type Pending = { kind: 'ban'; banned: boolean } | { kind: 'plan'; plan: PlanCode };

export default function CompaniesPage() {
  const table = useAdminTable<AdminCompany>({
    path: '/admin/companies',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [pending, setPending] = useState<Pending | null>(null);

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
      key: 'plan',
      label: 'Plan',
      render: (row) => {
        const plan = row.subscription?.plan;
        if (!plan) return <span className="muted">None</span>;
        return <Badge tone={PLAN_TONE[plan]}>{plan}</Badge>;
      },
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
  if (query.plan) activeFilters.push({ key: 'plan', label: `Plan: ${query.plan}` });
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

  function exportCsv() {
    const rows = table.selected.size
      ? table.rows.filter((row) => table.selected.has(row.id))
      : table.rows;
    downloadCsv(timestampedName('companies'), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'name', value: (r) => r.name },
      { header: 'slug', value: (r) => r.slug },
      { header: 'plan', value: (r) => r.subscription?.plan ?? '' },
      { header: 'verified', value: (r) => r.isVerified },
      { header: 'banned', value: (r) => r.isBanned },
      { header: 'jobs', value: (r) => r._count.jobPosts },
      { header: 'members', value: (r) => r._count.members },
      { header: 'city', value: (r) => r.city?.name ?? '' },
      { header: 'industry', value: (r) => r.industry?.name ?? '' },
      { header: 'createdAt', value: (r) => r.createdAt },
    ]);
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
                label="Plan"
                options={PLAN_CODES}
                value={query.plan ?? ''}
                onChange={(next) => setFilter('plan', next)}
              />
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
              <label>
                City slug
                <input
                  value={query.citySlug ?? ''}
                  onChange={(e) => setFilter('citySlug', e.target.value)}
                  placeholder="tashkent"
                />
              </label>
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
              onClick={() =>
                table.runAction(
                  apiPost(`/admin/companies/${row.id}/ban`, { banned: !row.isBanned }),
                  row.isBanned ? 'Company unbanned' : 'Company banned',
                )
              }
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
          {PLAN_CODES.map((plan) => (
            <button
              key={plan}
              type="button"
              className="secondary sm"
              onClick={() => setPending({ kind: 'plan', plan })}
            >
              Set {plan}
            </button>
          ))}
          <button
            type="button"
            className="danger sm"
            onClick={() => setPending({ kind: 'ban', banned: true })}
          >
            Ban
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'ban', banned: false })}
          >
            Unban
          </button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'plan'
            ? `Move selected companies to ${pending.plan}`
            : pending?.banned
              ? 'Ban selected companies'
              : 'Unban selected companies'
        }
        description={
          pending?.kind === 'plan'
            ? `${table.selected.size} subscriptions will change to ${pending.plan} and be marked active.`
            : pending?.banned
              ? `${table.selected.size} companies will be banned and their published jobs paused.`
              : `${table.selected.size} companies will be restored. Their jobs stay paused until reopened.`
        }
        confirmLabel={pending?.kind === 'plan' ? 'Change plans' : pending?.banned ? 'Ban them' : 'Unban them'}
        destructive={pending?.kind === 'ban' && pending.banned}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === 'plan') {
            await table.runBulk('/admin/companies/bulk/plan', { plan: action.plan }, 'updated');
          } else {
            await table.runBulk(
              '/admin/companies/bulk/ban',
              { banned: action.banned },
              action.banned ? 'banned' : 'unbanned',
            );
          }
        }}
      />
    </>
  );
}
