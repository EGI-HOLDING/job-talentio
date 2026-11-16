'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import { packageHref, type PackageCatalog } from '@/lib/jobCommerce';
import type { AssessmentLanguage } from '@job-talentio/shared';
import { HrIcon, useHrFlowSurface } from './HrFlowPresentation';
import { JobFormV2, cleanHrDraft, initialHrDraft, HrDraft } from './JobFormV2';
import s from './HrFlow.module.css';
import { hrJobError, validateHrSkills, type HrDraftIssue } from './hrDraftValidation';
import { useEmployerUnsaved } from './useEmployerUnsaved';
import { AssessmentLanguageDialog } from './JobContentAi';

export function RecruiterJobEditorV2({companyId,company,job,onClose,onPublished,onSaved}:{companyId:string;company:any;job:any;onClose:()=>void;onPublished?:(id:string)=>void|Promise<void>;onSaved:(message:string)=>Promise<void>}){
  const c=useHrCopy();
  useHrFlowSurface(company?.name);
  const router=useRouter();const [draft,setDraft]=useState<HrDraft>(()=>initialHrDraft(job)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [approved,setApproved]=useState(job);
  const [skillIssues,setSkillIssues]=useState<HrDraftIssue[]>([]);
  const [chooseAssessmentLanguage,setChooseAssessmentLanguage]=useState(false);
  const original=useRef(job),current=useRef(draft),saved=useRef(JSON.stringify(cleanHrDraft(draft))),queue=useRef<Promise<any>>(Promise.resolve()),alive=useRef(false),lock=useRef(false);current.current=draft;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function save(assessmentLanguage?: AssessmentLanguage){
    const run=queue.current.catch(()=>undefined).then(async()=>{
      if(!alive.current)throw Error(c("Halaman sudah berubah."));
      const body=cleanHrDraft(current.current),hash=JSON.stringify(body);
      const languageChanged=assessmentLanguage!==undefined&&assessmentLanguage!==original.current.assessmentLanguage;
      if(hash===saved.current&&!languageChanged)return original.current;
      if(validateHrSkills(current.current,false).length)return original.current;
      const initial=initialHrDraft(original.current);
      const positionFields=['title','jobTitleId','positionEntryMode','positionGroupId','positionGroupScopeRevision'];
      if(positionFields.every(field=>(body[field]??null)===(initial[field]??null))){
        for(const field of positionFields)delete body[field];
      }
      if(body.seniorityLevelCode===initial.seniorityLevelCode)delete body.seniorityLevelCode;
      if(current.current.experienceRangeMin===initial.experienceRangeMin&&current.current.experienceRangeMax===initial.experienceRangeMax){delete body.experienceRangeMin;delete body.experienceRangeMax;}
      setStatus('Menyimpan...');
      try{const result=await api<any>('/jobs/'+job.id,{method:'PATCH',body:JSON.stringify({
        ...(hash!==saved.current?{...body,responsibilities:(body.responsibilities as string[]|undefined)?.filter(v=>v.trim()),kpis:(body.kpis as string[]|undefined)?.filter(v=>v.trim())}:{}),
        ...(languageChanged?{assessmentLanguage}:{}),expectedUpdatedAt:original.current.updatedAt})});if(alive.current){original.current=result;setApproved(result);saved.current=hash;setStatus(hash===JSON.stringify(cleanHrDraft(current.current))?'Tersimpan':c("Perubahan belum tersimpan"));}return result;}
      catch(reason){if(alive.current)setStatus(c("Belum tersimpan"));throw reason;}
    });queue.current=run;return run;
  }
  const serialized=JSON.stringify(cleanHrDraft(draft));
  useEmployerUnsaved(serialized!==saved.current,busy);
  useEffect(()=>{if(job.status!=='DRAFT'||serialized===saved.current)return;setStatus(c("Perubahan belum tersimpan"));const timer=setTimeout(()=>void save().catch(reason=>{if(alive.current)setError(reason.message);}),900);return()=>clearTimeout(timer);},[serialized,job.id,job.status]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(JSON.stringify(cleanHrDraft(current.current))!==saved.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
  async function action(publish=false, assessmentLanguage?: AssessmentLanguage){
    if(lock.current)return;
    const issues=validateHrSkills(current.current);
    setSkillIssues(issues);
    if(issues.length){document.querySelector('#hr-existing-job-form [data-job-field=skills]')?.scrollIntoView({block:'center'});return;}
    lock.current=true;setBusy(true);setError('');
    try{
      const result=await save(assessmentLanguage);
      if(publish&&result.status!=='PUBLISHED'){
        const benefit=await api<{selected:boolean}>('/benefits/jobs/'+job.id,{cache:'no-store'});
        if(!benefit.selected){setChooseAssessmentLanguage(false);router.push(packageHref(job.id,employerJobHref(job.id,'details',companyId)));return;}
        await api('/jobs/'+job.id+'/status',{method:'POST',body:JSON.stringify({status:'PUBLISHED',expectedUpdatedAt:result.updatedAt})});await onPublished?.(job.id);
      }
      await onSaved(publish?c("Lowongan berhasil dipublikasikan."):c("Perubahan berhasil disimpan."));
      setChooseAssessmentLanguage(false);
    }catch(reason){setError(c(hrJobError(reason)));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function requestPublish() {
    if (lock.current) return;
    if (job.status === 'PUBLISHED') return action();
    if (original.current.publishedAt) return action(true);
    const issues=validateHrSkills(current.current);
    setSkillIssues(issues);
    if(issues.length){document.querySelector('#hr-existing-job-form [data-job-field=skills]')?.scrollIntoView({block:'center'});return;}
    lock.current=true;setError('');
    let enabled: boolean | undefined;
    try { enabled=Boolean((await api<PackageCatalog>('/job-commerce/catalog',{auth:false,cache:'no-store'})).assessmentLanguageSelection); }
    catch (reason) { if(alive.current)setError(c(hrJobError(reason))); }
    finally { lock.current=false; }
    if(!alive.current||enabled===undefined)return;
    if(enabled)setChooseAssessmentLanguage(true);
    else await action(true);
  }
  return <div className={s.page} data-hr-job-editor-v2 data-hr-surface><h1 className={s.title}>{job.status==='PUBLISHED'?c("Edit lowongan"):c("Lengkapi lowongan")}</h1><p className={s.subtitle}>{c("Susun kebutuhan posisi dengan jelas untuk kandidat.")}</p><div className={s.context}><strong><HrIcon kind="building"/>{company?.name}</strong><span className={s.saved} data-saved={status===c("Tersimpan")} role="status">{status===c("Tersimpan")&&<HrIcon kind="check"/>}{status}</span></div>{error&&<div className={s.error} role="alert">{error}</div>}<form id="hr-existing-job-form" onSubmit={e=>{e.preventDefault();void requestPublish();}}><JobFormV2 draft={draft} companyId={companyId} initialCity={job.city} approvedMembers={approved.positionGroupApprovedAt && approved.positionGroupId===draft.positionGroupId ? approved.approvedPositionMembers : undefined} disabled={busy} validationIssues={skillIssues} onChange={patch=>{if('skills' in patch)setSkillIssues([]);setDraft(previous=>({...previous,...patch}));}}/></form><footer className={s.footer}><div className={s.footerInner}><button className={s.secondary} disabled={busy} onClick={()=>{void (async()=>{const issues=validateHrSkills(current.current);if(issues.length){setSkillIssues(issues);return;}if(serialized!==saved.current){await save();await onSaved(c("Draf tersimpan."));}onClose();})().catch(reason=>setError(reason.message));}}><HrIcon kind="back"/>{c("Kembali")}</button><div className={s.actions}><button className={job.status==='PUBLISHED'?s.primary:s.secondary} disabled={busy} onClick={()=>void action(false)}>{c("Simpan")+" "}{job.status==='DRAFT'?'draf':'perubahan'}</button>{job.status!=='PUBLISHED'&&<button className={s.primary} type="submit" form="hr-existing-job-form" disabled={busy}>{c("Publikasikan lowongan")}</button>}</div></div></footer>
    {chooseAssessmentLanguage&&<AssessmentLanguageDialog initialLanguage={approved.assessmentLanguage??undefined} action={c('Publikasikan lowongan')}
      busy={busy} error={error} onCancel={()=>{setChooseAssessmentLanguage(false);setError('');}} onConfirm={language=>void action(true,language)}/>}
  </div>;
}
