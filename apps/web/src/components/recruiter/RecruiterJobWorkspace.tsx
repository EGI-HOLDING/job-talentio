'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { api, getSession } from '@/lib/api';
import { employerJobHref, employerWorkspaceHref, jobDetailHref } from '@/lib/accountNavigation';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { localizedJobLocation } from '@/lib/location';
import { formatJobSalary } from '@/components/jobs/formatJobSalary';
import { ResourceError, WorkspaceLoading, WorkspaceEmpty } from '@/components/employee/WorkspacePrimitives';
import { RecruiterJobEditor } from './RecruiterJobEditor';
import { LinkedInSharePreview } from './LinkedInSharePreview';
import { LinkedInJobSummary } from './LinkedInPostStatus';
import { RecruiterPipeline } from './RecruiterPipeline';
import { JobApplicants } from './JobApplicants';
import { JobBenefits } from './HrBenefits';
import { rememberCompany } from './RecruiterPrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import s from './JobWorkspace.module.css';

export function RecruiterJobWorkspace() {
  const {id} = useParams<{id:string}>(), params = useSearchParams();
  const {t,locale}=useI18n(), enumLabel=useEnumLabel();
  const router=useRouter();
  const context=useRef('');context.current=id+':'+locale;
  const section=['kanban','details'].includes(params.get('section')||'')?params.get('section')!:'applicants';
  const [data,setData]=useState<any>(null), [error,setError]=useState(''), [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0), [editing,setEditing]=useState<any>(null), [notice,setNotice]=useState(''), [editingBusy,setEditingBusy]=useState(false);
  const linkedInReview=useRef('');
  useEffect(()=>{
    let alive=true;setLoading(true);setData(null);setError('');setEditing(null);setEditingBusy(false);
    (async()=>{
      const [job,memberships]=await Promise.all([api<any>('/jobs/'+encodeURIComponent(id)),api<any[]>('/companies/mine')]);
      const companyId=job.companyId||job.company?.id;
      const membership=memberships.find(row=>row.companyId===companyId);
      if(!membership && getSession()?.user.role!=='SUPER_ADMIN') throw new Error(t('rw.noCompanyHint'));
      const [cities,skills,categories,benefits,languages]=await Promise.all(['cities','skills?sort=popular&take=120','categories','benefits','languages'].map(path=>api<any[]>('/meta/'+path,{auth:false})));
      if(alive){rememberCompany(companyId);setData({job,companyId,company:membership?.company||job.company,meta:{cities,skills,categories,benefits,languages},applicants:[],templates:[],revision:retry});}
    })().catch(reason=>{if(alive)setError(reason.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[id,locale,retry]);
  useEffect(()=>{
    if(section!=='kanban'||!data?.companyId)return;
    let alive=true;
    api<any[]>('/bulk-comms/templates?companyId='+data.companyId).then(templates=>{
      if(alive)setData((current:any)=>current?{...current,templates}:null);
    }).catch(reason=>{if(alive)setNotice(reason.message);});
    return()=>{alive=false;};
  },[section,data?.companyId,locale]);
  async function refresh(){const job=await api<any>('/jobs/'+encodeURIComponent(id));setData((current:any)=>current?{...current,job,applicants:[],revision:current.revision+1}:null);}
  async function openEditor(initialStep=0){
    if(editingBusy||!data)return;
    const requestedContext=context.current;
    setEditingBusy(true);
    try{
      // Public detail is localized. Editing must preserve the authored wording,
      // including screening questions, rather than saving a display translation.
      const source=await api<any>('/jobs/'+encodeURIComponent(id)+'/translations');
      if(context.current!==requestedContext)return;
      const questions=new Map((source.questions||[]).map((row:any)=>[row.id,row.question]));
      setEditing({...data.job,...source.source,locale:source.sourceLocale,_initialStep:initialStep,questions:(data.job.questions||[]).map((row:any)=>({...row,question:questions.get(row.id)||row.question}))});
    }catch(reason){if(context.current===requestedContext)setNotice(reason instanceof Error?reason.message:t('ew.loadFailed'));}
    finally{if(context.current===requestedContext)setEditingBusy(false);}
  }
  useEffect(()=>{
    const key=id+':'+locale;
    if(params.get('review')!=='1'||!data||loading||linkedInReview.current===key)return;
    linkedInReview.current=key;void openEditor(3);
    // The marker prevents refreshes from reopening or replacing an active form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[id,locale,data?.job?.id,loading,params]);
  if(error)return <section className={s.root}><Link href={employerWorkspaceHref()} className={s.back}>← {t('rw.backJobs')}</Link><ResourceError message={error} onRetry={()=>setRetry(n=>n+1)}/></section>;
  if(loading||!data||data.job.id!==id)return <WorkspaceLoading/>;
  const {job,companyId,company,meta}=data;
  if(editing)return <RecruiterJobEditor companyId={companyId} company={company} job={editing} initialStep={editing._initialStep || 0} meta={meta} onClose={()=>setEditing(null)} onSaved={async message=>{await refresh();setNotice(message);}}/>;
  const href=(value:string)=>employerJobHref(id,value,companyId);
  return <section className={s.root} data-job-workspace>
    <header className={s.header}><Link href={employerWorkspaceHref('jobs',companyId)} className={s.backIcon} aria-label={t('rw.backJobs')} title={t('rw.backJobs')}><WorkspaceIcon kind="left"/></Link><div className={s.jobIdentity}><div className={s.heading}><h1>{job.title}</h1><span className={s.badge} data-status={job.status}>{enumLabel('jobStatus',job.status)}</span></div><p className={s.subtitle}>{[company?.name,localizedJobLocation(job,t),enumLabel('workMode',job.workMode)].filter(Boolean).join(' | ')}</p></div><div className={s.actions}><Link className={s.secondary} href={jobDetailHref(id,href(section))}>{t('ranking.viewJob')}</Link><button type="button" className={s.primary} disabled={editingBusy} onClick={()=>void openEditor()}><WorkspaceIcon kind="edit"/>{t('rec.edit')}</button></div></header>
    <nav className={s.tabs} aria-label={job.title}>{[['applicants','ranking.applicants'],['kanban','applicants.kanban'],['details','ranking.details']].map(([value,key])=><Link key={value} href={href(value)} aria-current={section===value?'page':undefined}>{t(key)}{value==='applicants'&&job._count?.applications!=null&&<span className={s.count}>{job._count.applications}</span>}</Link>)}</nav>
    {notice&&<div className={s.notice} role="status">{notice}</div>}
    {section!=='details' && <LinkedInJobSummary jobId={id} companyId={companyId}/>}
    {section==='applicants'&&<JobApplicants key={id} jobId={id} companyId={companyId} meta={meta} revision={data.revision} applicationId={params.get('application')||undefined} onChanged={()=>{void refresh().catch(reason=>setNotice(reason.message));}}/>}
    {section==='kanban'&&<div className={s.card}><RecruiterPipeline embedded meta={meta} companyId={companyId} companyName={company?.name||''} jobs={[job]} selectedJob={id} onJobChange={()=>{}} applicants={data.applicants} loading={false} applicationId={params.get('application')||undefined} templates={data.templates} onReload={refresh} onTemplates={()=>router.push(employerWorkspaceHref('bulk',companyId)+'&job='+encodeURIComponent(id))} onFlash={message=>setNotice(message)}/></div>}
    {section==='details'&&<article className={s.card+' '+s.details}>
      <JobBenefits jobId={id} status={job.status}/>
      <h2>{t('ranking.details')}</h2>
      <p>{[enumLabel('workMode',job.workMode),enumLabel('employmentType',job.employmentType),localizedJobLocation(job,t)].filter(Boolean).join(' | ')}</p>
      <p>{formatJobSalary(job,locale,t)}</p>
      <h3>{t('rec.description')}</h3><p className={s.description}>{job.description||'-'}</p>
      <h3>{t('experience')}</h3><p>{[enumLabel('experienceLevel',job.experienceLevel),job.experienceYearsMin!=null?t('talent.expYears').replace('{n}',String(job.experienceYearsMin)):null].filter(Boolean).join(' | ')||t('ranking.noSkillRequirements')}</p>
      <h3>{t('ranking.skills')}</h3>{job.jobSkills?.length?<ul>{job.jobSkills.map((row:any)=><li key={row.id||row.skillId}>{row.skill?.name}{row.minLevel?' | '+enumLabel('skillLevel',row.minLevel):''}{row.isRequired?' *':''}</li>)}</ul>:<p>{t('ranking.noSkillRequirements')}</p>}
      <h3>{t('languages')}</h3>{job.jobLanguages?.length?<ul>{job.jobLanguages.map((row:any)=><li key={row.id||row.language?.code}>{row.language?.name} {row.minLevel}{row.isRequired?' *':''}{row.provenance!=='EMPLOYER_CONFIRMED'?' | '+t('ranking.unknown'):''}</li>)}</ul>:<p>{t('ranking.noSkillRequirements')}</p>}
      {job.benefits?.length>0&&<><h3>{t('benefits')}</h3><ul>{job.benefits.map((row:any)=><li key={row.id||row.benefit?.id}>{row.benefit?.name}</li>)}</ul></>}
      <button className={s.secondary} disabled={editingBusy} onClick={()=>void openEditor()}>{t('rec.edit')}</button>
    </article>}
    {section==='details' && <LinkedInSharePreview jobId={id} title={job.title} companyName={company?.name || ''} location={localizedJobLocation(job,t)} employmentType={job.employmentType} workMode={job.workMode} isAnonymous={Boolean(job.isAnonymous)} published={job.status==='PUBLISHED'}/>}
  </section>;
}
