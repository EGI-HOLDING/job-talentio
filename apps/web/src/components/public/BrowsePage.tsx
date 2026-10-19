'use client';
import type { ReactNode } from 'react';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import s from './PublicPages.module.css';

export function BrowsePage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return <div className={s.page}><div className={s.container}><h1 className="sr-only">{title}</h1><Link href="/" className={`${s.back} ${s.browseBack}`}>{'\u2190'} {t('home')}</Link>{children}</div></div>;
}
export function DirectoryStatus({ loading, error, onRetry, onReset }: { loading: boolean; error?: boolean; onRetry: () => void; onReset?: () => void }) {
  const { t } = useI18n();
  return <div className={s.notice} role={error ? 'alert' : 'status'}>{loading ? t('ui.loading') : error ? t('public.loadError') : t('public.noResults')}{error && <p><button type="button" className={s.secondary} onClick={onRetry}>{t('workspace.retry')}</button></p>}{!error && !loading && onReset && <p><button type="button" className={s.secondary} onClick={onReset}>{t('workspace.reset')}</button></p>}</div>;
}
