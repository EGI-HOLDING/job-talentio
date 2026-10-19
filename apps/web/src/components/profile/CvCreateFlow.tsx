'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { MAX_RESUMES_PER_PROFILE } from '@job-talentio/shared';
import { JobTitleInput } from '@/components/ui/JobTitleInput';
import { FormField } from '@/components/ui/Field';
import { ProfileDialog } from './ProfileDialog';
import { ProfileIcon } from './ProfileIcon';
import { CvFileDrop } from './CvFileDrop';
import { cvFileError, type Resume } from './types';
import s from './ProfileWorkspace.module.css';

export function CvCreateFlow({ defaultRole, count, onClose, onCreated }: { defaultRole: string; count: number; onClose: () => void; onCreated: (id: string, method: 'builder' | 'upload') => Promise<void> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<'builder' | 'upload'>('builder');
  const [step, setStep] = useState<'choose' | 'upload' | 'done'>('choose');
  const [title, setTitle] = useState(defaultRole);
  const [role, setRole] = useState(defaultRole);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [created, setCreated] = useState<Resume | null>(null);

  function pick(file: File | null) {
    const error = file ? cvFileError(file, t) : null;
    setError(error || ''); setFile(error ? null : file);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!title.trim()) { setError(t('resumeTitleRequired')); return; }
    if (role.trim().length < 2) { setError(t('resumeTargetRoleRequired')); return; }
    if (count >= MAX_RESUMES_PER_PROFILE) { setError(t('resumeQuotaReached').replace('{max}', String(MAX_RESUMES_PER_PROFILE))); return; }
    if (step === 'choose' && method === 'upload') { setError(''); setStep('upload'); return; }
    if (method === 'upload' && !file) { setError(t('resumePdfRequired')); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      let resume: Resume;
      if (method === 'builder') {
        resume = await api<Resume>('/profiles/me/resumes/from-builder', { method: 'POST', body: JSON.stringify({ title: title.trim(), jobTitle: role.trim(), isPrimary: true }) });
      } else {
        const fd = new FormData(); fd.append('file', file!); fd.append('title', title.trim()); fd.append('jobTitle', role.trim()); fd.append('parse', 'false');
        resume = await api<Resume>('/profiles/me/resumes/upload', { method: 'POST', body: fd });
      }
      setCreated(resume); setStep('done');
      await onCreated(resume.id, method);
    } catch (error) { setError(error instanceof Error ? error.message : t('resumeCreateFailed')); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <ProfileDialog title={t(step === 'done' ? 'pc.cvAdded' : step === 'upload' ? 'pc.uploadCv' : 'pc.createCv')} subtitle={step === 'choose' ? t('pc.createHint') : undefined} busy={busy} guardChanges={step !== 'done'} onClose={onClose}>
    {error && <div className={s.formError} role="alert">{error}</div>}
    {step === 'done' ? <div className={s.dialogBody}><div className={s.empty}><span className={s.successMark}><ProfileIcon kind="check" /></span><h2>{created?.title}</h2><p>{t(method === 'builder' ? 'pc.exportNeeded' : 'pc.attached')}</p><p>{t('pc.libraryOnly')}</p></div><div className={s.dialogFooter}><button className={s.primary} type="button" onClick={onClose}>{t('pc.backToCvs')}</button></div></div> : <form onSubmit={submit} className={s.form}>
      <fieldset disabled={busy} className={s.resetFieldset}>
        {step === 'choose' ? <>
          <FormField label={t('pc.cvName')} required><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></FormField>
          <FormField label={t('resumeTargetRole')} required><JobTitleInput focusSuggestions value={role} onValueChange={setRole} minLength={2} required /></FormField>
          <div className={s.methodOptions}>{(['builder', 'upload'] as const).map((value) => <label key={value}><input type="radio" name="method" checked={method === value} onChange={() => setMethod(value)} /><div><strong>{t(value === 'builder' ? 'pc.buildMethod' : 'pc.uploadMethod')}</strong><small>{t(value === 'builder' ? 'pc.buildHint' : 'pc.uploadHint')}</small></div></label>)}</div>
        </> : <><div className={s.inlineNote}><div><strong>{title}</strong><br />{role}</div><button type="button" className={s.textButton} style={{ marginLeft: 'auto' }} onClick={() => setStep('choose')}>{t('emp.edit')}</button></div><CvFileDrop file={file} onPick={pick} disabled={busy} /><p className={s.inlineNote}><ProfileIcon kind="info" />{t('pc.libraryOnly')}</p></>}
        <p className={s.quiet}>{t('pc.newPrimary')}</p>
      </fieldset>
      <footer className={s.dialogFooter}><small className={s.quiet}>{t('pc.cvCount').replace('{n}', String(count)).replace('{max}', String(MAX_RESUMES_PER_PROFILE))}</small><button className={s.secondary} type="button" disabled={busy} onClick={() => step === 'upload' ? setStep('choose') : onClose()}>{t(step === 'upload' ? 'pc.back' : 'cancel')}</button><button type="submit" className={s.primary} disabled={busy || (step === 'upload' && !file)}>{busy ? t('creating') : t(step === 'upload' ? 'pc.saveCv' : method === 'upload' ? 'pc.continue' : 'pc.createCv')}</button></footer>
    </form>}
  </ProfileDialog>;
}
