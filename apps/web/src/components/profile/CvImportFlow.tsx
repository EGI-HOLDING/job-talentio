'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@/lib/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { waitForResumeParse } from '@/lib/cvParse';
import { CvReviewModal, type ParsedCv } from '@/components/CvReviewModal';
import { ProfileDialog } from './ProfileDialog';
import { CvFileDrop } from './CvFileDrop';
import { ProfileIcon } from './ProfileIcon';
import { cvFileError, type ImportedResult } from './types';
import s from './ProfileWorkspace.module.css';

export function CvImportFlow({ existingResumeId, onClose, onProfileChanged }: { existingResumeId?: string; onClose: () => void; onProfileChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<'upload' | 'parsing' | 'pending' | 'review' | 'done' | 'failed'>(existingResumeId ? 'parsing' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [resumeId, setResumeId] = useState(existingResumeId || '');
  const [parsed, setParsed] = useState<ParsedCv | null>(null);
  const [result, setResult] = useState<ImportedResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (existingResumeId) void check(existingResumeId);
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [existingResumeId]);

  async function check(id: string) {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setPhase('parsing'); setError('');
    try {
      const status = await waitForResumeParse(id, { signal: abort.signal });
      if (abort.signal.aborted || !mounted.current) return;
      if (status.parseStatus === 'READY' && status.parsedData) { setParsed(status.parsedData as ParsedCv); setPhase('review'); }
      else if (status.parseStatus === 'PENDING' || status.parseStatus === 'PROCESSING') setPhase('pending');
      else { setError(status.parseError || t('cvParseFailed')); setPhase('failed'); }
    } catch (error) {
      if (abort.signal.aborted || !mounted.current) return;
      setError(error instanceof Error ? error.message : t('cvParseFailed')); setPhase('pending');
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('parse', 'true');
      const resume = await api<{ id: string }>('/profiles/me/resumes/upload', { method: 'POST', body: fd });
      setResumeId(resume.id);
      await onProfileChanged();
      setBusy(false); void check(resume.id);
    } catch (error) { setError(error instanceof Error ? error.message : t('emp.uploadFailed')); }
    finally { submitting.current = false; setBusy(false); }
  }

  if (phase === 'review' && parsed) return <CvReviewModal resumeId={resumeId} parsed={parsed} presentation="workspace" onClose={onClose} onImported={async (result) => { setResult(result); setPhase('done'); await onProfileChanged(); }} />;

  return <ProfileDialog title={t(phase === 'done' ? 'pc.importDone' : 'pc.import')} subtitle={phase === 'upload' ? t('pc.importHint') : undefined} onClose={onClose} busy={busy}>
    <div className={s.dialogBody}>
      <ol className={s.steps}>{['pc.upload', 'pc.review', 'pc.complete'].map((key, index) => <li key={key} aria-current={(phase === 'done' ? 2 : phase === 'upload' ? 0 : 1) === index ? 'step' : undefined}><span>{index + 1}</span>{t(key)}</li>)}</ol>
      {error && <div className={s.error} role="alert">{error}</div>}
      {phase === 'upload' ? <form onSubmit={upload}>
        <CvFileDrop file={file} disabled={busy} onPick={(file) => { const error = file ? cvFileError(file, t) : null; setError(error || ''); setFile(error ? null : file); }} />
        <p className={s.inlineNote}><ProfileIcon kind="info" />{t('pc.importLibraryNote')}</p>
        <footer className={s.dialogFooter}><button className={s.secondary} type="button" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className={s.primary} type="submit" disabled={!file || busy}>{busy ? t('emp.uploading') : t('pc.continue')}</button></footer>
      </form> : phase === 'parsing' ? <><div className={s.processing} role="status"><span className={s.spinner} /><h3>{t('pc.reading')}</h3><p>{t('pc.profileUnchanged')}</p><p>{t('pc.backgroundHint')}</p></div><footer className={s.dialogFooter}><button className={s.secondary} type="button" onClick={onClose}>{t('pc.continueBackground')}</button></footer></> : phase === 'done' ? <>
        <div className={s.empty}><span className={s.successMark}><ProfileIcon kind="check" /></span><h2>{t('pc.importDone')}</h2><p>{t('pc.importDoneHint')}</p></div>
        {result?.imported && <div className={s.importCounts}>{([['skills', 'skills'], ['experiences', 'experience'], ['educations', 'education'], ['languages', 'languages']] as const).map(([key, label]) => <div key={key}><strong>{t(label)}</strong>{t('pc.addedCount').replace('{n}', String(result.imported?.[key] || 0))}</div>)}</div>}
        <div className={s.dialogFooter}><button className={s.secondary} type="button" onClick={onClose}>{t('emp.postImportReviewProfile')}</button><Link className={s.primary} href="/jobs?mode=for-you">{t('home.forYou')}<ProfileIcon kind="arrow" /></Link></div><p style={{ textAlign: 'center' }}><Link className={s.textButton} href="/dashboard/employee?tab=alerts">{t('workspace.jobAlerts')}</Link></p>
      </> : <><div className={s.processing}><ProfileIcon kind="document" /><p>{t(phase === 'pending' ? 'pc.parsePending' : 'cvParseFailed')}</p><p>{t('pc.profileUnchanged')}</p></div><footer className={s.dialogFooter}><button className={s.secondary} type="button" onClick={() => { setPhase('upload'); setFile(null); setError(''); }}>{t('pc.chooseAnotherFile')}</button>{phase === 'pending' && <button className={s.primary} type="button" onClick={() => void check(resumeId)}>{t('pc.checkParse')}</button>}<button className={s.textButton} type="button" onClick={onClose}>{t('pc.editManually')}</button></footer></>}
    </div>
  </ProfileDialog>;
}
