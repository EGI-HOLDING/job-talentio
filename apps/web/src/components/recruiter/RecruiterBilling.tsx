'use client';

import { PLAN_LIMITS, PLAN_PRICES_UZS, HOT_JOB_DAYS } from '@job-talentio/shared';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { localizedJobLocation } from '@/lib/location';
import { formatUzs } from '@/lib/numberFormat';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import s from './RecruiterWorkspace.module.css';
import c from './RecruiterReports.module.css';

const ORDER = ['FREE','STANDARD','PREMIUM','VIP'] as const;
type Plan=typeof ORDER[number];
const FEATURES:Record<Plan,string[]>={FREE:['rec.planFeature3Jobs','rec.planFeatureContactsBlurred','rec.planFeatureNoColdChat'],STANDARD:['rec.planFeature5Jobs','rec.planFeatureContactsFull','rec.planFeatureNoColdChat'],PREMIUM:['rec.planFeature20Jobs','rec.planFeatureContactsFull','rec.planFeatureColdChat20'],VIP:['rec.planFeature50Jobs','rec.planFeatureContactsFull','rec.planFeatureColdChat50','rec.planFeatureVipBadge']};
export function RecruiterBilling({ plan, subscription, jobs, busy, onUpgrade, onBoost }: {plan:Plan; subscription:any; jobs:any[]; busy:boolean; onUpgrade:(plan:'STANDARD'|'PREMIUM'|'VIP')=>void; onBoost:(id:string,days:7|14|30)=>void}) {
  const {t,locale}=useI18n(); const enumLabel=useEnumLabel();
  const published=jobs.filter((job)=>job.status==='PUBLISHED');
  const limit=PLAN_LIMITS[plan].activeJobs;
  return <div className={s.scroll}>
    <div className={c.planHeader}><div><span className={s.status}>{t('rec.currentPlan')}</span><h2>{enumLabel('plan',plan)}</h2>{subscription?.endsAt && <p>{t('rec.renewsEnds').replace('{date}',new Date(subscription.endsAt).toLocaleDateString(locale))}</p>}<p>{t('rec.demoModeBadge')} | {t('rec.demoCheckoutNote')}</p></div><div className={c.usage}>{t('rec.publishedJobs')}<strong className={s.sub}>{published.length} / {limit}</strong><progress aria-label={t('rec.publishedJobs')} value={published.length} max={limit} /></div></div>
    <div className={c.plans}>{ORDER.map((code)=>{const current=plan===code; const upgrade=code!=='FREE'&&ORDER.indexOf(code)>ORDER.indexOf(plan); return <section key={code} className={c.plan} data-current={current}><h3>{enumLabel('plan',code)}</h3><div className={c.price}>{PLAN_PRICES_UZS[code]===0?t('rec.free'):formatUzs(PLAN_PRICES_UZS[code])}<small>{code!=='FREE'&&t('rec.perMonth')}</small></div><ul>{FEATURES[code].map((key)=><li key={key}><WorkspaceIcon kind="check" />{t(key)}</li>)}</ul>{current?<button className={s.secondary} disabled>{t('rec.currentPlan')}</button>:upgrade?<button className={s.primary} disabled={busy} onClick={()=>onUpgrade(code as 'STANDARD'|'PREMIUM'|'VIP')}>{t('rec.upgradeTo').replace('{plan}',enumLabel('plan',code))}</button>:<span className={s.emptyNote}>{t(code==='FREE'?'rec.included':'rec.alreadyHigherPlan')}</span>}</section>;})}</div>
    <section className={c.section}><h2>{t('rec.hotJobBoosts')}</h2><p className={s.emptyNote}>{t('rec.hotBoostHint')}</p>{!published.length?<p className={s.emptyNote}>{t('rec.noPublishedJobs')}</p>:published.map((job)=><div key={job.id} className={c.boost}><div><strong>{job.title}</strong><span className={s.sub}>{localizedJobLocation(job,t)}{job.boostUntil&&new Date(job.boostUntil)>new Date()?' | '+t('rec.hotUntil').replace('{date}',new Date(job.boostUntil).toLocaleDateString(locale)):''}</span></div><div className={s.actions}>{HOT_JOB_DAYS.map((days)=><button key={days} className={s.secondary} disabled={busy} onClick={()=>onBoost(job.id,days)}>{t('rec.daysShort').replace('{n}',String(days))} | {formatUzs(PLAN_PRICES_UZS[`HOT_JOB_${days}D`])}</button>)}</div></div>)}</section>
  </div>;
}
