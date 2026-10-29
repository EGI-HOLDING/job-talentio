'use client';

import { useEffect, useState, useRef } from 'react';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { WorkspaceLoading, ResourceError } from '@/components/employee/WorkspacePrimitives';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { RecruiterAvatar } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';
import c from './RecruiterMessages.module.css';

export function RecruiterMessageContext({ candidateId, job, name }: {candidateId:string;job?:{id:string;title:string;companyId:string}|null;name:string}) {
  const {t,locale}=useI18n(); const [profile,setProfile]=useState<any>(null);const [error,setError]=useState(''); const [retry,setRetry]=useState(0);
  const loaded=useRef('');
  useLiveRefresh('applications',async()=>{setRetry(value=>value+1);},true,candidateId+':'+job?.id);
  useEffect(()=>{let active=true;const identity=candidateId+':'+job?.id+':'+locale;if(loaded.current!==identity)setProfile(null);setError('');api('/profiles/candidates/'+candidateId+(job?'?matchJobId='+job.id:'')).then((data)=>{if(active){loaded.current=identity;setProfile(data);}}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:t('ew.loadFailed'));});return()=>{active=false;};},[candidateId,job?.id,locale,retry]);
  return <aside className={c.context} aria-label={t('rw.application')}>{error?<ResourceError message={error} onRetry={()=>setRetry((v)=>v+1)} />:!profile?<WorkspaceLoading />:<>
    <div className={c.identity}><RecruiterAvatar name={name} src={profile.user?.avatarUrl} /><strong>{name}</strong><span>{profile.headline||'-'}</span><span>{profile.city?.name || profile.residenceCountry?.name}</span></div>
    {job&&<section><h2>{t('rw.application')}</h2><strong>{job.title}</strong>{profile.applicationForJob&&<Link className={s.secondary} href={'/dashboard/recruiter?tab=pipeline&job='+job.id+'&company='+job.companyId+'&application='+profile.applicationForJob.id}>{t('rw.openApplication')}<WorkspaceIcon kind="arrow" /></Link>}</section>}
    {job&&profile.match&&<section><h2>{t('rw.matchForJob')}</h2><strong className={c.score}>{profile.match.assessable ? Math.round(profile.match.total)+'/100' : '-'}</strong><span className={s.sub}>{job.title}</span></section>}
    <section><h2>{t('skills')}</h2><div className={s.tags}>{(profile.skills||[]).slice(0,8).map((item:any)=><span className={s.tag} key={item.id}>{item.skill?.name}</span>)}</div></section>
    <div className={c.links}><Link className={s.secondary} href={'/candidates/'+candidateId+(job?'?matchJobId='+job.id:'')}>{t('viewProfile')}<WorkspaceIcon kind="external" /></Link><Link className={s.textButton} href={'/candidates/'+candidateId+'?section=cvs'+(job?'&matchJobId='+job.id:'')}><WorkspaceIcon kind="file" />{t('viewCv')}</Link></div>
  </>}</aside>;
}
