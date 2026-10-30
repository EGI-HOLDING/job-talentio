'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { useSessionIdentity } from '@/lib/useSessionIdentity';
import s from './OfferDocuments.module.css';

type OfferDocument = { id: string; originalName: string; contentType: string; sizeBytes: number; createdAt: string };
type OfferPacket = { id: string; version: number; kind: 'OFFER' | 'POST_HIRE'; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'SHARED'; requiresCandidateDecision: boolean; createdAt: string; respondedAt?: string | null; documents: OfferDocument[] };
function dateLabel(value: string | null | undefined, locale: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function OfferPacketHistory({ applicationId, applicationStatus, audience, candidateDecisionRequired = false, onSendOffer, onDecision }: {
  applicationId: string; applicationStatus: string; audience: 'candidate' | 'hr';
  candidateDecisionRequired?: boolean; onSendOffer?: () => void;
  onDecision?: (status: 'HIRED' | 'WITHDRAWN') => void;
}) {
  const { t, locale } = useI18n();
  const sessionIdentity = useSessionIdentity();
  const confirm = useConfirm();
  const [packets, setPackets] = useState<OfferPacket[]>([]);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState('');
  const request = useRef(0);
  const pending = useRef(false);
  const scopeRef = useRef('');
  const scope = applicationId + ':' + audience + ':' + sessionIdentity;
  const refresh = useCallback(async () => { setRetry(value => value + 1); }, []);
  useLiveRefresh('applications', refresh, !busyId, applicationId + ':' + applicationStatus + ':' + audience);

  useEffect(() => {
    let alive = true;
    const version = ++request.current;
    const actor = sessionIdentity;
    if (scopeRef.current !== scope) { scopeRef.current = scope; setPackets([]); setLoadedScope(''); }
    setLoading(true);
    setError('');
    api<{ packets: OfferPacket[] }>('/applications/' + encodeURIComponent(applicationId) + '/offer-packets', { signal: AbortSignal.timeout(15_000) })
      .then(result => { if (alive && version === request.current && actor === getSession()?.user.id) { setPackets(result.packets); setLoadedScope(scope); } })
      .catch(reason => { if (alive && version === request.current && actor === getSession()?.user.id) { setPackets([]); setLoadedScope(scope); setError(reason instanceof Error && reason.name !== 'TimeoutError' && reason.name !== 'AbortError' ? reason.message : t('offer.loadFailed')); } })
      .finally(() => { if (alive && version === request.current) setLoading(false); });
    return () => { alive = false; };
  }, [applicationId, audience, retry, t, sessionIdentity]);

  async function download(packet: OfferPacket, document: OfferDocument) {
    if (busyId) return;
    const actor = getSession()?.user.id;
    const identity = packet.id + ':' + document.id;
    setBusyId(identity);
    setError('');
    let tab: Window | null = null;
    try { tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null; } catch { /* use current tab if blocked */ }
    try {
      const result = await api<{ url: string }>('/applications/' + encodeURIComponent(applicationId) + '/offer-packets/' + encodeURIComponent(packet.id) + '/documents/' + encodeURIComponent(document.id) + '/download');
      if (actor !== getSession()?.user.id) { tab?.close(); return; }
      if (tab) tab.location.href = result.url; else window.location.assign(result.url);
    } catch (reason) {
      tab?.close();
      if (actor === getSession()?.user.id) setError(reason instanceof Error ? reason.message : t('offer.downloadFailed'));
    } finally { if (actor === getSession()?.user.id) setBusyId(''); }
  }

  async function decide(decision: 'ACCEPT' | 'DECLINE') {
    if (pending.current || applicationStatus !== 'OFFER') return;
    const accepted = decision === 'ACCEPT';
    const approved = await confirm({
      title: t(accepted ? 'offer.acceptTitle' : 'offer.declineTitle'),
      message: t(accepted ? 'offer.acceptBody' : 'offer.declineBody'),
      confirmLabel: t(accepted ? 'offer.acceptConfirm' : 'offer.declineConfirm'),
      tone: accepted ? 'create' : 'danger',
    });
    if (!approved) return;
    pending.current = true;
    setBusyId('decision');
    setError('');
    const actor = getSession()?.user.id;
    try {
      const result = await api<{ application: { status: 'HIRED' | 'WITHDRAWN' }; packet: OfferPacket }>('/applications/' + encodeURIComponent(applicationId) + '/offer-decision', { method: 'POST', body: JSON.stringify({ decision }) });
      if (actor !== getSession()?.user.id) return;
      onDecision?.(result.application.status);
      setPackets(current => current.map(packet => packet.id === result.packet.id ? result.packet : packet));
    } catch (reason) {
      if (actor === getSession()?.user.id) setError(reason instanceof Error ? reason.message : t('offer.decisionFailed'));
    } finally {
      if (actor === getSession()?.user.id) { pending.current = false; setBusyId(''); }
    }
  }

  const scopedPackets = loadedScope === scope ? packets : [];
  const scopedLoading = loading || loadedScope !== scope;
  const offers = scopedPackets.filter(packet => packet.kind === 'OFFER');
  const documents = scopedPackets.filter(packet => packet.kind === 'POST_HIRE');
  const activeOffer = offers.find(packet => packet.requiresCandidateDecision);
  const canSendOfferDocuments = audience === 'hr' && applicationStatus === 'OFFER' && !candidateDecisionRequired && Boolean(onSendOffer);
  if (offers.length === 0 && documents.length === 0 && !scopedLoading && !error && !canSendOfferDocuments) return null;

  return <section className={s.history} aria-labelledby={'offer-heading-' + applicationId}>
    <header className={s.historyHead}><div><span className={s.eyebrow}>{t('offer.candidateDocuments')}</span><h3 id={'offer-heading-' + applicationId}>{t('offer.sectionTitle')}</h3><p>{t(audience === 'candidate' ? 'offer.candidateHint' : 'offer.hrHint')}</p></div><div className={s.historyHeadActions}>{canSendOfferDocuments&&<button type="button" className={s.sendOfferButton} onClick={onSendOffer}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 3.5h7l3 3V16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M12 3.75V7h3M10 9v5m-2.5-2.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>{t('offer.addDocuments')}</button>}<span className={s.historyMark} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 4h7l4 4v11a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 5 19V5.75A1.75 1.75 0 0 1 6.75 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></span></div></header>
    {error && <div className={s.error} role="alert"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>{t('offer.retry')}</button></div>}
    {scopedLoading && <div className={s.loading} aria-live="polite">{t('offer.loading')}</div>}
    {!scopedLoading && <>
      {offers.map(packet => <article className={s.packet} key={packet.id} data-active={packet.id === activeOffer?.id}>
        <div className={s.packetHead}><div><strong>{t('offer.version').replace('{version}', String(packet.version))}</strong><span>{t('offer.sentAt').replace('{date}', dateLabel(packet.createdAt, locale))}</span></div><span className={s.packetStatus} data-status={packet.kind === 'OFFER' && packet.status === 'SHARED' && !packet.documents.length ? 'OUTSIDE_APP' : packet.status}>{t(packet.kind === 'OFFER' && packet.status === 'SHARED' && !packet.documents.length ? 'offer.status.OUTSIDE_APP' : 'offer.status.' + packet.status)}</span></div>
        <DocumentList packet={packet} busyId={busyId} onDownload={download}/>
      </article>)}
      {documents.length > 0 && <div className={s.postHireList}><h4>{t('offer.postHireDocuments')}</h4>{documents.map(packet => <article className={s.packet} key={packet.id}><div className={s.packetHead}><div><strong>{t('offer.sharedAt').replace('{date}', dateLabel(packet.createdAt, locale))}</strong><span>{t('offer.status.SHARED')}</span></div></div><DocumentList packet={packet} busyId={busyId} onDownload={download}/></article>)}</div>}
      {!offers.length && !documents.length && <p className={s.empty}>{t('offer.empty')}</p>}
      {audience === 'candidate' && activeOffer && applicationStatus === 'OFFER' && <div className={s.decisions}><button type="button" className={s.acceptButton} disabled={Boolean(busyId)} onClick={() => void decide('ACCEPT')}>{t(busyId === 'decision' ? 'saving' : 'offer.accept')}</button><button type="button" className={s.declineButton} disabled={Boolean(busyId)} onClick={() => void decide('DECLINE')}>{t('offer.decline')}</button></div>}
      {audience === 'candidate' && applicationStatus === 'HIRED' && offers.some(packet => packet.status === 'ACCEPTED') && <p className={s.outcome} data-tone="success">{t('offer.acceptedOutcome')}</p>}
      {audience === 'candidate' && applicationStatus === 'WITHDRAWN' && offers.some(packet => packet.status === 'DECLINED') && <p className={s.outcome}>{t('offer.declinedOutcome')}</p>}
    </>}
  </section>;
}

function DocumentList({ packet, busyId, onDownload }: { packet: OfferPacket; busyId: string; onDownload: (packet: OfferPacket, document: OfferDocument) => void }) {
  const { t, locale } = useI18n();
  if (!packet.documents.length) return <p className={s.empty}>{packet.kind === 'OFFER' && packet.status === 'SHARED' ? t('offer.externalDetails') : t('offer.noDocumentsInPacket')}</p>;
  return <ul className={s.documentList}>{packet.documents.map(document => {
    const key = packet.id + ':' + document.id;
    const extension = document.originalName.split('.').pop()?.toUpperCase() || 'FILE';
    return <li key={document.id} className={s.documentRow}><span className={s.fileType} aria-hidden="true">{extension}</span><div className={s.documentInfo}><strong title={document.originalName}>{document.originalName}</strong><span>{(document.sizeBytes / 1024 / 1024).toFixed(2)} MB | {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(document.createdAt))}</span></div><button type="button" className={s.downloadButton} disabled={Boolean(busyId)} onClick={() => onDownload(packet, document)}>{t(busyId === key ? 'offer.downloading' : 'offer.download')}</button></li>;
  })}</ul>;
}
