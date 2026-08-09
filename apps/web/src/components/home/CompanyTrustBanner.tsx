'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import {
  CompanyCompletenessInput,
  computeCompanyCompleteness,
} from '@/lib/company-completeness';

export function CompanyTrustBanner({ company }: { company: CompanyCompletenessInput | null }) {
  const { t } = useI18n();
  const c = computeCompanyCompleteness(company);

  if (c.complete) {
    if (!c.isVerified) return null;
    return (
      <div className="trust-banner trust-banner--ok">
        <strong>{t('trustVerifiedChip')}</strong>
      </div>
    );
  }

  const missing = c.items.filter((i) => !i.done).slice(0, 4);

  return (
    <div className="trust-banner">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{t('trustBannerTitle')}</strong>
          <span className="badge">{c.percent}%</span>
          {c.isVerified ? <span className="badge hot">{t('trustVerifiedChip')}</span> : null}
        </div>
        <p className="muted" style={{ margin: '0.35rem 0 0.5rem' }}>
          {t('trustBannerSubtitle')}
        </p>
        <ul className="trust-banner__list">
          {missing.map((item) => (
            <li key={item.key}>{t(item.labelKey)}</li>
          ))}
        </ul>
      </div>
      <Link href="/dashboard/recruiter?tab=company" className="cta" style={{ whiteSpace: 'nowrap' }}>
        {t('trustBannerCta')}
      </Link>
    </div>
  );
}
