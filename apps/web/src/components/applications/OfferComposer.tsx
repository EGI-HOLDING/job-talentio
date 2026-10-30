'use client';

import { useRef, useState } from 'react';
import { apiUpload } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import s from './OfferDocuments.module.css';

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
type QueuedFile = { file: File; error?: string };

export function OfferComposer({ applicationId, candidateName, jobTitle, mode = 'offer', onClose, onSent }: {
  applicationId: string; candidateName: string; jobTitle: string;
  mode?: 'offer' | 'post-hire'; onClose: () => void;
  onSent: (result: { packet?: { requiresCandidateDecision?: boolean } }) => void;
}) {
  const { t } = useI18n();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);

  function addFiles(incoming: FileList | File[]) {
    const selected = Array.from(incoming);
    setError('');
    if (files.length + selected.length > MAX_FILES) { setError(t('offer.tooManyFiles')); return; }
    setFiles(current => [...current, ...selected.map(file => {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const fileError = !EXTENSIONS.has(extension) ? t('offer.invalidFile') : file.size > MAX_BYTES || file.size === 0 ? t('offer.fileTooLarge') : undefined;
      return { file, error: fileError };
    })]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (files.some(item => item.error)) { setError(t('offer.fixFiles')); return; }
    if (mode === 'post-hire' && files.length === 0) { setError(t('offer.chooseAtLeastOne')); return; }
    pending.current = true;
    setError('');
    setProgress(0);
    const body = new FormData();
    files.forEach(item => body.append('files', item.file, item.file.name));
    try {
      const result = await apiUpload<{ packet?: { requiresCandidateDecision?: boolean } }>(
        '/applications/' + encodeURIComponent(applicationId) + '/' + (mode === 'offer' ? 'offers' : 'hiring-documents'),
        body,
        value => setProgress(value),
      );
      onSent(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('offer.uploadFailed'));
      setProgress(null);
      pending.current = false;
    }
  }

  return <ProfileDialog title={t(mode === 'offer' ? 'offer.sendTitle' : 'offer.postHireDocuments')}
    subtitle={t(mode === 'offer' ? 'offer.sendHint' : 'offer.postHireHint')}
    wide busy={busy} guardChanges={files.length > 0} onClose={onClose}>
    <form className={s.composer} onSubmit={event => void submit(event)}>
      <div className={s.context}>
        <span className={s.contextIcon} aria-hidden="true">{mode === 'offer' ? <svg viewBox="0 0 24 24" fill="none"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 4v4.25h4.2M8.5 12h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" fill="none"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 4v4.25h4.2M8.5 12h7M8.5 15.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="m14.5 16.5 2 2 3.75-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}</span>
        <div><strong>{candidateName}</strong><span>{jobTitle}</span></div>
      </div>
      {mode === 'offer' && <aside className={s.decisionRule} role="note"><span aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 9v4m0-6h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg></span><p>{t('offer.decisionRule')}</p></aside>}
      <div className={s.sectionHead}>
        <div><h3>{t('offer.documents')}</h3><span>{t(mode === 'offer' ? 'offer.optional' : 'offer.required')}</span></div>
        <small>{files.length}/{MAX_FILES}</small>
      </div>
      <div className={s.dropzone}
        onDragOver={event => { event.preventDefault(); event.currentTarget.dataset.over = 'true'; }}
        onDragLeave={event => { event.currentTarget.dataset.over = 'false'; }}
        onDrop={event => { event.preventDefault(); event.currentTarget.dataset.over = 'false'; if (!busy) addFiles(event.dataTransfer.files); }}>
        <span className={s.uploadIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
        <div className={s.dropText}><strong>{t('offer.dropFiles')}</strong><span>{t('offer.fileTypes')}</span></div>
        <button type="button" className={s.chooseButton} disabled={busy} onClick={() => input.current?.click()}>{t('offer.chooseFiles')}</button>
        <input ref={input} className={s.fileInput} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple disabled={busy}
          onChange={event => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ''; }}/>
      </div>
      {files.length > 0 && <div className={s.fileList} aria-label={t('offer.selectedFiles')}>
        {files.map(({ file, error: fileError }, index) => {
          const extension = file.name.split('.').pop()?.toUpperCase() || 'FILE';
          const offset = files.slice(0, index).reduce((sum, item) => sum + item.file.size, 0);
          const uploaded = busy && totalBytes ? Math.max(0, Math.min(file.size, (totalBytes * (progress || 0) / 100) - offset)) : 0;
          const itemProgress = busy ? Math.round(uploaded / file.size * 100) : 0;
          return <div className={s.fileRow} key={file.name + ':' + file.size + ':' + file.lastModified + ':' + index}>
            <span className={s.fileType} aria-hidden="true">{extension}</span>
            <div className={s.fileInfo}><strong title={file.name}>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB{fileError ? ' | ' + fileError : busy ? ' | ' + t('offer.uploadProgress').replace('{percent}', String(itemProgress)) : ''}</span>{busy && <i><b style={{ width: itemProgress + '%' }}/></i>}</div>
            <button type="button" className={s.removeFile} aria-label={t('offer.removeFile').replace('{name}', file.name)} disabled={busy} onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>;
        })}
      </div>}
      {error && <div className={s.error} role="alert">{error}</div>}
      <div className={s.privacyNote}><span aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><rect x="4" y="8.5" width="12" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M6.5 8.5V6a3.5 3.5 0 1 1 7 0v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 11.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></span>{t('offer.privateFiles')}</div>
      <footer className={s.footer}>
        <button type="button" className={s.cancelButton} disabled={busy} onClick={onClose}>{t('offer.cancel')}</button>
        <button type="submit" className={s.submitButton} disabled={busy || files.some(item => item.error)}>{busy ? t('offer.uploading') + ' | ' + progress + '%' : t(mode === 'offer' ? 'offer.send' : 'offer.shareDocuments')}</button>
      </footer>
    </form>
  </ProfileDialog>;
}
