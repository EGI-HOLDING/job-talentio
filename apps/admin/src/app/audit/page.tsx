'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import { AdminAuditLog, formatDateTime } from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { FilterBar, Pager, type ActiveFilter } from '@/components/data/TableChrome';
import { Modal } from '@/components/ui/Modal';
import { Badge, DateField, SelectField } from '@/components/ui/primitives';

const DEFAULTS = { page: '1', limit: '50', sort: 'createdAt', dir: 'desc' };
const FILTER_KEYS = [
  'q',
  'action',
  'entityType',
  'actorId',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];

type Facets = { actions: string[]; entityTypes: string[] };

export default function AuditPage() {
  const table = useAdminTable<AdminAuditLog>({
    path: '/admin/audit-logs',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const [facets, setFacets] = useState<Facets>({ actions: [], entityTypes: [] });
  const [detail, setDetail] = useState<AdminAuditLog | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Facets>('/admin/audit-logs/facets')
      .then((data) => {
        if (!cancelled) setFacets(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const columns: Array<Column<AdminAuditLog>> = [
    {
      key: 'createdAt',
      label: 'When',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'actor',
      label: 'Actor',
      render: (row) => <span className="dim">{row.actor?.email ?? 'System'}</span>,
    },
    { key: 'action', label: 'Action', render: (row) => <Badge>{row.action}</Badge> },
    {
      key: 'entity',
      label: 'Entity',
      render: (row) => (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span>{row.entityType}</span>{' '}
          <span className="mono">{row.entityId?.slice(0, 12) ?? ''}</span>
        </span>
      ),
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.action) activeFilters.push({ key: 'action', label: `Action: ${query.action}` });
  if (query.entityType)
    activeFilters.push({ key: 'entityType', label: `Entity: ${query.entityType}` });
  if (query.actorId) activeFilters.push({ key: 'actorId', label: 'Single actor' });
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  function exportCsv() {
    downloadCsv(timestampedName('audit-log'), table.rows, [
      { header: 'createdAt', value: (r) => r.createdAt },
      { header: 'actor', value: (r) => r.actor?.email ?? '' },
      { header: 'action', value: (r) => r.action },
      { header: 'entityType', value: (r) => r.entityType },
      { header: 'entityId', value: (r) => r.entityId ?? '' },
      { header: 'metadata', value: (r) => JSON.stringify(r.metadata ?? null) },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={`${table.total} entries`}
        actions={
          <button
            type="button"
            className="secondary"
            onClick={exportCsv}
            disabled={!table.rows.length}
          >
            Export page
          </button>
        }
      />

      <div className="content">
        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search action or entity id"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <SelectField
              label=""
              value={query.action ?? ''}
              onChange={(next) => setFilter('action', next)}
              allLabel="Any action"
              options={facets.actions.map((a) => ({ value: a, label: a }))}
            />
          }
          advanced={
            <>
              <SelectField
                label="Entity type"
                value={query.entityType ?? ''}
                onChange={(next) => setFilter('entityType', next)}
                options={facets.entityTypes.map((e) => ({ value: e, label: e }))}
              />
              <label>
                Actor id
                <input
                  value={query.actorId ?? ''}
                  onChange={(e) => setFilter('actorId', e.target.value)}
                  placeholder="User id"
                />
              </label>
              <DateField
                label="From"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="To"
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
          emptyTitle="No audit entries match these filters"
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) => (
            <button type="button" className="ghost sm" onClick={() => setDetail(row)}>
              Details
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
      </div>

      <Modal
        open={detail !== null}
        title={detail?.action ?? ''}
        onClose={() => setDetail(null)}
        footer={
          <button type="button" className="secondary" onClick={() => setDetail(null)}>
            Close
          </button>
        }
      >
        <dl style={{ display: 'grid', gap: '0.5rem', marginTop: '1rem' }}>
          <div>
            <dt className="muted">When</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(detail?.createdAt)}</dd>
          </div>
          <div>
            <dt className="muted">Actor</dt>
            <dd style={{ margin: 0 }}>{detail?.actor?.email ?? 'System'}</dd>
          </div>
          <div>
            <dt className="muted">Entity</dt>
            <dd style={{ margin: 0 }} className="mono">
              {detail?.entityType} {detail?.entityId}
            </dd>
          </div>
          <div>
            <dt className="muted">Metadata</dt>
            <dd style={{ margin: 0 }}>
              <pre
                className="mono"
                style={{
                  background: 'var(--surface-2)',
                  padding: '0.6rem',
                  borderRadius: '7px',
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {JSON.stringify(detail?.metadata ?? null, null, 2)}
              </pre>
            </dd>
          </div>
        </dl>
      </Modal>
    </>
  );
}
