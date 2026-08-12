'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type CatalogKind = 'skill' | 'jobTitle' | 'language' | 'benefit';
type CatalogStatus = 'PENDING' | 'COMPLETE' | 'IGNORED';

type CatalogEntry = {
  id: string;
  name: string;
  nameUz: string | null;
  nameRu: string | null;
  nameUzIsMachine: boolean;
  nameRuIsMachine: boolean;
  i18nStatus: CatalogStatus;
  createdAt: string;
};

type QueueResponse = {
  kind: CatalogKind;
  status: CatalogStatus;
  page: number;
  total: number;
  items: CatalogEntry[];
};

type Summary = Record<CatalogKind, { pending: number; complete: number; ignored: number }>;

const KINDS: Array<{ value: CatalogKind; label: string }> = [
  { value: 'skill', label: 'Skills' },
  { value: 'jobTitle', label: 'Job titles' },
  { value: 'language', label: 'Languages' },
  { value: 'benefit', label: 'Benefits' },
];

const STATUSES: CatalogStatus[] = ['PENDING', 'COMPLETE', 'IGNORED'];

const TRANSLATE_MESSAGE: Record<string, string> = {
  disabled: 'Machine translation is turned off (TRANSLATION_PROVIDER).',
  'budget-exceeded': 'Monthly translation budget is used up.',
  unsupported: 'The provider cannot translate into this language.',
  exists: 'Nothing left to translate.',
};

export function CatalogI18nPanel() {
  const [kind, setKind] = useState<CatalogKind>('skill');
  const [status, setStatus] = useState<CatalogStatus>('PENDING');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { nameUz: string; nameRu: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({ kind, status });
      if (search.trim()) params.set('q', search.trim());
      const [data, counts] = await Promise.all([
        api<QueueResponse>(`/admin/catalog/i18n?${params.toString()}`),
        api<Summary>('/admin/catalog/i18n/summary'),
      ]);
      setQueue(data);
      setSummary(counts);
      setDrafts(
        Object.fromEntries(
          data.items.map((item) => [
            item.id,
            { nameUz: item.nameUz ?? '', nameRu: item.nameRu ?? '' },
          ]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await run();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function save(entry: CatalogEntry) {
    const draft = drafts[entry.id];
    return act(entry.id, () =>
      api(`/admin/catalog/${kind}/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nameUz: draft?.nameUz ?? '', nameRu: draft?.nameRu ?? '' }),
      }),
    );
  }

  function translate(entry: CatalogEntry) {
    return act(entry.id, async () => {
      const result = await api<{ status: string }>(
        `/admin/catalog/${kind}/${entry.id}/translate`,
        { method: 'POST' },
      );
      if (result.status !== 'ready') {
        setNotice(TRANSLATE_MESSAGE[result.status] ?? 'Translation could not be produced.');
      }
    });
  }

  function setStatusOf(entry: CatalogEntry, next: CatalogStatus) {
    return act(entry.id, () =>
      api(`/admin/catalog/${kind}/${entry.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      }),
    );
  }

  function merge(entry: CatalogEntry) {
    const targetId = window.prompt(`Merge "${entry.name}" into which entry id?`)?.trim();
    if (!targetId) return Promise.resolve();
    return act(entry.id, () =>
      api(`/admin/catalog/${kind}/${entry.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      }),
    );
  }

  const pending = summary?.[kind]?.pending ?? 0;

  return (
    <section id="catalog-i18n" className="card">
      <h2>Catalog translations</h2>
      <p className="muted">
        Terms users created while posting jobs or editing profiles. Missing translations fall back
        to the English name, so this queue is about polish, not breakage.
      </p>

      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <label>
          Catalog{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as CatalogKind)}>
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {summary ? ` (${summary[option.value]?.pending ?? 0})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value as CatalogStatus)}>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <input
          placeholder="Search name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search catalog name"
        />
        <button
          className="secondary"
          onClick={() =>
            act('reclassify', () =>
              api(`/admin/catalog/${kind}/reclassify`, { method: 'POST' }),
            )
          }
          disabled={kind === 'language'}
          title={
            kind === 'language'
              ? 'Language names always need a translation'
              : 'Move tech and brand names out of the queue'
          }
        >
          Auto-mark tech terms
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      <p className="muted">
        {pending} awaiting review - showing {queue?.items.length ?? 0} of {queue?.total ?? 0}
      </p>

      <table>
        <thead>
          <tr>
            <th>English name</th>
            <th>Uzbek</th>
            <th>Russian</th>
            <th>Added</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(queue?.items ?? []).map((entry) => {
            const draft = drafts[entry.id] ?? { nameUz: '', nameRu: '' };
            const busy = busyId === entry.id;
            return (
              <tr key={entry.id}>
                <td>
                  {entry.name}
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    {entry.id}
                  </div>
                </td>
                <td>
                  <input
                    value={draft.nameUz}
                    aria-label={`Uzbek name for ${entry.name}`}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [entry.id]: { ...draft, nameUz: e.target.value },
                      }))
                    }
                  />
                  {entry.nameUzIsMachine && <div className="muted">machine</div>}
                </td>
                <td>
                  <input
                    value={draft.nameRu}
                    aria-label={`Russian name for ${entry.name}`}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [entry.id]: { ...draft, nameRu: e.target.value },
                      }))
                    }
                  />
                  {entry.nameRuIsMachine && <div className="muted">machine</div>}
                </td>
                <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                <td className="row">
                  <button onClick={() => save(entry)} disabled={busy}>
                    Save
                  </button>
                  <button className="secondary" onClick={() => translate(entry)} disabled={busy}>
                    Translate
                  </button>
                  {entry.i18nStatus === 'IGNORED' ? (
                    <button
                      className="secondary"
                      onClick={() => setStatusOf(entry, 'PENDING')}
                      disabled={busy}
                    >
                      Needs translation
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() => setStatusOf(entry, 'IGNORED')}
                      disabled={busy}
                    >
                      Mark tech
                    </button>
                  )}
                  <button className="danger" onClick={() => merge(entry)} disabled={busy}>
                    Merge
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
