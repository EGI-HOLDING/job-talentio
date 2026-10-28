'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { employerJobHref, employerWorkspaceHref, jobDetailHref } from '@/lib/accountNavigation';
import { DatabaseCvAccess } from './HrBenefits';
import { api, getSession } from '@/lib/api';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { seedPresence, usePresence } from '@/lib/presence';
import { PresenceDot } from '@/components/presence/PresenceDot';
import { KanbanAction } from './ApplicationActions';
import { UgcText } from '@/components/ui/UgcText';
import { ShareButton } from '@/components/ui/ShareButton';
import { WorkspaceLoading, ResourceError, WorkspaceEmpty, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { RecruiterAvatar, JobContextSelect, preferredCompany, rememberCompany } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';

export function RecruiterCandidate() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams(), router = useRouter();
  const { t, locale } = useI18n(), enumLabel = useEnumLabel();
  const request = useRef(0);
  const matchJobId = params.get('matchJobId') || '';
  const section = ['profile', 'cvs'].includes(params.get('section') || '') ? params.get('section')! : 'profile';
  const [loadedContext, setLoadedContext] = useState('');
  const [data, setData] = useState<any>(null), [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [contacts, setContacts] = useState<any>(null), [contactBusy, setContactBusy] = useState(false), [contactError, setContactError] = useState('');
  const [companyId,setCompanyId]=useState('');
  const [canChat, setCanChat] = useState(false), [cvUrl, setCvUrl] = useState(''), [cvBusy, setCvBusy] = useState(false), [cvError, setCvError] = useState('');
  const [translating, setTranslating] = useState(false), [translateError, setTranslateError] = useState('');
  const presence = usePresence([data?.user?.id]);
  function navigate(patch: Record<string, string>) { const next = new URLSearchParams(params.toString()); for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); } router.replace('/candidates/' + id + '?' + next.toString(), { scroll: false }); }
  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/login?role=RECRUITER&next=' + encodeURIComponent('/candidates/' + id + '?' + params.toString())); return; }
    if (!['RECRUITER', 'SUPER_ADMIN'].includes(session.user.role)) { router.replace(session.user.role === 'EMPLOYEE' ? '/jobs' : '/'); return; }
    let active = true; ++request.current; setLoading(true); setError(''); setContacts(null); setContactError(''); setCvUrl(''); setCvError('');
    api<any[]>('/companies/mine').then(async (memberships) => {
      const lists = await Promise.all(memberships.map(async (membership) => { const items = await api<any[]>('/jobs/company/' + membership.companyId); return items.map((job) => ({ ...job, companyId: membership.companyId })); }));
      if (!active) return;
      const allJobs = lists.flat(); setJobs(allJobs); setLoadedContext(id + ':' + matchJobId + ':' + (params.get('company') || ''));
      const selected = allJobs.find((job) => job.id === matchJobId);
      const membership = memberships.find((item) => item.companyId === (params.get('company')||selected?.companyId)) || preferredCompany(memberships);
      const profile=await api<any>('/profiles/candidates/'+id+'?'+new URLSearchParams({...(matchJobId?{matchJobId}:{}),...(membership?{companyId:membership.companyId}:{})}));
      if(!active)return;if(params.get('application')&&profile.applicationForJob?.id!==params.get('application'))throw new Error(t('ew.loadFailed'));setData(profile);
      if (!active) return;
      setCompanyId(membership?.companyId || '');
      if(membership)rememberCompany(membership.companyId);
      setCanChat(Boolean(membership || session.user.role === 'SUPER_ADMIN'));
      if (profile.user?.id) seedPresence(profile.user.id, profile.presence);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('talent.loadFailed')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; ++request.current; };
  }, [id, matchJobId, locale, retry, params.get('company'),params.get('application')]);
  async function reveal() { const version = request.current; setContactBusy(true); setContactError(''); try { const result = await api('/profiles/candidates/' + id + '/reveal-contact?companyId='+companyId, { method: 'POST' }); if (version === request.current) setContacts(result); } catch (reason) { setContactError(reason instanceof Error ? reason.message : t('talent.revealContactsFailed')); } finally { setContactBusy(false); } }
  async function viewCv(key: string, application = false) { const version = ++request.current; setCvBusy(true); setCvError(''); setCvUrl(''); try { const result = await api<{ url: string }>(application ? '/applications/' + key + '/resume-download' : '/profiles/resumes/' + key + '/download?companyId='+companyId); if (version === request.current) setCvUrl(result.url); } catch (reason) { setCvError(reason instanceof Error ? reason.message : t('viewCvFailed')); } finally { setCvBusy(false); } }
  async function translate() { const version = request.current; setTranslating(true); setTranslateError(''); try { const result = await api<any>('/profiles/candidates/' + id + '/translate/' + locale + (matchJobId ? '?matchJobId=' + matchJobId : ''), { method: 'POST' }); if (version === request.current && result.profile) setData(result.profile); if (['disabled', 'budget-exceeded'].includes(result.status)) setTranslateError(t('ui.translateFailed')); } catch (reason) { setTranslateError(reason instanceof Error ? reason.message : t('ui.translateFailed')); } finally { setTranslating(false); } }
  const job = jobs.find((item) => item.id === matchJobId);
  return <section className={s.root} aria-label={t('viewProfile')}><div className={s.context}><Link className={s.textButton} href={matchJobId ? employerJobHref(matchJobId, params.get('from')==='kanban'?'kanban':'applicants', companyId) : employerWorkspaceHref('jobs',companyId)}><WorkspaceIcon kind="left" />{t(matchJobId?'applicants.back':'rw.backJobs')}</Link><strong>{t('applicants.forJob')}</strong><JobContextSelect allowBrowse={false} jobs={jobs.filter(job=>job.publishedAt&&job.status!=='DRAFT')} value={matchJobId} onChange={(value) => navigate({ application: '', matchJobId: value, company: jobs.find(item => item.id === value)?.companyId || companyId })} /></div>
    {error ? <ResourceError message={error} onRetry={() => setRetry((value) => value + 1)} /> : loading || loadedContext !== id + ':' + matchJobId + ':' + (params.get('company') || '') ? <WorkspaceLoading /> : data && <div className={s.detailLayout}><div className={s.detailScroll}><div className={s.identity}><RecruiterAvatar name={data.user.fullName} src={data.user.avatarUrl} /><div><h1>{data.user.fullName}</h1><span className={s.sub}>{data.headline || '-'}</span><span className={s.sub}>{[data.city?.name || data.residenceCountry?.name, t('talent.expYears').replace('{n}', String(data.experienceYears || 0))].filter(Boolean).join(' | ')}</span><PresenceDot status={presence[data.user.id] ?? data.presence} showLabel /></div><div className={s.actions}>{canChat && <Link className={s.primary} href={'/messages?peer=' + data.user.id + (matchJobId ? '&job=' + matchJobId : '') + '&role=RECRUITER'}><WorkspaceIcon kind="message" />{t('rec.chat')}</Link>}<ShareButton path={'/candidates/' + id + (matchJobId ? '?matchJobId=' + matchJobId : '')} title={data.user.fullName} className={s.icon} /></div></div>
      <nav className={s.tabs + ' ' + s.candidateTabs} aria-label={t('rw.profile')}>{[['profile', 'rw.profile'], ['cvs', 'resumes']].map(([value, label]) => <button key={value} aria-current={section === value ? 'page' : undefined} onClick={() => navigate({ section: value })}>{t(label)}</button>)}</nav>
      {section === 'profile' && <><section className={s.detailSection}><h2>{t('talent.about')}</h2>{data.canMachineTranslate && <button className={s.textButton} disabled={translating} onClick={() => void translate()}>{t(translating ? 'ui.translating' : 'ui.translateThis')}</button>}{translateError && <p role="alert">{translateError}</p>}{data.summary ? <UgcText text={data.summary} contentLocale={data.contentLocale} isMachineTranslated={data.isMachineTranslated} preserveLineBreaks /> : <p>-</p>}</section>
      <section className={s.detailSection}><h2>{t('experience')}</h2>{data.experiences?.length ? <div className={s.timeline}>{data.experiences.map((item: any) => <div key={item.id}><strong>{item.title}</strong><span className={s.sub}>{item.companyName}</span><span className={s.sub}>{dateLabel(item.startDate, locale)} - {item.endDate ? dateLabel(item.endDate, locale) : t('talent.now')}{item.city?.name && ' | ' + item.city.name}</span>{item.description && <UgcText text={item.description} contentLocale={item.contentLocale} isMachineTranslated={item.isMachineTranslated} preserveLineBreaks />}</div>)}</div> : <p>-</p>}</section>
      <section className={s.detailSection}><h2>{t('education')}</h2>{(data.educations || []).map((item: any) => <div className={s.document} key={item.id}><WorkspaceIcon kind="education" /><div><strong>{item.school}</strong><span className={s.sub}>{[enumLabel('degree', item.degree), item.field].filter(Boolean).join(' | ')}</span><span className={s.sub}>{dateLabel(item.startDate, locale)} - {item.endDate ? dateLabel(item.endDate, locale) : t('talent.now')}</span></div></div>)}{!data.educations?.length && <p>-</p>}</section>
      <section className={s.detailSection}><h2>{t('skills')}</h2><div className={s.tags}>{(data.skills || []).map((item: any) => <span className={s.tag} key={item.id}>{item.skill?.name}{item.level && ' | ' + enumLabel('skillLevel', item.level)}</span>)}</div></section><section className={s.detailSection}><h2>{t('languages')}</h2><div className={s.tags}>{(data.languages || []).map((item: any) => <span className={s.tag} key={item.id}>{item.language?.name} {item.level}</span>)}</div></section><section className={s.detailSection}><h2>{t('certifications')}</h2>{(data.certifications || []).map((item: any) => <p key={item.id}><strong>{item.name}</strong><span className={s.sub}>{item.issuer}{item.issuedAt && ' | ' + dateLabel(item.issuedAt, locale)}</span></p>)}{!data.certifications?.length && <p>-</p>}</section></>}
      {section === 'cvs' && <section className={s.detailSection}>{companyId && <DatabaseCvAccess key={id + ':' + companyId} profileId={id} companyId={companyId} />}<h2>{t('resumes')}</h2>{cvError && <p role="alert" style={{ color: '#b73c57' }}>{cvError}</p>}{data.applicationForJob && <div className={s.document}><WorkspaceIcon kind="file" /><div><strong>{data.applicationForJob.resumeTitle || t('resumes')}</strong><span className={s.sub}>{t('appliedWithResume').replace('{title}', job?.title || '')}</span></div>{data.applicationForJob.hasResumeFile ? <button className={s.secondary} disabled={cvBusy} onClick={() => void viewCv(data.applicationForJob.id, true)}>{t('viewCv')}</button> : <span className={s.emptyNote}>{t('noCvAttached')}</span>}</div>}{(data.resumes || []).map((resume: any) => <div key={resume.id} className={s.document}><WorkspaceIcon kind="file" /><div><strong>{resume.title}</strong></div>{resume.canDownload ? <button className={s.secondary} disabled={cvBusy} onClick={() => void viewCv(resume.id)}>{t('viewCv')}</button> : <span className={s.emptyNote}>{t(resume.hasFile ? 'talent.cvAfterApply' : 'noCvAttached')}</span>}</div>)}{!data.applicationForJob && !data.resumes?.length && <WorkspaceEmpty icon="file" title={t('noCvAttached')} />}{cvBusy && <WorkspaceLoading />}{cvUrl && <><div className={s.actions} style={{ marginTop: 16 }}><a href={cvUrl} target="_blank" rel="noopener noreferrer" className={s.secondary}>{t('viewCv')}<WorkspaceIcon kind="external" /></a></div><iframe title={t('viewCv')} src={cvUrl} className={s.cvFrame} /></>}</section>}

    </div><aside className={s.detailAside}>{matchJobId&&data.applicationForJob&&<section><h2>{t('rw.application')}</h2><p>{enumLabel('applicationStatus',data.applicationForJob.status)}</p><KanbanAction application={data.applicationForJob} jobId={matchJobId} companyId={companyId} onChanged={value=>setData((current:any)=>({...current,applicationForJob:{...current.applicationForJob,...value}}))}/></section>}
      <section><h2>{t('contact')}</h2>{data.contactsBlurred ? <p>{t('rw.noCompanyHint')}</p> : contacts ? <><p>{contacts.email && <a href={'mailto:' + contacts.email}>{contacts.email}</a>}</p><p>{contacts.phone && <a href={'tel:' + contacts.phone}>{contacts.phone}</a>}</p>{!contacts.email && !contacts.phone && <p>{t('noContactsOnProfile')}</p>}</> : <button className={s.secondary} disabled={contactBusy} onClick={() => void reveal()}><WorkspaceIcon kind="lock" />{t(contactBusy ? 'loading' : 'revealContacts')}</button>}{contactError && <p role="alert" style={{ color: '#b73c57' }}>{contactError}</p>}</section><section><h2>{t('resumes')}</h2><button className={s.textButton} onClick={() => navigate({ section: 'cvs' })}><WorkspaceIcon kind="file" />{t('viewCv')}<WorkspaceIcon kind="right" /></button></section>{(data.desiredSalaryMin != null || data.desiredSalaryMax != null) && <section><h2>{t('talent.desiredSalary')}</h2><strong>{data.desiredSalaryCurrency || 'UZS'} {[data.desiredSalaryMin, data.desiredSalaryMax].filter((value) => value != null).map((value) => Number(value).toLocaleString(locale)).join(' - ')}</strong></section>}</aside></div>}
  </section>;
}
