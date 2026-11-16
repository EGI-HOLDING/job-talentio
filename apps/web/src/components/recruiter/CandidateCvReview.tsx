'use client';

import { useEffect, useRef, useState } from 'react';
import { assessmentCopy, candidateCvCriteria } from '@job-talentio/shared';
import { api, apiBlob } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { CandidatePdfPreview } from './CandidatePdfPreview';
import { CandidateReportCriterion, CandidateReportFrame, type ReportTab } from './CandidateReportFrame';
import { candidateScore, cvPending } from './cv-status';
import { ReviewCharacter, ReviewError, ReviewPill, reviewDate, useReviewCopy } from './candidate-review-view';
import type { CandidateDetail } from './CandidateReview';
import s from './CandidateReview.module.css';

function CvDocument({ data, initialPage = 1 }: { data: CandidateDetail; initialPage?: number }) {
  const c = useReviewCopy();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const path = '/recruitment/candidates/' + encodeURIComponent(data.id) + '/cv';
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setUrl('');
    setError('');
    void api<{ url: string }>(path, { cacheMode: 'no-store', signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setUrl(result.url);
    }).catch(reason => {
      if (!abort.signal.aborted && reason.status !== 404) setError(reason.message);
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [path, revision, data.revision]);

  if (url && data.contentType === 'application/pdf') return <CandidatePdfPreview key={url}
    url={url} name={data.fullName} filename={data.filename} initialPage={initialPage} />;
  return <section className={s.document}>
    <header className={s.documentToolbar}><strong>{c('CV asli', 'Original CV')}</strong>
      <span className={s.documentFilename}><WorkspaceIcon kind="file" />{data.filename}</span>
    </header>
    {loading ? <WorkspaceLoading /> : <div className={s.empty}>
      {error ? <ReviewError retry={() => setRevision(n => n + 1)}>{error}</ReviewError>
        : url ? <a href={url} target="_blank" rel="noreferrer" className={s.primary}>{c('Buka CV', 'Open CV')}<WorkspaceIcon kind="external" /></a>
        : c('CV belum tersedia untuk ditampilkan.', 'The CV is not available to preview.')}
    </div>}
  </section>;
}

export function CandidateCvOverview({ data, href, busy, onRetry }: {
  data: CandidateDetail; href: string; busy: boolean; onRetry: () => void;
}) {
  const c = useReviewCopy();
  const result = data.cvResult;
  const language = (result ? result.assessmentLanguage : data.assessmentLanguage) ?? 'id';
  const criteria = candidateCvCriteria(result, language);
  const strongest = criteria.filter(row => row.level > 0 && row.evidence.length).sort((a, b) => b.level - a.level)[0];
  const probe = result?.limitations?.[0] ?? criteria.filter(row => row.level < 4).sort((a, b) => a.level - b.level)[0]?.name;
  const ready = data.scoreStatus === 'READY' && Boolean(result);
  const retryable = (data.cvMethodologyUpgradeAvailable || ['FAILED', 'UNREADABLE', 'STALE'].includes(data.scoreStatus)) &&
    !['RECOVERING', 'DOCUMENT_REQUIRED'].includes(data.cvProgress?.phase ?? '');
  const local = (id: string, en: string) => language === 'en' ? en : id;
  const score = ready && data.cvScore !== null
    ? data.cvScore.toLocaleString(language === 'en' ? 'en-US' : 'id-ID', { maximumFractionDigits: 1 }) + '%' : null;

  return <div className={s.stack}>
    <section className={s.cvHero} aria-labelledby="taka-review-title">
      <ReviewCharacter character="taka" working={cvPending(data)} />
      <div className={s.cvHeroScore}>
        <h2 id="taka-review-title">{c('Ulasan Taka', 'Taka review')}</h2>
        {score !== null && <span className={s.score} data-has-score>{score}</span>}
        {score !== null ? <div className={s.cvMatchBadge}>
          <span className={s.wideLabel}><ReviewPill icon="check">{local('Kecocokan CV', 'CV match')}</ReviewPill></span>
          <span className={s.narrowLabel}>{local('Kecocokan CV', 'CV match')}<WorkspaceIcon kind="info" /></span>
        </div>
          : <p role={cvPending(data) ? 'status' : undefined} className={s.scoreStatus}>
            {result?.roleAssessment?.state === 'NOT_APPLICABLE' && ready ? local('Rubrik belum tersedia', 'Rubric unavailable')
              : data.cvScore === null ? assessmentCopy(language, candidateScore(data))
              : local('Perlu dinilai ulang', 'Needs reassessment')}
          </p>}
      </div>
      {ready && (strongest || probe) && <div className={s.findings}>
        {strongest && <div><span className={s.findingIcon} data-good><WorkspaceIcon kind="check" /></span>
          <div><span>{local('Bukti terkuat', 'Strongest evidence')}</span><strong title={strongest.name}>{strongest.name}</strong></div></div>}
        {probe && <div><span className={s.findingIcon}><WorkspaceIcon kind="message" /></span>
          <div><span>{local('Gali saat screening', 'Explore in screening')}</span><strong title={probe}>{probe}</strong></div></div>}
      </div>}
      <div className={s.heroActions}>
        {ready && <Link href={href} className={s.primary}>{c('Buka laporan Taka', 'Open Taka report')}<WorkspaceIcon kind="arrowForward" /></Link>}
        {retryable && <button type="button" className={ready ? s.secondary : s.primary} onClick={onRetry} disabled={busy}>
          {data.cvMethodologyUpgradeAvailable ? c('Nilai dengan rubrik terbaru', 'Assess with the latest rubric')
            : data.scoreStatus === 'STALE' ? c('Nilai dengan kriteria terbaru', 'Assess with the latest criteria') : c('Coba nilai ulang', 'Retry assessment')}
        </button>}
      </div>
      {!ready && data.error && <p className={s.heroNotice}>{data.error}</p>}
    </section>
    <CvDocument data={data} />
  </div>;
}

export function saveCandidateFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function CandidateCvReport({ data, onRefresh }: { data: CandidateDetail; onRefresh: () => void }) {
  const [tab, setTab] = useState<ReportTab>('criteria');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const downloading = useRef(false);
  const result = data.cvResult;
  const language = (result ? result.assessmentLanguage : data.assessmentLanguage) ?? 'id';
  const c = (id: string, en: string) => language === 'en' ? en : id;
  const locale = c('id-ID', 'en-US');
  const ready = data.scoreStatus === 'READY' && Boolean(result);
  const criteria = ready ? candidateCvCriteria(result, language) : [];
  const assessedAt = data.activities?.find(row => row.kind === 'CV_ANALYZED')?.createdAt ?? data.updatedAt ?? data.createdAt;
  const canJumpToPage = data.contentType === 'application/pdf';
  const title = c('Laporan CV Taka', 'Taka CV report');

  async function download() {
    if (downloading.current || !ready) return;
    downloading.current = true;
    setBusy(true);
    setError('');
    try {
      const query = data.revision === undefined ? '' : '?revision=' + data.revision;
      const blob = await apiBlob('/recruitment/candidates/' + encodeURIComponent(data.id) + '/cv-report' + query);
      saveCandidateFile(blob, c('Laporan-CV-Taka.pdf', 'Taka-CV-report.pdf'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c('PDF belum dapat diunduh.', 'The PDF could not be downloaded.'));
    } finally {
      downloading.current = false;
      setBusy(false);
    }
  }

  return <CandidateReportFrame title={title} name={data.fullName} subtitle={data.headline || data.job?.title || ''}
    context="cv" score={ready && data.cvScore !== null ? data.cvScore.toLocaleString(locale, { maximumFractionDigits: 1 }) + '%' : null}
    scoreLabel={<ReviewPill icon={ready ? 'check' : 'clock'} tone={ready ? 'good' : 'warning'}>
      {ready && data.cvScore !== null ? c('Kecocokan CV', 'CV match') : c('Skor CV belum tersedia', 'CV score unavailable')}
    </ReviewPill>}
    coverage={ready && <p>{criteria.length} {c('kriteria dinilai', 'criteria assessed')}</p>}
    metadata={<><span className={s.reportDateLabel}>{c('Tanggal laporan', 'Report date')}</span>
      <time dateTime={assessedAt}><WorkspaceIcon kind="calendar" />{reviewDate(assessedAt, locale)}</time></>}
    download={<button type="button" className={s.primary} disabled={busy || !ready} onClick={() => void download()}>
      <WorkspaceIcon kind="download" />{busy ? c('Mengunduh\u2026', 'Downloading\u2026') : c('Unduh PDF', 'Download PDF')}
    </button>}
    tabs={{ summary: c('Ringkasan', 'Summary'), criteria: c('Nilai per kriteria', 'Criteria scores'), evidence: c('Bukti CV', 'CV evidence') }}
    tab={tab} onTab={setTab}>
    {error && <ReviewError retry={() => { setError(''); onRefresh(); }}>{error}</ReviewError>}
    {result?.narrative && <p role="status" className={s.muted}>{assessmentCopy(language,
      result.narrative.state === 'PENDING' ? 'Penjelasan bahasa sedang disiapkan.' : 'Bahasa penjelasan perlu ditinjau.')}</p>}
    {tab === 'summary' && <section className={s.card + ' ' + s.reportSummary}>
      <h2>{c('Ringkasan', 'Summary')}</h2>
      <p>{ready && result?.summary ? result.summary : c('Ringkasan belum tersedia.', 'The summary is not available.')}</p>
      {ready && Boolean(result?.limitations?.length) && <><h3>{c('Perlu didalami', 'Review notes')}</h3>
        <ul>{result?.limitations?.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    </section>}
    {tab === 'criteria' && <>
      <h2>{c('Nilai per kriteria', 'Criteria scores')}</h2>
      {!criteria.length && <p className={s.empty}>{c('Belum ada kriteria yang dinilai.', 'No criteria have been assessed yet.')}</p>}
      <div className={s.criteria}>{criteria.map((row, index) => <CandidateReportCriterion key={row.id}
        initialOpen={index === 0} name={row.name} score={row.level + '/4'} reason={row.reason}
        reasonLabel={c('Alasan penilaian', 'Assessment rationale')}
        evidence={row.evidence.map(({ quote, page: sourcePage }) => ({
          quote, label: c('Kutipan CV', 'CV evidence'),
          anchor: canJumpToPage && sourcePage ? c('Buka CV \u00b7 Halaman', 'Open CV \u00b7 Page') + ' ' + sourcePage : c('Buka CV', 'Open CV'),
          onOpen: () => { setPage(canJumpToPage ? sourcePage ?? 1 : 1); setTab('evidence'); },
        }))} />)}</div>
    </>}
    {tab === 'evidence' && <CvDocument data={data} initialPage={page} />}
  </CandidateReportFrame>;
}
