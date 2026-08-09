'use client';

import { FormEvent, useEffect, useState } from 'react';
import { MAX_RESUMES_PER_PROFILE } from '@job-talentio/shared';
import { api } from '@/lib/api';
import { waitForResumeParse } from '@/lib/cvParse';
import { useI18n } from '@/lib/i18n';
import { FormField, LabelText } from '@/components/ui/Field';
import { JobTitleInput } from '@/components/ui/JobTitleInput';

export type CreateResumeResult = {
  id: string;
  method: 'builder' | 'upload';
  parsedData?: unknown;
  needsReview?: boolean;
  parseStatus?: string;
};

type CreateResumeModalProps = {
  open: boolean;
  busy?: boolean;
  defaultJobTitle?: string;
  defaultTitle?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onCancel: () => void;
  onCreated: (result: CreateResumeResult) => void | Promise<void>;
};

export function CreateResumeModal({
  open,
  busy: busyExternal,
  defaultJobTitle = '',
  defaultTitle = '',
  secondaryLabel,
  onSecondary,
  onCancel,
  onCreated,
}: CreateResumeModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultTitle);
  const [jobTitle, setJobTitle] = useState(defaultJobTitle);
  const [method, setMethod] = useState<'builder' | 'upload'>('builder');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const submitting = busy || busyExternal || parsing;

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setJobTitle(defaultJobTitle);
    setMethod('builder');
    setFile(null);
    setError('');
    setParsing(false);
  }, [open, defaultTitle, defaultJobTitle]);

  if (!open) return null;

  function pickFile(next: File | null | undefined) {
    if (!next) return;
    const ok =
      next.type === 'application/pdf' || next.name.toLowerCase().endsWith('.pdf');
    if (!ok) {
      setError(t('resumePdfOnly'));
      return;
    }
    if (next.size > 5 * 1024 * 1024) {
      setError(t('resumeFileTooLarge'));
      return;
    }
    setError('');
    setFile(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const role = jobTitle.trim();
    const displayTitle = (title.trim() || role).trim();
    if (!displayTitle) {
      setError(t('resumeTitleRequired'));
      return;
    }
    if (role.length < 2) {
      setError(t('resumeTargetRoleRequired'));
      return;
    }
    if (method === 'upload' && !file) {
      setError(t('resumePdfRequired'));
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (method === 'builder') {
        const created = await api<{ id: string }>('/profiles/me/resumes/from-builder', {
          method: 'POST',
          body: JSON.stringify({
            title: displayTitle,
            jobTitle: role,
            isPrimary: true,
          }),
        });
        await onCreated({ id: created.id, method: 'builder' });
      } else {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('title', displayTitle);
        fd.append('jobTitle', role);
        const created = await api<{ id: string; parseStatus?: string }>(
          '/profiles/me/resumes/upload',
          { method: 'POST', body: fd },
        );
        setBusy(false);
        setParsing(true);
        const parse = await waitForResumeParse(created.id);
        if (parse.parseStatus === 'FAILED') {
          setError(parse.parseError || t('cvParseFailed'));
          await onCreated({
            id: created.id,
            method: 'upload',
            parseStatus: parse.parseStatus,
            needsReview: false,
          });
          return;
        }
        await onCreated({
          id: created.id,
          method: 'upload',
          parsedData: parse.parsedData,
          needsReview: Boolean(parse.needsReview),
          parseStatus: parse.parseStatus,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('resumeCreateFailed'));
    } finally {
      setBusy(false);
      setParsing(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!submitting) onCancel();
      }}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-resume-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-resume-title">{t('createResume')}</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
          {t('createResumeHint').replace('{max}', String(MAX_RESUMES_PER_PROFILE))}
        </p>
        <form className="form-stack" onSubmit={onSubmit}>
          <fieldset disabled={submitting} style={{ border: 0, margin: 0, padding: 0 }}>
            <FormField label={t('resumeDisplayName')} required>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                placeholder={jobTitle || t('resumeTitlePlaceholder')}
              />
            </FormField>
            <label>
              <LabelText required>{t('resumeTargetRole')}</LabelText>
              <JobTitleInput
                name="jobTitle"
                required
                minLength={2}
                value={jobTitle}
                onValueChange={(next) => {
                  setJobTitle(next);
                  if (!title.trim()) setTitle(next);
                }}
                placeholder={t('resumeTargetRolePlaceholder')}
              />
            </label>

            <fieldset className="filter-group" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                {t('resumeCreateMethod')}
              </legend>
              <label className="filter-check">
                <input
                  type="radio"
                  name="resumeMethod"
                  checked={method === 'builder'}
                  onChange={() => setMethod('builder')}
                />
                <LabelText optional={false}>{t('resumeMethodBuilder')}</LabelText>
              </label>
              <label className="filter-check">
                <input
                  type="radio"
                  name="resumeMethod"
                  checked={method === 'upload'}
                  onChange={() => setMethod('upload')}
                />
                <LabelText optional={false}>{t('resumeMethodUpload')}</LabelText>
              </label>
            </fieldset>

            {method === 'upload' && (
              <div
                className={`cv-upload-drop ${file ? 'has-file' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pickFile(e.dataTransfer.files?.[0]);
                }}
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  aria-label={t('resumeMethodUpload')}
                />
                <span className="cv-upload-drop-title">
                  {file ? file.name : t('resumeDropPdf')}
                </span>
                <span className="cv-upload-drop-hint muted">{t('resumePdfHint')}</span>
              </div>
            )}

            {method === 'builder' && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                {t('resumeBuilderEmptyHint')}
              </p>
            )}

            {error && <div className="error">{error}</div>}

            {parsing && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                {t('cvParsing')}
              </p>
            )}

            <div className="chips" style={{ marginTop: '0.5rem' }}>
              <button type="submit" className="cta" disabled={submitting}>
                {parsing ? t('cvParsing') : submitting ? t('creating') : t('createResume')}
              </button>
              <button type="button" className="secondary" disabled={submitting} onClick={onCancel}>
                {t('cancel')}
              </button>
              {secondaryLabel && onSecondary && (
                <button
                  type="button"
                  className="ghost"
                  disabled={submitting}
                  onClick={onSecondary}
                >
                  {secondaryLabel}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
