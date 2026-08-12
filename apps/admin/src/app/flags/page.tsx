'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, apiPost } from '@/lib/api';
import { AdminFlag } from '@/lib/types';
import { PageHeader } from '@/components/shell/PageHeader';
import { DataTable, type Column } from '@/components/data/DataTable';
import { Badge } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toaster';

export default function FlagsPage() {
  const { notify } = useToast();
  const [flags, setFlags] = useState<AdminFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFlags(await api<AdminFlag[]>('/admin/flags'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: string, enabled: boolean, message: string) {
    setBusy(true);
    try {
      await apiPost('/admin/flags', { key, enabled });
      notify(message);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save the flag', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const key = String(form.get('key') ?? '').trim();
    if (!key) return;
    setCreating(false);
    await save(key, form.get('enabled') === 'on', `Flag ${key} saved`);
  }

  const columns: Array<Column<AdminFlag>> = [
    { key: 'key', label: 'Key', render: (row) => <span className="cell-strong">{row.key}</span> },
    {
      key: 'enabled',
      label: 'State',
      render: (row) =>
        row.enabled ? <Badge tone="ok">On</Badge> : <Badge tone="default">Off</Badge>,
    },
    {
      key: 'payload',
      label: 'Payload',
      render: (row) => (
        <span className="mono truncate">
          {row.payload ? JSON.stringify(row.payload) : 'none'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Feature flags"
        subtitle={`${flags.length} flags`}
        actions={
          <button type="button" onClick={() => setCreating(true)}>
            New flag
          </button>
        }
      />

      <div className="content">
        <DataTable
          rows={flags}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          emptyTitle="No feature flags yet"
          emptyHint="Create one to gate a rollout."
          actions={(row) => (
            <button
              type="button"
              className={row.enabled ? 'secondary sm' : 'sm'}
              disabled={busy}
              onClick={() =>
                save(row.key, !row.enabled, `${row.key} turned ${row.enabled ? 'off' : 'on'}`)
              }
            >
              {row.enabled ? 'Turn off' : 'Turn on'}
            </button>
          )}
        />
      </div>

      <Modal
        open={creating}
        title="New feature flag"
        description="Keys are unique. Saving an existing key updates it instead of creating a duplicate."
        onClose={() => setCreating(false)}
      >
        <form onSubmit={create} style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
          <label>
            Key
            <input name="key" required placeholder="maintenance_mode" autoFocus />
          </label>
          <label className="field-inline" style={{ display: 'flex' }}>
            <input type="checkbox" name="enabled" />
            <span>Enabled immediately</span>
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Save flag
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
