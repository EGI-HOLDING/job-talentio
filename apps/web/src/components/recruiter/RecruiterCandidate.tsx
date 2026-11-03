'use client';
import { HrMatchSummary } from './HrMatchSummary';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { employerJobHref, employerWorkspaceHref } from '@/lib/accountNavigation';
import { api, apiBlob, getSession } from '@/lib/api';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { seedPresence, usePresence } from '@/lib/presence';
import { PresenceDot } from '@/components/presence/PresenceDot';
import { KanbanAction, WhatsAppAction } from './ApplicationActions';
import { WorkspaceLoading, ResourceError } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { RecruiterAvatar, JobContextSelect, preferredCompany, rememberCompany } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';
import c from './CandidateCv.module.css';

export function RecruiterCandidate() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams(), router = useRouter();
  const { t, locale } = useI18n(), enumLabel = useEnumLabel();
  const request = useRef(0);
  const matchJobId = params.get('matchJobId') || '';
  const [data, setData] = useState<any>(null), [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [contacts, setContacts] = useState<any>(null), [contactBusy, setContactBusy] = useState(false), [contactError, setContactError] = useState('');
  const [companyId,setCompanyId]=useState('');
  const [canChat, setCanChat] = useState(false), [cvUrl, setCvUrl] = useState(''), [cvBusy, setCvBusy] = useState(false), [cvError, setCvError] = useState('');
  const presence = usePresence([data?.user?.id]);
  function navigate(patch: Record<string, string>) { const next = new URLSearchParams(params.toString()); for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); } router.replace('/candidates/' + id + '?' + next.toString(), { scroll: false }); }
  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/login?role=RECRUITER&next=' + encodeURIComponent('/candidates/' + id + '?' + params.toString())); return; }
    if (!['RECRUITER', 'SUPER_ADMIN'].includes(session.user.role)) { router.replace(session.user.role === 'EMPLOYEE' ? '/jobs' : '/'); return; }
    let active = true; ++request.current; setLoading(true); setError(''); setContacts(null); setContactError(''); setCvUrl(''); setCvError('');setCvBusy(false);setContactBusy(false);
    api<any[]>('/companies/mine').then(async (memberships) => {
      const lists = await Promise.all(memberships.map(async (membership) => { const items = await api<any[]>('/jobs/company/' + membership.companyId); return items.map((job) => ({ ...job, companyId: membership.companyId })); }));
      if (!active) return;
      const allJobs = lists.flat(); setJobs(allJobs);
      const selected = allJobs.find((job) => job.id === matchJobId);
      const membership = memberships.find((item) => item.companyId === (params.get('company')||selected?.companyId)) || preferredCompany(memberships);
      const profile=await api<any>('/profiles/candidates/'+id+'?'+new URLSearchParams({...(matchJobId?{matchJobId}:{}),...(membership?{companyId:membership.companyId}:{})}));
      if(!active||getSession()?.user.id!==session.user.id)return;if(params.get('application')&&profile.applicationForJob?.id!==params.get('application'))throw new Error(t('ew.loadFailed'));setData(profile);
      if (!active) return;
      setCompanyId(membership?.companyId || '');
      if(membership)rememberCompany(membership.companyId);
      setCanChat(Boolean(membership || session.user.role === 'SUPER_ADMIN'));
      if (profile.user?.id) seedPresence(profile.user.id, profile.presence);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t('talent.loadFailed')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; ++request.current; };
  }, [id, matchJobId, locale, retry, params.get('company'),params.get('application')]);
  useEffect(()=>{
    if(loading||!data||!companyId)return;
    let active=true;const version=request.current,actor=getSession()?.user.id;
    const refresh=async()=>{try{const result=await api('/profiles/candidates/'+id+'?'+new URLSearchParams({companyId,...(matchJobId?{matchJobId}:{})}));if(active&&version===request.current&&getSession()?.user.id===actor)setData(result);}catch{/* Keep the last authorized view; foreground navigation reports errors. */}};
    window.addEventListener('focus',refresh);
    const timer=['PENDING','PROCESSING','NONE'].includes(data.cvSource?.status)&&data.cv?.hasFile?setInterval(refresh,5000):undefined;
    return()=>{active=false;window.removeEventListener('focus',refresh);if(timer)clearInterval(timer);};
  },[loading,id,matchJobId,companyId,locale,data?.cvSource?.status,data?.cvSource?.versionId]);
  useEffect(()=>{
    if(matchJobId&&data?.applicationForJob?.status==='WITHDRAWN'){
      setContacts(null);
      setContactError('');
      setContactBusy(false);
    }
  },[matchJobId,data?.applicationForJob?.status]);
  async function reveal() { const version = request.current,actor=getSession()?.user.id; setContactBusy(true); setContactError(''); try { const query=new URLSearchParams({companyId,...(matchJobId?{jobPostId:matchJobId}:{})}); const result = await api('/profiles/candidates/' + id + '/reveal-contact?'+query.toString(), { method: 'POST' }); if (version === request.current&&getSession()?.user.id===actor) setContacts(result); } catch (reason) { if(version===request.current)setContactError(reason instanceof Error ? reason.message : t('talent.revealContactsFailed')); } finally { if(version===request.current)setContactBusy(false); } }
  const blobUrl=useRef('');
  useEffect(()=>()=>{if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);},[id,matchJobId,companyId]);
  async function viewCv(){const version=request.current;if(!data?.cv?.hasFile||cvBusy)return;setCvBusy(true);setCvError('');try{
    let url:string;
    if(data.cv.application){url=(await api<{url:string}>(data.cv.downloadPath)).url;}else{const blob=await apiBlob(data.cv.downloadPath);url=URL.createObjectURL(blob);if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);blobUrl.current=url;}
    if(version===request.current)setCvUrl(url);else if(url.startsWith('blob:'))URL.revokeObjectURL(url);
  }catch(reason){if(version===request.current)setCvError(reason instanceof Error?reason.message:t('viewCvFailed'));}finally{if(version===request.current)setCvBusy(false);}}
  const job = jobs.find((item) => item.id === matchJobId);
  return <section className={s.root} aria-label={t('viewCv')}>
    <div className={s.context}><Link className={s.textButton} href={matchJobId?employerJobHref(matchJobId,params.get('from')==='kanban'?'kanban':'applicants',companyId):employerWorkspaceHref('candidates',companyId)}><WorkspaceIcon kind="left" />{t(matchJobId?'applicants.back':'candidates')}</Link>{jobs.length>0&&<JobContextSelect allowBrowse jobs={jobs.filter(job=>job.publishedAt&&job.status!=='DRAFT')} value={matchJobId} onChange={value=>navigate({application:'',matchJobId:value,company:jobs.find(item=>item.id===value)?.companyId||companyId})} />}</div>
    {error?<ResourceError message={error} onRetry={()=>setRetry(value=>value+1)} />:loading?<WorkspaceLoading />:data&&<div className={c.workspace}>
      <header className={c.identity}><RecruiterAvatar name={data.user.fullName} src={data.user.avatarUrl} /><div className={c.name}><h1>{data.user.fullName}</h1>{data.headline&&<p>{data.headline}</p>}<small>{data.city?.name||data.residenceCountry?.name}</small><PresenceDot status={presence[data.user.id]??data.presence} showLabel /></div><div className={c.actions}>{canChat && !(matchJobId && data.applicationForJob?.status === 'WITHDRAWN')&&<><Link className={s.primary} href={'/messages?'+new URLSearchParams({peer:data.user.id,...(matchJobId?{job:matchJobId}:{}),role:'RECRUITER'})}><WorkspaceIcon kind="message" />{t('rec.chat')}</Link><WhatsAppAction profileId={id} companyId={companyId} jobPostId={matchJobId || undefined} contactRevealed={contacts!==null} phone={contacts?.phone} /></>}</div></header>
      <div className={c.columns}><section className={c.document} aria-label={t('viewCv')}><header className={c.documentHeading}><div><span className={c.eyebrow}>{t(data.cv?.application?'cv.applicationFile':'cv.databaseFile')}</span><h2>{data.cv?.title||t('resumes')}</h2></div>{data.cv?.hasFile&&<button type="button" className={s.secondary} disabled={cvBusy} onClick={()=>void viewCv()}><WorkspaceIcon kind="file" />{t(cvBusy?'loading':'viewCv')}</button>}</header>
        {cvError&&<p role="alert" className={c.error}>{cvError}</p>}{cvBusy?<WorkspaceLoading />:cvUrl?<><div className={c.download}><a href={cvUrl} target="_blank" rel="noopener noreferrer" className={s.textButton}>{t('pc.downloadFile')}<WorkspaceIcon kind="external" /></a></div>{data.cv?.format==='pdf'?<iframe title={t('viewCv')} src={cvUrl} className={c.frame} />:<div className={c.placeholder}><WorkspaceIcon kind="file" /><a href={cvUrl} target="_blank" rel="noopener noreferrer" className={s.primary}>{t('pc.downloadFile')}</a></div>}</>:<div className={c.placeholder}><WorkspaceIcon kind="file" /><p>{t(data.cv?.hasFile?'cv.previewHint':'cv.notShared')}</p>{data.cv?.hasFile&&<button type="button" className={s.primary} disabled={cvBusy} onClick={()=>void viewCv()}>{t('viewCv')}</button>}</div>}
      </section><aside className={c.aside}>
        {data.applicationForJob&&<section><h2>{t('rw.application')}</h2><p>{job?.title}</p><strong>{enumLabel('applicationStatus',data.applicationForJob.status)}</strong><KanbanAction application={data.applicationForJob} jobId={matchJobId} companyId={companyId} onChanged={value=>setData((current:any)=>({...current,applicationForJob:{...current.applicationForJob,...value}}))} /></section>}
        {matchJobId&&<section><h2>{t('rw.matchForJob')}</h2>{data.match?.rankingVersion?<HrMatchSummary assessment={data.match} detail/>:<p>{t(data.cvSource?.status==='FAILED'?'cv.hrFailed':data.cvSource?.status==='READY'?'ranking.insufficient':data.cvSource?.status==='NONE'?'noCvAttached':'cv.hrPending')}</p>}</section>}
        {!(matchJobId&&data.applicationForJob?.status==='WITHDRAWN')&&<section><h2>{t('contact')}</h2>{contacts?<>{contacts.email&&<a href={'mailto:'+contacts.email}>{contacts.email}</a>}{contacts.phone&&<a href={'tel:'+contacts.phone}>{contacts.phone}</a>}</>:<button type="button" className={s.secondary} disabled={contactBusy} onClick={()=>void reveal()}>{t(contactBusy?'loading':'revealContacts')}</button>}{contactError&&<p className={c.error} role="alert">{contactError}</p>}</section>}
        {(data.languages?.length>0||data.certifications?.length>0)&&<section><h2>{t('cv.additional')}</h2>{data.languages?.length>0&&<div><h3>{t('languages')}</h3>{data.languages.map((row:any)=><p key={row.id}>{row.language?.name} {'\u00b7'} {row.level}</p>)}</div>}{data.certifications?.length>0&&<div><h3>{t('certifications')}</h3>{data.certifications.map((row:any)=><p key={row.id}><strong>{row.name}</strong>{row.issuer&&<small>{row.issuer}</small>}</p>)}</div>}</section>}
      </aside></div>
    </div>}
  </section>;
}
