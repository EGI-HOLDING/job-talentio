'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { ReviewError, ReviewPill, reviewDate, reviewTime, useReviewCopy } from './candidate-review-view';
import shared from './CandidateWorkspace.module.css';
import s from './CandidateReview.module.css';

type Interview = {
  id: string; scheduledAt: string; durationMins: number; meetingUrl: string | null; location: string | null;
  organizerName?: string | null; note: string | null; status: string; revision: number; nativeOnly?: boolean;
};
type Appointment = { id?: string; revision?: number; at: string; duration: number; url: string; location: string; note: string; email: string };

function meetingProvider(url: string | null) {
  if (!url) return null;
  try {
    const link = new URL(url);
    if (link.protocol !== 'https:' && link.protocol !== 'http:') return null;
    const labels: Record<string, string> = { 'meet.google.com': 'Google Meet', 'teams.microsoft.com': 'Microsoft Teams', 'zoom.us': 'Zoom' };
    return { href: link.href, name: labels[link.hostname] ?? (link.hostname.endsWith('.zoom.us') ? 'Zoom' : link.hostname) };
  } catch { return null; }
}

export function CandidateSchedule({ candidateId, email, onChanged, onApplication }: {
  candidateId: string; email: string | null; onChanged: () => void; onApplication?: () => void;
}) {
  const c = useReviewCopy();
  const locale = c('id-ID', 'en-US');
  const [rows, setRows] = useState<Interview[]>();
  const [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<Appointment>();
  const [cancelItem, setCancelItem] = useState<Interview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const modal = useRef<HTMLDialogElement>(null);
  const cancelModal = useRef<HTMLDialogElement>(null);
  const key = useRef('');
  const lock = useRef(false);
  const path = '/recruitment/candidates/' + encodeURIComponent(candidateId) + '/interviews';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const open = Boolean(edit), confirmCancel = Boolean(cancelItem);

  useEffect(() => {
    const abort = new AbortController();
    void api<Interview[]>(path, { cacheMode: 'no-store', signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setRows(result);
    }).catch(reason => { if (!abort.signal.aborted) setError(reason.message); });
    return () => abort.abort();
  }, [path, revision]);
  useEffect(() => { if (open) modal.current?.showModal(); }, [open]);
  useEffect(() => { if (confirmCancel) cancelModal.current?.showModal(); }, [confirmCancel]);

  const next = rows?.find(row => row.status === 'SCHEDULED' && Date.parse(row.scheduledAt) + row.durationMins * 60_000 > Date.now());
  const history = rows?.filter(row => row.id !== next?.id).slice().sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt)) ?? [];
  const upcoming = next && new Date(next.scheduledAt);
  const nextLink = meetingProvider(next?.meetingUrl ?? null);
  const title = history.some(row => row.status === 'COMPLETED') ? c('Wawancara lanjutan', 'Follow-up interview') : c('Wawancara HR', 'HR interview');

  function start(item?: Interview) {
    const date = item && new Date(item.scheduledAt);
    setEdit({
      id: item?.id, revision: item?.revision,
      at: date ? new Date(+date - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '',
      duration: item?.durationMins ?? 30, url: item?.meetingUrl ?? '', location: item?.location ?? '',
      note: item?.note ?? '', email: email ?? '',
    });
    setError('');
    key.current = '';
  }
  function change(patch: Partial<Appointment>) {
    setEdit(current => current && { ...current, ...patch });
    key.current = '';
    setError('');
  }
  async function act(task: () => Promise<void>, message: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
      setRevision(n => n + 1);
      setNotice(message);
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : c('Jadwal belum berhasil disimpan.', 'The appointment could not be saved.')); }
    finally { lock.current = false; setBusy(false); }
  }
  function save(appointment: Appointment) {
    key.current ||= crypto.randomUUID();
    void act(async () => {
      const scheduledAt = new Date(appointment.at).toISOString();
      const details = { scheduledAt, durationMins: appointment.duration, meetingUrl: appointment.url.trim() || null,
        location: appointment.location.trim() || null, note: appointment.note.trim() || null };
      await api(path + (appointment.id ? '/' + encodeURIComponent(appointment.id) : ''), {
        method: appointment.id ? 'PATCH' : 'POST', body: JSON.stringify(appointment.id
          ? { ...details, revision: appointment.revision, status: 'SCHEDULED' }
          : { ...details, requestKey: key.current, ...(appointment.email.trim() ? { email: appointment.email.trim() } : {}) }),
      });
      setEdit(undefined);
    }, c('Jadwal tersimpan. Pemberitahuan sedang disiapkan.', 'The appointment was saved. The notice is being prepared.'));
  }
  function update(item: Interview, status: 'CANCELLED' | 'COMPLETED') {
    void act(async () => {
      await api(path + '/' + encodeURIComponent(item.id), { method: 'PATCH', body: JSON.stringify({ revision: item.revision, status }) });
      setCancelItem(undefined);
    }, status === 'CANCELLED' ? c('Jadwal dibatalkan.', 'The appointment was cancelled.') : c('Wawancara ditandai selesai.', 'The interview was marked complete.'));
  }
  function statusBadge(item: Interview) {
    return <ReviewPill tone={item.status === 'CANCELLED' ? 'warning' : 'good'} icon={item.status === 'CANCELLED' ? undefined : 'check'}>
      {item.status === 'SCHEDULED' ? c('Terjadwal', 'Scheduled') : item.status === 'CANCELLED' ? c('Dibatalkan', 'Cancelled') : c('Selesai', 'Complete')}
    </ReviewPill>;
  }
  function management(item: Interview) {
    if (item.nativeOnly) return onApplication && <button type="button" className={s.textAction} onClick={onApplication}>
      {c('Kelola melalui detail lamaran', 'Manage in application details')}
    </button>;
    if (item.status !== 'SCHEDULED') return null;
    return <div className={s.rowActions}>
      <button type="button" className={s.textAction} disabled={busy} onClick={() => setCancelItem(item)}>{c('Batalkan', 'Cancel')}</button>
      <button type="button" className={s.textAction} disabled={busy} onClick={() => update(item, 'COMPLETED')}>{c('Tandai selesai', 'Mark complete')}</button>
    </div>;
  }

  return <section className={s.schedule + ' ' + s.stack}>
    <h2 className={s.sectionTitle}>{c('Jadwal', 'Schedule')}</h2>
    {notice && <p role="status" className={s.notice}>{notice}</p>}
    {error && !edit && !cancelItem && <ReviewError retry={() => { setError(''); setRevision(n => n + 1); }}>{error}</ReviewError>}
    {!rows && !error && <WorkspaceLoading />}
    {rows && <section className={s.scheduleHero}>
      <h3>{c('Jadwal terdekat', 'Next appointment')}</h3>
      {next && upcoming ? <>
        <div className={s.scheduleStatus}>{statusBadge(next)}</div>
        <div className={s.dateTile} aria-hidden="true"><WorkspaceIcon kind="calendar" />
          <strong>{upcoming.getDate()}</strong><span>{upcoming.toLocaleDateString(locale, { month: 'short' }).toLocaleUpperCase(locale)}</span>
        </div>
        <div className={s.scheduleInfo}>
          <h4>{title}</h4>
          <time dateTime={next.scheduledAt}><WorkspaceIcon kind="calendar" />{reviewDate(next.scheduledAt, locale)}</time>
          <span><WorkspaceIcon kind="clock" />{reviewTime(next.scheduledAt, locale)}&#x2013;{new Intl.DateTimeFormat(locale, {
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
          }).format(new Date(+upcoming + next.durationMins * 60_000))}</span>
          {(nextLink || next.location) && <span><WorkspaceIcon kind={nextLink ? 'video' : 'building'} />{nextLink?.name ?? next.location}</span>}
          {next.organizerName && <span><WorkspaceIcon kind="user" />{next.organizerName}</span>}
        </div>
        <div className={s.scheduleActions}>
          {next.nativeOnly ? onApplication && <button type="button" className={s.primary} onClick={onApplication}>{c('Ubah jadwal', 'Edit appointment')}</button>
            : <button type="button" className={s.primary} disabled={busy} onClick={() => start(next)}>{c('Ubah jadwal', 'Edit appointment')}</button>}
          {nextLink && <a href={nextLink.href} className={s.textAction} target="_blank" rel="noreferrer"
            aria-label={c('Buka tautan meeting', 'Open meeting link')}>{c('Buka tautan', 'Open link')}<WorkspaceIcon kind="external" /></a>}
        </div>
      </> : <div className={s.scheduleEmpty}>
        <p>{c('Belum ada wawancara yang akan datang.', 'There are no upcoming interviews.')}</p>
        <button type="button" className={s.primary} onClick={() => start()}>{c('Jadwalkan wawancara', 'Schedule an interview')}</button>
      </div>}
    </section>}
    {rows && <section className={s.scheduleHistory}>
      <h3>{c('Riwayat jadwal', 'Appointment history')}</h3>
      {history.length ? history.map(item => <details key={item.id} className={s.appointment}>
        <summary>
          <strong>{c('Wawancara HR', 'HR interview')}</strong>
          <span className={s.appointmentDate}><WorkspaceIcon kind="calendar" />{reviewDate(item.scheduledAt, locale)}
            <span className={s.appointmentDot}>&#xb7;</span><WorkspaceIcon kind="clock" />{reviewTime(item.scheduledAt, locale)}</span>
          {statusBadge(item)}<DirectionalIcon direction="right" size={18} />
        </summary>
        <div className={s.appointmentDetail}>
          {item.location && <p>{item.location}</p>}
          {item.note && <p>{item.note}</p>}
          {meetingProvider(item.meetingUrl) && <a className={s.textAction} href={meetingProvider(item.meetingUrl)?.href} target="_blank" rel="noreferrer">
            {c('Buka tautan meeting', 'Open meeting link')}<WorkspaceIcon kind="external" />
          </a>}
          {item.status === 'SCHEDULED' && !item.nativeOnly && <button type="button" className={s.textAction} disabled={busy} onClick={() => start(item)}>
            {c('Ubah jadwal', 'Edit appointment')}
          </button>}
          {management(item)}
        </div>
      </details>) : <p className={s.muted}>{c('Belum ada riwayat jadwal.', 'There is no appointment history.')}</p>}
    </section>}
    {next && <div className={s.sectionActions}>
      {next.note && <p className={s.muted}>{next.note}</p>}
      {!next.nativeOnly && management(next)}
      <button type="button" className={s.secondary} onClick={() => start()}>{c('Jadwalkan wawancara', 'Schedule an interview')}</button>
    </div>}
    {edit && <dialog ref={modal} className={shared.modal} aria-labelledby="candidate-schedule-title"
      onCancel={event => { if (busy) event.preventDefault(); else setEdit(undefined); }}>
      <form onSubmit={event => { event.preventDefault(); save(edit); }}>
        <header><h2 id="candidate-schedule-title">{edit.id ? c('Ubah jadwal wawancara', 'Edit interview appointment') : c('Jadwalkan wawancara', 'Schedule an interview')}</h2>
          <button type="button" aria-label={c('Tutup jadwal', 'Close appointment')} disabled={busy} onClick={() => setEdit(undefined)}>×</button></header>
        <fieldset disabled={busy} className={shared.messageFields}>
          <div className={shared.formColumns}>
            <label className={shared.field}>{c('Tanggal dan waktu', 'Date and time')}<input type="datetime-local" value={edit.at} required onChange={e => change({ at: e.target.value })} /></label>
            <label className={shared.field}>{c('Durasi (menit)', 'Duration (minutes)')}<input type="number" value={edit.duration} min={5} max={480}
              required onChange={e => change({ duration: Number(e.target.value) })} /></label>
          </div>
          <small className={s.muted}>{c('Zona waktu perangkat', 'Device time zone')} &#xb7; {zone}</small>
          <label className={shared.field}>{c('Tautan meeting', 'Meeting link')}<input type="url" value={edit.url} maxLength={2000}
            placeholder="https://meet.google.com/..." onChange={e => change({ url: e.target.value })} /></label>
          <label className={shared.field}>{c('Lokasi', 'Location')}<input value={edit.location} maxLength={500} onChange={e => change({ location: e.target.value })} /></label>
          <label className={shared.field}>{c('Catatan internal', 'Internal note')}<textarea value={edit.note} rows={3} maxLength={2000} onChange={e => change({ note: e.target.value })} /></label>
          {!edit.id && <label className={shared.field}>{c('Email kandidat', 'Candidate email')}<input type="email" value={edit.email} maxLength={254} onChange={e => change({ email: e.target.value })} /></label>}
        </fieldset>
        {error && <ReviewError>{error}</ReviewError>}
        <footer><button type="button" className={s.secondary} disabled={busy} onClick={() => setEdit(undefined)}>{c('Batal', 'Cancel')}</button>
          <button type="submit" className={s.primary} disabled={busy || !edit.at || !edit.url.trim() && !edit.location.trim()}>
            {busy ? c('Menyimpan\u2026', 'Saving\u2026') : c('Simpan & kirim jadwal', 'Save and send appointment')}
          </button></footer>
      </form>
    </dialog>}
    {cancelItem && <dialog ref={cancelModal} className={shared.modal} aria-labelledby="cancel-candidate-appointment"
      onCancel={event => { if (busy) event.preventDefault(); else setCancelItem(undefined); }}>
      <h2 id="cancel-candidate-appointment">{c('Batalkan jadwal wawancara?', 'Cancel interview appointment?')}</h2>
      <p>{reviewDate(cancelItem.scheduledAt, locale)} &#xb7; {reviewTime(cancelItem.scheduledAt, locale)}</p>
      {error && <ReviewError>{error}</ReviewError>}
      <footer><button type="button" className={s.secondary} disabled={busy} onClick={() => setCancelItem(undefined)}>{c('Kembali', 'Go back')}</button>
        <button type="button" className={s.primary} disabled={busy} onClick={() => update(cancelItem, 'CANCELLED')}>{c('Batalkan jadwal', 'Cancel appointment')}</button></footer>
    </dialog>}
  </section>;
}
