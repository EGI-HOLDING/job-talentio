'use client';

import { useI18n } from '@/lib/i18n';

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="shell">
        © {new Date().getFullYear()} {t('footer')}
      </div>
    </footer>
  );
}
