'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { postOnce } from '@/lib/hr-benefits';
import { useI18n } from '@/lib/i18n';
import { Pagination } from '@/components/employee/WorkspacePrimitives';
import s from './RecruiterWorkspace.module.css';
import support from './HrSupport.module.css';
export function HrSupport({ companyId }: { companyId: string }) {
  return <CompanySupport key={companyId} companyId={companyId} />;
}
function CompanySupport({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const threadRequest = useRef(0);
  useEffect(
    () => () => {
      ++threadRequest.current;
    },
    [],
  );
  const [open, setOpen] = useState(false),
    [available, setAvailable] = useState(false),
    [items, setItems] = useState<any[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [active, setActive] = useState<any>(null),
    [replyPage, setReplyPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [includeResolved, setIncludeResolved] = useState(false);
  const load = () =>
    api<any>(
      '/hr-support?companyId=' +
        companyId +
        '&page=' +
        page +
        (includeResolved ? '&status=ALL' : ''),
    ).then((data) => {
      setItems(data.items);
      setTotal(data.total);
      setAvailable(true);
    });
  useEffect(() => {
    let alive = true;
    api<any>(
      '/hr-support?companyId=' +
        companyId +
        '&page=' +
        page +
        (includeResolved ? '&status=ALL' : ''),
    )
      .then((data) => {
        if (alive) {
          setItems(data.items);
          setTotal(data.total);
          setAvailable(true);
        }
      })
      .catch((error) => {
        if (alive && !(error instanceof ApiError && error.status === 404)) setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [companyId, page, includeResolved]);
  useEffect(() => {
    setActive(null);
    setReplyPage(1);
  }, [companyId]);
  async function thread(id: string, next = 1) {
    const version = ++threadRequest.current;
    const value = await api('/hr-support/' + id + '?page=' + next);
    if (version === threadRequest.current) {
      setActive(value);
      setReplyPage(next);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const node = event.currentTarget;
    const form = new FormData(node);
    const version = threadRequest.current;
    setBusy(true);
    setError('');
    try {
      if (active) {
        await postOnce('/hr-support/' + active.id + '/replies', { body: String(form.get('body')) });
        if (version !== threadRequest.current) return;
        await thread(active.id, replyPage);
      } else {
        const ticket = await postOnce<any>('/hr-support', {
          companyId,
          title: String(form.get('title')),
          body: String(form.get('body')),
        });
        if (version !== threadRequest.current) return;
        await thread(ticket.id);
      }
      node.reset();
      await load();
    } catch (error) {
      if (version === threadRequest.current) setError(error instanceof Error ? error.message : t('ew.loadFailed'));
    } finally {
      setBusy(false);
    }
  }
  if (!available) return error ? <p role="alert">{error}</p> : null;
  return (
    <section className={support.root} style={{ padding: '12px 24px' }}>
      <button className={s.textButton} onClick={() => setOpen(!open)} aria-expanded={open}>
        {t('hr.support')}
      </button>
      {open && (
        <div className={s.fields} style={{ paddingBlock: 16 }}>
          <p>{t('hr.supportHint')}</p>
          <label>
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => {
                setPage(1);
                setIncludeResolved(event.target.checked);
              }}
            />
            {t('hr.includeResolved')}
          </label>
          <div className={s.actions}>
            <button
              className={s.secondary}
              onClick={() => {
                ++threadRequest.current;
                setActive(null);
              }}
            >
              {t('hr.newTicket')}
            </button>
            {items.map((ticket) => (
              <button
                className={s.textButton}
                key={ticket.id}
                onClick={() => void thread(ticket.id).catch((error) => setError(error.message))}
              >
                {ticket.title} | {t('hr.ticket.' + ticket.status)}
                {ticket.priority ? ' | ' + t('hr.priority') : ''}
              </button>
            ))}
          </div>
          <Pagination page={page} total={total} size={20} onChange={setPage} />
          {active && (
            <article>
              <h3>{active.title}</h3>
              {active.replies.map((reply: any) => (
                <p key={reply.id} style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>
                    {reply.authorRole === 'SUPER_ADMIN' ? t('hr.support') : t('hr.yourTeam')}
                  </strong>
                  : {reply.body}
                </p>
              ))}
              <Pagination
                page={replyPage}
                total={active.total}
                size={50}
                onChange={(next) =>
                  void thread(active.id, next).catch((error) => setError(error.message))
                }
              />
            </article>
          )}
          <form key={active?.id || 'new'} className={s.fields} onSubmit={(event) => void submit(event)}>
            {!active && (
              <label>
                {t('hr.subject')}
                <input name="title" minLength={5} maxLength={180} required />
              </label>
            )}
            <label>
              {t('hr.message')}
              <textarea
                name="body"
                required
                minLength={active ? 1 : 10}
                maxLength={10000}
                rows={3}
              />
            </label>
            <button className={s.primary} type="submit" disabled={busy}>
              {t(busy ? 'saving' : 'hr.send')}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
