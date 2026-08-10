'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { api, getSession, AuthSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePresence, seedPresence, type PresenceStatus } from '@/lib/presence';
import { PresenceDot } from '@/components/presence/PresenceDot';

type Peer = { id: string; fullName: string; email: string };
type Conversation = {
  id: string;
  userAId: string;
  userBId: string;
  userA: Peer;
  userB: Peer;
  jobPostId?: string | null;
  isColdOutreach: boolean;
  updatedAt: string;
  messages: Array<{ id: string; body: string; senderId: string; createdAt: string }>;
  peerPresence?: PresenceStatus | null;
};
type Message = {
  id: string;
  body: string;
  senderId: string;
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  sender: { id: string; fullName: string };
};


function MessagesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConversations = useCallback(async () => {
    const list = await api<Conversation[]>('/chat/conversations');
    const me = getSession()?.user.id;
    for (const c of list) {
      const peerId = c.userAId === me ? c.userBId : c.userAId;
      seedPresence(peerId, c.peerPresence);
    }
    setConversations(list);
    return list;
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const msgs = await api<Message[]>(`/chat/conversations/${id}/messages`);
    setMessages(msgs);
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setSession(s);

    (async () => {
      try {
        // Support deep-link: /messages?peer=<userId>&job=<jobPostId>
        const peer = params.get('peer');
        let list = await loadConversations();
        if (peer) {
          try {
            const conv = await api<Conversation>('/chat/conversations', {
              method: 'POST',
              body: JSON.stringify({
                peerUserId: peer,
                jobPostId: params.get('job') || undefined,
              }),
            });
            list = await loadConversations();
            setActiveId(conv.id);
            await loadMessages(conv.id);
            return;
          } catch (err) {
            setError(err instanceof Error ? err.message : t('ui.cannotStartConversation'));
          }
        }
        if (list.length > 0) {
          setActiveId(list[0].id);
          await loadMessages(list[0].id);
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light polling keeps the thread fresh without websockets on this page
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (activeId) {
      pollRef.current = setInterval(() => {
        loadMessages(activeId).catch(() => undefined);
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    await loadMessages(id);
  }

  const livePresence = usePresence(
    conversations.map((c) => (c.userAId === session?.user.id ? c.userBId : c.userAId)),
  );

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !activeId) return;
    const body = draft.trim();
    setDraft('');
    try {
      const msg = await api<Message>(`/chat/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setMessages((prev) => [...prev, msg]);
      loadConversations().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ui.messageSendFailed'));
      setDraft(body);
    }
  }

  if (!session) return null;

  const peerOf = (c: Conversation): Peer => (c.userAId === session.user.id ? c.userB : c.userA);
  const active = conversations.find((c) => c.id === activeId) || null;
  const presenceOf = (c: Conversation): PresenceStatus | null =>
    livePresence[peerOf(c).id] ?? c.peerPresence ?? null;

  return (
    <div className="shell" style={{ padding: '2rem 1.5rem' }}>
      <h1 style={{ marginBottom: '1.25rem', color: 'var(--text)' }}>{t('messages')}</h1>
      {error && (
        <div className="card" style={{ borderColor: '#f43f5e', color: '#be123c', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      <div className="chat-layout">
        <aside className="chat-sidebar">
          {conversations.length === 0 && (
            <div className="chat-empty">{t('noConversations')}</div>
          )}
          {conversations.map((c) => {
            const peer = peerOf(c);
            const last = c.messages[0];
            return (
              <button
                key={c.id}
                type="button"
                className={`chat-conv${c.id === activeId ? ' active' : ''}`}
                onClick={() => openConversation(c.id)}
              >
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  {peer.fullName}
                  <PresenceDot status={presenceOf(c)} />
                </strong>
                <span className="preview">{last ? last.body : '-'}</span>
              </button>
            );
          })}
        </aside>

        <section className="chat-panel">
          {!active ? (
            <div className="chat-empty">{t('noConversations')}</div>
          ) : (
            <>
              <div className="chat-header">
                {peerOf(active).fullName}
                <span style={{ marginLeft: '0.55rem' }}>
                  <PresenceDot status={presenceOf(active)} showLabel />
                </span>
                {active.isColdOutreach && (
                  <span className="chip" style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>
                    {t('ui.coldOutreach')}
                  </span>
                )}
              </div>
              <div className="chat-thread">
                {messages.map((m) => {
                  const mine = m.senderId === session.user.id;
                  const receipt = mine
                    ? m.readAt
                      ? t('read')
                      : m.deliveredAt
                        ? t('delivered')
                        : t('sent')
                    : null;
                  return (
                    <div key={m.id} className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                      {m.body}
                      <div className="time">
                        <span>{new Date(m.createdAt).toLocaleString()}</span>
                        {receipt && (
                          <span
                            className={`chat-receipt${m.readAt ? ' read' : m.deliveredAt ? ' delivered' : ''}`}
                            aria-label={receipt}
                          >
                            {receipt}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <form className="chat-compose" onSubmit={send}>
                <label className="sr-only" htmlFor="chat-message-input">
                  {t('messageInput')}
                </label>
                <input
                  id="chat-message-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('writeMessage')}
                  aria-label={t('messageInput')}
                  autoComplete="off"
                />
                <button type="submit" disabled={!draft.trim()} aria-label={t('send')}>
                  {t('send')}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInner />
    </Suspense>
  );
}
