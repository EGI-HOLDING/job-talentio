'use client';

import { useEffect, useRef, useState } from 'react';
import { assessmentCopy, type AssessmentLanguage } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { TaraInterviewNotes } from '@/components/screening/TaraInterviewNotes';
import { CandidateReportCriterion, CandidateReportFrame, type ReportTab } from './CandidateReportFrame';
import { saveCandidateFile } from './CandidateCvReview';
import { ReviewError, ReviewPill, reviewDate, useReviewCopy } from './candidate-review-view';
import { clock, coverage, evaluatedInterviewScore, interviewClaimLabel, interviewFieldLabel, number, partialCompetency,
  roleScoreReason, status, turns, type Evidence, type Report, type ScreeningEvaluation, type Turn } from './screening-view';
import type { CandidateDetail } from './CandidateReview';
import type { ReviewReport } from './candidate-review-route';
import s from './CandidateReview.module.css';

type ApplicationAssessment = {
  status: string; screeningScore: number | null; finalScore: number | null; result: ScreeningEvaluation | null;
  pdfReady: boolean; assessmentLanguage?: AssessmentLanguage; plan?: { claims?: Report['claims'] };
  questions: Array<Omit<Report['questions'][number], 'text'> & { question: string }>;
};

function evidenceTurn(evidence: Evidence, conversation: Turn[]) {
  const direct = conversation.find(turn => turn.speaker === 'CANDIDATE' &&
    (turn.id === evidence.questionId || turn.id === 'answer:' + evidence.questionId));
  if (direct) return direct;
  const quote = evidence.quote.trim().replace(/\s+/g, ' ');
  if (!quote) return undefined;
  const matching = conversation.filter(turn => turn.speaker === 'CANDIDATE' && turn.text.replace(/\s+/g, ' ').includes(quote));
  return matching.length === 1 ? matching[0] : undefined;
}

