'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, getSession } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { WorkspaceIcon } from './WorkspaceIcon';
import s from './Workspace.module.css';

export function CompanyMark({ name, logo }: { name: string; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  return <span className={s.companyMark}>{logo && !failed ? <img src={logo} alt="" onError={() => setFailed(true)} /> : name.trim().slice(0, 2).toUpperCase()}</span>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className={s.search}><WorkspaceIcon kind="search" /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} aria-label={placeholder} placeholder={placeholder} /></label>;
}

export function WorkspaceEmpty({ icon = 'briefcase', title, hint, children }: { icon?: string; title: string; hint?: string; children?: ReactNode }) {
  return <div className={s.empty}><WorkspaceIcon kind={icon} /><h2>{title}</h2>{hint && <p>{hint}</p>}{children}</div>;
}

export function WorkspaceLoading() {
  const { t } = useI18n();
  return <div className={s.loading} role="status" aria-label={t('ew.loading')}><div className={s.skeleton} /><div className={s.skeleton} /><div className={s.skeleton} /><div className={s.skeleton} /></div>;
}

export function Pagination({ page, total, size = 10, onChange }: { page: number; total: number; size?: number; onChange: (page: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / size));
  const start = Math.max(1, Math.min(page - 1, pages - 2));
  const nums = Array.from({ length: Math.min(3, pages) }, (_, index) => start + index);
  return <footer className={s.footer}><span aria-live="polite">{t('ew.showing').replace('{from}', String(total ? (page - 1) * size + 1 : 0)).replace('{to}', String(Math.min(page * size, total))).replace('{total}', String(total))}</span><nav className={s.pagination} aria-label={t('ew.page').replace('{n}', String(page))}><button type="button" className={s.pageButton} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t('ew.previousPage')}><WorkspaceIcon kind="left" /></button>{nums.map((number) => <button type="button" className={s.pageButton} key={number} aria-label={t('ew.page').replace('{n}', String(number))} aria-current={number === page ? 'page' : undefined} onClick={() => onChange(number)}>{number}</button>)}<button type="button" className={s.pageButton} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={t('ew.nextPage')}><WorkspaceIcon kind="right" /></button></nav></footer>;
}

export function ResourceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return <div className={s.notice} role="alert"><span>{message}</span><button type="button" className={s.textButton} onClick={onRetry}>{t('workspace.retry')}</button></div>;
}

export function useEmployeeResource<T>(path: string) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const data = await api<T[]>(path);
    setItems(data);
    setError('');
  }, [path, locale]);
  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/login?role=EMPLOYEE'); return; }
    if (session.user.role !== 'EMPLOYEE') { router.replace(session.user.role === 'RECRUITER' ? '/dashboard/recruiter?tab=jobs' : '/'); return; }
    let active = true;
    setLoading(true);
    setError('');
    api<T[]>(path).then((data) => { if (active) setItems(data); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('ew.loadFailed')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, locale, router, t]);
  return { items, setItems, loading, error, setError, reload };
}

export function FindJobsAction() {
  const { t } = useI18n();
  return <Link href="/jobs" className={s.primary}>{t('home.findJobs')}<WorkspaceIcon kind="arrow" /></Link>;
}

export function dateLabel(value: string | null | undefined, locale: string, withTime = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '\u2014';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}) }).format(new Date(value));
}
