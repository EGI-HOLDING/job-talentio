'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {Link} from '@/lib/navigation';
import {postOnce} from '@/lib/hr-benefits';
import {useLiveRefresh} from '@/lib/useLiveRefresh';
import {useI18n,useEnumLabel} from '@/lib/i18n';
import {useConfirm} from '@/components/ui/ConfirmProvider';
import {ProfileDialog} from '@/components/profile/ProfileDialog';
import {ResourceError,WorkspaceLoading,dateLabel} from '@/components/employee/WorkspacePrimitives';
import {KANBAN_STAGES} from '@job-talentio/shared';
import {Applicant,ApplicationCvAction,KanbanAction} from './ApplicationActions';
import {RecruiterAvatar} from './RecruiterPrimitives';
import s from './JobWorkspace.module.css';

export function ApplicationDetail({applicationId,jobId,companyId,from='applicants',onClose,onChanged}: {applicationId:string;jobId:string;companyId:string;from?:'applicants'|'kanban';onClose:()=>void;onChanged:()=>void}) {
  const {t,locale}=useI18n(),label=useEnumLabel(),confirm=useConfirm();
  const [data,setData]=useState<Applicant|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [scheduleOpen,setScheduleOpen]=useState(false),schedulePending=useRef(false),scheduleFormId=useId();
  const context=useRef(''); context.current=jobId+':'+applicationId;
  const loaded=useRef(''),reads=useRef(0);
  useLiveRefresh('applications',async()=>{setRetry(value=>value+1);},!busy,context.current+':'+locale);
  useEffect(()=>{let alive=true;const sequence=++reads.current,identity=jobId+':'+applicationId+':'+locale;if(loaded.current!==identity)setData(null);setError('');api<Applicant>('/applications/jobs/'+encodeURIComponent(jobId)+'/applicants/'+encodeURIComponent(applicationId),{signal:AbortSignal.timeout(15000)}).then(value=>{if(alive&&sequence===reads.current){loaded.current=identity;setData(value);}}).catch(reason=>{if(alive&&sequence===reads.current)setError(reason.message);});return()=>{alive=false;};},[applicationId,jobId,locale,retry]);
  useEffect(()=>{schedulePending.current=false;setScheduleOpen(false);},[applicationId,jobId,companyId]);
  useEffect(()=>{setScheduleOpen(false);},[data?.status]);
  const changed=(value:Partial<Applicant>)=>{setData(current=>current?{...current,...value}:null);onChanged();};
  async function move(status:string) {
    if(!data||busy)return;
    if(['REJECTED','HIRED'].includes(status)&&!await confirm({title:label('applicationStatus',status),message:data.profile.user.fullName,confirmLabel:t('rec.saveChanges')}))return;
    const version=context.current;++reads.current;setBusy(true);setError('');
    try {const value=await api<Partial<Applicant>>('/applications/'+data.id+'/status',{method:'POST',body:JSON.stringify({status})});if(version===context.current){++reads.current;changed(value);setRetry(value=>value+1);if(status!=='INTERVIEW')setScheduleOpen(false);}}
    catch(reason){if(version===context.current)setError(reason instanceof Error?reason.message:t('ew.loadFailed'));}
    finally{if(version===context.current)setBusy(false);}
  }
  async function schedule(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!data||data.status!=='INTERVIEW'||busy||schedulePending.current)return;
    schedulePending.current=true;
    const form=new FormData(event.currentTarget),node=event.currentTarget,version=context.current;++reads.current;setBusy(true);setError('');
    try {
      await postOnce('/applications/'+data.id+'/interviews',{scheduledAt:new Date(String(form.get('scheduledAt'))).toISOString(),durationMins:Number(form.get('durationMins')||60),meetingUrl:String(form.get('meetingUrl')||''),location:String(form.get('location')||''),note:String(form.get('note')||'')});
      if(version===context.current){node.reset();setScheduleOpen(false);setRetry(n=>n+1);onChanged();}
    }catch(reason){if(version===context.current)setError(reason instanceof Error?reason.message:t('ew.loadFailed'));}
    finally{if(version===context.current){schedulePending.current=false;setBusy(false);}}
  }
  const interviewHistory=[...(data?.interviews||[])].sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt));
  const hasUpcomingInterview=interviewHistory.some(item=>item.status==='SCHEDULED'&&Date.parse(item.scheduledAt)>=Date.now());
  useEffect(()=>()=>{context.current='';},[]);
  return <ProfileDialog title={data?.profile.user.fullName||t('applicants.details')} wide onClose={onClose} busy={busy}>
    <div className={s.applicationDetail}>
      {error&&<ResourceError message={error} onRetry={()=>setRetry(n=>n+1)}/>}
      {!data&&!error?<WorkspaceLoading/>:data&&<>
        <div className={s.detailIdentity}><RecruiterAvatar name={data.profile.user.fullName} src={data.profile.user.avatarUrl} className={s.avatar}/><div><h2>{data.profile.user.fullName}</h2><p>{data.profile.headline||t('ranking.noHeadline')}</p><small>{t('rw.applied')}: {dateLabel(data.createdAt,locale,true)}</small></div></div>
        <div className={s.detailActions}><span className={s.applicationStatus} data-status={data.status}>{label('applicationStatus',data.status)}</span><KanbanAction application={data} jobId={jobId} companyId={companyId} onChanged={changed}/><ApplicationCvAction application={data}/><Link className={s.profileButton} href={'/candidates/'+encodeURIComponent(data.profile.id)+'?'+new URLSearchParams({matchJobId:jobId,company:companyId,application:data.id,from})}>{t('viewProfile')}</Link>{data.status!=='WITHDRAWN'&&<Link className={s.cvLink} href={'/messages?'+new URLSearchParams({peer:data.profile.user.id,job:jobId,role:'RECRUITER'})}>{t('rec.chat')}</Link>}</div>
        {data.kanbanEnteredAt&&<label className={s.stageField}>{t('status')}<select value={data.status} disabled={busy||data.status==='WITHDRAWN'} onChange={event=>void move(event.target.value)}>{KANBAN_STAGES.map(status=><option key={status} value={status}>{label('applicationStatus',status)}</option>)}</select></label>}
        {data.coverLetter&&<section><h3>{t('coverLetter')}</h3><p className={s.description}>{data.coverLetter}</p></section>}
        {data.status==='IN_REVIEW'&&<section><h3>{t('rw.screening')}</h3>{data.answers?.length?data.answers.map(answer=><div key={answer.id}><h4>{answer.question?.question}</h4><p className={s.description}>{answer.answer==='Yes'?t('job.yes'):answer.answer==='No'?t('job.no'):answer.answer}</p></div>):<p>{t('rec.answersNone')}</p>}</section>}
        {(data.status==='INTERVIEW'||interviewHistory.length>0)&&<section className={s.interviewSection}>
          <div className={s.interviewHead}><div><h3>{t('rw.interviews')}</h3><p>{data.status==='INTERVIEW'?t('rec.interviewStageHint'):t('rec.interviewHistoryReadOnly')}</p></div>{data.status==='INTERVIEW'&&<button type="button" className={s.secondary} aria-expanded={scheduleOpen} aria-controls={scheduleOpen?scheduleFormId:undefined} disabled={busy} onClick={()=>setScheduleOpen(open=>!open)}>{scheduleOpen?t('rec.hideScheduleForm'):t(interviewHistory.length?'rec.scheduleNextInterview':'rec.scheduleInterview')}</button>}</div>
          {data.status==='INTERVIEW'&&!hasUpcomingInterview&&<p className={s.interviewAwaiting}>{t('journey.awaitingSchedule')}</p>}
          {interviewHistory.length>0&&<div className={s.interviewList}>{interviewHistory.map(item=><article key={item.id} className={s.interviewItem}><div className={s.interviewItemHead}><time dateTime={item.scheduledAt}>{dateLabel(item.scheduledAt,locale,true)}</time><span className={s.interviewBadge} data-status={item.status}>{t('ew.interview.'+item.status)}</span></div><div className={s.interviewItemMeta}>{item.durationMins&&<span>{item.durationMins} {t('minutes')}</span>}{item.location&&<span>{item.location}</span>}</div>{item.note&&<p className={s.description}>{item.note}</p>}{item.meetingUrl&&/^https?:\/\//i.test(item.meetingUrl)&&item.status==='SCHEDULED'&&data.status==='INTERVIEW'&&<a href={item.meetingUrl} target="_blank" rel="noopener noreferrer">{t('ew.joinInterview')}</a>}</article>)}</div>}
          {data.status==='INTERVIEW'&&scheduleOpen&&<div id={scheduleFormId} className={s.interviewFormPanel}><form className={s.interviewForm} onSubmit={event=>void schedule(event)}>
            <label>{t('rec.interviewTime')}<input name="scheduledAt" type="datetime-local" required min={(()=>{const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());return now.toISOString().slice(0,16);})()}/></label><label>{t('duration')}<select name="durationMins" defaultValue="60">{[15,30,45,60,90,120].map(value=><option key={value} value={value}>{value} {t('minutes')}</option>)}</select></label><label>{t('rec.meetingUrl')}<input name="meetingUrl" type="url"/></label><label>{t('rec.interviewVenue')}<input name="location" maxLength={300}/></label><label>{t('note')}<textarea name="note" maxLength={2000}/></label><small>{t('rw.timezone')}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small><div className={s.interviewFormActions}><button type="button" className={s.secondary} disabled={busy} onClick={()=>setScheduleOpen(false)}>{t('cancel')}</button><button type="submit" className={s.primary} disabled={busy||schedulePending.current}>{t(interviewHistory.length?'rec.scheduleNextInterview':'rec.scheduleInterview')}</button></div>
          </form></div>}
        </section>}
      </>}
    </div>
  </ProfileDialog>;
}
