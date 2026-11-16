'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { postOnce } from '@/lib/hr-benefits';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { MessageBody } from '@/components/employee/MessageBody';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { CandidateMessageDialog, candidateDeliveryLabel } from './CandidateMessageDialog';
import { candidateInitials, localDateKey, ReviewError, reviewDate, reviewTime, useReviewCopy } from './candidate-review-view';
import shared from './CandidateWorkspace.module.css';
import s from './CandidateReview.module.css';

type Contact = {
  state: 'AVAILABLE' | 'NEEDS_JOB' | 'CONFIDENTIAL' | 'UNAVAILABLE';
  whatsapp: string | null; telegram: string | null; conversationId: string | null; peerUserId: string | null;
};
type Delivery = {
  id: string; subject: string; body: string; emailStatus: string; messageStatus: string;
  messageId?: string | null; error: string | null; createdAt: string;
};
type Chat = { id: string; body: string; senderId: string; createdAt: string };

function WhatsAppMark() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none">
    <path d="M20.8 11.7a8.8 8.8 0 0 1-13 7.8l-4.6 1.1 1.1-4.5a8.8 8.8 0 1 1 16.5-4.4Z" stroke="#079d59" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M8.7 7.2c-.6 0-1.3.7-1.3 1.8 0 2.8 3.6 6.5 6.5 6.5 1 0 1.8-.7 1.8-1.3 0-.3-.2-.5-.5-.6l-1.8-.9c-.3-.1-.5 0-.7.2l-.6.7a6 6 0 0 1-2.8-2.7l.7-.8c.2-.2.3-.5.1-.7l-.8-1.8c-.1-.3-.3-.4-.6-.4Z" fill="#079d59" />
  </svg>;
}
function TelegramMark() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="#159cd8">
    <path d="M2.9 10.6 21 3.6c.9-.4 1.4.2 1.2 1.1l-3 14.4c-.2.9-.8 1.1-1.5.6l-4.6-3.4-2.2 2.2c-.3.3-.6.3-.7-.2l-.7-4.5 8.6-7.5c.4-.3 0-.4-.3-.2l-10.7 6.7-4.3-1.4c-.8-.3-.8-.6.1-.8Z" />
  </svg>;
}

