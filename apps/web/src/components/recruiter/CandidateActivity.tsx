'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import type { CandidateActivityRow, CandidateDetail } from './CandidateReview';
import type { Invitation } from './screening-view';
import { localDateKey, ReviewError, reviewDate, reviewTime, useReviewCopy } from './candidate-review-view';
import s from './CandidateReview.module.css';

const descriptions: Record<string, { title: [string, string]; icon: string; category: string }> = {
  APPLICATION_RECEIVED: { title: ['Lamaran diterima', 'Application received'], icon: 'check', category: 'application' },
  CV_RECEIVED: { title: ['CV diterima', 'CV received'], icon: 'file', category: 'assessment' },
  CV_SCORING_STARTED: { title: ['Penilaian CV dimulai', 'CV assessment started'], icon: 'file', category: 'assessment' },
  CV_ANALYZED: { title: ['Taka menyelesaikan ulasan CV', 'Taka completed the CV review'], icon: 'file', category: 'assessment' },
  CV_UNREADABLE: { title: ['CV memerlukan pemeriksaan', 'The CV needs review'], icon: 'warning', category: 'assessment' },
  CV_CRITERIA_CHANGED: { title: ['Kriteria penilaian CV diperbarui', 'CV assessment criteria changed'], icon: 'file', category: 'assessment' },
  CV_RETRY: { title: ['Penilaian CV diproses ulang', 'CV assessment restarted'], icon: 'file', category: 'assessment' },
  CV_ADDED_TO_JOB: { title: ['CV ditambahkan ke lowongan', 'CV added to the job'], icon: 'file', category: 'application' },
  STAGE_CHANGED: { title: ['Tahap kandidat diperbarui', 'Candidate stage updated'], icon: 'check', category: 'application' },
  HR_ASSIGNED: { title: ['Penanggung jawab diperbarui', 'Recruiter assignment updated'], icon: 'user', category: 'application' },
  SCREENING_INVITED: { title: ['Undangan wawancara Tara dibuat', 'Tara interview invitation created'], icon: 'mic', category: 'assessment' },
  SCREENING_LIVE_COMPLETED: { title: ['Wawancara Live bersama Tara selesai', 'The live Tara interview ended'], icon: 'video', category: 'assessment' },
  SCREENING_CHAT_COMPLETED: { title: ['Wawancara Chat bersama Tara selesai', 'The Tara chat interview ended'], icon: 'message', category: 'assessment' },
  INTERVIEW_SCHEDULED: { title: ['Wawancara dijadwalkan', 'Interview scheduled'], icon: 'calendar', category: 'schedule' },
  INTERVIEW_RESCHEDULED: { title: ['Jadwal wawancara diubah', 'Interview rescheduled'], icon: 'calendar', category: 'schedule' },
  INTERVIEW_COMPLETED: { title: ['Wawancara ditandai selesai', 'Interview marked complete'], icon: 'check', category: 'schedule' },
  INTERVIEW_CANCELLED: { title: ['Jadwal wawancara dibatalkan', 'Interview cancelled'], icon: 'calendar', category: 'schedule' },
  MESSAGE_QUEUED: { title: ['Pesan kandidat masuk antrean', 'A candidate message was queued'], icon: 'message', category: 'messages' },
};

export function CandidateActivity({ data }: { data: CandidateDetail }) {
  const c = useReviewCopy();
  const locale = c('id-ID', 'en-US');
  const [filter, setFilter] = useState('all');
  const [completions, setCompletions] = useState<CandidateActivityRow[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!data.jobId) return;
    const abort = new AbortController();
    setError('');
    void api<Invitation[]>('/recruitment/candidates/' + encodeURIComponent(data.id) + '/invitations',
      { cacheMode: 'no-store', signal: abort.signal }).then(rows => {
        if (!abort.signal.aborted) setCompletions(rows.flatMap(row => {
          const completedAt = row.session?.completedAt;
          if (!completedAt || row.status !== 'COMPLETED' || row.session?.completion && row.session.completion.status !== 'COMPLETE') return [];
          return [{ id: 'completed:' + row.id, kind: row.mode === 'VOICE' ? 'SCREENING_LIVE_COMPLETED' : 'SCREENING_CHAT_COMPLETED', createdAt: completedAt }];
        }));
      }).catch(reason => { if (!abort.signal.aborted) setError(reason.message); });
    return () => abort.abort();
  }, [data.id, data.jobId, revision]);
  const native = data.application?.screeningSession;
  const rows = [...(data.activities ?? []), ...completions];
  if (native?.status === 'COMPLETED' && native.completedAt) rows.push({
    id: 'native:' + native.id, kind: 'SCREENING_CHAT_COMPLETED', createdAt: native.completedAt,
  });
  const groups = new Map<string, CandidateActivityRow[]>();
  for (const item of rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    if (filter !== 'all' && descriptions[item.kind]?.category !== filter) continue;
    const key = localDateKey(item.createdAt);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return <section className={s.card + ' ' + s.activityCard}>
    <header className={s.activityHeader}>
      <h2>{c('Aktivitas kandidat', 'Candidate activity')}</h2>
      <select aria-label={c('Filter aktivitas', 'Filter activity')} value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">{c('Semua aktivitas', 'All activity')}</option>
        <option value="assessment">{c('CV & screening', 'CV & screening')}</option>
        <option value="application">{c('Lamaran', 'Application')}</option>
        <option value="schedule">{c('Jadwal', 'Schedule')}</option>
        <option value="messages">{c('Pesan', 'Messages')}</option>
      </select>
    </header>
    {error && <ReviewError retry={() => setRevision(n => n + 1)}>{error}</ReviewError>}
    {!groups.size && <p className={s.empty}>{c('Belum ada aktivitas untuk ditampilkan.', 'There is no activity to display.')}</p>}
    {[...groups].map(([day, items]) => <section className={s.activityDay} key={day}>
      <h3><time dateTime={items[0].createdAt}>{reviewDate(items[0].createdAt, locale)}</time></h3>
      <ol>{items.map(item => {
        const description = descriptions[item.kind];
        return <li key={item.id}>
          <span className={s.activityIcon}><WorkspaceIcon kind={description?.icon ?? 'clock'} /></span>
          <div><strong>{description ? c(...description.title) : c('Aktivitas rekrutmen diperbarui', 'Recruitment activity updated')}</strong>
            <time dateTime={item.createdAt}>{reviewTime(item.createdAt, locale)}</time></div>
        </li>;
      })}</ol>
    </section>)}
  </section>;
}
