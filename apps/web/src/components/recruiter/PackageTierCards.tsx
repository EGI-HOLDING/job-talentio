'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { money, packageLabel, type JobPackage, type PackageCatalog, type PackageCode } from '@/lib/jobCommerce';
import s from './PackageTierCards.module.css';

const copy = {
  id: {
    sandbox: 'Sandbox', perJob: 'per lowongan', days: 'hari', duration: 'Masa tayang lowongan', live: 'Wawancara AI secara live',
    boost: 'Job Boost manual', featured: 'Perusahaan unggulan', conversions: 'Analitik konversi', reports: 'Laporan rekrutmen dan ekspor CSV',
    support: 'Dukungan prioritas', linkedin: 'Posting ke halaman perusahaan LinkedIn', imported: 'Impor CV dari portal lain',
    interviewed: 'Kandidat yang dapat diwawancarai AI', compare: 'Bandingkan semua fitur', included: 'Termasuk', excluded: 'Tidak termasuk',
    draft: 'Buat lowongan dengan AI', applicants: 'Kelola pelamar, cari kandidat, dan akses database CV', interviews: 'Wawancara AI via chat dan live',
    ranking: 'Penilaian CV dan ranking kandidat dengan AI', chat: 'Wawancara AI via chat', feature: 'Fitur',
    choose: 'Pilih', selected: 'Dipilih', selection: 'Pilihan paket lowongan', preview: 'Angka impor dan wawancara untuk preview kapasitas.',
    LITE: 'Mulai rekrutmen untuk satu kebutuhan', STANDARD: 'Jangkauan lebih luas dan analitik konversi',
    PREMIUM: 'Distribusi dan laporan rekrutmen lengkap', FREE: '',
  },
  en: {
    sandbox: 'Sandbox', perJob: 'per job', days: 'days', duration: 'Job posting duration', live: 'Live AI interviews',
    boost: 'Manual Job Boost', featured: 'Featured company placement', conversions: 'Conversion analytics', reports: 'Recruitment reports and CSV export',
    support: 'Priority support', linkedin: 'Post to the company LinkedIn page', imported: 'Import CVs from other platforms',
    interviewed: 'Candidates eligible for AI interviews', compare: 'Compare all features', included: 'Included', excluded: 'Not included',
    draft: 'Draft your job with AI', applicants: 'Manage applicants, search candidates, and access the CV database', interviews: 'AI interviews by chat and live',
    ranking: 'AI CV assessment and candidate ranking', chat: 'AI chat interviews', feature: 'Feature',
    choose: 'Choose', selected: 'Selected', selection: 'Job package options', preview: 'Import and interview figures are capacity previews.',
    LITE: 'Start hiring for one role', STANDARD: 'Reach more candidates and track conversions',
    PREMIUM: 'Broader distribution and recruitment reporting', FREE: '',
  },
};

