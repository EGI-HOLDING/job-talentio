'use client';
import { useEffect, useRef, useState } from 'react';
import { postOnce } from '@/lib/operations';
import { api, apiPatch } from '@/lib/api';
import { PageHeader } from '@/components/shell/PageHeader';
export default function SupportPage() {
  const threadRequest = useRef(0);
  useEffect(() => () => { ++threadRequest.current; }, []);
  const [items, setItems] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [active, setActive] = useState<any>(null),
    [replyPage, setReplyPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [includeResolved, setIncludeResolved] = useState(false);
  const load = async () => {
    const data = await api<any>(
      '/hr-support?page=' + page + (includeResolved ? '&status=ALL' : ''),
    );
    setItems(data.items);
    setTotal(data.total);
  };
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [page, includeResolved]);
  async function thread(id: string, next = 1) {
    const version = ++threadRequest.current;
    const data = await api('/hr-support/' + id + '?page=' + next);
    if (version === threadRequest.current) { setReplyPage(next); setActive(data); }
  }
  async function reply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const node = event.currentTarget;
    const body = String(new FormData(node).get('body'));
    const version = threadRequest.current;
    setBusy(true);
    setError('');
    try {
      await postOnce('/hr-support/' + active.id + '/replies', { body });
      if (version !== threadRequest.current) return;
      node.reset();
      await thread(active.id, replyPage);
      await load();
    } catch (error) {
      if (version === threadRequest.current) setError(error instanceof Error ? error.message : 'Reply failed');
    } finally {
      setBusy(false);
    }
  }
  async function update(status: string) {
    const version = threadRequest.current;
    setBusy(true);
    try {
      await apiPatch('/hr-support/' + active.id, { status });
      if (version !== threadRequest.current) return;
      await thread(active.id, replyPage);
      await load();
    } catch (error) {
      if (version === threadRequest.current) setError(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (busy) return;
    const version=threadRequest.current;
    setBusy(true);setError('');
    try {
      await api('/hr-support/' + active.id + '/assign-self', {method:'POST',body:'{}'});
      if (version !== threadRequest.current) return;
      await thread(active.id);await load();
    } catch(error) {
      if(version===threadRequest.current)setError(error instanceof Error?error.message:'Assignment failed');
    } finally {setBusy(false);}
  }
  return (
    <>
      <PageHeader
        title="HR support queue"
        subtitle="Priority is fixed when a ticket is created. Oldest requests are first within each priority."
      />
      <div className="panel support-panel" style={{ padding: 24 }}>
        <label>
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(event) => {
              setPage(1);
              setIncludeResolved(event.target.checked);
            }}
          />
          Include resolved
        </label>
        {items.map((ticket) => (
          <p key={ticket.id}>
            <button
              className="ghost"
              onClick={() => void thread(ticket.id).catch((error) => setError(error.message))}
            >
              {ticket.priority ? 'Priority | ' : ''}
              {ticket.company.name} | {ticket.title} | {ticket.status}
            </button>
          </p>
        ))}
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          {' '}
          {page} | {total} requests{' '}
        </span>
        <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
      {active && (
        <section className="panel support-panel" style={{ padding: 24, marginTop: 16 }}>
          <h2>{active.title}</h2>
          <label>
            Status
            <select
              value={active.status}
              disabled={busy}
              onChange={(event) => void update(event.target.value)}
            >
              {['OPEN', 'IN_PROGRESS', 'WAITING_HR', 'RESOLVED'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void assign()}
          >
            Assign to me
          </button>
          {active.replies.map((reply: any) => (
            <p key={reply.id} style={{ whiteSpace: 'pre-wrap' }}>
              <strong>{reply.authorRole}</strong>: {reply.body}
            </p>
          ))}
          <button disabled={replyPage === 1} onClick={() => void thread(active.id, replyPage - 1).catch(error=>setError(error.message))}>
            Previous replies
          </button>
          <button
            disabled={replyPage * 50 >= active.total}
            onClick={() => void thread(active.id, replyPage + 1).catch(error=>setError(error.message))}
          >
            Next replies
          </button>
          <form key={active.id} onSubmit={(event) => void reply(event)}>
            <label>
              Reply
              <textarea
                name="body"
                required
                maxLength={10000}
                rows={4}
              />
            </label>
            <button className="primary" disabled={busy}>
              Send reply
            </button>
          </form>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
