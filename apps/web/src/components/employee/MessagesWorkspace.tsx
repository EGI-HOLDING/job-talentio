'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { jobDetailHref } from '@/lib/accountNavigation';
import { api, getSession, type AuthSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePresence, seedPresence, type PresenceStatus } from '@/lib/presence';
import { PresenceDot } from '@/components/presence/PresenceDot';
import { WorkspaceIcon } from './WorkspaceIcon';
import { ResourceError, SearchField, WorkspaceEmpty, WorkspaceLoading, dateLabel } from './WorkspacePrimitives';
import s from './Workspace.module.css';
import c from './MessagesWorkspace.module.css';
import { RecruiterMessageContext } from '@/components/recruiter/RecruiterMessageContext';

type Peer = { id: string; fullName: string; role: string };
type ChatJob = { id: string; title: string; status: string; companyId: string };
type Message = { id: string; body: string; senderId: string; createdAt: string; deliveredAt?: string | null; readAt?: string | null };
type Conversation = {
  id: string; userAId: string; userBId: string; userA: Peer; userB: Peer;
  jobPostId?: string | null; isColdOutreach: boolean; updatedAt: string; messages: Message[];
  peerPresence?: PresenceStatus | null; peerCandidateId?: string | null;
  company?: { id: string; name: string; slug: string } | null; job?: ChatJob | null;
};
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }

