'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FormAlert, LabelText } from '@/components/ui/Field';

type Template = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
  author?: { fullName: string };
};

type Campaign = {
  id: string;
  createdAt: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  messageBody?: string | null;
  note?: string | null;
  createdBy?: { fullName: string };
  jobPost?: { title: string };
  template?: { name: string } | null;
  recipients: Array<{
    id: string;
    candidateName: string;
    deliveryStatus: string;
    statusMoved: boolean;
    sentAt?: string | null;
    errorMessage?: string | null;
  }>;
  _count?: { recipients: number };
};

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Sent',
  SKIPPED_OPTED_OUT: 'Opted out',
  FAILED: 'Failed',
  PENDING: 'Pending',
};

export function BulkCommsPanel({
  companyId,
  jobPostId,
}: {
  companyId: string;
  jobPostId?: string;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [tpl, hist] = await Promise.all([
        api<Template[]>(`/bulk-comms/templates?companyId=${companyId}`),
        api<Campaign[]>(
          `/bulk-comms/campaigns?companyId=${companyId}${
            jobPostId ? `&jobPostId=${jobPostId}` : ''
          }`,
        ),
      ]);
      setTemplates(tpl);
      setCampaigns(hist);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load bulk communication data');
    } finally {
      setLoading(false);
    }
  }, [companyId, jobPostId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      if (editingId) {
        await api(`/bulk-comms/templates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, body }),
        });
        setMsg('Template updated');
      } else {
        await api('/bulk-comms/templates', {
          method: 'POST',
          body: JSON.stringify({ companyId, name, body }),
        });
        setMsg('Template created');
      }
      setName('');
      setBody('');
      setEditingId(null);
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to save template');
    }
  }

  async function removeTemplate(id: string) {
    if (!confirm('Delete this template?')) return;
    setErr(null);
    try {
      await api(`/bulk-comms/templates/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        setEditingId(null);
        setName('');
        setBody('');
      }
      setMsg('Template deleted');
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to delete template');
    }
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
    setMsg(null);
    setErr(null);
  }

  return (
    <div className="bulk-panel">
      <div className="bulk-panel-intro">
        <h2 className="section-title" style={{ margin: 0 }}>
          Bulk communication
        </h2>
        <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
          Manage message templates and review who was contacted. Use checkboxes in Pipeline to
          move and message selected candidates. Variables:{' '}
          <code>{'{{name}}'}</code>, <code>{'{{jobTitle}}'}</code>,{' '}
          <code>{'{{companyName}}'}</code>, <code>{'{{status}}'}</code>.
        </p>
      </div>

      {msg && <FormAlert tone="success">{msg}</FormAlert>}
      {err && <FormAlert tone="error">{err}</FormAlert>}

      <div className="bulk-grid">
        <section className="card bulk-card">
          <h3 className="section-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {editingId ? 'Edit template' : 'New template'}
          </h3>
          <form className="bulk-form" onSubmit={saveTemplate}>
            <label>
              <LabelText required>Name</LabelText>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                placeholder="Interview invite"
              />
            </label>
            <label>
              <LabelText required>Body</LabelText>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                rows={6}
                maxLength={5000}
                placeholder="Hi {{name}}, thanks for applying to {{jobTitle}} at {{companyName}}…"
              />
            </label>
            <div className="chips">
              <button type="submit" className="chip active">
                {editingId ? 'Save changes' : 'Create template'}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    setEditingId(null);
                    setName('');
                    setBody('');
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <h3 className="section-title" style={{ fontSize: '1.05rem', marginTop: '1.5rem' }}>
            Templates {loading ? '' : `(${templates.length})`}
          </h3>
          {templates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No templates yet.
            </p>
          ) : (
            <ul className="bulk-template-list">
              {templates.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.name}</strong>
                    <p className="muted bulk-template-preview">{t.body}</p>
                  </div>
                  <div className="chips">
                    <button type="button" className="chip" onClick={() => startEdit(t)}>
                      Edit
                    </button>
                    <button type="button" className="chip" onClick={() => removeTemplate(t.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card bulk-card">
          <h3 className="section-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Communication history
          </h3>
          {campaigns.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No bulk actions yet. Select candidates in Pipeline to start.
            </p>
          ) : (
            <ul className="bulk-history-list">
              {campaigns.map((c) => {
                const open = expanded === c.id;
                const sent = c.recipients.filter((r) => r.deliveryStatus === 'SENT').length;
                const skipped = c.recipients.filter(
                  (r) => r.deliveryStatus === 'SKIPPED_OPTED_OUT',
                ).length;
                const failed = c.recipients.filter((r) => r.deliveryStatus === 'FAILED').length;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="bulk-history-head"
                      onClick={() => setExpanded(open ? null : c.id)}
                    >
                      <div>
                        <strong>
                          {c.jobPost?.title || 'Job'}
                          {c.toStatus ? ` → ${c.toStatus}` : ''}
                        </strong>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {new Date(c.createdAt).toLocaleString()} · {c.createdBy?.fullName || '—'} ·{' '}
                          {c.recipients.length} recipient(s)
                          {c.template ? ` · ${c.template.name}` : ''}
                        </div>
                        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
                          Sent {sent}
                          {skipped ? ` · Opted out ${skipped}` : ''}
                          {failed ? ` · Failed ${failed}` : ''}
                        </div>
                      </div>
                      <span className="muted">{open ? 'Hide' : 'Details'}</span>
                    </button>
                    {open && (
                      <div className="bulk-history-detail">
                        {c.messageBody && (
                          <p className="bulk-msg-preview">
                            <span className="muted">Message:</span> {c.messageBody}
                          </p>
                        )}
                        <table className="bulk-table">
                          <thead>
                            <tr>
                              <th>Candidate</th>
                              <th>Delivery</th>
                              <th>Moved</th>
                              <th>When</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.recipients.map((r) => (
                              <tr key={r.id}>
                                <td>{r.candidateName}</td>
                                <td>
                                  <span
                                    className={`bulk-status bulk-status-${r.deliveryStatus.toLowerCase()}`}
                                  >
                                    {STATUS_LABEL[r.deliveryStatus] || r.deliveryStatus}
                                  </span>
                                  {r.errorMessage && (
                                    <div className="muted" style={{ fontSize: '0.72rem' }}>
                                      {r.errorMessage}
                                    </div>
                                  )}
                                </td>
                                <td>{r.statusMoved ? 'Yes' : '—'}</td>
                                <td>
                                  {r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
