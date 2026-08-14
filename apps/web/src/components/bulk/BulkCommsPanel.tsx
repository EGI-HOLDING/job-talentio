'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
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

const STATUS_LABEL_KEY: Record<string, string> = {
  SENT: 'sent',
  SKIPPED_OPTED_OUT: 'ui.optedOut',
  FAILED: 'ui.failed',
  PENDING: 'ui.pending',
};

export function BulkCommsPanel({
  companyId,
  jobPostId,
}: {
  companyId: string;
  jobPostId?: string;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
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
      setErr(e instanceof Error ? e.message : t('ui.bulkLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [companyId, jobPostId, t]);

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
        setMsg(t('ui.templateUpdated'));
      } else {
        await api('/bulk-comms/templates', {
          method: 'POST',
          body: JSON.stringify({ companyId, name, body }),
        });
        setMsg(t('ui.templateCreated'));
      }
      setName('');
      setBody('');
      setEditingId(null);
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.templateSaveFailed'));
    }
  }

  async function removeTemplate(id: string) {
    const ok = await confirm({
      title: t('ui.deleteTemplateConfirm'),
      tone: 'danger',
      confirmLabel: t('ui.delete'),
    });
    if (!ok) return;
    setErr(null);
    try {
      await api(`/bulk-comms/templates/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        setEditingId(null);
        setName('');
        setBody('');
      }
      setMsg(t('ui.templateDeleted'));
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('ui.templateDeleteFailed'));
    }
  }

  function startEdit(tpl: Template) {
    setEditingId(tpl.id);
    setName(tpl.name);
    setBody(tpl.body);
    setMsg(null);
    setErr(null);
  }

  return (
    <div className="bulk-panel">
      <div className="bulk-panel-intro">
        <h2 className="section-title" style={{ margin: 0 }}>
          {t('ui.bulkCommunication')}
        </h2>
        <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
          {t('ui.bulkCommsIntro')} {t('ui.bulkCommsVariables')}{' '}
          <code>{'{{name}}'}</code>, <code>{'{{jobTitle}}'}</code>,{' '}
          <code>{'{{companyName}}'}</code>, <code>{'{{status}}'}</code>.
        </p>
      </div>

      {msg && <FormAlert tone="success">{msg}</FormAlert>}
      {err && <FormAlert tone="error">{err}</FormAlert>}

      <div className="bulk-grid">
        <section className="card bulk-card">
          <h3 className="section-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {editingId ? t('ui.editTemplate') : t('ui.newTemplate')}
          </h3>
          <form className="bulk-form" onSubmit={saveTemplate}>
            <label>
              <LabelText required>{t('ui.name')}</LabelText>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                placeholder={t('ui.interviewInvitePlaceholder')}
              />
            </label>
            <label>
              <LabelText required>{t('ui.body')}</LabelText>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                rows={6}
                maxLength={5000}
                placeholder={t('ui.templateBodyPlaceholder')}
              />
            </label>
            <div className="chips">
              <button type="submit" className="chip active">
                {editingId ? t('ui.saveChanges') : t('ui.createTemplate')}
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
                  {t('cancel')}
                </button>
              )}
            </div>
          </form>

          <h3 className="section-title" style={{ fontSize: '1.05rem', marginTop: '1.5rem' }}>
            {t('ui.templates')} {loading ? '' : `(${templates.length})`}
          </h3>
          {templates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t('ui.noTemplatesYet')}
            </p>
          ) : (
            <ul className="bulk-template-list">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <div>
                    <strong>{tpl.name}</strong>
                    <p className="muted bulk-template-preview">{tpl.body}</p>
                  </div>
                  <div className="chips">
                    <button type="button" className="chip" onClick={() => startEdit(tpl)}>
                      {t('ui.edit')}
                    </button>
                    <button type="button" className="chip" onClick={() => removeTemplate(tpl.id)}>
                      {t('ui.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card bulk-card">
          <h3 className="section-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {t('ui.communicationHistory')}
          </h3>
          {campaigns.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t('ui.noBulkActionsYet')}
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
                          {c.jobPost?.title || t('ui.job')}
                          {c.toStatus ? ` → ${c.toStatus}` : ''}
                        </strong>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {new Date(c.createdAt).toLocaleString()} | {c.createdBy?.fullName || '-'} | {' '}
                          {t('ui.recipientsCount').replace('{n}', String(c.recipients.length))}
                          {c.template ? ` | ${c.template.name}` : ''}
                        </div>
                        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
                          {t('sent')} {sent}
                          {skipped ? ` | ${t('ui.optedOut')} ${skipped}` : ''}
                          {failed ? ` | ${t('ui.failed')} ${failed}` : ''}
                        </div>
                      </div>
                      <span className="muted">{open ? t('ui.hide') : t('ui.details')}</span>
                    </button>
                    {open && (
                      <div className="bulk-history-detail">
                        {c.messageBody && (
                          <p className="bulk-msg-preview">
                            <span className="muted">{t('ui.message')}:</span> {c.messageBody}
                          </p>
                        )}
                        <table className="bulk-table">
                          <thead>
                            <tr>
                              <th>{t('ui.candidate')}</th>
                              <th>{t('ui.delivery')}</th>
                              <th>{t('ui.moved')}</th>
                              <th>{t('ui.when')}</th>
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
                                    {STATUS_LABEL_KEY[r.deliveryStatus]
                                      ? t(STATUS_LABEL_KEY[r.deliveryStatus])
                                      : r.deliveryStatus}
                                  </span>
                                  {r.errorMessage && (
                                    <div className="muted" style={{ fontSize: '0.72rem' }}>
                                      {r.errorMessage}
                                    </div>
                                  )}
                                </td>
                                <td>{r.statusMoved ? t('ui.yes') : '-'}</td>
                                <td>
                                  {r.sentAt ? new Date(r.sentAt).toLocaleString() : '-'}
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
