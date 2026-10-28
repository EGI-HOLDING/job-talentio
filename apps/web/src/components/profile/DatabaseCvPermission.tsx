'use client';
import s from './ProfileWorkspace.module.css';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
export function DatabaseCvPermission({
  resumes,
}: {
  resumes: Array<{ id: string; title: string; hasFile?: boolean; fileKey?: string | null }>;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false),
    [resumeId, setResumeId] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    api<any>('/profiles/me/database-cv-permission')
      .then((data) => {
        if (alive) {
          setEnabled(data.databaseCvEnabled);
          setResumeId(data.databaseResumeId || '');
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      await api('/profiles/me/database-cv-permission', {
        method: 'PATCH',
        body: JSON.stringify({ enabled, resumeId: resumeId || null }),
      });
      setMessage(t('pc.saved'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('ew.loadFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}>
      <legend>{t('hr.databaseCv')}</legend>
      <p>{t('hr.cvPermissionHint')}</p>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />{' '}
        {t('hr.cvPermission')}
      </label>
      <label>
        {t('hr.chooseCv')}
        <select
          value={resumeId}
          onChange={(event) => setResumeId(event.target.value)}
          disabled={!enabled}
        >
          <option value="">{t('hr.chooseCv')}</option>
          {resumes
            .filter((resume) => resume.hasFile || resume.fileKey)
            .map((resume) => (
              <option value={resume.id} key={resume.id}>
                {resume.title}
              </option>
            ))}
        </select>
      </label>
      <button
        className={s.primary}
        type="button"
        disabled={busy || (enabled && !resumeId)}
        onClick={() => void save()}
      >
        {t(busy ? 'saving' : 'save')}
      </button>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
