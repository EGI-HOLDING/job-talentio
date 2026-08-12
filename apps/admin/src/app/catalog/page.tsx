'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, apiPatch, apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  ArchiveResult,
  CatalogKindSpec,
  CatalogRow,
  CatalogType,
  CatalogUsage,
  isCatalogType,
} from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { FilterBar, Pager, type ActiveFilter } from '@/components/data/TableChrome';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Alert, Badge, SelectField } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toaster';

const DEFAULTS = { page: '1', limit: '25', sort: 'name', dir: 'asc', archived: 'false' };
const FILTER_KEYS = ['q', 'archived', 'parentSlug', 'sort', 'dir', 'page', 'limit'];

function catalogKeyLabel(keyField?: 'slug' | 'code'): string {
  return keyField === 'code' ? 'Code (ISO)' : 'Slug';
}

function rowIdentityKey(row: CatalogRow): string {
  return row.slug ?? row.code ?? '';
}

type FormState = {
  name: string;
  key: string;
  nameUz: string;
  nameRu: string;
  parentSlug: string;
  sortOrder: string;
  icon: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  key: '',
  nameUz: '',
  nameRu: '',
  parentSlug: '',
  sortOrder: '0',
  icon: '',
};

export default function CatalogPage() {
  const { notify } = useToast();
  const [kinds, setKinds] = useState<CatalogKindSpec[]>([]);

  // The catalog lives in the URL like every other filter, so a view can be
  // shared and switching resets paging. It is read directly because the table
  // hook needs it to build the request path.
  const searchParams = useSearchParams();
  const typeParam = searchParams.get('type');
  const type: CatalogType = isCatalogType(typeParam) ? typeParam : 'skill';

  const table = useAdminTable<CatalogRow>({
    path: `/admin/catalog/type/${type}`,
    defaults: DEFAULTS,
    filterKeys: FILTER_KEYS,
  });
  const { query, setFilter } = table;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CatalogRow | null>(null);
  const [editUsage, setEditUsage] = useState<CatalogUsage | null>(null);
  const [pendingKeyConfirm, setPendingKeyConfirm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [archiving, setArchiving] = useState<{ row: CatalogRow; usage: CatalogUsage } | null>(null);

  const spec = kinds.find((k) => k.type === type);

  useEffect(() => {
    api<CatalogKindSpec[]>('/admin/catalog/kinds')
      .then(setKinds)
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not load catalogs', 'error'));
  }, [notify]);

  const openArchive = useCallback(
    async (row: CatalogRow) => {
      try {
        const usage = await api<CatalogUsage>(`/admin/catalog/type/${type}/${row.id}/usage`);
        setArchiving({ row, usage });
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Could not read usage', 'error');
      }
    },
    [type, notify],
  );

  async function startEdit(row: CatalogRow) {
    setEditing(row);
    setEditUsage(null);
    setPendingKeyConfirm(false);
    setForm({
      name: row.name,
      key: rowIdentityKey(row),
      nameUz: row.nameUz ?? '',
      nameRu: row.nameRu ?? '',
      parentSlug:
        row.province?.slug ?? row.country?.slug ?? row.industryGroup?.slug ?? '',
      sortOrder: String(row.sortOrder ?? 0),
      icon: row.icon ?? '',
    });
    try {
      const usage = await api<CatalogUsage>(`/admin/catalog/type/${type}/${row.id}/usage`);
      setEditUsage(usage);
    } catch {
      // Confirm dialog treats missing usage as zero; save still works.
      setEditUsage({ total: 0, byRelation: [] });
    }
  }

  function buildEditPayload(row: CatalogRow) {
    const original = rowIdentityKey(row);
    const nextKey = form.key.trim();
    return {
      name: form.name.trim(),
      ...(nextKey && nextKey !== original ? { key: nextKey } : {}),
      ...(spec?.hasLocaleNames ? { nameUz: form.nameUz.trim(), nameRu: form.nameRu.trim() } : {}),
      ...(spec?.parent && form.parentSlug.trim() ? { parentSlug: form.parentSlug.trim() } : {}),
      ...(spec?.hasSortOrder ? { sortOrder: Number(form.sortOrder) || 0 } : {}),
      ...(spec?.hasIcon ? { icon: form.icon.trim() || null } : {}),
    };
  }

  const columns: Array<Column<CatalogRow>> = [
    {
      key: 'name',
      label: 'Name',
      sortKey: 'name',
      render: (row) => (
        <span style={{ display: 'block', minWidth: 0 }}>
          <span className="cell-strong truncate">{row.name}</span>
          <span className="cell-sub mono">{row.slug ?? row.code}</span>
        </span>
      ),
    },
    ...(spec?.hasLocaleNames
      ? [
          {
            key: 'nameUz',
            label: 'Uzbek',
            render: (row: CatalogRow) => row.nameUz || <span className="muted">Missing</span>,
          },
          {
            key: 'nameRu',
            label: 'Russian',
            render: (row: CatalogRow) => row.nameRu || <span className="muted">Missing</span>,
          },
        ]
      : []),
    ...(spec?.parent
      ? [
          {
            key: 'parent',
            label: spec.parent.label,
            render: (row: CatalogRow) =>
              row.province?.name ?? row.country?.name ?? row.industryGroup?.name ?? '-',
          },
        ]
      : []),
    ...(spec?.hasSortOrder
      ? [
          {
            key: 'sortOrder',
            label: 'Order',
            sortKey: 'sortOrder',
            align: 'right' as const,
            render: (row: CatalogRow) => <span className="num">{row.sortOrder ?? 0}</span>,
          },
        ]
      : []),
    {
      key: 'state',
      label: 'State',
      render: (row) => (
        <div className="btn-row">
          {row.archivedAt ? (
            <Badge tone="warn">Archived</Badge>
          ) : (
            <Badge tone="ok">Active</Badge>
          )}
          {row.curatedAt && <Badge tone="accent">Edited</Badge>}
        </div>
      ),
    },
  ];

  const activeFilters: ActiveFilter[] = [];
  if (query.archived === 'true') activeFilters.push({ key: 'archived', label: 'Archived only' });
  if (query.archived === 'any') activeFilters.push({ key: 'archived', label: 'Any state' });
  if (query.parentSlug)
    activeFilters.push({ key: 'parentSlug', label: `Parent: ${query.parentSlug}` });

  function exportCsv() {
    downloadCsv(timestampedName(`catalog-${type}`), table.rows, [
      { header: 'id', value: (r) => r.id },
      { header: 'name', value: (r) => r.name },
      { header: 'key', value: (r) => r.slug ?? r.code ?? '' },
      { header: 'nameUz', value: (r) => r.nameUz ?? '' },
      { header: 'nameRu', value: (r) => r.nameRu ?? '' },
      { header: 'archivedAt', value: (r) => r.archivedAt ?? '' },
      { header: 'curatedAt', value: (r) => r.curatedAt ?? '' },
    ]);
  }

  async function submitCreate() {
    const payload = {
      name: form.name.trim(),
      ...(form.key.trim() ? { key: form.key.trim() } : {}),
      ...(spec?.parent ? { parentSlug: form.parentSlug.trim() } : {}),
      ...(spec?.hasSortOrder ? { sortOrder: Number(form.sortOrder) || 0 } : {}),
      ...(spec?.hasIcon && form.icon.trim() ? { icon: form.icon.trim() } : {}),
    };
    setCreating(false);
    await table.runAction(apiPost(`/admin/catalog/type/${type}`, payload), 'Entry created');
  }

  async function submitEdit() {
    const row = editing;
    if (!row) return;
    const original = rowIdentityKey(row);
    const nextKey = form.key.trim();
    const keyChanging = Boolean(nextKey && nextKey !== original);
    if (keyChanging && (editUsage?.total ?? 0) > 0) {
      setPendingKeyConfirm(true);
      return;
    }
    await commitEdit();
  }

  async function commitEdit() {
    const row = editing;
    setPendingKeyConfirm(false);
    setEditing(null);
    setEditUsage(null);
    if (!row) return;
    await table.runAction(
      apiPatch(`/admin/catalog/type/${type}/${row.id}`, buildEditPayload(row)),
      'Entry saved',
    );
  }

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle="Every lookup table users pick from. Archiving hides an entry from new selections without touching the records that already use it."
        actions={
          <>
            <Link href="/catalog/translations" className="btn secondary">
              Translation queue
            </Link>
            <button
              type="button"
              className="secondary"
              onClick={exportCsv}
              disabled={!table.rows.length}
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setCreating(true);
              }}
            >
              New entry
            </button>
          </>
        }
      />

      <div className="content">
        <FilterBar
          search={query.q ?? ''}
          onSearch={(next) => setFilter('q', next)}
          searchPlaceholder="Search any language or key"
          activeFilters={activeFilters}
          onClearFilter={(key) => setFilter(key, '')}
          onClearAll={table.reset}
          quick={
            <>
              <SelectField
                label=""
                value={type}
                onChange={(next) => setFilter('type', next)}
                allLabel={null}
                options={kinds.map((k) => ({ value: k.type, label: k.label }))}
              />
              <SelectField
                label=""
                value={query.archived ?? 'false'}
                onChange={(next) => setFilter('archived', next)}
                allLabel={null}
                options={[
                  { value: 'false', label: 'Active only' },
                  { value: 'true', label: 'Archived only' },
                  { value: 'any', label: 'Any state' },
                ]}
              />
            </>
          }
          advanced={
            spec?.parent ? (
              <label>
                {spec.parent.label} slug
                <input
                  value={query.parentSlug ?? ''}
                  onChange={(e) => setFilter('parentSlug', e.target.value)}
                  placeholder="tashkent"
                />
              </label>
            ) : undefined
          }
        />

        {spec?.seedManaged ? (
          <Alert tone="info">
            This catalog is recreated from code on deploy, so entries here are archived rather than
            deleted. Your edits are kept.
          </Alert>
        ) : null}

        <DataTable
          rows={table.rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={table.loading}
          error={table.error}
          emptyTitle="Nothing in this catalog"
          emptyHint="Create an entry or widen the filters."
          sort={query.sort}
          dir={query.dir}
          onSort={table.toggleSort}
          actions={(row) => (
            <>
              <button
                type="button"
                className="secondary sm"
                onClick={() => void startEdit(row)}
              >
                Edit
              </button>
              {row.archivedAt ? (
                <button
                  type="button"
                  className="secondary sm"
                  disabled={table.busy}
                  onClick={() =>
                    table.runAction(
                      apiPost(`/admin/catalog/type/${type}/${row.id}/restore`),
                      'Entry restored',
                    )
                  }
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className="danger sm"
                  disabled={table.busy}
                  onClick={() => openArchive(row)}
                >
                  Archive
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
      </div>

      <Modal
        open={creating}
        title={`New ${spec?.label ?? 'entry'}`}
        description="Created through the same rules as user input, so matching and aliases stay consistent."
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="button" disabled={!form.name.trim() || table.busy} onClick={submitCreate}>
              Create
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </label>
          <label>
            {catalogKeyLabel(spec?.keyField)} (optional)
            <input
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              placeholder={
                spec?.keyField === 'code'
                  ? '2-3 letter ISO code (id, en, uz)'
                  : 'Derived from the name when empty'
              }
            />
          </label>
          {spec?.parent ? (
            <label>
              {spec.parent.label} slug
              <input
                value={form.parentSlug}
                onChange={(e) => setForm((f) => ({ ...f, parentSlug: e.target.value }))}
              />
            </label>
          ) : null}
          {spec?.hasSortOrder ? (
            <label>
              Sort order
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
          ) : null}
          {spec?.hasIcon ? (
            <label>
              Icon
              <input
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={editing !== null && !pendingKeyConfirm}
        title={`Edit ${editing?.name ?? ''}`}
        description="Saving marks this entry as owned by an admin, so deploy backfills stop rewriting it."
        onClose={() => {
          setEditing(null);
          setEditUsage(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(null);
                setEditUsage(null);
              }}
            >
              Cancel
            </button>
            <button type="button" disabled={!form.name.trim() || table.busy} onClick={submitEdit}>
              Save
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label>
            {catalogKeyLabel(spec?.keyField)}
            <input
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              placeholder={
                spec?.keyField === 'code' ? '2-3 letter ISO code (id, en, uz)' : undefined
              }
            />
            {spec?.keyField === 'code' ? (
              <span className="muted" style={{ display: 'block', fontSize: '0.8rem', marginTop: 4 }}>
                Changing the code keeps the old value as an alias so existing input still matches.
              </span>
            ) : null}
          </label>
          {spec?.hasLocaleNames ? (
            <>
              <label>
                Uzbek
                <input
                  value={form.nameUz}
                  onChange={(e) => setForm((f) => ({ ...f, nameUz: e.target.value }))}
                />
              </label>
              <label>
                Russian
                <input
                  value={form.nameRu}
                  onChange={(e) => setForm((f) => ({ ...f, nameRu: e.target.value }))}
                />
              </label>
            </>
          ) : null}
          {spec?.parent ? (
            <label>
              {spec.parent.label} slug
              <input
                value={form.parentSlug}
                onChange={(e) => setForm((f) => ({ ...f, parentSlug: e.target.value }))}
              />
            </label>
          ) : null}
          {spec?.hasSortOrder ? (
            <label>
              Sort order
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </label>
          ) : null}
          {spec?.hasIcon ? (
            <label>
              Icon
              <input
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingKeyConfirm && editing !== null}
        title={`Change ${catalogKeyLabel(spec?.keyField).toLowerCase()}?`}
        description={
          <>
            <p style={{ marginTop: 0 }}>
              {editing
                ? `"${rowIdentityKey(editing)}" → "${form.key.trim()}". Profiles and jobs keep the same record; matching on the old key will use an alias.`
                : null}
            </p>
            {editUsage && editUsage.total > 0 ? (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {editUsage.byRelation.map((relation) => (
                  <li key={relation.label}>
                    <span className="num">{relation.count}</span> {relation.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        }
        confirmLabel="Change key"
        busy={table.busy}
        onConfirm={() => void commitEdit()}
        onCancel={() => setPendingKeyConfirm(false)}
      />

      <Modal
        open={archiving !== null}
        title={`Archive ${archiving?.row.name ?? ''}`}
        description={
          archiving?.usage.total
            ? 'It disappears from search, suggestions and filters. Records that already use it keep it.'
            : spec?.seedManaged
              ? 'Nothing uses it, but this catalog is rebuilt from code on deploy, so it is archived rather than deleted.'
              : 'Nothing uses it, so it will be deleted outright.'
        }
        onClose={() => setArchiving(null)}
        footer={
          <>
            <button type="button" className="secondary" onClick={() => setArchiving(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={table.busy}
              onClick={async () => {
                const row = archiving?.row;
                setArchiving(null);
                if (!row) return;
                try {
                  const result = await apiPost<ArchiveResult>(
                    `/admin/catalog/type/${type}/${row.id}/archive`,
                  );
                  notify(
                    result.outcome === 'deleted'
                      ? `${row.name} deleted, nothing referenced it.`
                      : `${row.name} archived.`,
                  );
                  await table.reload();
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Could not archive', 'error');
                }
              }}
            >
              {archiving?.usage.total || spec?.seedManaged ? 'Archive it' : 'Delete it'}
            </button>
          </>
        }
      >
        {archiving?.usage.total ? (
          <ul style={{ marginTop: '1rem', paddingLeft: '1.1rem' }}>
            {archiving.usage.byRelation.map((relation) => (
              <li key={relation.label}>
                <span className="num">{relation.count}</span> {relation.label}
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
    </>
  );
}
