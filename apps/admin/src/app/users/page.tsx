'use client';

import { FormEvent, useMemo, useState } from 'react';
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
import { readIdentity } from '@/components/shell/AuthGate';
import { DataTable, type Column } from '@/components/data/DataTable';
import {
  BulkBar,
  FilterBar,
  Pager,
  SelectAllNotice,
  type ActiveFilter,
} from '@/components/data/TableChrome';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
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

type RowAction = 'ban' | 'reset' | 'verify' | 'revoke';

export default function UsersPage() {
  const table = useAdminTable<AdminUser>({
    path: '/admin/users',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [confirmBan, setConfirmBan] = useState<null | { banned: boolean }>(null);
  const [pending, setPending] = useState<null | { action: RowAction; row: AdminUser }>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [anonymizeRow, setAnonymizeRow] = useState<AdminUser | null>(null);
  const [anonymizeReason, setAnonymizeReason] = useState('');
  const [anonymizeTyped, setAnonymizeTyped] = useState('');

  const selfEmail = useMemo(() => (readIdentity()?.email || '').trim().toLowerCase(), []);

  function isSelf(row: AdminUser) {
    return Boolean(selfEmail && row.email && row.email.toLowerCase() === selfEmail);
  }

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
          {row.anonymized ? <Badge tone="danger">Anonymized</Badge> : null}
          {row.isBanned ? <Badge tone="danger">Banned</Badge> : <Badge tone="ok">Active</Badge>}
          {!row.emailVerified && !row.anonymized ? <Badge tone="warn">Unverified</Badge> : null}
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
      { header: 'anonymized', value: (r) => r.anonymized },
      { header: 'lastSeenAt', value: (r) => r.lastSeenAt ?? '' },
      { header: 'createdAt', value: (r) => r.createdAt },
    ]);
  }

  const pendingCopy: Record<RowAction, { title: string; description: string; confirm: string; ok: string; path: string }> =
    pending
      ? {
          ban: {
            title: pending.row.isBanned ? 'Unban this user?' : 'Ban this user?',
            description: pending.row.isBanned
              ? `${pending.row.fullName} will be able to sign in again.`
              : `${pending.row.fullName} will be blocked from signing in and signed out of every device.`,
            confirm: pending.row.isBanned ? 'Unban' : 'Ban',
            ok: pending.row.isBanned ? 'User unbanned' : 'User banned',
            path: `/admin/users/${pending.row.id}/ban`,
          },
          reset: {
            title: 'Send password reset?',
            description: `We will email a reset link to ${pending.row.email}. You will not see or set their password.`,
            confirm: 'Send reset',
            ok: 'Password reset email sent',
            path: `/admin/users/${pending.row.id}/send-password-reset`,
          },
          verify: {
            title: 'Resend verification email?',
            description: `We will email a verification link to ${pending.row.email}.`,
            confirm: 'Send verification',
            ok: 'Verification email sent',
            path: `/admin/users/${pending.row.id}/send-verification`,
          },
          revoke: {
            title: 'Sign out all devices?',
            description: `${pending.row.fullName} will have to sign in again. This does not ban the account.`,
            confirm: 'Sign out',
            ok: 'Sessions revoked',
            path: `/admin/users/${pending.row.id}/revoke-sessions`,
          },
        }
      : {
          ban: { title: '', description: '', confirm: '', ok: '', path: '' },
          reset: { title: '', description: '', confirm: '', ok: '', path: '' },
          verify: { title: '', description: '', confirm: '', ok: '', path: '' },
          revoke: { title: '', description: '', confirm: '', ok: '', path: '' },
        };

  async function confirmRowAction() {
    if (!pending) return;
    const { action, row } = pending;
    const copy = pendingCopy[action];
    setPending(null);
    const body = action === 'ban' ? { banned: !row.isBanned } : undefined;
    await table.runAction(apiPost(copy.path, body), copy.ok);
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    await table.runAction(
      apiPost('/admin/users', { email: inviteEmail.trim(), fullName: inviteName.trim() }),
      'Operator invited. They will get a set-password email.',
    );
    setInviteOpen(false);
    setInviteEmail('');
    setInviteName('');
  }

  async function submitAnonymize() {
    if (!anonymizeRow) return;
    const row = anonymizeRow;
    setAnonymizeRow(null);
    setAnonymizeReason('');
    setAnonymizeTyped('');
    await table.runAction(
      apiPost(`/admin/users/${row.id}/anonymize`, { reason: anonymizeReason.trim() }),
      'Account anonymized',
    );
  }

  const anonymizeEmail = (anonymizeRow?.email || '').trim().toLowerCase();
  const anonymizeReady =
    Boolean(anonymizeRow) &&
    anonymizeReason.trim().length >= 8 &&
    anonymizeTyped.trim().toLowerCase() === anonymizeEmail;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${table.total} accounts`}
        actions={
          <>
            <button type="button" className="secondary" onClick={() => setInviteOpen(true)}>
              Invite operator
            </button>
            <button type="button" className="secondary" onClick={exportCsv} disabled={!table.rows.length}>
              Export CSV
            </button>
          </>
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
          actions={(row) => {
            const self = isSelf(row);
            const admin = row.role === 'SUPER_ADMIN';
            const gone = row.anonymized;
            const canReset =
              !self &&
              !gone &&
              !row.isBanned &&
              Boolean(row.email) &&
              (row.hasPassword || (admin && !row.hasPassword)) &&
              !(admin && row.hasPassword);
            const canVerify =
              !self && !gone && !admin && !row.isBanned && Boolean(row.email) && !row.emailVerified;
            const canRevoke = !self && !gone && !admin;
            const canBan = !self && !gone && !admin;
            const canAnonymize = !self && !gone && !admin && Boolean(row.email);
            return (
              <div className="btn-row">
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy || !canReset}
                  title={
                    admin && row.hasPassword
                      ? 'Cannot send a reset to a super admin'
                      : !row.hasPassword && !admin
                        ? 'This account signs in with Google or Telegram'
                        : undefined
                  }
                  onClick={() => setPending({ action: 'reset', row })}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy || !canVerify}
                  onClick={() => setPending({ action: 'verify', row })}
                >
                  Verify
                </button>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy || !canRevoke}
                  onClick={() => setPending({ action: 'revoke', row })}
                >
                  Sign out
                </button>
                <button
                  type="button"
                  className={row.isBanned ? 'secondary sm' : 'danger sm'}
                  disabled={table.busy || !canBan}
                  title={admin ? 'Super admins cannot be banned' : undefined}
                  onClick={() => setPending({ action: 'ban', row })}
                >
                  {row.isBanned ? 'Unban' : 'Ban'}
                </button>
                <button
                  type="button"
                  className="danger sm"
                  disabled={table.busy || !canAnonymize}
                  onClick={() => {
                    setAnonymizeRow(row);
                    setAnonymizeReason('');
                    setAnonymizeTyped('');
                  }}
                >
                  Anonymize
                </button>
              </div>
            );
          }}
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

      <ConfirmDialog
        open={pending !== null}
        title={pending ? pendingCopy[pending.action].title : ''}
        description={pending ? pendingCopy[pending.action].description : ''}
        confirmLabel={pending ? pendingCopy[pending.action].confirm : 'Confirm'}
        destructive={pending?.action === 'ban' && !pending.row.isBanned}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRowAction()}
      />

      <Modal
        open={inviteOpen}
        title="Invite operator"
        description="Creates a super admin with no password and emails a set-password link. Does not create employees or recruiters."
        onClose={() => {
          if (!table.busy) setInviteOpen(false);
        }}
        footer={
          <>
            <button type="button" className="secondary" disabled={table.busy} onClick={() => setInviteOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="invite-operator-form"
              disabled={table.busy || inviteName.trim().length < 2 || !inviteEmail.trim()}
            >
              Send invite
            </button>
          </>
        }
      >
        <form id="invite-operator-form" style={{ display: 'grid', gap: '0.75rem' }} onSubmit={(e) => void submitInvite(e)}>
          <label>
            Full name
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              required
              minLength={2}
              autoComplete="name"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={anonymizeRow !== null}
        title="Anonymize this account?"
        description="Identity fields are cleared and the user is banned. Applications and chat stay for the other party. This cannot be undone."
        onClose={() => {
          if (!table.busy) setAnonymizeRow(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="secondary"
              disabled={table.busy}
              onClick={() => setAnonymizeRow(null)}
            >
              Cancel
            </button>
            <button type="button" className="danger" disabled={table.busy || !anonymizeReady} onClick={() => void submitAnonymize()}>
              Anonymize
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label>
            Reason
            <textarea
              value={anonymizeReason}
              onChange={(e) => setAnonymizeReason(e.target.value)}
              rows={3}
              minLength={8}
              required
            />
          </label>
          <label>
            Type the account email to confirm
            <input
              value={anonymizeTyped}
              onChange={(e) => setAnonymizeTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={anonymizeRow?.email || ''}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
