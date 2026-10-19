'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import s from './RecruiterWorkspace.module.css';

export const COMPANY_KEY = 'talentio:employer-company';
export function preferredCompany<T extends { companyId: string }>(memberships: T[]): T | undefined {
  let id: string | null = null;
  try { id = sessionStorage.getItem(COMPANY_KEY); } catch { /* Storage can be unavailable. */ }
  return memberships.find((item) => item.companyId === id) || memberships[0];
}
export function rememberCompany(id: string) {
  try { sessionStorage.setItem(COMPANY_KEY, id); } catch { /* Keep the current company in memory. */ }
  window.dispatchEvent(new Event('talentio:company'));
}

export function RecruiterAvatar({ name, src, className = '' }: { name: string; src?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt="" className={s.avatar + ' ' + className} onError={() => setFailed(true)} referrerPolicy="no-referrer" /> : <span className={s.avatarFallback + ' ' + className} aria-hidden="true">{name.split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase()}</span>;
}

export function JobContextSelect({ jobs, value, onChange, allowBrowse = true }: { jobs: any[]; value: string; onChange: (value: string) => void; allowBrowse?: boolean }) {
  const { t } = useI18n();
  const options = [...(allowBrowse ? [{ value: '', label: t('rw.browseWithout') }] : []), ...jobs.map((job) => ({ value: job.id, label: [job.title, job.workMode === 'REMOTE' ? t('remote') : job.city?.name, job.status === 'DRAFT' ? t('rw.drafts') : job.status === 'CLOSED' ? t('rw.closed') : ''].filter(Boolean).join(' | ') }))];
  if (!options.length) options.push({ value: '', label: t('rec.noJobsYet') });
  return <WorkspaceSelect value={value} options={options} label={t('rw.chooseJob')} onChange={onChange} />;
}
