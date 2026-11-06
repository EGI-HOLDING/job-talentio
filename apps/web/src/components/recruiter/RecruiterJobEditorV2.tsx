'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { packageHref } from '@/lib/jobCommerce';
import { HrIcon, useHrFlowSurface } from './HrFlowPresentation';
import { JobFormV2, cleanHrDraft, initialHrDraft, HrDraft } from './JobFormV2';
import s from './HrFlow.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';

export function RecruiterJobEditorV2({companyId,company,job,onClose,onPublished,onSaved}:{companyId:string;company:any;job:any;onClose:()=>void;onPublished?:(id:string)=>void|Promise<void>;onSaved:(message:string)=>Promise<void>}){
  const c=useHrCopy();
  useHrFlowSurface(company?.name);
  const router=useRouter();const [draft,setDraft]=useState<HrDraft>(()=>initialHrDraft(job)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const original=useRef(job),current=useRef(draft),saved=useRef(JSON.stringify(cleanHrDraft(draft))),queue=useRef<Promise<any>>(Promise.resolve()),alive=useRef(false),lock=useRef(false);current.current=draft;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function save(){
    const run=queue.current.catch(()=>undefined).then(async()=>{
      if(!alive.current)throw Error(c("Halaman sudah berubah."));
      const body=cleanHrDraft(current.current),hash=JSON.stringify(body);
      if(hash===saved.current)return original.current;
      const initial=initialHrDraft(original.current);
      if(body.title===initial.title&&body.jobTitleId===initial.jobTitleId&&original.current.jobTitleId){delete body.title;delete body.jobTitleId;delete body.positionEntryMode;}
      if(body.seniorityLevelCode===initial.seniorityLevelCode)delete body.seniorityLevelCode;
      if(current.current.experienceRangeMin===initial.experienceRangeMin&&current.current.experienceRangeMax===initial.experienceRangeMax){delete body.experienceRangeMin;delete body.experienceRangeMax;}
      setStatus('Menyimpan...');
      try{const result=await api<any>('/jobs/'+job.id,{method:'PATCH',body:JSON.stringify({...body,expectedUpdatedAt:original.current.updatedAt,responsibilities:(body.responsibilities as string[]|undefined)?.filter(v=>v.trim()),kpis:(body.kpis as string[]|undefined)?.filter(v=>v.trim())})});if(alive.current){original.current=result;saved.current=hash;setStatus(hash===JSON.stringify(cleanHrDraft(current.current))?'Tersimpan':c("Perubahan belum tersimpan"));}return result;}
      catch(reason){if(alive.current)setStatus(c("Belum tersimpan"));throw reason;}
    });queue.current=run;return run;
  }
  const serialized=JSON.stringify(cleanHrDraft(draft));
  useEmployerUnsaved(serialized!==saved.current,busy);
  useEffect(()=>{if(job.status!=='DRAFT'||serialized===saved.current)return;setStatus(c("Perubahan belum tersimpan"));const timer=setTimeout(()=>void save().catch(reason=>{if(alive.current)setError(reason.message);}),900);return()=>clearTimeout(timer);},[serialized,job.id,job.status]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(JSON.stringify(cleanHrDraft(current.current))!==saved.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
  async function action(publish=false){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      const result=await save();
      if(publish&&result.status!=='PUBLISHED'){
        const benefit=await api<{selected:boolean}>('/benefits/jobs/'+job.id,{cache:'no-store'});
        if(!benefit.selected){router.push(packageHref(job.id,employerJobHref(job.id,'details',companyId)));return;}
        await api('/jobs/'+job.id+'/status',{method:'POST',body:JSON.stringify({status:'PUBLISHED'})});await onPublished?.(job.id);
      }
      await onSaved(publish?c("Lowongan berhasil dipublikasikan."):c("Perubahan berhasil disimpan."));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <div className={s.page} data-hr-job-editor-v2 data-hr-surface><h1 className={s.title}>{job.status==='PUBLISHED'?c("Edit lowongan"):c("Lengkapi lowongan")}</h1><p className={s.subtitle}>{c("Susun kebutuhan posisi dengan jelas untuk kandidat.")}</p><div className={s.context}><strong><HrIcon kind="building"/>{company?.name}</strong><span className={s.saved} data-saved={status===c("Tersimpan")} role="status">{status===c("Tersimpan")&&<HrIcon kind="check"/>}{status}</span></div>{error&&<div className={s.error} role="alert">{error}</div>}<form id="hr-existing-job-form" onSubmit={e=>{e.preventDefault();void action(job.status!=='PUBLISHED');}}><JobFormV2 draft={draft} initialCity={job.city} disabled={busy} onChange={patch=>setDraft(previous=>({...previous,...patch}))}/></form><footer className={s.footer}><div className={s.footerInner}><button className={s.secondary} disabled={busy} onClick={()=>{void (async()=>{if(serialized!==saved.current){await save();await onSaved(c("Draf tersimpan."));}onClose();})().catch(reason=>setError(reason.message));}}><HrIcon kind="back"/>{c("Kembali")}</button><div className={s.actions}><button className={job.status==='PUBLISHED'?s.primary:s.secondary} disabled={busy} onClick={()=>void action(false)}>{c("Simpan")+" "}{job.status==='DRAFT'?'draf':'perubahan'}</button>{job.status!=='PUBLISHED'&&<button className={s.primary} type="submit" form="hr-existing-job-form" disabled={busy}>{c("Publikasikan lowongan")}</button>}</div></div></footer></div>;
}
