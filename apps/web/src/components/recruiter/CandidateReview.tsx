'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { AssessmentLanguage, CandidateCvResult } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { employerWorkspaceHref } from '@/lib/accountNavigation';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { ApplicationDetail } from './ApplicationDetail';
import { CandidateCvOverview, CandidateCvReport } from './CandidateCvReview';
import { CandidateInterviewReport } from './CandidateInterviewReport';
import { CandidateScreening } from './CandidateScreening';
import { CandidateSchedule } from './CandidateSchedule';
import { CandidateMessages } from './CandidateMessages';
import { CandidateActivity } from './CandidateActivity';
import type { CandidateRow } from './CandidateWorkspace';
import { cvPending, useCvStatus } from './cv-status';
import type { ScreeningEvaluation } from './screening-view';
import { candidateListHref, candidateReviewHref, candidateStages, readCandidateListFilters, reviewTabs,
  type ReviewReport, type ReviewTab } from './candidate-review-route';
import { candidateInitials, ReviewError, useReviewCopy } from './candidate-review-view';
import s from './CandidateReview.module.css';

export type CandidateActivityRow = { id: string; kind: string; createdAt: string; detail?: { stage?: string } | null };
export type CandidateDetail = CandidateRow & {
  cvMethodologyUpgradeAvailable?: boolean;
  interviewTopicCount?: number | null;
  assessmentLanguage?: AssessmentLanguage;
  cvResult: CandidateCvResult | null;
  job?: { title: string } | null;
  updatedAt?: string;
  stage: string;
  activities: CandidateActivityRow[];
  application?: (NonNullable<CandidateRow['application']> & {
    screeningSession?: { id: string; status: string; completedAt: string | null; evaluation: {
      status: string; screeningScore: number | null; finalScore?: number | null; result: ScreeningEvaluation | null;
    } | null } | null;
  }) | null;
};

