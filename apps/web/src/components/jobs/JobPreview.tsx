'use client';

import type { ReactNode } from 'react';
import { Link } from '@/lib/navigation';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { UgcText } from '@/components/ui/UgcText';
import { ShareButton } from '@/components/ui/ShareButton';
import { JobsIcon } from './JobsIcon';
import { formatJobSalary } from './formatJobSalary';
import s from './JobsWorkspace.module.css';
import { authLink } from '@/lib/authReturn';
import type { JobPromotion } from '@job-talentio/shared';
import { PromotionBadge } from './PromotionBadge';

type PreviewJob = {
  promotion?: JobPromotion | null;
  country?: { name: string } | null;
  id: string; title: string; description: string; contentLocale?: string | null;
  salaryMin?: number | null; salaryMax?: number | null; currency?: string | null;
  salaryPeriod?: string | null; workMode?: string; employmentType?: string; experienceLevel?: string | null;
  experienceYearsMin?: number | null; city?: { name: string } | null; category?: { name: string } | null;
  company: { name: string; slug: string; logoUrl?: string | null; anonymous?: boolean; isVerified?: boolean };
  jobSkills?: Array<{ skill: { name: string }; isRequired: boolean }>;
  benefits?: Array<{ benefit: { name: string } }>;
  jobLanguages?: Array<{ language: { name: string }; minLevel: string; isRequired: boolean; provenance?: string }>;
};

type Props = {
  standalone?: boolean;
  backHref?: string;
  companyHref?: string;
  chatHref?: string;
  job: PreviewJob; country?: string; onBack?: () => void; onApply?: () => void; onSave: () => void;
  onFollow?: () => void; following: boolean; appliedStatus?: string; guest: boolean; busy: boolean;
  submittedCvAvailable?: boolean; submittedCvTitle?: string | null; submittedCvBusy?: boolean; submittedCvError?: string; onViewSubmittedCv?: () => void;
  saved?: boolean; saving?: boolean; canSave?: boolean; success?: string; error?: string;
  children: ReactNode;
};

