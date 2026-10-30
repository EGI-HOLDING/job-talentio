'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { useI18n } from '@/lib/i18n';
import s from './JobWorkspace.module.css';

export type Applicant = {
  id: string; jobPostId: string; status: string; kanbanEnteredAt: string | null;
  canAddToKanban: boolean; candidateDecisionRequired?: boolean; createdAt: string; hasResumeFile: boolean;
  resumeTitle?: string | null; coverLetter?: string | null;
  profile: { id: string; headline?: string | null; user: {id: string; fullName: string; avatarUrl?: string | null}; city?: {name: string} | null; residenceCountry?: {name: string} | null; skills?: Array<{id: string; skill: {name: string}}> };
  answers?: Array<{id: string; answer: string; question: {question: string}}>;
  interviews?: Array<{id: string; scheduledAt: string; status: string; meetingUrl?: string | null; durationMins?: number; location?: string | null; note?: string | null}>;
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

export function whatsAppChatUrl(phone: string | null | undefined) {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return 'https://wa.me/' + phone.slice(1);
}

/** Reveals a candidate's phone only after an explicit, audited HR action. */
export function WhatsAppAction({profileId,companyId,phone,contactRevealed=false}: {profileId:string;companyId:string;phone?:string|null;contactRevealed?:boolean}) {
  const {t}=useI18n();
  const [busy,setBusy]=useState(false),[error,setError]=useState<'no-phone'|'failed'|''>('');
  const request=useRef(0),pending=useRef(false),revealed=useRef<{profileId:string;companyId:string;phone:string|null}|null>(null);
  useEffect(()=>{
    const version=++request.current;
    pending.current=false;revealed.current=null;setBusy(false);setError('');
    return()=>{if(request.current===version)++request.current;};
  },[profileId,companyId]);
  async function openChat() {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');const version=request.current;
    let tab:Window|null=null;
    try{tab=window.open('about:blank','_blank');if(tab)tab.opener=null;}catch{/* Continue in this tab if the browser refuses a new window. */}
    try {
      let candidatePhone:string|null|undefined;
      if(revealed.current?.profileId===profileId&&revealed.current.companyId===companyId)candidatePhone=revealed.current.phone;
      else if(contactRevealed)candidatePhone=phone||null;
      else {
        const result=await api<{phone?:string|null}>('/profiles/candidates/'+encodeURIComponent(profileId)+'/reveal-contact?'+new URLSearchParams({companyId}).toString(),{method:'POST'});
        if(version!==request.current){tab?.close();return;}
        candidatePhone=result.phone||null;
        revealed.current={profileId,companyId,phone:candidatePhone};
      }
      if(version!==request.current){tab?.close();return;}
      const url=whatsAppChatUrl(candidatePhone);
      if(!url){tab?.close();setError('no-phone');return;}
      if(tab)tab.location.href=url;else window.location.assign(url);
    }catch {
      tab?.close();if(version===request.current)setError('failed');
    }finally{if(version===request.current){pending.current=false;setBusy(false);}}
  }
  const label=t(busy?'rec.whatsappOpening':'rec.whatsappChat');
  return <span className={s.whatsappAction}><button type="button" className={s.whatsappButton} aria-label={label} title={label} aria-busy={busy} disabled={busy} onClick={()=>void openChat()}><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.5 28.3l6.1-1.6A12.8 12.8 0 1 0 16 3.2Zm0 23.2c-2 0-3.9-.5-5.6-1.6l-.4-.2-3.6 1 1-3.5-.3-.4A10.2 10.2 0 1 1 16 26.4Zm5.6-7.6c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.4 8.4 0 0 1-2.5-1.5 9.4 9.4 0 0 1-1.7-2.1c-.2-.3 0-.5.2-.7l.5-.6c.2-.2.2-.4.3-.6s0-.4 0-.6-.7-1.7-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.2-1.2 2.8 1.2 3.2 1.4 3.4 2.4 3.7 5.8 5.2c.8.3 1.4.5 1.9.6.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4s-.3-.3-.6-.5Z"/></svg></button>{error&&<span className={s.whatsappError} role="alert">{t(error==='no-phone'?'rec.whatsappNoPhone':'rec.whatsappFailed')}</span>}</span>;
}
