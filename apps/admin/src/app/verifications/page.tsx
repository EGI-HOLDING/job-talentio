'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import { useAdminTable } from '@/lib/useAdminTable';
import { formatDateTime, humanize } from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { FilterBar, Pager, type ActiveFilter } from '@/components/data/TableChrome';
import { Modal } from '@/components/ui/Modal';
import { Badge, DateField, SelectField } from '@/components/ui/primitives';

type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type VerificationRow = {
  id: string;
  legalName: string;
  taxId: string;
  note?: string | null;
  documentName?: string | null;
  documentUrl?: string | null;
  status: VerificationStatus;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  company: { id: string; name: string; slug: string; logoUrl?: string | null; isVerified: boolean };
  submittedBy?: { id: string; email: string | null; fullName: string } | null;
  reviewedBy?: { id: string; email: string | null; fullName: string } | null;
};

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc', status: 'PENDING' };
const FILTER_KEYS = ['q', 'status', 'createdFrom', 'createdTo', 'sort', 'dir', 'page', 'limit'];
const STATUSES: VerificationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const STATUS_TONE: Record<VerificationStatus, 'warn' | 'ok' | 'danger'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
};

type Decision = { row: VerificationRow; status: 'APPROVED' | 'REJECTED' };

export default function VerificationsPage() {
  const table = useAdminTable<VerificationRow>({
    path: '/admin/verifications',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');

  const columns: Array<Column<VerificationRow>> = [
    {
      key: 'company',
      label: 'Company',
      render: (row) => (
        <div className="cell-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="avatar"
            src={
              row.company.logoUrl ||
              `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(row.company.name)}`
            }
            alt=""
          />
          <span style={{ minWidth: 0 }}>
            <span className="cell-strong truncate">{row.company.name}</span>
            <span className="cell-sub truncate">
              {row.company.isVerified ? 'Already verified' : row.company.slug}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'legal',
      label: 'Legal entity',
      render: (row) => (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span className="cell-strong truncate" title={row.legalName}>
            {row.legalName}
          </span>
          <span className="cell-sub mono">STIR/INN {row.taxId}</span>
        </span>
      ),
    },
    {
      key: 'document',
      label: 'Document',
      render: (row) =>
        row.documentUrl ? (
          <a href={row.documentUrl} target="_blank" rel="noreferrer">
            {row.documentName || 'Open'}
          </a>
        ) : (
          <span className="muted">None</span>
        ),
    },
    {
      key: 'note',
      label: 'Note',
      render: (row) => (
        <span className="truncate" title={row.note || ''}>
          {row.note || <span className="muted">-</span>}
        </span>
      ),
    },
    {
      key: 'submittedBy',
      label: 'Submitted by',
      render: (row) => <span className="dim">{row.submittedBy?.email ?? 'Deleted user'}</span>,
    },
    {
      key: 'createdAt',
      label: 'Submitted',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortKey: 'status',
      render: (row) => (
        <span style={{ display: 'block' }}>
          <Badge tone={STATUS_TONE[row.status]}>{humanize(row.status)}</Badge>
          {row.reviewNote ? (
            <span className="cell-sub truncate" title={row.reviewNote}>
              {row.reviewNote}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.status) activeFilters.push({ key: 'status', label: `Status: ${humanize(query.status)}` });
  if (query.createdFrom) activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  async function submitDecision() {
    if (!decision) return;
    const { row, status } = decision;
    setDecision(null);
    await table.runAction(
      apiPost(`/admin/verifications/${row.id}/decide`, { status, reviewNote: note.trim() || undefined }),
      status === 'APPROVED' ? `${row.company.name} verified` : `Request for ${row.company.name} declined`,
    );
    setNote('');
  }

  return (
    <>
      <PageHeader title="Company verification" subtitle={`${table.total} requests`} />

      <div className="content">
        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search company, legal name or STIR"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <SelectField
              label=""
              value={query.status ?? ''}
              onChange={(next) => setFilter('status', next)}
              allLabel="Any status"
              options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
            />
          }
          advanced={
            <>
              <DateField
                label="Submitted from"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="Submitted to"
                value={query.createdTo ?? ''}
                onChange={(next) => setFilter('createdTo', next)}
              />
            </>
          }
        />

        <DataTable
          rows={table.rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={table.loading}
          error={table.error}
          emptyTitle="No verification requests match these filters"
          emptyHint="Employers ask for the badge from the Company tab of their dashboard."
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) =>
            row.status === 'PENDING' ? (
              <>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy}
                  onClick={() => {
                    setNote('');
                    setDecision({ row, status: 'APPROVED' });
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="danger sm"
                  disabled={table.busy}
                  onClick={() => {
                    setNote('');
                    setDecision({ row, status: 'REJECTED' });
                  }}
                >
                  Reject
                </button>
              </>
            ) : (
              <span className="muted">{row.reviewedBy?.email ?? 'Reviewed'}</span>
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
      </div>

      <Modal
        open={decision !== null}
        title={decision?.status === 'APPROVED' ? 'Approve verification' : 'Reject verification'}
        description={
          decision
            ? `${decision.row.company.name} - ${decision.row.legalName} (STIR/INN ${decision.row.taxId})`
            : undefined
        }
        onClose={() => setDecision(null)}
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setDecision(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={decision?.status === 'APPROVED' ? undefined : 'danger'}
              disabled={table.busy || (decision?.status === 'REJECTED' && !note.trim())}
              onClick={() => void submitDecision()}
            >
              {decision?.status === 'APPROVED' ? 'Approve and grant badge' : 'Reject request'}
            </button>
          </>
        }
      >
        <label style={{ display: 'grid', gap: '0.35rem', marginTop: '0.75rem' }}>
          <span>{decision?.status === 'APPROVED' ? 'Note (optional)' : 'Reason shown to the employer'}</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              decision?.status === 'APPROVED'
                ? 'e.g. Registration certificate matches the STIR'
                : 'e.g. The document is unreadable; upload the registration certificate'
            }
          />
        </label>
      </Modal>
    </>
  );
}