export function CandidateMessages({ candidateId, candidateName, companyId, jobId, email, onChanged }: {
  candidateId: string; candidateName: string; companyId: string; jobId: string | null; email: string | null; onChanged: () => void;
}) {
  const c = useReviewCopy();
  const locale = c('id-ID', 'en-US');
  const [contact, setContact] = useState<Contact>();
  const [messages, setMessages] = useState<Chat[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [queued, setQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState(false);
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const lock = useRef(false);
  const requestKey = useRef('');
  const sequence = useRef(0);
  const thread = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const candidatePath = '/recruitment/candidates/' + encodeURIComponent(candidateId);
  const session = getSession();
  const self = session?.user.id;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current;
    try {
      const [channels, rows] = await Promise.allSettled([
        api<Contact>(candidatePath + '/contact-channels', { cacheMode: 'no-store', signal }),
        api<Delivery[]>(candidatePath + '/messages', { cacheMode: 'no-store', signal }),
      ]);
      if (signal?.aborted || request !== sequence.current) return;
      if (rows.status === 'fulfilled') setDeliveries(rows.value);
      if (channels.status === 'rejected') {
        setContact(undefined);
        setMessages([]);
        throw channels.reason;
      }
      setContact(channels.value);
      const latest = channels.value.conversationId ? await api<Chat[]>(
        '/chat/conversations/' + encodeURIComponent(channels.value.conversationId) + '/messages', { cacheMode: 'no-store', signal },
      ) : [];
      if (!signal?.aborted && request === sequence.current) { setMessages(latest); setReadError(''); }
      if (rows.status === 'rejected') throw rows.reason;
    } catch (reason) {
      if (!signal?.aborted && request === sequence.current) setReadError(reason instanceof Error ? reason.message : 'Pesan belum dapat dimuat.');
    } finally {
      if (!signal?.aborted && request === sequence.current) setLoaded(true);
    }
  }, [candidatePath]);
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal);
    return () => { abort.abort(); sequence.current += 1; };
  }, [refresh]);
  useLiveRefresh('chat', refresh, Boolean(contact?.state === 'AVAILABLE'), candidateId);
  const pendingDelivery = deliveries.some(row => ['PENDING', 'SENDING'].includes(row.emailStatus) || row.messageStatus === 'PENDING');
  useEffect(() => {
    if (!pendingDelivery) return;
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [pendingDelivery, deliveries, refresh]);
  useEffect(() => {
    if (stickToBottom.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, deliveries]);

  const canSend = contact?.state === 'AVAILABLE' && Boolean(jobId && (contact.conversationId || contact.peerUserId || email));
  const missingNumber = contact?.state === 'CONFIDENTIAL'
    ? c('Pindahkan kandidat ke tahap Wawancara sebelum menghubunginya.', 'Move the candidate to the interview stage before contacting them.')
    : contact?.state === 'UNAVAILABLE' ? c('Kandidat sudah tidak dapat dihubungi.', 'The candidate can no longer be contacted.')
    : contact?.state === 'NEEDS_JOB' ? c('Tambahkan CV ke lowongan untuk menghubungi kandidat.', 'Add the CV to a job before contacting the candidate.')
    : c('Nomor kontak internasional kandidat belum tersedia.', 'The candidate has no international contact number.');
  const messageIds = new Set(messages.map(row => row.id));
  const rows = [
    ...messages.map(row => ({ ...row, own: row.senderId === self, delivery: null as Delivery | null })),
    ...deliveries.filter(row => !row.messageId || !messageIds.has(row.messageId))
      .map(row => ({ id: 'delivery:' + row.id, body: row.body, createdAt: row.createdAt, own: true, delivery: row })),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  async function operate(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    try { await task(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : c('Permintaan belum berhasil.', 'The request could not be completed.')); }
    finally { lock.current = false; setBusy(false); }
  }
  function send() {
    const body = draft.trim();
    if (!contact || !canSend || !body) return;
    void operate(async () => {
      let conversationId = contact.conversationId;
      if (!conversationId && contact.peerUserId && session?.user.role === 'RECRUITER') {
        const conversation = await api<{ id: string }>('/chat/conversations', {
          method: 'POST', body: JSON.stringify({ peerUserId: contact.peerUserId, jobPostId: jobId }),
        });
        conversationId = conversation.id;
        setContact(current => current && { ...current, conversationId });
      }
      if (conversationId) {
        const item = await postOnce<Chat>('/chat/conversations/' + encodeURIComponent(conversationId) + '/messages', { body });
        setMessages(current => current.some(row => row.id === item.id) ? current : [...current, item]);
      } else {
        requestKey.current ||= crypto.randomUUID();
        await api('/recruitment/messages', {
          method: 'POST', body: JSON.stringify({ companyId, selection: { ids: [candidateId] }, requestKey: requestKey.current,
            subject: c('Pesan rekrutmen', 'Recruitment message'), body, channels: { email: false, talentio: true } }),
        });
        setQueued(true);
      }
      requestKey.current = '';
      stickToBottom.current = true;
      setDraft('');
      await refresh();
      onChanged();
    });
  }

  return <section className={s.card + ' ' + s.messageCard}>
    <h2>{c('Pesan', 'Messages')}</h2>
    <div className={s.messageContent}>
      {readError && <ReviewError retry={() => void refresh()}>{readError}</ReviewError>}
      <div className={s.messageThread} role="log" aria-label={c('Percakapan Talentio', 'Talentio conversation')} aria-busy={!loaded}
        ref={thread} onScroll={event => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}>
        {!loaded ? <WorkspaceLoading /> : !rows.length && <p className={s.empty}>{c('Belum ada pesan Talentio.', 'There are no Talentio messages yet.')}</p>}
        {rows.map((row, index) => <Fragment key={row.id}>
          {(index === 0 || localDateKey(row.createdAt) !== localDateKey(rows[index - 1].createdAt)) &&
            <div className={s.messageDate}><time dateTime={row.createdAt}>{reviewDate(row.createdAt, locale)}</time></div>}
          <article className={s.bubbleRow} data-own={row.own}>
            {!row.own && <span className={s.messageAvatar} aria-hidden="true">{candidateInitials(candidateName)}</span>}
            <div className={s.bubbleContent}>
              <div className={s.bubble}>{row.delivery && <strong>{row.delivery.subject}</strong>}<MessageBody text={row.body} /></div>
              <small>Talentio &#xb7; {reviewTime(row.createdAt, locale)}
                {row.delivery && ' \u00b7 ' + candidateDeliveryLabel(row.delivery.messageStatus)}</small>
              {row.delivery && row.delivery.emailStatus !== 'SKIPPED' && <small>Email &#xb7; {candidateDeliveryLabel(row.delivery.emailStatus)}</small>}
              {row.delivery?.error && <p className={s.muted}>{row.delivery.error}</p>}
              {row.delivery?.emailStatus === 'UNCERTAIN' && <label className={shared.checkLabel}>
                <input type="checkbox" checked={Boolean(ack[row.delivery.id])} onChange={event => {
                  const id = row.delivery!.id;
                  setAck(state => ({ ...state, [id]: event.target.checked }));
                }} />{c('Saya memahami kemungkinan email ganda.', 'I understand the email may be sent twice.')}
              </label>}
              {row.delivery && (['FAILED', 'UNCERTAIN'].includes(row.delivery.emailStatus) || row.delivery.messageStatus === 'FAILED') &&
                <button type="button" className={s.textAction} disabled={busy || row.delivery.emailStatus === 'UNCERTAIN' && !ack[row.delivery.id]}
                  onClick={() => void operate(async () => {
                    const id = row.delivery!.id;
                    await api('/recruitment/messages/' + encodeURIComponent(id) + '/retry', { method: 'POST', body: JSON.stringify({ acknowledgePossibleDuplicate: Boolean(ack[id]) }) });
                    await refresh();
                  })}>{c('Coba kirim ulang', 'Retry delivery')}</button>}
            </div>
          </article>
        </Fragment>)}
      </div>
      <form className={s.messageCompose} onSubmit={event => { event.preventDefault(); send(); }}>
        <div className={s.channels}>
          <strong>{c('Kanal pengiriman', 'Message channels')}</strong>
          <div className={s.channelChoices}>
            <button type="button" className={s.channel} aria-pressed="true" onClick={() => document.getElementById('candidate-message-draft')?.focus()}>
              <img src="/brand/talentio-mark.png" alt="" />Talentio
            </button>
            {([
              ['WhatsApp', contact?.whatsapp, <WhatsAppMark key="whatsapp" />],
              ['Telegram', contact?.telegram, <TelegramMark key="telegram" />],
            ] as const).map(([name, href, icon]) => href
              ? <a key={name} className={s.channel} href={href} target="_blank" rel="noopener noreferrer"
                aria-label={c('Buka chat ', 'Open chat in ') + name}>{icon}{name}</a>
              : <button key={name} type="button" className={s.channel} disabled title={loaded ? missingNumber : undefined}>{icon}{name}</button>)}
          </div>
        </div>
        {loaded && contact && !contact.whatsapp && !contact.telegram && <p className={s.channelHint}>{missingNumber}</p>}
        <label className="sr-only" htmlFor="candidate-message-draft">{c('Tulis pesan Talentio', 'Write a Talentio message')}</label>
        <textarea id="candidate-message-draft" value={draft} placeholder={c('Tulis pesan\u2026', 'Write a message\u2026')} maxLength={5000}
          rows={2} disabled={!canSend || busy} onChange={event => { requestKey.current = ''; setQueued(false); setDraft(event.target.value); }} />
        {queued && <p className={s.muted} role="status">{c('Pesan masuk antrean Talentio.', 'The message was queued for Talentio.')}</p>}
        {actionError && <ReviewError>{actionError}</ReviewError>}
        <button type="submit" className={s.primary} disabled={busy || !canSend || !draft.trim()}>
          {busy ? c('Mengirim\u2026', 'Sending\u2026') : c('Kirim via Talentio', 'Send via Talentio')}
        </button>
        {jobId && contact?.state === 'AVAILABLE' && <button type="button" className={s.textAction + ' ' + s.deliveryOptions} onClick={() => setCompose(true)}>
          {c('Opsi pesan dan email', 'Message and email options')}
        </button>}
      </form>
    </div>
    {compose && <CandidateMessageDialog companyId={companyId} selection={{ ids: [candidateId] }} count={1} email={email}
      onClose={() => { setCompose(false); void refresh(); }} onQueued={() => { void refresh(); onChanged(); }} />}
  </section>;
}
