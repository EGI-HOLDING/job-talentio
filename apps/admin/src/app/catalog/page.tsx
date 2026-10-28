'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CatalogParentSelect } from '@/components/ui/CatalogParentSelect';
import { OccupationMatchingEditor } from '@/components/ui/OccupationMatchingEditor';
import type { OccupationMatchingMetadata } from '@job-talentio/shared';
import { api, apiPatch, apiPost } from '@/lib/api';
import { downloadCsv, timestampedName } from '@/lib/csv';
import { useAdminTable } from '@/lib/useAdminTable';
import {
  ArchiveResult,
  CatalogKindSpec,
  CatalogAlias,
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
  matchingMetadata: OccupationMatchingMetadata;
  name: string;
  key: string;
  nameUz: string;
  nameRu: string;
  nameId: string;
  iso2: string; iso3: string; phoneCode: string; currencyCode: string; isActive: boolean; kind: string;
  parentSlug: string;
  sortOrder: string;
  icon: string;
};

const EMPTY_FORM: FormState = {
  matchingMetadata:{sources:[],relatedRoles:[]},
  name: '',
  key: '',
  nameUz: '',
  nameRu: '',
  nameId: '', iso2: '', iso3: '', phoneCode: '', currencyCode: '', isActive: false, kind: 'CITY',
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
  const [aliases, setAliases] = useState<CatalogAlias[]>([]);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);
  const [archiving, setArchiving] = useState<{ row: CatalogRow; usage: CatalogUsage } | null>(null);
  const editLoadVersion = useRef(0);
  const archiveLoadVersion = useRef(0);

  const spec = kinds.find((k) => k.type === type);

  useEffect(() => {
    api<CatalogKindSpec[]>('/admin/catalog/kinds')
      .then(setKinds)
      .catch((e) => notify(e instanceof Error ? e.message : 'Could not load catalogs', 'error'));
  }, [notify]);

  const openArchive = useCallback(
    async (row: CatalogRow) => {
      const version = ++archiveLoadVersion.current;
      try {
        const usage = await api<CatalogUsage>(`/admin/catalog/type/${type}/${row.id}/usage`);
        if (archiveLoadVersion.current === version) setArchiving({ row, usage });
      } catch (e) {
        if (archiveLoadVersion.current === version) {
          notify(e instanceof Error ? e.message : 'Could not read usage', 'error');
        }
      }
    },
    [type, notify],
  );

  async function startEdit(row: CatalogRow) {
    const version = ++editLoadVersion.current;
    const isCurrent = () => editLoadVersion.current === version;
    setEditing(row);
    setEditUsage(null);
    setPendingKeyConfirm(false);
    setAliases([]);
    setAliasDraft('');
    setForm({
      matchingMetadata:row.matchingMetadata ?? {sources:[],relatedRoles:[]},
      name: row.name,
      key: rowIdentityKey(row),
      nameUz: row.nameUz ?? '',
      nameRu: row.nameRu ?? '',
      nameId: row.nameId ?? '', iso2: row.iso2 || '', iso3: row.iso3 || '', phoneCode: row.phoneCode || '', currencyCode: row.currencyCode || '', isActive: row.isActive ?? false, kind: row.kind || 'CITY',
      parentSlug:
        row.province?.id ?? row.country?.id ?? row.industryGroup?.id ?? '',
      sortOrder: String(row.sortOrder ?? 0),
      icon: row.icon ?? '',
    });
    try {
      const usage = await api<CatalogUsage>(`/admin/catalog/type/${type}/${row.id}/usage`);
      if (isCurrent()) setEditUsage(usage);
    } catch {
      // Confirm dialog treats missing usage as zero; save still works.
      if (isCurrent()) setEditUsage({ total: 0, byRelation: [] });
    }
    if (spec?.hasAliases && isCurrent()) {
      try {
        const loadedAliases = await api<CatalogAlias[]>(`/admin/catalog/type/${type}/${row.id}/aliases`);
        if (isCurrent()) setAliases(loadedAliases);
      } catch (e) {
        if (isCurrent()) notify(e instanceof Error ? e.message : 'Could not load aliases', 'error');
      }
    }
  }

  function buildEditPayload(row: CatalogRow) {
    const original = rowIdentityKey(row);
    const nextKey = form.key.trim();
    return {
      ...(type === 'jobTitle' ? {matchingMetadata:form.matchingMetadata} : {}),
      name: form.name.trim(),
      ...(type === 'country' ? { iso2: form.iso2.trim().toUpperCase(), iso3: form.iso3.trim().toUpperCase(), phoneCode: form.phoneCode.trim(), ...(form.currencyCode.trim() ? { currencyCode: form.currencyCode.trim().toUpperCase() } : {}), isActive: form.isActive } : {}), ...(type === 'city' ? { kind: form.kind } : {}),
      ...(nextKey && nextKey !== original ? { key: nextKey } : {}),
      ...(spec?.hasLocaleNames ? { nameUz: form.nameUz.trim(), nameRu: form.nameRu.trim(), nameId: form.nameId.trim() } : {}),
      ...(spec?.parent && form.parentSlug.trim() ? { parentId: form.parentSlug.trim() } : {}),
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
          {
            key: 'nameId',
            label: 'Indonesian',
            render: (row: CatalogRow) => row.nameId || <span className="muted">Missing</span>,
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
      { header: 'nameId', value: (r) => r.nameId ?? '' },
      { header: 'archivedAt', value: (r) => r.archivedAt ?? '' },
      { header: 'curatedAt', value: (r) => r.curatedAt ?? '' },
    ]);
  }

  async function submitCreate() {
    const payload = {
      ...(type === 'jobTitle' ? {matchingMetadata:form.matchingMetadata} : {}),
      name: form.name.trim(),
      ...(type === 'country' ? { iso2: form.iso2.trim().toUpperCase(), iso3: form.iso3.trim().toUpperCase(), phoneCode: form.phoneCode.trim(), ...(form.currencyCode.trim() ? { currencyCode: form.currencyCode.trim().toUpperCase() } : {}), isActive: form.isActive } : {}), ...(type === 'city' ? { kind: form.kind } : {}),
      ...(form.key.trim() ? { key: form.key.trim() } : {}),
      ...(spec?.hasLocaleNames
        ? { nameUz: form.nameUz.trim(), nameRu: form.nameRu.trim(), nameId: form.nameId.trim() }
        : {}),
      ...(spec?.parent ? { parentId: form.parentSlug.trim() } : {}),
      ...(spec?.hasSortOrder ? { sortOrder: Number(form.sortOrder) || 0 } : {}),
      ...(spec?.hasIcon && form.icon.trim() ? { icon: form.icon.trim() } : {}),
    };
    const saved = await table.runAction(apiPost(`/admin/catalog/type/${type}`, payload), 'Entry created');
    if (saved) {
      setCreating(false);
      setForm(EMPTY_FORM);
    }
  }

  async function addAlias() {
    const row = editing;
    const alias = aliasDraft.trim();
    if (!row || !alias) return;
    const version = editLoadVersion.current;
    setAliasBusy(true);
    try {
      const created = await api<CatalogAlias>(`/admin/catalog/type/${type}/${row.id}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias }),
      });
      if (editLoadVersion.current === version) {
        setAliases((current) => [...current, created].sort((a, b) => a.alias.localeCompare(b.alias)));
        setAliasDraft('');
      }
      notify('Alias added');
    } catch (e) {
      if (editLoadVersion.current === version) {
        notify(e instanceof Error ? e.message : 'Could not add alias', 'error');
      }
    } finally {
      setAliasBusy(false);
    }
  }

  async function deleteAlias(aliasId: string) {
    const row = editing;
    if (!row) return;
    const version = editLoadVersion.current;
    setAliasBusy(true);
    try {
      await api(`/admin/catalog/type/${type}/${row.id}/aliases/${aliasId}`, { method: 'DELETE' });
      if (editLoadVersion.current === version) {
        setAliases((current) => current.filter((alias) => alias.id !== aliasId));
      }
      notify('Alias removed');
    } catch (e) {
      if (editLoadVersion.current === version) {
        notify(e instanceof Error ? e.message : 'Could not remove alias', 'error');
      }
    } finally {
      setAliasBusy(false);
    }
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
    const version = editLoadVersion.current;
    setPendingKeyConfirm(false);
    if (!row) return;
    const saved = await table.runAction(
      apiPatch(`/admin/catalog/type/${type}/${row.id}`, buildEditPayload(row)),
      'Entry saved',
    );
    if (saved && editLoadVersion.current === version) {
      setEditing(null);
      setEditUsage(null);
    }
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
              <CatalogParentSelect type={spec.parent.type} label={spec.parent.label} value={query.parentSlug ?? ''} onChange={next=>setFilter('parentSlug',next)} />
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
        description="Create the catalog entry and add its reviewed translations."
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
              <label>
                Indonesian
                <input
                  value={form.nameId}
                  onChange={(e) => setForm((f) => ({ ...f, nameId: e.target.value }))}
                />
              </label>
            </>
          ) : null}
          {type === 'country' && <><div className="form-grid">{(['iso2','iso3','phoneCode','currencyCode'] as const).map(field => <label key={field}>{({ iso2:'ISO2 country code', iso3:'ISO3 country code', phoneCode:'Phone code', currencyCode:'Currency code' })[field]}<input value={form[field]} required={field !== 'currencyCode'} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} /></label>)}</div><label><input type="checkbox" checked={form.isActive} onChange={event => setForm(previous => ({ ...previous, isActive: event.target.checked }))} />Market active (enable after its city catalog is ready)</label></>}
          {type === 'city' && <label>Location type<select value={form.kind} onChange={event => setForm(previous => ({ ...previous, kind: event.target.value }))}>{['CITY','REGENCY','DISTRICT','SETTLEMENT','LEGACY'].map(kind => <option key={kind}>{kind}</option>)}</select></label>}
          {spec?.parent ? (
            <CatalogParentSelect type={spec.parent.type} label={spec.parent.label} value={form.parentSlug} required={spec.parent.required} onChange={next=>setForm(previous=>({...previous,parentSlug:next}))} />
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
              <label>
                Indonesian
                <input
                  value={form.nameId}
                  onChange={(e) => setForm((f) => ({ ...f, nameId: e.target.value }))}
                />
              </label>
            </>
          ) : null}
          {type === 'jobTitle' && <OccupationMatchingEditor value={form.matchingMetadata} onChange={matchingMetadata=>setForm(f=>({...f,matchingMetadata}))}/>}
          {spec?.hasAliases ? (
            <section style={{ display: 'grid', gap: '0.65rem' }}>
              <strong>Aliases</strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                Alternative spellings that should resolve to this catalog entry.
              </span>
              <div className="btn-row">
                <input
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  placeholder="Add an alias"
                  disabled={aliasBusy}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void addAlias()}
                  disabled={!aliasDraft.trim() || aliasBusy}
                >
                  Add
                </button>
              </div>
              {aliases.length ? (
                <ul style={{ display: 'grid', gap: '0.35rem', margin: 0, paddingLeft: '1.1rem' }}>
                  {aliases.map((alias) => (
                    <li key={alias.id} className="btn-row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        {alias.alias} <span className="cell-sub mono">{alias.aliasKey}</span>
                      </span>
                      <button
                        type="button"
                        className="danger sm"
                        onClick={() => void deleteAlias(alias.id)}
                        disabled={aliasBusy}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">No aliases yet.</span>
              )}
            </section>
          ) : null}
          {type === 'country' && <><div className="form-grid">{(['iso2','iso3','phoneCode','currencyCode'] as const).map(field => <label key={field}>{({ iso2:'ISO2 country code', iso3:'ISO3 country code', phoneCode:'Phone code', currencyCode:'Currency code' })[field]}<input value={form[field]} required={field !== 'currencyCode'} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} /></label>)}</div><label><input type="checkbox" checked={form.isActive} onChange={event => setForm(previous => ({ ...previous, isActive: event.target.checked }))} />Market active (enable after its city catalog is ready)</label></>}
          {type === 'city' && <label>Location type<select value={form.kind} onChange={event => setForm(previous => ({ ...previous, kind: event.target.value }))}>{['CITY','REGENCY','DISTRICT','SETTLEMENT','LEGACY'].map(kind => <option key={kind}>{kind}</option>)}</select></label>}
          {spec?.parent ? (
            <CatalogParentSelect type={spec.parent.type} label={spec.parent.label} value={form.parentSlug} required={spec.parent.required} onChange={next=>setForm(previous=>({...previous,parentSlug:next}))} />
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