export function MessagesWorkspace() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const peerParam = params.get('peer');
  const jobParam = params.get('job');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const loadConversations = useCallback(async () => {
    const list = await api<Conversation[]>('/chat/conversations');
    const me = getSession()?.user.id;
    for (const item of list) seedPresence(item.userAId === me ? item.userBId : item.userAId, item.peerPresence);
    setConversations(list);
    return list;
  }, [locale]);

  const loadMessages = useCallback(async (id: string) => {
    const version = ++requestVersion.current;
    const list = await api<Message[]>('/chat/conversations/' + id + '/messages');
    if (activeIdRef.current !== id || version !== requestVersion.current) return;
    setMessages(list);
    const last = list[list.length - 1];
    setConversations((rows) => rows.map((row) => row.id === id && last ? { ...row, messages: [{ ...last, readAt: last.senderId === getSession()?.user.id ? last.readAt : last.readAt || new Date().toISOString() }] } : row));
  }, []);

  const openConversation = useCallback(async (id: string) => {
    if (activeIdRef.current === id) return;
    activeIdRef.current = id;
    nearBottomRef.current = true;
    setActiveId(id); setMessages([]); setThreadLoading(true); setError('');
    try { await loadMessages(id); }
    catch (reason) { if (activeIdRef.current === id) setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { if (activeIdRef.current === id) setThreadLoading(false); }
  }, [loadMessages, t]);

  useEffect(() => {
    const current = getSession();
    if (!current) { router.replace('/login?role=' + (params.get('role') === 'RECRUITER' ? 'RECRUITER' : 'EMPLOYEE') + '&next=' + encodeURIComponent('/messages' + (params.toString() ? '?' + params.toString() : ''))); return; }
    setSession(current);
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        await loadConversations();
        if (peerParam && alive) {
          const conversation = await api<Conversation>('/chat/conversations', { method: 'POST', body: JSON.stringify({ peerUserId: peerParam, jobPostId: jobParam || undefined }) });
          if (!alive) return;
          await loadConversations();
          if (alive) await openConversation(conversation.id);
        }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [peerParam, jobParam, loadConversations, openConversation, router, t]);

  useEffect(() => {
    if (!session) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void (async () => {
        try { await loadConversations(); if (activeIdRef.current) await loadMessages(activeIdRef.current); }
        catch { /* Keep the current conversation visible through a transient polling failure. */ }
      })();
    }, 5000);
    return () => window.clearInterval(poll);
  }, [session, loadConversations, loadMessages]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [messages, activeId]);

  const presence = usePresence(conversations.map((item) => item.userAId === session?.user.id ? item.userBId : item.userAId));
  const peerOf = (item: Conversation) => item.userAId === session?.user.id ? item.userB : item.userA;
  const isUnread = (item: Conversation) => Boolean(item.messages[0] && item.messages[0].senderId !== session?.user.id && !item.messages[0].readAt);
  const visible = useMemo(() => conversations.filter((item) => (!unreadOnly || Boolean(item.messages[0] && item.messages[0].senderId !== session?.user.id && !item.messages[0].readAt)) && [item.userA.fullName, item.userB.fullName, item.company?.name, item.job?.title, item.messages[0]?.body].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [conversations, unreadOnly, session?.user.id, search]);
  const active = conversations.find((item) => item.id === activeId);
  const draft = activeId ? drafts[activeId] || '' : '';

  async function send() {
    if (!activeId || !draft.trim() || sendingId) return;
    const id = activeId;
    const text = draft.trim();
    setSendingId(id); setError('');
    try {
      const message = await api<Message>('/chat/conversations/' + id + '/messages', { method: 'POST', body: JSON.stringify({ body: text }) });
      if (activeIdRef.current === id) {
        requestVersion.current++;
        nearBottomRef.current = true;
        setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
      }
      setDrafts((items) => items[id]?.trim() === text ? { ...items, [id]: '' } : items);
      void loadConversations().catch(() => undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('ui.messageSendFailed')); }
    finally { setSendingId(null); }
  }
  async function retry() {
    setError('');
    try { await loadConversations(); if (activeIdRef.current) { setThreadLoading(true); await loadMessages(activeIdRef.current); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }
    finally { setThreadLoading(false); setLoading(false); }
  }
  if (!session) return <section className={s.root}><WorkspaceLoading /></section>;
  const canLinkJob = active?.job && (active.job.status === 'PUBLISHED' || session.user.role === 'SUPER_ADMIN' || session.user.memberships?.some((membership) => membership.companyId === active.job!.companyId));

  return <section className={s.root} aria-label={t('messages')}>
    {error && <ResourceError message={error} onRetry={() => void retry()} />}
    <div className={c.layout + (active ? ' ' + c.hasActive : '') + (session.user.role === 'RECRUITER' && active?.peerCandidateId ? ' ' + c.employer : '')}>
      <aside className={c.sidebar} aria-label={t('messages')}><div className={c.searchArea}><SearchField value={search} onChange={setSearch} placeholder={t('ew.searchConversations')} /></div><nav className={c.filters} aria-label={t('messages')}><button type="button" className={s.tab} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t('ew.all')}</button><button type="button" className={s.tab} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{t('ew.unread')}<span className={s.count}>{conversations.filter(isUnread).length}</span></button></nav><div className={c.list}>{loading ? <WorkspaceLoading /> : !visible.length ? <WorkspaceEmpty icon="message" title={t(error && !conversations.length ? 'ew.loadFailed' : conversations.length ? 'ew.noResults' : 'ew.messagesEmpty')} hint={error && !conversations.length ? undefined : t(conversations.length ? 'ew.adjustSearch' : 'ew.messagesHint')} /> : visible.map((item) => {
        const peer = peerOf(item);
        const last = item.messages[0];
        return <button type="button" key={item.id} className={c.conversation} aria-pressed={activeId === item.id} onClick={() => void openConversation(item.id)}><span className={c.avatar}>{initials(peer.fullName)}</span><span className={c.conversationCopy}><span className={c.conversationTop}><strong>{peer.fullName}</strong><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(item.updatedAt))}</time></span><span className={c.context}>{[item.company?.name, item.job?.title].filter(Boolean).join(' \u00b7 ')}</span><span className={c.preview}><span>{last?.body || t('ew.conversationHint')}</span>{isUnread(item) && <span className={c.unread} aria-label={t('ew.unread')} />}</span></span></button>;
      })}</div></aside>
      <section className={c.chat} aria-label={active ? peerOf(active).fullName : t('messages')}>{!active ? <WorkspaceEmpty icon="message" title={t('ew.chooseConversation')} hint={t('ew.conversationHint')} /> : <><header className={c.header}><button type="button" className={s.iconButton + ' ' + c.back} aria-label={t('ew.backConversations')} onClick={() => { activeIdRef.current = null; requestVersion.current++; setActiveId(null); setMessages([]); }}><WorkspaceIcon kind="left" /></button><span className={c.avatar}>{initials(peerOf(active).fullName)}</span><div className={c.headerCopy}><div className={c.headerTitle}>{session.user.role === 'RECRUITER' && active.peerCandidateId ? <Link href={'/candidates/' + active.peerCandidateId + (active.job ? '?matchJobId=' + active.job.id : '')}>{peerOf(active).fullName}</Link> : <span>{peerOf(active).fullName}</span>}<PresenceDot status={presence[peerOf(active).id] ?? active.peerPresence} showLabel />{active.isColdOutreach && <span className={c.cold}>{t('ui.coldOutreach')}</span>}</div><div className={c.headerMeta}>{active.company && <Link href={'/companies/' + active.company.slug}>{active.company.name}</Link>}{active.company && active.job && <span>{'\u00b7'}</span>}{active.job && <span>{active.job.title}</span>}</div></div>{active.job && canLinkJob && <Link className={s.secondary} href={jobDetailHref(active.job.id, '/messages?peer=' + peerOf(active).id + '&job=' + active.job.id + '&role=' + session.user.role)}>{t('ew.viewJob')}<WorkspaceIcon kind="external" /></Link>}</header>
        <div ref={threadRef} className={c.thread} role="log" aria-live="polite" aria-relevant="additions" aria-label={t('messages')} aria-busy={threadLoading} onScroll={() => { const node = threadRef.current; if (node) nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 110; }}>{threadLoading ? <WorkspaceLoading /> : messages.map((message, index) => {
          const mine = message.senderId === session.user.id;
          const day = new Date(message.createdAt).toLocaleDateString(locale);
          const previousDay = index ? new Date(messages[index - 1].createdAt).toLocaleDateString(locale) : '';
          const receipt = mine ? t(message.readAt ? 'read' : message.deliveredAt ? 'delivered' : 'sent') : '';
          return <div key={message.id} style={{ display: 'contents' }}>{day !== previousDay && <div className={c.day}>{dateLabel(message.createdAt, locale)}</div>}<div className={c.message + (mine ? ' ' + c.mine : '')}><div className={c.bubble}>{message.body}</div><div className={c.time}><time dateTime={message.createdAt} title={dateLabel(message.createdAt, locale, true)}>{new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>{receipt && <span className={c.receipt}>{message.readAt && <WorkspaceIcon kind="check" />}{receipt}</span>}</div></div></div>;
        })}</div>
        <form className={c.compose} onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="workspace-message">{t('messageInput')}</label><textarea id="workspace-message" rows={1} maxLength={5000} value={draft} onChange={(event) => setDrafts((items) => ({ ...items, [active.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={t('writeMessage')} /><button type="submit" className={s.primary} disabled={!draft.trim() || Boolean(sendingId) || threadLoading}>{t(sendingId === active.id ? 'saving' : 'send')}<WorkspaceIcon kind="send" /></button></form>
      </>}</section>
      {session.user.role === 'RECRUITER' && active?.peerCandidateId && <RecruiterMessageContext key={active.id} candidateId={active.peerCandidateId} name={peerOf(active).fullName} job={active.job} />}
    </div>
  </section>;
}
