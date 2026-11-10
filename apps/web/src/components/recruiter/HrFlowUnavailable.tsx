'use client';

import { useHrCopy } from '@/lib/i18n/hr-flow';
import s from './HrFlow.module.css';

export function HrFlowUnavailable() {
  const c = useHrCopy();

  return (
    <main className={s.page} data-hr-surface>
      <section className={s.stageCard} style={{ maxWidth: 720, margin: '72px auto' }}>
        <h1 className={s.title}>{c('Pembuatan lowongan saat ini difokuskan untuk perusahaan di Indonesia.')}</h1>
        <p className={s.subtitle}>{c('Layanan HR untuk pasar lain belum tersedia.')}</p>
      </section>
    </main>
  );
}