export function JobPreview({ standalone = false, backHref = '/jobs', companyHref, chatHref, job, country, onBack, onApply, onSave, onFollow, following, appliedStatus, guest, busy, submittedCvAvailable, submittedCvTitle, submittedCvBusy, submittedCvError, onViewSubmittedCv, saved, saving, canSave = true, success, error, children }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const Title = standalone ? 'h1' : 'h2';
  const employerName = job.company.anonymous ? t('job.confidentialEmployer') : job.company.name;
  return <div className={`${s.preview} ${standalone ? s.standalone : ''}`}>
    <div className={s.previewToolbar}>
      {standalone ? <Link className={s.textAction} href={backHref}><JobsIcon kind="back" />{t('workspace.back')}</Link> : <><button className={s.backButton} type="button" onClick={onBack}><JobsIcon kind="back" />{t('workspace.back')}</button><strong className={s.detailLabel}>{t('workspace.details')}</strong></>}
      <div className={s.previewTools}>
        {!standalone && <Link href={`/jobs/${job.id}`} className={s.textAction} aria-label={t('workspace.openFull')}><JobsIcon kind="external" /><span>{t('workspace.openFull')}</span></Link>}
        <ShareButton path={`/jobs/${job.id}`} title={job.title} className={s.textAction} />
        {!standalone && <button type="button" className={s.closePreview} onClick={onBack} aria-label={t('workspace.closeDetails')}><JobsIcon kind="close" /></button>}
      </div>
    </div>
    <div className={s.previewScroll}>
      <div className={s.previewCompany}>
        <span className={s.previewLogo}>{job.company.anonymous ? <JobsIcon kind="briefcase" /> : job.company.logoUrl ? <img src={job.company.logoUrl} alt="" /> : employerName.charAt(0)}</span>
        <div><div className={s.previewCompanyHeading}><strong>{employerName}{!job.company.anonymous && job.company.isVerified && <span aria-label={t('trustVerifiedChip')}> {'\u2713'}</span>}</strong><PromotionBadge promotion={job.promotion} /></div>
          {!job.company.anonymous && <Link href={companyHref || `/companies/${job.company.slug}`}>{t('viewCompanyProfile')} <span aria-hidden="true">{'\u2192'}</span></Link>}
        </div>
      </div>
      <Title className={s.previewTitle}>{job.title}</Title>
      <div className={s.previewMeta}>
        {(job.city?.name || country || job.country?.name) && <span><JobsIcon kind="pin" />{[job.city?.name, country || job.country?.name].filter(Boolean).join(', ')}</span>}
        {job.workMode && <span><JobsIcon kind="briefcase" />{enumLabel('workMode', job.workMode)}</span>}
        {job.employmentType && <span><JobsIcon kind="document" />{enumLabel('employmentType', job.employmentType)}</span>}

      </div>
      <p className={s.previewSalary}>{formatJobSalary(job, locale, t)}</p>
      <dl className={s.facts}>
        {(job.experienceLevel || job.experienceYearsMin != null) && <div><dt>{t('experience')}</dt><dd>{[enumLabel('experienceLevel', job.experienceLevel), job.experienceYearsMin != null ? t('job.yearsPreferred').replace('{n}', String(job.experienceYearsMin)) : ''].filter(Boolean).join(', ')}</dd></div>}
        {job.category && <div><dt>{t('category')}</dt><dd>{job.category.name}</dd></div>}
      </dl>
      {success && <p className={s.success} role="status">{success}</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <section className={s.description}><h3>{t('job.aboutTheRole')}</h3>
        <UgcText text={job.description} contentLocale={job.contentLocale} preserveLineBreaks />
      </section>
      {!!job.jobSkills?.length && <section className={s.detailSection}><h3>{t('skills')}</h3><div className={s.tags}>{job.jobSkills.map((item, index) => <span key={index} title={item.isRequired ? t('workspace.required') : undefined}>{item.skill.name}{item.isRequired ? ' *' : ''}</span>)}</div></section>}
      {!!job.benefits?.length && <section className={s.detailSection}><h3>{t('benefits')}</h3><div className={s.tags}>{job.benefits.map((item, index) => <span key={index}>{item.benefit.name}</span>)}</div></section>}
      {!!job.jobLanguages?.filter(item=>item.provenance === 'EMPLOYER_CONFIRMED').length && <section className={s.detailSection}><h3>{t('languages')}</h3><div className={s.tags}>{job.jobLanguages.filter(item=>item.provenance === 'EMPLOYER_CONFIRMED').map((item, index) => <span key={index}>{item.language.name} {item.minLevel}+{item.isRequired ? ' *' : ''}</span>)}</div></section>}
      {!job.company.anonymous && onFollow && <button className={s.textAction} type="button" onClick={onFollow}>{following ? t('following') : t('followCompany')}</button>}
    </div>
    <div className={s.previewActions}>
      {appliedStatus ? <><span className={s.applied}>{t('job.appliedBadge')} / {enumLabel('applicationStatus', appliedStatus)}</span><Link className={s.outlineButton} href="/dashboard/employee?tab=applications">{t('job.viewMyApplications')}</Link>{submittedCvAvailable && onViewSubmittedCv ? <button type="button" className={s.outlineButton} onClick={onViewSubmittedCv} disabled={submittedCvBusy} title={submittedCvTitle || undefined} aria-label={submittedCvTitle ? `${t('job.viewSubmittedCv')}: ${submittedCvTitle}` : t('job.viewSubmittedCv')}><JobsIcon kind="document" />{submittedCvBusy ? t('loading') : t('job.viewSubmittedCv')}</button> : <span className={s.cvUnavailable}>{t('noCvAttached')}</span>}{submittedCvError && <span className={s.cvError} role="alert">{submittedCvError}</span>}</> : onApply && <button type="button" className={s.primaryButton} onClick={onApply} disabled={busy}>{t('applyNow')}</button>}
      {canSave && <button type="button" className={s.outlineButton} onClick={onSave} disabled={saving} aria-pressed={saved || false}><JobsIcon kind={saved ? 'check' : 'bookmark'} />{saved ? t('workspace.saved') : t('saveJob')}</button>}
      {chatHref && <Link href={chatHref} className={s.outlineButton}>{t('chatWithRecruiter')}</Link>}
      {guest && <Link href={authLink('/login', `/jobs/${job.id}`)} className={s.guestNote}>{t('workspace.signIn')}</Link>}
    </div>
    {children}
  </div>;
}
