'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from './CvApplicationPicker.module.css';

export type ApplicationCv = {
  id: string;
  title: string;
  isPrimary?: boolean;
  hasFile?: boolean;
  format?: string | null;
  updatedAt?: string;
};

type Props = {
  resumes: ApplicationCv[];
  selectedResumeId: string;
  loading?: boolean;
  error?: string;
  onSelect: (id: string) => void;
  onApply: () => void;
  submitting?: boolean;
  onUpload: () => void;
  onClose: () => void;
};

function resumeName(resume: ApplicationCv) {
  const title = resume.title.trim() || 'CV';
  const format = resume.format?.toLowerCase();
  if (!format || !['pdf', 'doc', 'docx'].includes(format) || title.toLowerCase().endsWith(`.${format}`)) return title;
  return `${title}.${format}`;
}

export function CvApplicationPicker({ resumes, selectedResumeId, loading = false, error, onSelect, onUpload, onClose, onApply, submitting = false }: Props) {
  const { t, locale } = useI18n();
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = () => { if (!submitting) onClose(); };

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => (dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)'))?.focus());
    function onKeyDown(event: KeyboardEvent) {
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      if (openDialogs[openDialogs.length - 1] !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') || []).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      active?.focus();
    };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="cv-picker-title" aria-busy={loading || submitting}>
        <header className={styles.header}>
          <div>
            <h2 id="cv-picker-title">{t('job.cvPickerTitle')}</h2>
            <p>{t('job.cvPickerHint')}</p>
          </div>
          <button type="button" className={styles.closeButton} disabled={submitting} onClick={onClose} aria-label={t('closeDialog')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        {loading ? <div className={styles.status} role="status">{t('loading')}</div> : <>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {resumes.length ? <fieldset disabled={submitting} className={styles.resumeList} aria-label={t('job.resume')}>
            {resumes.map((resume) => {
              const selected = resume.id === selectedResumeId;
              const format = resume.format?.toUpperCase();
              const updated = resume.updatedAt && !Number.isNaN(Date.parse(resume.updatedAt))
                ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(resume.updatedAt))
                : null;
              return <label key={resume.id} className={`${styles.resumeRow} ${selected ? styles.selected : ''}`}>
                <input type="radio" name="application-cv" value={resume.id} checked={selected} onChange={() => onSelect(resume.id)} />
                <span className={styles.fileIcon} aria-hidden="true">
                  <svg viewBox="0 0 42 50"><path d="M8 2h17l11 11v33a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M25 2v11h11" /></svg>
                  <span>{format || 'CV'}</span>
                </span>
                <span className={styles.resumeInfo}>
                  <strong>{resumeName(resume)}{resume.isPrimary && <small className={styles.primaryTag}>{t('job.resumePrimary')}</small>}</strong>
                  <span>{updated ? `${t('job.cvUpdated')} ${updated}` : t('job.resume')}{format ? ` · ${format}` : ''}</span>
                </span>
              </label>;
            })}
          </fieldset> : <p className={styles.emptyState}>{t('job.noCvAvailable')}</p>}

          <button type="button" className={styles.uploadButton} disabled={submitting} onClick={onUpload}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>
            {t('job.uploadNewCv')}
          </button>

          <footer className={styles.footer}>
            <button type="button" className={styles.cancelButton} disabled={submitting} onClick={onClose}>{t('cancel')}</button>
            <button type="button" className={styles.applyButton} disabled={!selectedResumeId || submitting || loading} onClick={onApply}>{submitting ? t('loading') : t('job.applyWithCv')}</button>
          </footer>
        </>}
      </section>
    </div>,
    document.body,
  );
}
