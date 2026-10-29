'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { postOnce } from '@/lib/hr-benefits';
import { useI18n } from '@/lib/i18n';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { Pagination, WorkspaceLoading, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { allowEmployerContextChange, useEmployerUnsaved } from './useEmployerUnsaved';
import s from './HrSupport.module.css';

type Ticket = { id: string; title: string; status: string; priority: boolean; createdAt: string };
type Thread = Ticket & { replies: Array<{ id: string; body: string; authorRole: string; createdAt: string }>; total: number };

export function HrSupport({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState('');
  const [active, setActive] = useState<Thread | null>(null);
  const [replyPage, setReplyPage] = useState(1);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [notice, setNotice] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const viewVersion = useRef(0);
  const submitting = useRef(false);
  useEmployerUnsaved(Boolean(title || message), busy);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++viewVersion.current; }; }, []);
  useEffect(() => { if (selected === 'new') titleRef.current?.focus(); }, [selected]);

  useEffect(() => {
    let current = true;
    setListLoading(true); setListError(false); setUnavailable(false);
    const params = new URLSearchParams({ companyId, page: String(page) });
    if (includeResolved) params.set('status', 'ALL');
    api<{ items: Ticket[]; total: number }>('/hr-support?' + params).then(data => {
      if (!current) return;
      if (page > 1 && !data.items.length) { setPage(Math.max(1, Math.ceil(data.total / 20))); return; }
      setItems(data.items); setTotal(data.total);
    }).catch(reason => {
      if (!current) return;
      if (reason instanceof ApiError && reason.status === 404) setUnavailable(true);
      else setListError(true);
    }).finally(() => { if (current) setListLoading(false); });
    return () => { current = false; };
  }, [companyId, page, includeResolved, refresh, locale]);

  useEffect(() => {
    setActive(null); setThreadError(false);
    if (!selected || selected === 'new') { setThreadLoading(false); return; }
    let current = true;
    setThreadLoading(true);
    api<Thread>('/hr-support/' + encodeURIComponent(selected) + '?page=' + replyPage).then(value => {
      if (current) setActive(value);
    }).catch(() => { if (current) setThreadError(true); }).finally(() => { if (current) setThreadLoading(false); });
    return () => { current = false; };
  }, [selected, companyId, replyPage, refresh, locale]);

  async function choose(id: string) {
    if (id === selected || !await allowEmployerContextChange()) return;
    ++viewVersion.current;
    setSelected(id); setActive(null); setReplyPage(1); setTitle(''); setMessage(''); setSubmitError(''); setNotice('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !selected) return;
    const body = message.trim();
    if (body.length < (selected === 'new' ? 10 : 1) || (selected === 'new' && title.trim().length < 5)) {
      setSubmitError(t('support.validation')); return;
    }
    const version = viewVersion.current;
    submitting.current = true; setBusy(true); setSubmitError(''); setNotice('');
    try {
      const ticket = selected === 'new'
        ? await postOnce<Ticket>('/hr-support', { companyId, title: title.trim(), body })
        : await postOnce('/hr-support/' + encodeURIComponent(selected) + '/replies', { body });
      if (!alive.current || version !== viewVersion.current) return;
      setTitle(''); setMessage(''); setNotice(t('support.sent'));
      if (selected === 'new') { setSelected((ticket as Ticket).id); setReplyPage(1); }
      else setReplyPage(Math.max(1, Math.ceil(((active?.total || 0) + 1) / 50)));
      // Refresh separately: a failed read must never turn a successful send into a retry.
      setRefresh(value => value + 1);
    } catch {
      if (alive.current && version === viewVersion.current) setSubmitError(t('support.sendFailed'));
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const thread = active?.id === selected ? active : null;
  return <section className={s.root} aria-labelledby="hr-support-title">
    <header className={s.heading}>
      <div className={s.identity}><span className={s.headingIcon}><WorkspaceIcon kind="message" /></span><div><span className={s.company}>{companyName}</span><h1 id="hr-support-title">{t('hr.support')}</h1><p>{t('support.subtitle')}</p></div></div>
      <button type="button" className={s.primary} disabled={busy || listLoading || unavailable || listError || selected === 'new'} onClick={() => void choose('new')}><WorkspaceIcon kind="plus" />{t('hr.newTicket')}</button>
    </header>
    <div className={s.priorityNote}><WorkspaceIcon kind="shield" /><p>{t('support.priorityHint')}</p></div>
    {notice && <p className={s.success} role="status"><WorkspaceIcon kind="check" />{notice}</p>}
    {unavailable ? <div className={s.unavailable}><WorkspaceIcon kind="message" /><h2>{t('support.unavailable')}</h2><p>{t('support.unavailableHint')}</p></div> : <div className={s.workspace}>
      <aside className={s.inbox} aria-labelledby="support-requests-title">
        <div className={s.inboxHead}><h2 id="support-requests-title">{t('support.requests')}</h2><span>{total}</span></div>
        <label className={s.filter}><input type="checkbox" checked={includeResolved} onChange={event => { setPage(1); setIncludeResolved(event.target.checked); }} />{t('hr.includeResolved')}</label>
        {listLoading ? <WorkspaceLoading /> : listError ? <div className={s.listError} role="alert"><p>{t('ew.loadFailed')}</p><button className={s.secondary} type="button" onClick={() => setRefresh(value => value + 1)}>{t('workspace.retry')}</button></div> : items.length ? <div className={s.ticketList}>{items.map(ticket => <button type="button" className={s.ticket} key={ticket.id} aria-pressed={selected === ticket.id} disabled={busy} onClick={() => void choose(ticket.id)}><strong>{ticket.title}</strong><span className={s.ticketMeta}><span className={s.badge} data-status={ticket.status}>{t('hr.ticket.' + ticket.status)}</span>{ticket.priority && <span className={s.priority}>{t('hr.priority')}</span>}</span><time dateTime={ticket.createdAt}>{dateLabel(ticket.createdAt, locale)}</time></button>)}</div> : <div className={s.listEmpty}><WorkspaceIcon kind="message" /><strong>{t(includeResolved ? 'support.noRequests' : 'support.noOpenRequests')}</strong><p>{t('support.listEmptyHint')}</p></div>}
        {!listLoading && !listError && total > 20 && <Pagination page={page} total={total} size={20} onChange={setPage} />}
      </aside>
      <div className={s.detail}>
        {!selected ? <div className={s.empty}><span className={s.emptyIcon}><WorkspaceIcon kind="message" /></span><h2>{t('support.welcome')}</h2><p>{t('support.welcomeHint')}</p><button className={s.secondary} type="button" disabled={listLoading || listError} onClick={() => void choose('new')}><WorkspaceIcon kind="plus" />{t('hr.newTicket')}</button></div> : selected === 'new' ? <div className={s.composer}><h2>{t('hr.newTicket')}</h2><p className={s.description}>{t('support.newHint')}</p><form onSubmit={event => void submit(event)}><fieldset className={s.fields} disabled={busy}><label htmlFor="support-subject">{t('hr.subject')}<input ref={titleRef} id="support-subject" name="title" value={title} onChange={event => setTitle(event.target.value)} minLength={5} maxLength={180} required /></label><label htmlFor="support-message">{t('hr.message')}<textarea id="support-message" name="body" value={message} onChange={event => setMessage(event.target.value)} minLength={10} maxLength={10000} rows={7} required /></label>{submitError && <p className={s.formError} role="alert">{submitError}</p>}<div className={s.formActions}><button type="button" className={s.secondary} onClick={() => void choose('')}>{t('cancel')}</button><button className={s.primary} type="submit"><WorkspaceIcon kind="send" />{t(busy ? 'saving' : 'support.sendRequest')}</button></div></fieldset></form></div> : threadLoading ? <WorkspaceLoading /> : threadError ? <div className={s.empty} role="alert"><WorkspaceIcon kind="message" /><h2>{t('ew.loadFailed')}</h2><button type="button" className={s.secondary} onClick={() => setRefresh(value => value + 1)}>{t('workspace.retry')}</button></div> : thread ? <article className={s.conversation}>
          <header className={s.threadHead}><div className={s.ticketMeta}><span className={s.badge} data-status={thread.status}>{t('hr.ticket.' + thread.status)}</span>{thread.priority && <span className={s.priority}>{t('hr.priority')}</span>}</div><h2>{thread.title}</h2><time dateTime={thread.createdAt}>{dateLabel(thread.createdAt, locale, true)}</time></header>
          <div className={s.messages}>{thread.replies.map(reply => <section className={s.message} data-team={reply.authorRole !== 'SUPER_ADMIN'} key={reply.id}><header><strong>{t(reply.authorRole === 'SUPER_ADMIN' ? 'hr.support' : 'hr.yourTeam')}</strong><time dateTime={reply.createdAt}>{dateLabel(reply.createdAt, locale, true)}</time></header><p>{reply.body}</p></section>)}</div>
          {thread.total > 50 && <Pagination page={replyPage} total={thread.total} size={50} onChange={setReplyPage} />}
          <form className={s.reply} onSubmit={event => void submit(event)}><fieldset className={s.fields} disabled={busy}><label htmlFor="support-reply">{t('support.yourReply')}<textarea id="support-reply" name="body" value={message} onChange={event => setMessage(event.target.value)} minLength={1} maxLength={10000} rows={4} required /></label>{submitError && <p className={s.formError} role="alert">{submitError}</p>}<div className={s.formActions}><button className={s.primary} type="submit"><WorkspaceIcon kind="send" />{t(busy ? 'saving' : 'hr.send')}</button></div></fieldset></form>
        </article> : null}
      </div>
    </div>}
  </section>;
}
