'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { FindTalentPanel } from '@/components/talent/FindTalentPanel';

function TalentPageInner() {
  const { t } = useI18n();
  return (
    <div className="shell" style={{ paddingTop: '1.5rem', paddingBottom: '3rem' }}>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        <Link href="/">{t('home')}</Link>
        {' / '}
        <span>{t('findTalent')}</span>
      </p>
      <FindTalentPanel />
    </div>
  );
}

export default function TalentPage() {
  return (
    <Suspense fallback={<div className="shell muted">Loading...</div>}>
      <TalentPageInner />
    </Suspense>
  );
}
