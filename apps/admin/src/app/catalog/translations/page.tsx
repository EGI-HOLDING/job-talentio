'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiPatch, apiPost, toQueryString } from '@/lib/api';
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

const DEFAULTS = { page: '1', limit: '25', sort: 'createdAt', dir: 'desc', kind: 'skill' };
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

export default function CatalogTranslationsPage() {
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
  const [draft, setDraft] = useState({ nameUz: '', nameRu: '', nameId: '' });
  const [merging, setMerging] = useState<AdminCatalogEntry | null>(null);

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
      key: 'nameId',
      label: 'Indonesian',
      render: (row) => (
        <span>
          {row.nameId || <span className="muted">Missing</span>}
          {row.nameIdIsMachine && (
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

  async function exportCsv() {
    try {
      const rows = table.selected.size
        ? await apiPost<AdminCatalogEntry[]>(`/admin/catalog/i18n/${catalogKind}/selected`, {
            ids: [...table.selected],
          })
        : table.rows;
      if (!rows.length) {
        notify('No translations to export', 'error');
        return;
      }
      downloadCsv(timestampedName(`translations-${catalogKind}`), rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'name', value: (r) => r.name },
      { header: 'nameUz', value: (r) => r.nameUz ?? '' },
      { header: 'nameRu', value: (r) => r.nameRu ?? '' },
      { header: 'nameId', value: (r) => r.nameId ?? '' },
      { header: 'status', value: (r) => r.i18nStatus },
      ]);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not export translations', 'error');
    }
  }

  const kindSummary = summary?.[catalogKind];

  return (
    <>
      <PageHeader
        title="Catalog translations"
        subtitle="Terms users created while posting jobs or editing profiles. A missing translation falls back to the English name."
        actions={
          <>
            <Link href="/catalog" className="btn secondary">
              Browse catalog
            </Link>
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
            <button
              type="button"
              className="secondary"
              onClick={() => void exportCsv()}
              disabled={!table.rows.length && !table.selected.size}
            >
              {table.selected.size ? `Export selected (${table.selected.size})` : 'Export CSV'}
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
                allLabel={null}
                options={CATALOG_KINDS.map((k) => ({
                  value: k.value,
                  label: summary ? `${k.label} (${summary[k.value]?.pending ?? 0})` : k.label,
                }))}
              />
              <SelectField
                label=""
                value={query.status ?? ''}
                onChange={(next) => setFilter('status', next)}
                allLabel="Any status"
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
                  setDraft({ nameUz: row.nameUz ?? '', nameRu: row.nameRu ?? '', nameId: row.nameId ?? '' });
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
              <button type="button" className="ghost sm" onClick={() => setMerging(row)}>
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
        description="Saving marks these as human translations, so machine output never overwrites them."
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
                if (!row) return;
                const saved = await table.runAction(
                  apiPatch(`/admin/catalog/${catalogKind}/${row.id}`, draft),
                  'Translation saved',
                );
                if (saved) setEditing(null);
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
          <label>
            Indonesian
            <input
              value={draft.nameId}
              onChange={(e) => setDraft((d) => ({ ...d, nameId: e.target.value }))}
            />
          </label>
        </div>
      </Modal>

      <MergeDialog
        source={merging}
        kind={catalogKind}
        busy={table.busy}
        onClose={() => setMerging(null)}
        onMerged={async (targetId) => {
          const row = merging;
          if (!row) return;
          const saved = await table.runAction(
            apiPost(`/admin/catalog/${catalogKind}/${row.id}/merge`, { targetId }),
            'Entry merged',
          );
          if (saved) setMerging(null);
        }}
        onError={(message) => notify(message, 'error')}
      />

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
          if (!action) return;
          let saved: boolean;
          if (action.kind === 'translate') {
            saved = await table.runBulk(`/admin/catalog/${catalogKind}/bulk/translate`, {}, 'translated');
          } else {
            saved = await table.runBulk(
              `/admin/catalog/${catalogKind}/bulk/status`,
              { status: action.status },
              'updated',
            );
          }
          if (saved) setPending(null);
        }}
      />
    </>
  );
}

type Envelope = { items: AdminCatalogEntry[] };

/**
 * Picking the surviving entry by name. Searching across every status matters
 * here: the canonical entry is usually COMPLETE while the duplicate sits in
 * PENDING, so a status-scoped search would never find it.
 */
function MergeDialog({
  source,
  kind,
  busy,
  onClose,
  onMerged,
  onError,
}: {
  source: AdminCatalogEntry | null;
  kind: CatalogKind;
  busy: boolean;
  onClose: () => void;
  onMerged: (targetId: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<AdminCatalogEntry[]>([]);
  const [picked, setPicked] = useState<AdminCatalogEntry | null>(null);
  const [searching, setSearching] = useState(false);
  const searchVersion = useRef(0);

  useEffect(() => {
    if (!source) {
      searchVersion.current += 1;
      setTerm('');
      setResults([]);
      setPicked(null);
      setSearching(false);
    }
  }, [source]);

  const search = useCallback(
    async (value: string, version: number) => {
      if (!value.trim() || version !== searchVersion.current) return;
      try {
        const data = await api<Envelope>(
          `/admin/catalog/i18n${toQueryString({ kind, q: value.trim(), limit: 10 })}`,
        );
        if (version === searchVersion.current) {
          setResults(data.items.filter((item) => item.id !== source?.id));
        }
      } catch (e) {
        if (version === searchVersion.current) {
          onError(e instanceof Error ? e.message : 'Search failed');
        }
      } finally {
        if (version === searchVersion.current) setSearching(false);
      }
    },
    [kind, source?.id, onError],
  );

  useEffect(() => {
    const version = ++searchVersion.current;
    if (!source || !term.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => void search(term, version), 250);
    return () => window.clearTimeout(timer);
  }, [term, search, source]);

  return (
    <Modal
      open={source !== null}
      title={`Merge ${source?.name ?? ''}`}
      description="The duplicate is removed and everything pointing at it moves to the entry you keep. Its old spelling keeps resolving to the survivor."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={!picked || busy}
            onClick={() => picked && void onMerged(picked.id)}
          >
            {picked ? `Merge into ${picked.name}` : 'Pick an entry'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1rem' }}>
        <label>
          Search the entry to keep
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Type a name in any language"
            autoFocus
          />
        </label>
        {searching ? <p className="muted">Searching...</p> : null}
        {!searching && term.trim() && !results.length ? (
          <p className="muted">No other entry matches that.</p>
        ) : null}
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className={picked?.id === item.id ? 'sm' : 'secondary sm'}
              style={{ justifyContent: 'space-between', width: '100%' }}
              onClick={() => setPicked(item)}
            >
              <span>{item.name}</span>
              <span className="mono">{item.i18nStatus}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
