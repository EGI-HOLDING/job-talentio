'use client';

import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="shell" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>404</h1>
      <p className="muted">{t('pageNotFound')}</p>
      <div className="chips" style={{ justifyContent: 'center', marginTop: '1.25rem' }}>
        <Link href="/" className="chip">
          {t('backHome')}
        </Link>
        <Link href="/jobs" className="chip">
          {t('jobs')}
        </Link>
      </div>
    </div>
  );
}
