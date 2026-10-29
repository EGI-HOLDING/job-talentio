'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, localeUrl } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { postOnce } from '@/lib/hr-benefits';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { localizedJobLocation } from '@/lib/location';
import { dateLabel } from '@/components/employee/WorkspacePrimitives';
import { useJobRowBenefits } from './useJobRowBenefits';
import { jobRowPolicy } from './jobRowPolicy';
import { JobRowIcon } from './JobRowIcon';
import { JobRowDialog } from './JobRowDialog';
import { RecruiterJobActions } from './RecruiterJobActions';
import s from './RecruiterJobTable.module.css';

type Props = { job: any; companyId: string; companyOpen: boolean; busy: boolean; onEdit: () => void; onReviewPublish: () => void; onDuplicate: () => void; onStatus: (next: string) => void; onApplicants: () => void; onPeriodExpired: () => void; onFlash: (message: string, tone?: 'success' | 'error') => void };
export function RecruiterJobRow({ job, companyId, companyOpen, busy, onEdit, onReviewPublish, onDuplicate, onStatus, onApplicants, onPeriodExpired, onFlash }: Props) {
  const { t, locale } = useI18n(), enumLabel = useEnumLabel();
  const benefit = useJobRowBenefits(companyId, job.id, job.status, locale);
  const policy = jobRowPolicy(job, benefit.data, companyOpen);
  const [dialog, setDialog] = useState<'period' | 'boost' | 'link' | null>(null);
  const [boostBusy, setBoostBusy] = useState(false), [boostError, setBoostError] = useState(''), [committed, setCommitted] = useState(false);
  const [sharedLink, setSharedLink] = useState('');
  const lock = useRef(false), alive = useRef(true), menuTrigger = useRef<HTMLButtonElement>(null);
  const notifiedExpiry = useRef('');
  const context = [companyId, job.id, job.status, locale].join(':');
  const current = useRef(context); current.current = context;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setDialog(null); setBoostError(''); setCommitted(false); }, [context]);
  useEffect(() => { if (benefit.data) setCommitted(false); }, [benefit.data]);
  useEffect(() => { if (benefit.data && policy.status === 'EXPIRED' && ['PUBLISHED', 'PAUSED'].includes(job.status) && notifiedExpiry.current !== context) { notifiedExpiry.current = context; onPeriodExpired(); } }, [benefit.data, policy.status, job.status, context]);
  function openDialog(next: 'period' | 'boost') { setBoostError(''); setDialog(next); void benefit.refresh(); }
  const rowBusy = busy || boostBusy;
  async function activateBoost() {
    if (lock.current || rowBusy || committed) return;
    lock.current = true; setBoostBusy(true); setBoostError('');
    const requested = context;
    try {
      const fresh = await benefit.refresh();
      if (!alive.current || current.current !== requested) return;
      if (!fresh) { setBoostError(t('jr.refreshBeforeBoost')); return; }
      if (!jobRowPolicy(job, fresh, companyOpen).canBoost) { setBoostError(t('jr.boostChanged')); return; }
      await postOnce('/benefits/jobs/' + encodeURIComponent(job.id) + '/boost');
      if (!alive.current || current.current !== requested) return;
      setCommitted(true); onFlash(t('jr.boostActivated'));
      // A failed refresh after commit is not a failed activation or a second intent.
      const updated = await benefit.refresh();
      if (!alive.current || current.current !== requested) return;
      if (!updated) setBoostError(t('jr.boostActivatedRefreshFailed'));
      window.dispatchEvent(new Event('hr-benefits-updated'));
    } catch {
      if (alive.current && current.current === requested) { setBoostError(t('jr.boostFailed')); void benefit.refresh(); }
    } finally {
      lock.current = false;
      if (alive.current) setBoostBusy(false);
    }
  }
  async function copyLink() {
    if (!policy.publicVisible) return;
    const link = new URL(localeUrl(locale, '/jobs/' + encodeURIComponent(job.id)), window.location.origin).href;
    const requested = context;
    try { await navigator.clipboard.writeText(link); if (alive.current && current.current === requested) onFlash(t('jr.linkCopied')); }
    catch { if (alive.current && current.current === requested) { setSharedLink(link); setDialog('link'); } }
  }
  function duration(seconds: number, compact = false) {
    if (seconds < 60) return compact ? '<1 ' + t('jr.shortMinutes') : t('jr.lessMinute');
    const hours = seconds / 3600;
    return hours >= 1 ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours) + ' ' + t('hr.hours') : new Intl.NumberFormat(locale).format(Math.ceil(seconds / 60)) + ' ' + t(compact ? 'jr.shortMinutes' : 'jr.minutes');
  }
  function counter(value: number) { return new Intl.NumberFormat(locale, value >= 10000 ? { notation: 'compact', maximumFractionDigits: 0 } : {}).format(value); }
  const fullDate = (value: string | null | undefined) => dateLabel(value, locale, true);
  const location = localizedJobLocation(job, t);
  const content = benefit.phase === 'ready' && benefit.data;
  const placeholder = <span className={s.unavailable} aria-label={t(benefit.phase === 'loading' ? 'loading' : 'jr.notAvailable')}>{benefit.phase === 'loading' ? <span className={s.skeleton} /> : '\u2014'}</span>;
  const retry = <button type="button" className={s.retry} onClick={() => void benefit.refresh()} aria-label={t('jr.retryBenefits')}><JobRowIcon kind="info" />{t('workspace.retry')}</button>;
  const stats = [{ icon: 'user', label: t('applications'), value: job._count?.applications || 0 }, { icon: 'eye', label: t('rec.viewsWord'), value: job._count?.views || 0 }];
  return <tr className={s.row} data-job-id={job.id}>
    <td className={s.jobCell}><Link className={s.jobTitle} href={employerJobHref(job.id, 'applicants', companyId)} title={job.title}>{job.title}</Link><span className={s.jobMeta}>{[enumLabel('employmentType', job.employmentType), enumLabel('experienceLevel', job.experienceLevel)].filter(Boolean).join(' | ')}</span></td>
    <td data-label={t('status')}><span className={s.status} data-status={policy.status} title={enumLabel('jobStatus', policy.status)}>{enumLabel('jobStatus', policy.status)}</span></td>
    <td data-label={t('jr.package')}>{content ? <span className={s.packageBadge} title={t(content.selected ? 'hr.package.' + content.code : 'jr.unselected')}>{t(content.selected ? 'hr.package.' + content.code : 'jr.unselected')}</span> : benefit.phase === 'error' ? retry : placeholder}</td>
    <td data-label={t('city')}><span className={s.location} title={location}>{location}</span></td>
    <td data-label={t('jr.performance')}><div className={s.performance}>{stats.map(item => <span key={item.label} tabIndex={0} title={item.label + ': ' + new Intl.NumberFormat(locale).format(item.value)} aria-label={item.label + ': ' + new Intl.NumberFormat(locale).format(item.value)}><JobRowIcon kind={item.icon} /><span>{counter(item.value)}</span></span>)}</div></td>
    <td data-label={t('jr.period')}>{content ? <button type="button" className={s.periodButton} onClick={() => openDialog('period')} aria-label={t('jr.periodDetails')} title={t('jr.periodDetails')}><span>{content.expiresAt ? dateLabel(content.expiresAt, locale) : t('jr.notPublished')}</span><JobRowIcon kind="info" /></button> : placeholder}</td>
    <td data-label={t('jr.boost')}>{content && policy.boostDetails && (policy.activeBoost || content.boostRemainingSeconds > 0) ? <button type="button" className={s.boostIndicator} data-active={Boolean(policy.activeBoost)} onClick={() => openDialog('boost')} title={policy.activeBoost ? t('hr.boostUntil') + ' ' + fullDate(policy.activeBoost.endsAt) : t('jr.boostDetails')} aria-label={t('jr.boostDetails')}><JobRowIcon kind="boost" /><span>{policy.activeBoost ? t('jr.active') : duration(content.boostRemainingSeconds, true)}</span></button> : content ? <span className={s.unavailable} title={t('jr.noBoost')} aria-label={t('jr.noBoost')}>{'\u2014'}</span> : placeholder}</td>
    <td className={s.actionCell}><div className={s.rowActions}><button type="button" className={s.applicants} onClick={onApplicants}>{t('rw.applicants')}</button><RecruiterJobActions job={job} companyId={companyId} busy={rowBusy} policy={policy} benefitPhase={benefit.phase} triggerRef={menuTrigger} onEdit={onEdit} onReviewPublish={onReviewPublish} onStatus={onStatus} onDuplicate={onDuplicate} onBoost={() => openDialog('boost')} onCopy={() => void copyLink()} onRetry={() => void benefit.refresh()} /></div>
      {dialog && <JobRowDialog title={t(dialog === 'period' ? 'jr.periodDetails' : dialog === 'boost' ? 'jr.boostDetails' : 'jr.copyLink')} subtitle={job.title} busy={boostBusy} returnFocus={menuTrigger} onClose={() => setDialog(null)} footer={<><button type="button" className={s.secondary} disabled={boostBusy} onClick={() => setDialog(null)}>{t('close')}</button>{dialog === 'boost' && policy.canBoost && !committed && <button type="button" className={s.primary} disabled={boostBusy} onClick={() => void activateBoost()}><JobRowIcon kind="boost" />{t(boostBusy ? 'saving' : 'hr.activateBoost')}</button>}</>}>
        {dialog === 'link' ? <><p className={s.explanation}>{t('jr.copyManually')}</p><input className={s.copyInput} aria-label={t('jr.publicLink')} value={sharedLink} readOnly onFocus={event => event.currentTarget.select()} /></> : <>
          {benefit.phase === 'loading' ? <p className={s.explanation} role="status">{t('loading')}</p> : !content ? <div role="alert" className={s.readError}><p>{t('ew.loadFailed')}</p>{retry}</div> : dialog === 'period' ? <dl className={s.facts}><div><dt>{t('jr.createdAt')}</dt><dd>{fullDate(job.createdAt)}</dd></div><div><dt>{t('rw.posted')}</dt><dd>{job.publishedAt ? fullDate(job.publishedAt) : t('jr.notPublished')}</dd></div><div><dt>{t('jr.publicationStart')}</dt><dd>{content.startsAt ? fullDate(content.startsAt) : t('hr.startsOnPublish')}</dd></div><div><dt>{t('jr.publicationEnd')}</dt><dd>{content.expiresAt ? fullDate(content.expiresAt) : t('hr.startsOnPublish')}</dd></div></dl> : <>
            <div className={s.boostBanner}><JobRowIcon kind="boost" /><span>{t(policy.activeBoost ? 'jr.boostActive' : policy.canBoost ? 'jr.boostReady' : 'jr.noBoostNow')}</span></div>
            <dl className={s.facts}><div><dt>{t('jr.remainingAllowance')}</dt><dd>{content.boostRemainingSeconds > 0 ? duration(content.boostRemainingSeconds) : t('jr.noAllowance')}</dd></div>{policy.activeBoost ? <><div><dt>{t('jr.effectiveDuration')}</dt><dd>{duration(Math.max(0, (Date.parse(policy.activeBoost.endsAt) - Date.parse(policy.activeBoost.startsAt)) / 1000))}</dd></div><div><dt>{t('jr.boostStarted')}</dt><dd>{fullDate(policy.activeBoost.startsAt)}</dd></div><div><dt>{t('hr.boostUntil')}</dt><dd>{fullDate(policy.activeBoost.endsAt)}</dd></div></> : <div><dt>{t('jr.effectiveDuration')}</dt><dd>{content.boostEffectiveSeconds > 0 ? duration(content.boostEffectiveSeconds) : t('jr.notAvailable')}</dd></div>}<div><dt>{t('jr.publicationEnd')}</dt><dd>{content.expiresAt ? fullDate(content.expiresAt) : t('hr.startsOnPublish')}</dd></div></dl>
            <p className={s.explanation}>{t('jr.boostClockHint')}</p>{!policy.canBoost && !policy.activeBoost && <p className={s.explanation}>{t(!content.boostEnabled ? 'jr.boostDisabled' : policy.expired ? 'jr.boostExpired' : policy.status !== 'PUBLISHED' ? 'jr.boostPublishedOnly' : 'jr.noBoost')}</p>}
          </>}
          {boostError && <p className={s.dialogError} role="alert">{boostError}</p>}
        </>}
      </JobRowDialog>}
    </td>
  </tr>;
}
