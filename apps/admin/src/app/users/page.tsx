'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminUser,
  LOCALES,
  USER_ROLES,
  formatDate,
  humanize,
  timeAgo,
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
  'role',
  'banned',
  'verified',
  'locale',
  'seenWithin',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];

export default function UsersPage() {
  const table = useAdminTable<AdminUser>({
    path: '/admin/users',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [confirmBan, setConfirmBan] = useState<null | { banned: boolean }>(null);

  const columns: Array<Column<AdminUser>> = [
    {
      key: 'user',
      label: 'User',
      sortKey: 'fullName',
      render: (row) => (
        <div className="cell-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="avatar"
            src={
              row.avatarUrl ||
              `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(row.fullName)}`
            }
            alt=""
          />
          <span style={{ minWidth: 0 }}>
            <span className="cell-strong truncate">{row.fullName}</span>
            <span className="cell-sub truncate">{row.email || '-'}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (row) => (
        <Badge tone={row.role === 'SUPER_ADMIN' ? 'accent' : 'default'}>{humanize(row.role)}</Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="btn-row">
          {row.isBanned ? <Badge tone="danger">Banned</Badge> : <Badge tone="ok">Active</Badge>}
          {!row.emailVerified && <Badge tone="warn">Unverified</Badge>}
        </div>
      ),
    },
    { key: 'locale', label: 'Locale', render: (row) => row.locale.toUpperCase() },
    {
      key: 'lastSeenAt',
      label: 'Last seen',
      sortKey: 'lastSeenAt',
      render: (row) => <span className="dim">{timeAgo(row.lastSeenAt)}</span>,
    },
    {
      key: 'createdAt',
      label: 'Joined',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDate(row.createdAt)}</span>,
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.role) activeFilters.push({ key: 'role', label: `Role: ${query.role}` });
  if (query.banned) activeFilters.push({ key: 'banned', label: query.banned === 'true' ? 'Banned' : 'Not banned' });
  if (query.verified)
    activeFilters.push({ key: 'verified', label: query.verified === 'true' ? 'Verified' : 'Unverified' });
  if (query.locale) activeFilters.push({ key: 'locale', label: `Locale: ${query.locale}` });
  if (query.seenWithin) activeFilters.push({ key: 'seenWithin', label: `Seen in ${query.seenWithin}` });
  if (query.createdFrom) activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  function exportCsv() {
    const rows = table.selected.size
      ? table.rows.filter((row) => table.selected.has(row.id))
      : table.rows;
    downloadCsv(timestampedName('users'), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'fullName', value: (r) => r.fullName },
      { header: 'email', value: (r) => r.email ?? '' },
      { header: 'role', value: (r) => r.role },
      { header: 'locale', value: (r) => r.locale },
      { header: 'banned', value: (r) => r.isBanned },
      { header: 'emailVerified', value: (r) => r.emailVerified },
      { header: 'lastSeenAt', value: (r) => r.lastSeenAt ?? '' },
      { header: 'createdAt', value: (r) => r.createdAt },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${table.total} accounts`}
        actions={
          <button type="button" className="secondary" onClick={exportCsv} disabled={!table.rows.length}>
            Export CSV
          </button>
        }
      />

      <div className="content">
        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search name or email"
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
                label="Role"
                options={USER_ROLES}
                value={query.role ?? ''}
                onChange={(next) => setFilter('role', next)}
                format={humanize}
              />
              <MultiSelect
                label="Locale"
                options={LOCALES}
                value={query.locale ?? ''}
                onChange={(next) => setFilter('locale', next)}
                format={(v) => v.toUpperCase()}
              />
              <SelectField
                label="Email verified"
                value={query.verified ?? ''}
                onChange={(next) => setFilter('verified', next)}
                options={[
                  { value: 'true', label: 'Verified' },
                  { value: 'false', label: 'Not verified' },
                ]}
              />
              <SelectField
                label="Last seen within"
                value={query.seenWithin ?? ''}
                onChange={(next) => setFilter('seenWithin', next)}
                allLabel="Any time"
                options={[
                  { value: '24h', label: 'Last 24 hours' },
                  { value: '7d', label: 'Last 7 days' },
                  { value: '30d', label: 'Last 30 days' },
                ]}
              />
              <DateField
                label="Joined from"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="Joined to"
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
          emptyTitle="No users match these filters"
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
              disabled={table.busy || row.role === 'SUPER_ADMIN'}
              title={row.role === 'SUPER_ADMIN' ? 'Super admins cannot be banned' : undefined}
              onClick={() =>
                table.runAction(
                  apiPost(`/admin/users/${row.id}/ban`, { banned: !row.isBanned }),
                  row.isBanned ? 'User unbanned' : 'User banned',
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
          <button type="button" className="danger sm" onClick={() => setConfirmBan({ banned: true })}>
            Ban selected
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setConfirmBan({ banned: false })}
          >
            Unban selected
          </button>
          <button type="button" className="secondary sm" onClick={exportCsv}>
            Export selected
          </button>
        </BulkBar>
      </div>

      <ConfirmDialog
        open={confirmBan !== null}
        title={confirmBan?.banned ? 'Ban selected users' : 'Unban selected users'}
        description={
          confirmBan?.banned
            ? `${table.selected.size} accounts will be blocked from signing in. Super admins and your own account are skipped.`
            : `${table.selected.size} accounts will be able to sign in again.`
        }
        confirmLabel={confirmBan?.banned ? 'Ban them' : 'Unban them'}
        destructive={confirmBan?.banned}
        busy={table.busy}
        onCancel={() => setConfirmBan(null)}
        onConfirm={async () => {
          const banned = confirmBan?.banned ?? false;
          setConfirmBan(null);
          await table.runBulk('/admin/users/bulk/ban', { banned }, banned ? 'banned' : 'unbanned');
        }}
      />
    </>
  );
}