const closedStages = ['OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];

export function CandidateReview({ id, report }: { id: string; report?: ReviewReport }) {
  const c = useReviewCopy();
  const stageCopy = useHrCopy();
  const params = useSearchParams();
  const filters = readCandidateListFilters(params);
  const filterQuery = JSON.stringify(filters);
  const tab = reviewTabs.find(value => value === params.get('tab')) ?? 'cv';
  const [data, setData] = useState<CandidateDetail>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [revision, setRevision] = useState(0);
  const [record, setRecord] = useState<{ previous?: string; next?: string }>({});
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const candidateApi = '/recruitment/candidates/' + encodeURIComponent(id);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<CandidateDetail>(candidateApi, { cacheMode: 'no-store', signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [candidateApi, revision]);

  useCvStatus(data?.companyId ?? '', data && cvPending(data) ? id : '', ([observed]) => {
    if (!data || observed?.id !== id || (observed.revision ?? 0) < (data.revision ?? 0)) return;
    if (cvPending(observed)) setData(current => current && { ...current, ...observed });
    else refresh();
  });
  const pendingNarrative = data?.cvResult?.narrative?.state === 'PENDING';
  useEffect(() => {
    if (!pendingNarrative || (!report && tab !== 'cv') || report && report.kind !== 'cv') return;
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 6000);
    return () => clearInterval(timer);
  }, [pendingNarrative, report, tab, refresh]);

  const companyId = data?.companyId, jobId = data?.jobId;
  useEffect(() => {
    if (!companyId || report) return;
    const controller = new AbortController();
    const values = { ...JSON.parse(filterQuery), companyId, ...(jobId ? { jobId } : {}) };
    const query = new URLSearchParams(Object.entries(values)
      .filter(([key, value]) => key !== 'stage' || value !== '')
      .map(([key, value]) => [key, String(value)]));
    void api<{ items: Array<{ id: string }> }>('/recruitment/candidates?' + query, { cacheMode: 'no-store', signal: controller.signal })
      .then(({ items }) => {
        if (controller.signal.aborted) return;
        const index = items.findIndex(item => item.id === id);
        setRecord(index < 0 ? {} : { previous: items[index - 1]?.id, next: items[index + 1]?.id });
      }).catch(() => undefined);
    return () => controller.abort();
  }, [companyId, jobId, id, filterQuery, report, revision]);

  async function act(path: string, input: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(input) });
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : c('Perubahan belum berhasil.', 'The change could not be saved.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const detailHref = (nextTab: ReviewTab = tab) => candidateReviewHref(id, filters, nextTab);
  const reportHref = (nextReport: ReviewReport) => candidateReviewHref(id, filters, tab, nextReport);
  const backList = data ? candidateListHref(data.companyId, data.jobId, filters) : employerWorkspaceHref();
  const labels: Record<ReviewTab, [string, string]> = {
    cv: [c('CV & Ulasan Taka', 'CV & Taka review'), c('CV & Taka', 'CV & Taka')],
    screening: [c('Screening Tara', 'Tara screening'), c('Screening', 'Screening')],
    schedule: [c('Jadwal', 'Schedule'), c('Jadwal', 'Schedule')],
    messages: [c('Pesan', 'Messages'), c('Pesan', 'Messages')],
    activity: [c('Aktivitas', 'Activity'), c('Aktivitas', 'Activity')],
  };
  const backCandidate = detailHref(report?.kind === 'cv' ? 'cv' : 'screening');
  const openApplication = data?.applicationId && jobId ? () => setApplicationOpen(true) : undefined;

  return <div className={s.page} data-candidate-review>
    <div className={s.container}>
      <Link className={s.back} href={report ? backCandidate : backList}>
        <WorkspaceIcon kind="arrowBack" />
        {report ? c('Kembali ke kandidat', 'Back to candidate') : c('Daftar kandidat', 'Candidate list')}
      </Link>
      {error && <ReviewError retry={refresh}>{error}</ReviewError>}
      {!data && !error && <WorkspaceLoading />}
      {data && (report ? report.kind === 'cv'
        ? <CandidateCvReport data={data} onRefresh={refresh} />
        : <CandidateInterviewReport key={report.kind === 'interview' ? report.invitationId : 'application'} data={data} report={report} /> : <>
        <header className={s.candidateHeader}>
          <div className={s.candidateAvatar} aria-hidden="true">{candidateInitials(data.fullName)}</div>
          <div className={s.candidateIdentity}>
            <h1>{data.fullName}</h1>
            <p>{data.headline || data.job?.title || data.filename}</p>
          </div>
          <div className={s.stageControl} data-stage={data.stage}>
            {data.stage === 'NEW' && <span className={s.stageClock}><WorkspaceIcon kind="clock" /></span>}
            <select value={data.stage} disabled={busy || (!openApplication && closedStages.includes(data.stage))}
              aria-label={c('Tahap kandidat', 'Candidate stage')} onChange={event => {
                const stage = event.target.value;
                if (stage === '__actions') { openApplication?.(); return; }
                void act('/recruitment/candidates/bulk', { companyId: data.companyId, selection: { ids: [id] }, action: { kind: 'move', stage } });
              }}>
              <option value={data.stage}>{stageCopy(candidateStages[data.stage] ?? data.stage)}</option>
              {!closedStages.includes(data.stage) && ['IN_REVIEW', 'INTERVIEW', 'REJECTED'].filter(stage => stage !== data.stage)
                .map(stage => <option value={stage} key={stage}>{stageCopy(candidateStages[stage])}</option>)}
              {openApplication && <option value="__actions">{c('Tindakan lamaran', 'Application actions')}</option>}
            </select>
          </div>
          <nav className={s.candidateArrows} aria-label={c('Pindah kandidat', 'Candidate navigation')}>
            {(['previous', 'next'] as const).map((direction, index) => {
              const label = index ? c('Kandidat berikutnya', 'Next candidate') : c('Kandidat sebelumnya', 'Previous candidate');
              const icon = <DirectionalIcon direction={index ? 'right' : 'left'} size={19} />;
              const adjacent = record[direction];
              return adjacent
                ? <Link className={s.square} key={direction} href={candidateReviewHref(adjacent, filters, tab)} aria-label={label} prefetch={false}>{icon}</Link>
                : <button className={s.square} key={direction} type="button" aria-label={label} disabled>{icon}</button>;
            })}
          </nav>
        </header>
        <nav className={s.tabs} aria-label={c('Detail kandidat', 'Candidate details')}>
          {reviewTabs.map(value => <Link key={value} href={detailHref(value)} aria-current={value === tab ? 'page' : undefined} scroll={false}>
            <span className={s.wideLabel}>{labels[value][0]}</span><span className={s.narrowLabel}>{labels[value][1]}</span>
          </Link>)}
        </nav>
        {actionError && <ReviewError>{actionError}</ReviewError>}
        <div className={s.tabBody}>
          {tab === 'cv' && <CandidateCvOverview data={data} href={reportHref({ kind: 'cv' })} busy={busy} onRetry={() => void act(candidateApi + '/retry', {})} />}
          {tab === 'screening' && <CandidateScreening data={data} onChanged={refresh} reportHref={reportHref} />}
          {tab === 'schedule' && <CandidateSchedule candidateId={id} email={data.email} onChanged={refresh} onApplication={openApplication} />}
          {tab === 'messages' && <CandidateMessages candidateId={id} candidateName={data.fullName} companyId={data.companyId} jobId={data.jobId} email={data.email} onChanged={refresh} />}
          {tab === 'activity' && <CandidateActivity data={data} />}
        </div>
        {applicationOpen && data.applicationId && jobId &&
          <ApplicationDetail applicationId={data.applicationId} jobId={jobId} jobTitle={data.job?.title ?? ''}
            companyId={data.companyId} onClose={() => setApplicationOpen(false)} onChanged={refresh} />}
      </>)}
    </div>
  </div>;
}
