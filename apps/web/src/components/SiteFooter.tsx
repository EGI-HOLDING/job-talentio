'use client';

import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="shell" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          © {new Date().getFullYear()} {t('footer')}
        </span>
        <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }} aria-label="Footer">
          <Link href="/jobs">{t('jobs')}</Link>
          <Link href="/news">{t('news')}</Link>
          <Link href="/terms">{t('termsOfService')}</Link>
          <Link href="/privacy">{t('privacyPolicy')}</Link>
        </nav>
      </div>
    </footer>
  );
}
