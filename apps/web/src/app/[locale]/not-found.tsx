'use client';

import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import s from '@/components/public/PublicPages.module.css';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className={s.page}><div className={s.status}>
      <h1 style={{ marginBottom: '0.5rem' }}>404</h1>
      <p className="muted">{t('pageNotFound')}</p>
      <div className={s.actions}>
        <Link href="/" className={s.secondary}>
          {t('backHome')}
        </Link>
        <Link href="/jobs" className={s.primary}>
          {t('jobs')}
        </Link>
      </div>
    </div></div>
  );
}
