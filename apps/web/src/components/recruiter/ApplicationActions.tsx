'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { useI18n } from '@/lib/i18n';
import s from './JobWorkspace.module.css';

export type Applicant = {
  id: string; jobPostId: string; status: string; kanbanEnteredAt: string | null;
  canAddToKanban: boolean; createdAt: string; hasResumeFile: boolean;
  resumeTitle?: string | null; coverLetter?: string | null;
  profile: { id: string; headline?: string | null; user: {id: string; fullName: string; avatarUrl?: string | null}; city?: {name: string} | null; residenceCountry?: {name: string} | null; skills?: Array<{id: string; skill: {name: string}}> };
  answers?: Array<{id: string; answer: string; question: {question: string}}>;
  interviews?: Array<{id: string; scheduledAt: string; status: string; meetingUrl?: string | null}>;
};

export function KanbanAction({application, jobId, companyId, onChanged}: {application: Pick<Applicant,'id'|'kanbanEnteredAt'|'canAddToKanban'>; jobId: string; companyId: string; onChanged: (value: Partial<Applicant>) => void}) {
  const {t} = useI18n();
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const request = useRef(0), pending = useRef(false);
  useEffect(() => { ++request.current; pending.current=false; setBusy(false); setError(''); return () => { ++request.current; }; }, [application.id,jobId,companyId]);
  async function add() {
    if (pending.current) return;
    pending.current=true; setBusy(true); setError(''); const version=request.current;
    try {
      const value=await api<Partial<Applicant>>('/applications/'+encodeURIComponent(application.id)+'/kanban',{method:'POST'});
      if(version===request.current) onChanged(value);
    } catch(reason) { if(version===request.current) setError(reason instanceof Error?reason.message:t('ew.loadFailed')); }
    finally { if(version===request.current) {pending.current=false;setBusy(false);} }
  }
  if(application.kanbanEnteredAt) return <Link className={s.kanbanLink} href={employerJobHref(jobId,'kanban',companyId)+'&application='+encodeURIComponent(application.id)}>{t('applicants.viewKanban')}</Link>;
  if(!application.canAddToKanban) return null;
  return <span className={s.actionMessage}><button className={s.addKanban} disabled={busy} onClick={()=>void add()}>{t(busy?'saving':'applicants.addKanban')}</button>{error&&<span role="alert">{error}</span>}</span>;
}

/** Always resolves the submitted application file, never the database CV. */
export function ApplicationCvAction({application}: {application: Pick<Applicant,'id'|'hasResumeFile'>}) {
  const {t}=useI18n();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(0),pending=useRef(false);
  useEffect(()=>{++request.current;pending.current=false;setBusy(false);setError('');return()=>{++request.current;};},[application.id]);
  async function view() {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');const version=request.current;
    const tab=window.open('','_blank');if(tab)tab.opener=null;
    try {
      const data=await api<{url:string}>('/applications/'+encodeURIComponent(application.id)+'/resume-download');
      if(version!==request.current){tab?.close();return;}
      if(tab)tab.location.href=data.url;else window.location.assign(data.url);
    }catch(reason){tab?.close();if(version===request.current)setError(reason instanceof Error?reason.message:t('viewCvFailed'));}
    finally{if(version===request.current){pending.current=false;setBusy(false);}}
  }
  if(!application.hasResumeFile)return <span className={s.cvUnavailable}>{t('noCvAttached')}</span>;
  return <span className={s.actionMessage}><button type="button" className={s.cvLink} disabled={busy} onClick={()=>void view()}>{t(busy?'loading':'viewCv')}</button>{error&&<span role="alert">{error}</span>}</span>;
}
