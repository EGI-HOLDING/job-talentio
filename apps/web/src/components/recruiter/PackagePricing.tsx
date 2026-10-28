'use client';
import { useEffect, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { Link, useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { PackageCatalog, PackageCode, JobPackage, money, withPackagePreference } from '@/lib/jobCommerce';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import s from './JobCommerce.module.css';

export function PackagePricing({catalog: supplied, onChoose, current, preferred, busy, disabledCodes = [], upgradeFrom}: {
  catalog?: PackageCatalog; onChoose?: (code: PackageCode) => void; current?: PackageCode; preferred?: PackageCode; busy?: boolean; disabledCodes?: PackageCode[]; upgradeFrom?: JobPackage;
}) {
  const {t, locale} = useI18n(), router = useRouter();
  const [catalog, setCatalog] = useState(supplied), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (supplied) {setCatalog(supplied); return;}
    const abort = new AbortController();
    api<PackageCatalog>('/job-commerce/catalog', {auth: false, signal: abort.signal}).then(setCatalog).catch(e => {if (!abort.signal.aborted) setError(e.message);});
    return () => abort.abort();
  }, [supplied, retry]);
  const label = (key: string) => t('commerce.' + key);
  const check = <span className={s.check} aria-label={label('included')}>✓</span>;
  const days = (n: number) => n ? label('days').replace('{n}', String(n)) : '-';
  const recommendation = (p: JobPackage) => <>{label(p.code === 'FREE' ? 'basic' : p.code === 'STANDARD' ? 'aiRecommendations' : 'advancedAiRecommendations')}{p.code !== 'FREE' && <small className={s.planned}>{label('planned')}</small>}</>;
  const rows: Array<{key: string; value: (p: JobPackage) => React.ReactNode}> = [
    {key: 'essentials', value: () => check}, {key: 'candidateAccess', value: () => check}, {key: 'filters', value: () => check},
    {key: 'recommendations', value: recommendation}, {key: 'visibility', value: p => label(p.code === 'FREE' ? 'normal' : p.code === 'STANDARD' ? 'increased' : 'priority')},
    {key: 'stats', value: () => check}, {key: 'conversions', value: p => p.settings.conversions ? check : '-'},
    {key: 'boost', value: p => days(p.settings.boostDays)}, {key: 'featured', value: p => days(p.settings.featuredDays)},
    {key: 'reports', value: p => p.settings.reports ? check : '-'}, {key: 'support', value: p => p.settings.prioritySupport ? check : '-'},
    {key: 'linkedin', value: p => p.linkedin ? check : '-'}, {key: 'instagram', value: p => p.instagram === 'COMING_SOON' ? label('instagram') : '-'},
  ];
  if (!catalog) return error ? <div className={s.error} role="alert">{error}<br/><button className={s.text} onClick={() => {setError(''); setRetry(n => n + 1);}}>{t('workspace.retry')}</button></div> : <WorkspaceLoading/>;
  return <>
    <div className={s.cards}>{catalog.packages.map(p => <article className={s.card} data-code={p.code} key={p.code}>
      {p.code === 'STANDARD' && <span className={s.badge}>{label('recommended')}</span>}
      <h2>{label(p.code)}</h2>{preferred === p.code && <span className={s.preferred} data-preferred={p.code}>{label('preferred')}</span>}<p className={s.cardHint}>{label(p.code === 'FREE' ? 'freeHint' : p.code === 'STANDARD' ? 'standardHint' : 'premiumHint')}</p>
      <div className={s.price}>{money(upgradeFrom && p.amount > upgradeFrom.amount ? p.amount - upgradeFrom.amount : p.amount, locale, p.currency)}</div><span className={s.period}>{label(upgradeFrom && p.amount > upgradeFrom.amount ? 'upgrade' : 'perJob')}</span>
      {onChoose ? <button className={p.code === 'STANDARD' ? s.primary : s.secondary} disabled={busy || disabledCodes.includes(p.code)} onClick={() => onChoose(p.code)}>
        {current === p.code ? label('current') : label(p.code === 'FREE' ? 'continueFree' : 'choose')} {current !== p.code && '→'}
      </button> : <Link className={p.code === 'STANDARD' ? s.primary : s.secondary}
        href={'/register?' + new URLSearchParams({role: 'RECRUITER', next: withPackagePreference('/dashboard/recruiter?tab=jobs', p.code)})}
        onClick={event => {if (getSession()?.user.role === 'RECRUITER') {event.preventDefault(); router.push(withPackagePreference('/dashboard/recruiter?tab=jobs', p.code));}}}>{label(p.code === 'FREE' ? 'continueFree' : 'choose')} →</Link>}
      <ul className={s.features}>
        <li>{check}<span>{label('essentials')}</span></li><li>{p.code === 'FREE' ? check : <span className={s.check} aria-hidden="true">◷</span>}<span>{label('recommendations')} | {recommendation(p)}</span></li><li>{check}<span>{label('stats')}</span></li>
        {p.settings.conversions && <li>{check}<span>{label('conversions')}</span></li>}
        {p.settings.boostDays > 0 && <li>{check}<span>{label('boost')} | {days(p.settings.boostDays)}</span></li>}
        {p.settings.featuredDays > 0 && <li>{check}<span>{label('featured')} | {days(p.settings.featuredDays)}</span></li>}
        {p.settings.reports && <li>{check}<span>{label('reports')}</span></li>}
        {p.settings.prioritySupport && <li>{check}<span>{label('support')}</span></li>}
        {p.linkedin && <li>{check}<span>{label('linkedin')}</span></li>}
        {p.code === 'PREMIUM' && <li className={s.muted}><span className={s.check}>◷</span><span>{label('instagram')}</span></li>}
      </ul>
    </article>)}</div>
    <p className={s.freeNote}><span className={s.check}>✓</span>{label('freeDatabase')}</p>
    <p className={s.notice}>{label('recommendationsPlanned')}</p>
    <details className={s.comparison}><summary>{label('allFeatures')}</summary><div className={s.tableWrap} tabIndex={0} role="region" aria-label={label('allFeatures')}>
      <table><thead><tr><th scope="col">{label('pricing')}</th>{catalog.packages.map(p => <th scope="col" key={p.code}>{label(p.code)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row.key)}</th>{catalog.packages.map(p => <td key={p.code}>{row.value(p)}</td>)}</tr>)}</tbody></table>
    </div></details>
    <p className={s.muted} style={{fontSize: '.78rem', lineHeight: 1.8, marginTop: 20}}>{label('linkedinHint')}</p>
  </>;
}

export function PublicPricing() {
  const {t} = useI18n();
  return <div className={s.page}><header className={s.intro}><span className={s.eyebrow}>Talentio | {t('commerce.pricing')}</span><h1>{t('commerce.title')}</h1><p>{t('commerce.subtitle')}</p></header><PackagePricing/></div>;
}
