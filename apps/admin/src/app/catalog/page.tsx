'use client';

import { useEffect, useState } from 'react';
import { api, apiPatch, apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  AdminCatalogEntry,
  CATALOG_KINDS,
  CATALOG_STATUSES,
  type CatalogKind,
  type CatalogStatus,
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
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, DateField, SelectField } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toaster';

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc', kind: 'skill', status: 'PENDING' };
const FILTER_KEYS = [
  'q',
  'kind',
  'status',
  'createdFrom',
  'createdTo',
  'sort',
  'dir',
  'page',
  'limit',
];

type Summary = Record<CatalogKind, { pending: number; complete: number; ignored: number }>;
type Pending = { kind: 'status'; status: CatalogStatus } | { kind: 'translate' };

export default function CatalogPage() {
  const table = useAdminTable<AdminCatalogEntry>({
    path: '/admin/catalog/i18n',
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;
  const { notify } = useToast();

  const catalogKind = (query.kind ?? 'skill') as CatalogKind;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<AdminCatalogEntry | null>(null);
  const [draft, setDraft] = useState({ nameUz: '', nameRu: '' });
  const [merging, setMerging] = useState<AdminCatalogEntry | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<Summary>('/admin/catalog/i18n/summary')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [table.rows]);

  const columns: Array<Column<AdminCatalogEntry>> = [
    {
      key: 'name',
      label: 'English name',
      sortKey: 'name',
      render: (row) => (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span className="cell-strong truncate">{row.name}</span>
          <span className="cell-sub mono">{row.id}</span>
        </span>
      ),
    },
    {
      key: 'nameUz',
      label: 'Uzbek',
      render: (row) => (
        <span>
          {row.nameUz || <span className="muted">Missing</span>}
          {row.nameUzIsMachine && (
            <>
              {' '}
              <Badge>machine</Badge>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'nameRu',
      label: 'Russian',
      render: (row) => (
        <span>
          {row.nameRu || <span className="muted">Missing</span>}
          {row.nameRuIsMachine && (
            <>
              {' '}
              <Badge>machine</Badge>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'State',
      render: (row) => (
        <Badge
          tone={
            row.i18nStatus === 'COMPLETE' ? 'ok' : row.i18nStatus === 'IGNORED' ? 'default' : 'warn'
          }
        >
          {row.i18nStatus}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'Added',
      sortKey: 'createdAt',
      render: (row) => <span className="num">{formatDate(row.createdAt)}</span>,
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.createdFrom)
    activeFilters.push({ key: 'createdFrom', label: `From ${query.createdFrom}` });
  if (query.createdTo) activeFilters.push({ key: 'createdTo', label: `To ${query.createdTo}` });

  function exportCsv() {
    const rows = table.selected.size
      ? table.rows.filter((row) => table.selected.has(row.id))
      : table.rows;
    downloadCsv(timestampedName(`catalog-${catalogKind}`), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'name', value: (r) => r.name },
      { header: 'nameUz', value: (r) => r.nameUz ?? '' },
      { header: 'nameRu', value: (r) => r.nameRu ?? '' },
      { header: 'status', value: (r) => r.i18nStatus },
      { header: 'createdAt', value: (r) => r.createdAt },
    ]);
  }

  const kindSummary = summary?.[catalogKind];

  return (
    <>
      <PageHeader
        title="Catalog translations"
        subtitle="Terms users created while posting jobs or editing profiles. Missing translations fall back to the English name."
        actions={
          <>
            <button
              type="button"
              className="secondary"
              disabled={catalogKind === 'language' || table.busy}
              title={
                catalogKind === 'language'
                  ? 'Language names always need a translation'
                  : 'Move tech and brand names out of the queue'
              }
              onClick={() =>
                table.runAction(
                  apiPost(`/admin/catalog/${catalogKind}/reclassify`),
                  'Tech terms moved out of the queue',
                )
              }
            >
              Auto-mark tech terms
            </button>
            <button type="button" className="secondary" onClick={exportCsv} disabled={!table.rows.length}>
              Export CSV
            </button>
          </>
        }
      />

      <div className="content">
        {kindSummary ? (
          <div className="grid">
            <div className="stat attention">
              <div className="stat-label">Awaiting review</div>
              <div className="stat-value">{kindSummary.pending}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Translated</div>
              <div className="stat-value">{kindSummary.complete}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Tech identity</div>
              <div className="stat-value">{kindSummary.ignored}</div>
            </div>
          </div>
        ) : null}

        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search any language"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <>
              <SelectField
                label=""
                value={catalogKind}
                onChange={(next) => setFilter('kind', next)}
                allLabel="Skills"
                options={CATALOG_KINDS.map((k) => ({
                  value: k.value,
                  label: summary
                    ? `${k.label} (${summary[k.value]?.pending ?? 0})`
                    : k.label,
                }))}
              />
              <SelectField
                label=""
                value={query.status ?? 'PENDING'}
                onChange={(next) => setFilter('status', next)}
                allLabel="Pending"
                options={CATALOG_STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </>
          }
          advanced={
            <>
              <DateField
                label="Added from"
                value={query.createdFrom ?? ''}
                onChange={(next) => setFilter('createdFrom', next)}
              />
              <DateField
                label="Added to"
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
          emptyTitle="Nothing in this queue"
          emptyHint="New terms appear here as users create them."
          selectable
          selected={table.selected}
          onSelectedChange={table.updateSelection}
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) => (
            <>
              <button
                type="button"
                className="secondary sm"
                onClick={() => {
                  setEditing(row);
                  setDraft({ nameUz: row.nameUz ?? '', nameRu: row.nameRu ?? '' });
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="secondary sm"
                disabled={table.busy}
                onClick={() =>
                  table.runAction(
                    apiPost(`/admin/catalog/${catalogKind}/${row.id}/translate`),
                    'Translation requested',
                  )
                }
              >
                Translate
              </button>
              <button
                type="button"
                className="ghost sm"
                disabled={table.busy}
                onClick={() =>
                  table.runAction(
                    apiPost(`/admin/catalog/${catalogKind}/${row.id}/status`, {
                      status: row.i18nStatus === 'IGNORED' ? 'PENDING' : 'IGNORED',
                    }),
                    row.i18nStatus === 'IGNORED' ? 'Moved back to the queue' : 'Marked as tech',
                  )
                }
              >
                {row.i18nStatus === 'IGNORED' ? 'Needs translation' : 'Mark tech'}
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={() => {
                  setMerging(row);
                  setMergeTarget('');
                }}
              >
                Merge
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
            onClick={() => setPending({ kind: 'translate' })}
          >
            Translate
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'status', status: 'IGNORED' })}
          >
            Mark tech
          </button>
          <button
            type="button"
            className="secondary sm"
            onClick={() => setPending({ kind: 'status', status: 'PENDING' })}
          >
            Needs translation
          </button>
        </BulkBar>
      </div>

      <Modal
        open={editing !== null}
        title={`Edit ${editing?.name ?? ''}`}
        description="Saving marks these as human translations, so machine output will never overwrite them."
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={table.busy}
              onClick={async () => {
                const row = editing;
                setEditing(null);
                if (!row) return;
                await table.runAction(
                  apiPatch(`/admin/catalog/${catalogKind}/${row.id}`, draft),
                  'Translation saved',
                );
              }}
            >
              Save
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
          <label>
            Uzbek
            <input
              value={draft.nameUz}
              onChange={(e) => setDraft((d) => ({ ...d, nameUz: e.target.value }))}
            />
          </label>
          <label>
            Russian
            <input
              value={draft.nameRu}
              onChange={(e) => setDraft((d) => ({ ...d, nameRu: e.target.value }))}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={merging !== null}
        title={`Merge ${merging?.name ?? ''}`}
        description="The duplicate is removed and everything pointing at it moves to the entry you choose. Its old spelling keeps resolving to the survivor."
        onClose={() => setMerging(null)}
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setMerging(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={!mergeTarget.trim() || table.busy}
              onClick={async () => {
                const row = merging;
                const target = mergeTarget.trim();
                setMerging(null);
                if (!row || !target) return;
                if (target === row.id) {
                  notify('Pick a different entry to merge into', 'error');
                  return;
                }
                await table.runAction(
                  apiPost(`/admin/catalog/${catalogKind}/${row.id}/merge`, { targetId: target }),
                  'Entry merged',
                );
              }}
            >
              Merge and delete
            </button>
          </>
        }
      >
        <label style={{ marginTop: '1rem' }}>
          Keep this entry id
          <input
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder="Paste the id of the entry to keep"
          />
        </label>
      </Modal>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'translate'
            ? 'Machine translate selected terms'
            : `Mark selected as ${pending?.status ?? ''}`
        }
        description={
          pending?.kind === 'translate'
            ? `${table.selected.size} terms will be sent to the translation provider. Human translations are never overwritten, and the run stops if the monthly budget is exhausted.`
            : `${table.selected.size} terms will change state.`
        }
        confirmLabel={pending?.kind === 'translate' ? 'Translate them' : 'Change state'}
        busy={table.busy}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const action = pending;
          setPending(null);
          if (!action) return;
          if (action.kind === 'translate') {
            await table.runBulk(`/admin/catalog/${catalogKind}/bulk/translate`, {}, 'translated');
          } else {
            await table.runBulk(
              `/admin/catalog/${catalogKind}/bulk/status`,
              { status: action.status },
              'updated',
            );
          }
        }}
      />
    </>
  );
}
