'use client';

import { useEffect, useRef, useState } from 'react';
import { assessmentCopy } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { active, coverage, evaluatedInterviewScore, number, status, type Invitation } from './screening-view';
import { candidateDeliveryLabel } from './CandidateMessageDialog';
import type { CandidateDetail } from './CandidateReview';
import type { ReviewReport } from './candidate-review-route';
import { ReviewCharacter, ReviewError, ReviewPill, reviewDate, useReviewCopy } from './candidate-review-view';
import shared from './CandidateWorkspace.module.css';
import s from './CandidateReview.module.css';

export function CandidateScreening({ data, onChanged, reportHref }: {
  data: CandidateDetail; onChanged: () => void; reportHref: (report: ReviewReport) => string;
}) {
  const c = useReviewCopy();
  const locale = c('id-ID', 'en-US');
  const [items, setItems] = useState<Invitation[]>();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [cancelId, setCancelId] = useState('');
  const [mode, setMode] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [recipient, setRecipient] = useState(data.email ?? '');
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const invite = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLDialogElement>(null);
  const requestKey = useRef('');
  const lock = useRef(false);
  const base = '/recruitment/candidates/' + encodeURIComponent(data.id) + '/invitations';
  const invitations = items ?? [];
  const pending = invitations.filter(active);
  const closed = ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(data.stage);
  const inviteReason = closed ? c('Proses rekrutmen kandidat sudah ditutup.', 'Recruitment for this candidate is closed.')
    : data.cvMethodologyUpgradeAvailable ? c('Nilai CV dengan rubrik terbaru sebelum mengundang.', 'Assess the CV with the latest rubric before inviting.')
    : data.scoreStatus !== 'READY' ? c('Selesaikan penilaian CV sebelum mengundang.', 'Complete the CV assessment before inviting.') : '';

  useEffect(() => {
    const abort = new AbortController();
    void api<Invitation[]>(base, { cacheMode: 'no-store', signal: abort.signal }).then(rows => {
      if (!abort.signal.aborted) { setItems(rows); setListError(''); }
    }).catch(reason => { if (!abort.signal.aborted) setListError(reason.message); });
    return () => abort.abort();
  }, [base, revision]);
  const needsUpdate = invitations.some(row => active(row) || ['PENDING', 'SENDING'].includes(row.emailStatus) ||
    row.status === 'COMPLETED' && (!row.session?.evaluation || ['PENDING', 'RUNNING'].includes(row.session.evaluation.status)));
  useEffect(() => {
    if (!needsUpdate) return;
    const timer = setInterval(() => { if (!document.hidden && !lock.current) setRevision(value => value + 1); }, 6000);
    return () => clearInterval(timer);
  }, [needsUpdate]);
  useEffect(() => { if (open) invite.current?.showModal(); }, [open]);
  useEffect(() => { if (cancelId) cancel.current?.showModal(); }, [cancelId]);

  const label = (value: Invitation['mode']) => value === 'VOICE' ? c('Wawancara Live', 'Live interview') : c('Wawancara Chat', 'Chat interview');
  const dateOf = (row: Invitation) => row.session?.completedAt ?? row.session?.startedAt ?? row.createdAt;
  const native = data.application?.screeningSession;
  const nativeDate = native?.completedAt ?? data.createdAt;
  const evaluated = [...invitations].filter(row => Boolean(row.session?.startedAt || row.session?.completedAt) ||
    ['COMPLETED', 'INTERRUPTED'].includes(row.status)).sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a)));
  const latest = evaluated[0];
  const showNative = Boolean(native && (!latest || Date.parse(nativeDate) > Date.parse(dateOf(latest))));
  const current = showNative ? undefined : latest;
  const evaluation = showNative ? native?.evaluation : current?.session?.evaluation;
  const { value, final } = evaluatedInterviewScore(evaluation);
  const language = evaluation?.result ? evaluation.result.assessmentLanguage : current?.assessmentLanguage;
  const scoreCopy = (id: string, en: string) => language ? language === 'en' ? en : id : c(id, en);
  const cover = current ? coverage(current) : evaluation?.result?.roleAssessment
    ? { tested: evaluation.result.roleAssessment.coverage.assessed, total: evaluation.result.roleAssessment.coverage.total, unit: 'kompetensi' }
    : null;
  const hasSession = Boolean(current || showNative);
  const history = invitations.filter(row => row.id !== current?.id && !active(row));
  const showNativeInHistory = Boolean(native && !showNative);
  const historyCount = history.length + Number(showNativeInHistory);
  const historyRows = [
    ...history.map(row => ({ key: row.id, title: label(row.mode), date: dateOf(row), value: row,
      href: reportHref({ kind: 'interview', invitationId: row.id }), icon: row.mode === 'VOICE' ? 'mic' : 'message' })),
    ...(showNativeInHistory ? [{ key: 'native', title: label('TEXT'), date: nativeDate, value: null,
      href: reportHref({ kind: 'application' }), icon: 'message' }] : []),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice((page - 1) * 10, page * 10);

  function sessionStatus(row?: Invitation | null) {
    const state = row ? status(row) : native?.evaluation?.result ? 'Hasil tersedia' : 'Menilai hasil';
    const good = state === 'Hasil tersedia';
    return <ReviewPill tone={good ? 'good' : 'warning'} icon={good ? 'check' : undefined}>
      {good ? c('Selesai', 'Complete') : assessmentCopy(locale === 'en-US' ? 'en' : 'id', state)}
    </ReviewPill>;
  }

  async function action(fn: () => Promise<unknown>, message: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      setNotice(message);
      setRevision(value => value + 1);
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : c('Permintaan belum berhasil.', 'The request could not be completed.')); }
    finally { lock.current = false; setBusy(false); }
  }

  function send() {
    if (inviteReason) return;
    requestKey.current ||= crypto.randomUUID();
    void action(async () => {
      await api(base, { method: 'POST', body: JSON.stringify({ mode, email: recipient.trim(), requestKey: requestKey.current }) });
      setOpen(false);
      requestKey.current = '';
    }, c('Undangan sedang disiapkan melalui email dan Pesan Talentio.', 'The invitation is being prepared for email and Talentio.'));
  }

  function retryControls(row: Invitation) {
    const path = '/recruitment/invitations/' + encodeURIComponent(row.id);
    const evaluation = row.session?.evaluation;
    const completion = row.session?.completion;
    return <div className={s.rowActions}>
      {(evaluation?.status === 'FAILED' || completion?.status === 'REVIEW_REQUIRED' && completion.canRetry) &&
        <button type="button" className={s.textAction} disabled={busy} onClick={() => void action(
          () => api(path + '/retry-evaluation', { method: 'POST', body: '{}' }),
          c('Hasil interview sedang diproses ulang.', 'The interview outcome is being recovered.'))}>
          {c('Coba proses hasil lagi', 'Retry assessment')}
        </button>}
      {!row.closedByStage && !closed && ['FAILED', 'UNCERTAIN'].includes(row.emailStatus) &&
        row.status !== 'CANCELLED' && Date.parse(row.expiresAt) > Date.now() && <>
          {row.emailStatus === 'UNCERTAIN' && <label className={shared.checkLabel}>
            <input type="checkbox" checked={Boolean(ack[row.id])} onChange={event => setAck(state => ({ ...state, [row.id]: event.target.checked }))} />
            {c('Saya memahami kemungkinan email ganda.', 'I understand the email may be sent twice.')}
          </label>}
          <button type="button" className={s.textAction} disabled={busy || row.emailStatus === 'UNCERTAIN' && !ack[row.id]} onClick={() =>
            void action(() => api(path + '/retry-delivery', { method: 'POST', body: JSON.stringify({ acknowledgePossibleDuplicate: Boolean(ack[row.id]) }) }),
              c('Pengiriman undangan sedang diperiksa ulang.', 'Invitation delivery is being retried.'))}>
            {c('Coba kirim lagi', 'Retry delivery')}
          </button>
        </>}
    </div>;
  }

  return <div className={s.stack}>
    {listError && <ReviewError retry={() => { setListError(''); setRevision(n => n + 1); }}>{listError}</ReviewError>}
    {error && !open && <ReviewError>{error}</ReviewError>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {!items ? listError ? null : <WorkspaceLoading /> : <>
      <section className={s.screeningHero}>
        <ReviewCharacter character="tara" working={!hasSession && pending.length > 0} />
        <div className={s.screeningIntro}>
          <h2>{c('Wawancara terbaru', 'Latest interview')}</h2>
          {hasSession ? <>
            <h3>{label(current?.mode ?? 'TEXT')}</h3>
            <div className={s.screeningMetadata}><time dateTime={current ? dateOf(current) : nativeDate}><WorkspaceIcon kind="calendar" />
              {reviewDate(current ? dateOf(current) : nativeDate, locale)}</time>{sessionStatus(current)}</div>
          </> : <p>{c('Belum ada wawancara Tara.', 'There is no Tara interview yet.')}</p>}
        </div>
        {hasSession && <div className={s.screeningEvaluation}>
          <div className={s.evaluationScore}>
            <ReviewCharacter character="taka" compact />
            <div><strong>{scoreCopy('Dinilai Taka', 'Assessed by Taka')}</strong>
              {value !== null && <span className={s.score} data-has-score>{number(value, language)}<small>/100</small></span>}
              <span className={s.muted}>{value === null ? scoreCopy('Skor belum tersedia', 'Score unavailable')
                : final ? scoreCopy('Skor akhir', 'Final score') : scoreCopy('Dukungan klaim CV', 'CV claim assessment')}</span>
            </div>
          </div>
          {cover && <p className={s.screeningCoverage}>
            {language === 'en' ? cover.tested + ' of ' + cover.total + (cover.unit ? ' competencies assessed' : ' claims assessed')
              : cover.tested + ' dari ' + cover.total + ' ' + (cover.unit ?? 'klaim') + ' dinilai'}
          </p>}
        </div>}
        <div className={s.heroActions}>
          {hasSession
            ? <Link href={reportHref(current ? { kind: 'interview', invitationId: current.id } : { kind: 'application' })} className={s.primary}>
              {c('Buka hasil wawancara', 'Open interview report')}<WorkspaceIcon kind="arrowForward" />
            </Link>
            : <button type="button" className={s.primary} disabled={busy || Boolean(inviteReason)} onClick={() => { setError(''); setRecipient(data.email ?? ''); setOpen(true); }}>
              {c('Undang screening', 'Invite to screening')}
            </button>}
        </div>
      </section>
      {current && retryControls(current)}
      {pending.length > 0 && <section className={s.card + ' ' + s.history}>
        <h2>{c('Undangan aktif', 'Active invitations')}</h2>
        {pending.map(row => <article className={s.invitation} key={row.id}>
          <div><strong>{label(row.mode)}</strong><p>{row.recipientEmail}</p><p>{status(row)} &#xb7; {reviewDate(row.session?.completion?.resumeUntil ?? row.expiresAt, locale)}</p></div>
          <div className={s.delivery}><span>Email &#xb7; {candidateDeliveryLabel(row.emailStatus)}</span><span>Talentio &#xb7; {candidateDeliveryLabel(row.messageStatus)}</span></div>
          <div>
            {row.status === 'INVITED' && !row.session?.startedAt && <button type="button" className={s.secondary} disabled={busy}
              onClick={() => setCancelId(row.id)}>{c('Batalkan undangan', 'Cancel invitation')}</button>}
            {retryControls(row)}
          </div>
        </article>)}
      </section>}
      <section className={s.card + ' ' + s.history}>
        <h2>{c('Riwayat sesi', 'Session history')}</h2>
        {historyRows.length ? historyRows.map(row => <div key={row.key} className={s.historyEntry}>
          <Link href={row.href} className={s.sessionRow}>
            <span className={s.sessionIcon}><WorkspaceIcon kind={row.icon} /></span>
            <strong>{row.title}</strong><time dateTime={row.date}><WorkspaceIcon kind="calendar" />{reviewDate(row.date, locale)}</time>
            {sessionStatus(row.value)}<DirectionalIcon direction="right" size={19} />
          </Link>
          {row.value && retryControls(row.value)}
        </div>) : <p className={s.muted}>{c('Belum ada sesi sebelumnya.', 'There are no earlier sessions.')}</p>}
        {historyCount > 10 && <nav className={s.historyPagination} aria-label={c('Halaman riwayat sesi', 'Session history pages')}>
          <button className={s.square} type="button" disabled={page === 1} onClick={() => setPage(n => n - 1)} aria-label={c('Sebelumnya', 'Previous')}><DirectionalIcon direction="left" /></button>
          <span>{page} / {Math.ceil(historyCount / 10)}</span>
          <button className={s.square} type="button" disabled={page * 10 >= historyCount} onClick={() => setPage(n => n + 1)} aria-label={c('Berikutnya', 'Next')}><DirectionalIcon direction="right" /></button>
        </nav>}
      </section>
      {hasSession && <div className={s.sectionActions}><button type="button" className={s.secondary} disabled={busy || Boolean(inviteReason)}
        onClick={() => { setError(''); setRecipient(data.email ?? ''); setOpen(true); }}>{c('Undang screening', 'Invite to screening')}</button></div>}
      {inviteReason && <p className={s.muted}>{inviteReason}</p>}
    </>}
    {open && <dialog className={shared.modal} ref={invite} aria-labelledby="candidate-screening-invite"
      onCancel={event => { if (busy) event.preventDefault(); else setOpen(false); }}>
      <form onSubmit={event => { event.preventDefault(); send(); }}>
        <header><h2 id="candidate-screening-invite">{c('Undang screening bersama Tara', 'Invite to screening with Tara')}</h2>
          <button type="button" disabled={busy} aria-label={c('Tutup undangan', 'Close invitation')} onClick={() => setOpen(false)}>×</button></header>
        <p>{c('Undangan dikirim melalui email dan Pesan Talentio.', 'The invitation is delivered by email and Talentio.')}</p>
        <fieldset className={shared.modeOptions} disabled={busy}>
          <legend>{c('Jenis interview', 'Interview type')}</legend>
          {(['TEXT', 'VOICE'] as const).map(value => <label key={value}>
            <input type="radio" name="screening-mode" checked={value === mode} onChange={() => { setMode(value); requestKey.current = ''; }} />
            <span><strong>{label(value)}</strong><small>{value === 'TEXT' ? c('1 menit per pertanyaan', '1 minute per question') : c('Maksimal 15 menit aktif', 'Up to 15 active minutes')}</small></span>
          </label>)}
        </fieldset>
        {data.interviewTopicCount != null && <p>{c('Jumlah topik pada agenda', 'Topics in the agenda')} &#xb7; {data.interviewTopicCount}</p>}
        <label className={shared.field}>{c('Email kandidat', 'Candidate email')}<input type="email" value={recipient} required maxLength={254} disabled={busy}
          onChange={event => { setRecipient(event.target.value); requestKey.current = ''; }} /></label>
        {error && <ReviewError>{error}</ReviewError>}
        <footer><button type="button" className={s.secondary} disabled={busy} onClick={() => setOpen(false)}>{c('Batal', 'Cancel')}</button>
          <button type="submit" className={s.primary} disabled={busy || !recipient.trim()}>{c('Kirim undangan', 'Send invitation')}</button></footer>
      </form>
    </dialog>}
    {cancelId && <dialog className={shared.modal} ref={cancel} aria-labelledby="candidate-screening-cancel"
      onCancel={event => { if (busy) event.preventDefault(); else setCancelId(''); }}>
      <h2 id="candidate-screening-cancel">{c('Batalkan undangan?', 'Cancel this invitation?')}</h2>
      <p>{c('Kandidat tidak dapat memulai sesi dari undangan ini. Riwayat tetap tersimpan.', 'The candidate cannot start a session from this invitation. The history will still be available.')}</p>
      <footer><button type="button" className={s.secondary} disabled={busy} onClick={() => setCancelId('')}>{c('Kembali', 'Go back')}</button>
        <button type="button" className={s.primary} disabled={busy} onClick={() => void action(async () => {
          await api('/recruitment/invitations/' + encodeURIComponent(cancelId) + '/cancel', { method: 'POST', body: '{}' });
          setCancelId('');
        }, c('Undangan dibatalkan.', 'The invitation was cancelled.'))}>{c('Batalkan undangan', 'Cancel invitation')}</button></footer>
    </dialog>}
  </div>;
}