export function CandidateInterviewReport({ data, report }: {
  data: CandidateDetail; report: Exclude<ReviewReport, { kind: 'cv' }>;
}) {
  const uiCopy = useReviewCopy();
  const [result, setResult] = useState<Report>();
  const [tab, setTab] = useState<ReportTab>('criteria');
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [turnId, setTurnId] = useState('');
  const [search, setSearch] = useState('');
  const [speaker, setSpeaker] = useState('all');
  const lock = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const invitationPath = report.kind === 'interview' ? '/recruitment/invitations/' + encodeURIComponent(report.invitationId) : null;
  const applicationPath = report.kind === 'application' && data.applicationId && data.application?.screeningSession
    ? '/ai-screening/applications/' + encodeURIComponent(data.applicationId) : null;
  const reportPath = invitationPath && invitationPath + '/report?' + new URLSearchParams({ candidateId: data.id });

  useEffect(() => {
    const abort = new AbortController();
    setError('');
    async function load() {
      try {
        if (reportPath) {
          const row = await api<Report>(reportPath, { cacheMode: 'no-store', signal: abort.signal });
          if (!abort.signal.aborted) setResult(row);
        } else if (applicationPath) {
          const row = await api<ApplicationAssessment>(applicationPath + '/assessment', { cacheMode: 'no-store', signal: abort.signal });
          if (!abort.signal.aborted) setResult({
            claims: row.plan?.claims ?? [], assessmentLanguage: row.assessmentLanguage,
            questions: row.questions.map(({ question, ...rest }) => ({ ...rest, text: question })),
            pdfUrl: null, pdfStatus: row.pdfReady ? 'READY' : ['PENDING', 'RUNNING'].includes(row.status) ? 'PENDING' : 'NOT_READY',
            evaluation: { status: row.status, score: row.screeningScore, finalScore: row.finalScore, result: row.result },
          });
        } else {
          setError(uiCopy('Wawancara tidak ditemukan.', 'Interview not found.'));
        }
      } catch (reason) {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Hasil wawancara belum dapat dimuat.');
      }
    }
    void load();
    return () => abort.abort();
  }, [reportPath, applicationPath, revision]);

  const stillProcessing = result && (result.pdfStatus === 'PENDING' ||
    ['PENDING', 'RUNNING'].includes(result.evaluation?.status ?? '') ||
    result.invitation?.session?.completion?.status === 'ASSESSING');
  useEffect(() => {
    if (!stillProcessing || error) return;
    const timer = setTimeout(() => setRevision(n => n + 1), 6000);
    return () => clearTimeout(timer);
  }, [stillProcessing, result, error]);
  useEffect(() => {
    if (tab !== 'evidence' || !turnId) return;
    const node = transcript.current?.querySelector<HTMLElement>('[data-turn="' + CSS.escape(turnId) + '"]');
    node?.scrollIntoView({ block: 'center' });
    node?.focus({ preventScroll: true });
  }, [tab, turnId]);
  if (!result) return error ? <ReviewError retry={() => setRevision(n => n + 1)}>{error}</ReviewError> : <WorkspaceLoading />;

  const response = result.evaluation?.result;
  const language = (response ? response.assessmentLanguage : result.invitation?.assessmentLanguage ?? result.assessmentLanguage) ?? 'id';
  const c = (id: string, en: string) => language === 'en' ? en : id;
  const locale = c('id-ID', 'en-US');
  const title = c('Laporan wawancara Taka', 'Taka interview report');
  const { value, final } = evaluatedInterviewScore(result.evaluation && {
    finalScore: result.evaluation.finalScore, screeningScore: result.evaluation.score, result: response ?? null,
  });
  const finalLabel = c('Skor akhir', 'Final score');
  const scoreLabel = value === null
    ? response?.interviewAssessment?.state === 'ALTERNATIVE' ? c('Pengalaman di luar CV', 'Experience outside the CV')
      : final ? c('Skor akhir belum lengkap', 'Final score incomplete') : c('Skor belum tersedia', 'Score unavailable')
    : final ? finalLabel : c('Dukungan klaim CV', 'CV claim assessment');
  const invitation = result.invitation;
  const role = response?.roleAssessment;
  const assessed = invitation ? coverage(invitation) : role ? { tested: role.coverage.assessed, total: role.coverage.total, unit: 'kompetensi' }
    : response?.interviewAssessment && { tested: response.interviewAssessment.assessedClaims, total: response.interviewAssessment.plannedClaims, unit: undefined };
  const assessedAt = invitation?.session?.completedAt ?? result.voice?.endedAt ?? invitation?.createdAt ??
    data.application?.screeningSession?.completedAt ?? data.createdAt;
  const conversation = turns(result);
  const visibleTurns = conversation.filter(turn => (speaker === 'all' || speaker === turn.speaker) &&
    turn.text.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)));
  const evidenceLabel = c('Kutipan wawancara', 'Interview evidence');
  const evidenceLink = c('Buka transkrip', 'Open transcript');
  const candidateName = data.fullName.split(/\s+/)[0];
  const state = invitation ? status(invitation) : result.evaluation?.status === 'FAILED'
    ? 'Penilaian gagal' : response ? 'Hasil tersedia' : 'Menilai hasil';

  function showTurn(id?: string) {
    setSpeaker('all');
    setSearch('');
    setTurnId(id ?? '');
    setTab('evidence');
  }
  function quoteLinks(rows: Evidence[]) {
    return rows.map(row => {
      const turn = evidenceTurn(row, conversation);
      return {
        quote: row.quote, label: evidenceLabel,
        anchor: turn?.startMs != null ? evidenceLink + ' \u00b7 ' + clock(turn.startMs) : evidenceLink,
        onOpen: turn ? () => showTurn(turn.id) : undefined,
      };
    });
  }
  async function operate(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setOperationError('');
    try { await task(); }
    catch (reason) { setOperationError(reason instanceof Error ? reason.message : c('Permintaan belum berhasil.', 'The request could not be completed.')); }
    finally { lock.current = false; setBusy(false); }
  }
  function downloadPdf() {
    void operate(async () => {
      let url: string | null = null;
      if (reportPath) {
        const fresh = await api<Report>(reportPath, { cacheMode: 'no-store' });
        if (fresh.resultRevision !== result?.resultRevision) {
          setResult(fresh);
          throw Error(c('Laporan telah diperbarui. Tinjau revisi terbaru sebelum mengunduh.', 'The report has changed. Review the latest revision before downloading.'));
        }
        url = fresh.pdfUrl;
      } else if (applicationPath) {
        url = (await api<{ url: string }>(applicationPath + '/report', { cacheMode: 'no-store' })).url;
      }
      if (!url) throw Error(c('PDF belum tersedia.', 'The PDF is not available yet.'));
      const link = document.createElement('a');
      link.href = url;
      link.download = c('Laporan-Wawancara-Taka.pdf', 'Taka-interview-report.pdf');
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  }
  const retryable = invitationPath && (result.evaluation?.status === 'FAILED' ||
    result.pdfStatus === 'FAILED' || invitation?.session?.completion?.canRetry);
  const hasCriteria = role ? role.criteria.length > 0 : Boolean(response?.claims?.length);

  return <CandidateReportFrame title={title} name={data.fullName} subtitle={data.headline || data.job?.title || ''}
    context="interview" score={value === null ? null : number(value, language) + '/100'} scoreLabel={scoreLabel}
    coverage={assessed && <p>{language === 'en'
      ? assessed.tested + ' of ' + assessed.total + (assessed.unit ? ' competencies assessed' : ' claims assessed')
      : assessed.tested + ' dari ' + assessed.total + ' ' + (assessed.unit ?? 'klaim') + ' dinilai'}</p>}
    metadata={<><time dateTime={assessedAt}><WorkspaceIcon kind="calendar" />{reviewDate(assessedAt, locale)}</time>
      <ReviewPill tone="violet">{invitation?.mode === 'VOICE' ? 'Live' : 'Chat'}</ReviewPill></>}
    download={<button type="button" className={s.primary} disabled={busy || (!result.pdfUrl && result.pdfStatus !== 'READY')} onClick={downloadPdf}>
      <WorkspaceIcon kind="download" />{busy ? c('Memuat\u2026', 'Loading\u2026') : result.pdfStatus === 'PENDING' ? c('Menyiapkan PDF\u2026', 'Preparing PDF\u2026')
        : c('Unduh PDF', 'Download PDF')}
    </button>}
    tabs={{ summary: c('Ringkasan', 'Summary'), criteria: c('Nilai per kriteria', 'Criteria scores'), evidence: c('Bukti wawancara', 'Interview evidence') }}
    tab={tab} onTab={setTab}>
    {error && <ReviewError retry={() => setRevision(n => n + 1)}>{error}</ReviewError>}
    {operationError && <ReviewError>{operationError}</ReviewError>}
    {state !== 'Hasil tersedia' && <p className={s.notice} role="status">{assessmentCopy(language, state)}</p>}
    {response?.narrative && <p className={s.muted} role="status">{assessmentCopy(language,
      response.narrative.state === 'PENDING' ? 'Penjelasan bahasa sedang disiapkan.' : 'Bahasa penjelasan perlu ditinjau.')}</p>}
    {retryable && <button type="button" className={s.secondary} disabled={busy} onClick={() => void operate(async () => {
      await api(invitationPath + '/retry-evaluation', { method: 'POST', body: '{}' });
      setRevision(n => n + 1);
    })}>{c('Coba proses hasil lagi', 'Retry assessment')}</button>}
    {tab === 'summary' && <section className={s.card + ' ' + s.reportSummary}>
      <h2>{c('Ringkasan', 'Summary')}</h2>
      <p>{response?.summary || c('Ringkasan belum tersedia.', 'The summary is not available.')}</p>
      {role && <>
        {role.missing.length > 0 && <p className={s.muted}>{roleScoreReason(role, language)}</p>}
        {role.partial && <p>{partialCompetency(role, language)} &#xb7; {c('Kejelasan', 'Clarity')} {number(role.partial.explanation, language)}/100</p>}
        <dl className={s.components}>
          {([['cv', c('Kecocokan CV', 'CV match')], ['competency', c('Kompetensi kerja', 'Job competencies')], ['explanation', c('Kejelasan penjelasan', 'Explanation clarity')]] as const)
            .map(([key, label]) => <div key={key}><dt>{label} &#xb7; {role.weights[key]}%</dt><dd>{role.components[key] === null
              ? c('Belum lengkap', 'Incomplete') : number(role.components[key], language) + ' / 100'}
              {role.contributions[key] != null && <small> &#xb7; {role.contributions[key]?.toLocaleString(locale, { maximumFractionDigits: 2 })} {c('poin', 'points')}</small>}
            </dd></div>)}
        </dl>
        <small>{c('Revisi rubrik', 'Rubric revision')} {role.rubricRevision.slice(0, 8)}</small>
      </>}
      {response?.taraInterview && <TaraInterviewNotes notes={response.taraInterview} assessmentLanguage={language}
        onContext={(_, reference, answer) => showTurn(conversation.find(turn => turn.id === reference ||
          turn.id === (answer ? 'answer:' : 'question:') + reference)?.id)} />}
      {([['strengths', c('Penjelasan yang didukung', 'Supported statements')], ['gaps', c('Perlu didalami', 'Review notes')],
        ['interviewQuestions', c('Pertanyaan lanjutan untuk HR', 'Follow-up questions for HR')]] as const).map(([key, label]) =>
          Boolean(response?.[key]?.length) && <div key={key}><h3>{label}</h3><ul>{response?.[key]?.map((row, i) => <li key={i}>{row}</li>)}</ul></div>)}
    </section>}
    {tab === 'criteria' && <>
      <h2>{c('Nilai per kriteria', 'Criteria scores')}</h2>
      {!hasCriteria && <p className={s.empty}>{c('Belum ada kriteria yang dapat ditampilkan.', 'There are no criteria to show.')}</p>}
      <div className={s.criteria}>
        {role ? role.criteria.map((row, index) => <CandidateReportCriterion key={row.criterionId} initialOpen={index === 0}
          name={row.displayName ?? row.name} score={row.level == null ? assessmentCopy(language, interviewClaimLabel[row.state] ?? c('Belum dinilai', 'Not assessed')) : row.level + '/4'}
          reason={row.reason} reasonLabel={c('Alasan penilaian', 'Assessment rationale')} evidence={quoteLinks(row.evidence)}>
          {row.reviewLabels?.map(label => <p className={s.muted} key={label}>{assessmentCopy(language, label)}</p>)}
          {row.discrepancy && <div className={s.notice}><strong>{c('Perlu konfirmasi HR', 'Review with HR')}</strong>
            <p>CV &#xb7; {row.discrepancy.left.quote}</p><p>{c('Jawaban', 'Answer')} &#xb7; {row.discrepancy.right.quote}</p></div>}
        </CandidateReportCriterion>) : response?.claims?.map((row, index) => {
          const source = result.claims?.find(item => item.id === row.claimId);
          return <CandidateReportCriterion key={row.claimId} initialOpen={index === 0}
            name={source?.statement ?? c('Klaim', 'Claim') + ' ' + (index + 1)}
            score={row.score == null ? assessmentCopy(language, interviewClaimLabel[row.assessment?.state ?? ''] ?? 'Belum dibahas') : row.score + '/4'}
            reason={row.reason} reasonLabel={c('Alasan penilaian', 'Assessment rationale')} evidence={quoteLinks(row.evidence ?? [])}>
            {source?.quote && <blockquote className={s.cvQuote}>CV &#xb7; {source.quote}</blockquote>}
            {Boolean(row.assessment?.openFields.length) && <p className={s.muted}>{c('Belum dibahas', 'Not discussed')} &#xb7; {row.assessment?.openFields.map(field => assessmentCopy(language, interviewFieldLabel[field] ?? field)).join(', ')}</p>}
            {row.contradictions?.map((item, i) => <div key={i} className={s.notice}><strong>{c('Perlu konfirmasi HR', 'Review with HR')}</strong>
              <p>CV &#xb7; {item.left.quote}</p><p>{c('Jawaban', 'Answer')} &#xb7; {item.right.quote}</p></div>)}
          </CandidateReportCriterion>;
        })}
      </div>
    </>}
    {tab === 'evidence' && <section className={s.card + ' ' + s.transcript}>
      <div className={s.transcriptHeader}>
        <h2>{c('Transkrip wawancara', 'Interview transcript')}</h2>
        <button type="button" className={s.secondary} disabled={!conversation.length} onClick={() => saveCandidateFile(new Blob([
          title + '\n' + data.fullName + ' \u00b7 ' + reviewDate(assessedAt, locale) + '\n',
          result.voice?.transcriptComplete === false ? c('Transkrip tidak lengkap.', 'Transcript incomplete.') + '\n' : '',
          '\n',
          ...conversation.map(turn => clock(turn.startMs) + ' \u00b7 ' + (turn.speaker === 'TARA' ? 'Tara' : candidateName) + '\n' + turn.text + '\n\n'),
        ], { type: 'text/plain;charset=utf-8' }), 'transkrip-tara.txt')}>
          <WorkspaceIcon kind="download" />{c('Unduh transkrip', 'Download transcript')}
        </button>
      </div>
      {result.voice?.transcriptComplete === false && <p className={s.notice}>
        {c('Sebagian percakapan mungkin tidak terekam.', 'Part of the conversation may not have been recorded.')}
      </p>}
      <div className={s.transcriptFilters}>
        <input type="search" aria-label={c('Cari dalam transkrip', 'Search the transcript')} placeholder={c('Cari dalam transkrip\u2026', 'Search the transcript\u2026')}
          value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label={c('Pembicara', 'Speaker')} value={speaker} onChange={event => setSpeaker(event.target.value)}>
          <option value="all">{c('Semua pembicara', 'All speakers')}</option><option value="TARA">Tara</option><option value="CANDIDATE">{candidateName}</option>
        </select>
      </div>
      <div ref={transcript}>
        {visibleTurns.map(turn => <article key={turn.id} data-turn={turn.id} data-highlight={turn.id === turnId} tabIndex={-1} className={s.turn}>
          <header><strong>{turn.speaker === 'TARA' ? 'Tara' : candidateName}</strong>{turn.startMs != null && <time>{clock(turn.startMs)}</time>}</header>
          <p>{turn.text}</p>{turn.timedOut && <small>{c('Waktu menjawab habis.', 'Time to answer expired.')}</small>}
        </article>)}
        {!visibleTurns.length && <p className={s.muted}>{conversation.length
          ? c('Tidak ada percakapan yang sesuai pencarian.', 'No turns match your search.')
          : c('Belum ada percakapan yang tersimpan.', 'No conversation has been saved.')}</p>}
      </div>
    </section>}
  </CandidateReportFrame>;
}