export function PackageTierCards({ catalog, selected, onSelect, action, upgradeFromAmount, disabled }: {
  catalog: PackageCatalog;
  selected?: PackageCode | '';
  onSelect?: (code: PackageCode) => void;
  action?: (pack: JobPackage) => ReactNode;
  upgradeFromAmount?: number;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const t = locale === 'id' ? copy.id : copy.en;
  const number = new Intl.NumberFormat(locale);
  const days = (value: number) => `${number.format(value)} ${t.days}`;
  const common = [t.draft, t.applicants, t.ranking, t.chat, t.live];
  const mark = (enabled: boolean) => <span className={enabled ? s.check : s.dash} aria-label={enabled ? t.included : t.excluded}>{enabled ? '\u2713' : '\u2014'}</span>;
  const showPreviewCapacity = catalog.packages.some(pack => pack.previewCapacity);
  const previewRows: Array<[string, (pack: JobPackage) => ReactNode]> = [
    [t.imported, pack => pack.previewCapacity ? number.format(pack.previewCapacity.importedCvs) : '\u2014'],
    [t.interviewed, pack => pack.previewCapacity ? number.format(pack.previewCapacity.interviewedCandidates) : '\u2014'],
  ];
  const rows: Array<[string, (pack: JobPackage) => ReactNode]> = [
    [t.duration, p => days(p.settings.durationDays)],
    ...common.map((label): [string, () => ReactNode] => [label, () => mark(true)]),
    ...(showPreviewCapacity ? previewRows : []),
    [t.boost, p => days(p.settings.boostDays)],
    [t.featured, p => days(p.settings.featuredDays)],
    [t.conversions, p => mark(p.settings.conversions)],
    [t.reports, p => mark(p.settings.reports)],
    [t.support, p => mark(p.settings.prioritySupport)],
    [t.linkedin, p => mark(p.linkedin)],
  ];

  return <div className={s.catalog}>
    {catalog.sandbox && <span className={s.sandbox}>{t.sandbox}</span>}
    <div className={s.grid} role={onSelect ? 'radiogroup' : undefined} aria-label={onSelect ? t.selection : undefined}>
      {catalog.packages.map(pack => <article className={s.card} key={pack.code} data-code={pack.code} data-selected={selected === pack.code}>
        <header>
          <h2>{packageLabel(pack.code)}</h2>
          <p>{t[pack.code]}</p>
          <div className={s.price}>{money(pack.amount > (upgradeFromAmount ?? 0) ? pack.amount - (upgradeFromAmount ?? 0) : pack.amount, locale, pack.currency)}</div>
          <span>{t.perJob}</span>
        </header>
        <div className={s.duration}><span aria-hidden="true">◷</span> {days(pack.settings.durationDays)} {locale === 'id' ? 'tayang' : 'live'}</div>
        <ul className={s.features}>
          <li>{mark(true)} <span>{t.ranking}</span></li>
          <li>{mark(true)} <span>{t.interviews}</span></li>
          <li>{mark(true)} <span>{t.boost}<strong>{days(pack.settings.boostDays)}</strong></span></li>
          <li>{mark(true)} <span>{t.featured}<strong>{days(pack.settings.featuredDays)}</strong></span></li>
          {pack.previewCapacity && <li>{mark(true)} <span>{t.imported}<strong>{number.format(pack.previewCapacity.importedCvs)}</strong></span></li>}
          {pack.settings.conversions && <li>{mark(true)} <span>{t.conversions}</span></li>}
          {pack.settings.reports && <li>{mark(true)} <span>{t.reports}</span></li>}
          {pack.settings.prioritySupport && <li>{mark(true)} <span>{t.support}</span></li>}
          {pack.linkedin && <li>{mark(true)} <span>{t.linkedin}</span></li>}
        </ul>
        {onSelect ? <label className={s.pick}>
          <input name="job-package" type="radio" checked={selected === pack.code} aria-label={packageLabel(pack.code)}
            disabled={disabled} onChange={() => onSelect(pack.code)}/>
          {selected === pack.code ? t.selected : `${t.choose} ${packageLabel(pack.code)}`}
        </label> : action?.(pack)}
      </article>)}
    </div>
    <details className={s.compare}>
      <summary>{t.compare}</summary>
      <div className={s.table} tabIndex={0} role="region" aria-label={t.compare}>
        <table><thead><tr><th scope="col">{t.feature}</th>{catalog.packages.map(p => <th scope="col" key={p.code}>{packageLabel(p.code)}</th>)}</tr></thead>
          <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{catalog.packages.map(p => <td key={p.code}>{value(p)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
    {showPreviewCapacity && <p className={s.preview}>{t.preview}</p>}
  </div>;
}

export function PackageBenefitReceipt({ settings, linkedin, locale }: {
  settings: JobPackage['settings']; linkedin?: boolean; locale: string;
}) {
  const t = locale === 'id' ? copy.id : copy.en;
  return <dl className={s.receipt}>
    <div><dt>{t.duration}</dt><dd>{settings.durationDays} {t.days}</dd></div>
    <div><dt>{t.boost}</dt><dd>{settings.boostDays} {t.days}</dd></div>
    <div><dt>{t.featured}</dt><dd>{settings.featuredDays} {t.days}</dd></div>
    {settings.conversions && <div><dt>{t.conversions}</dt><dd>{t.included}</dd></div>}
    {settings.reports && <div><dt>{t.reports}</dt><dd>{t.included}</dd></div>}
    {settings.prioritySupport && <div><dt>{t.support}</dt><dd>{t.included}</dd></div>}
    {(settings.companyPageLinkedIn || linkedin) && <div><dt>{t.linkedin}</dt><dd>{t.included}</dd></div>}
  </dl>;
}
