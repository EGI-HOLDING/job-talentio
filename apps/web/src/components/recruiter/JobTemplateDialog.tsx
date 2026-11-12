'use client';

import { useEffect, useState, type RefObject } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { dateLabel } from '@/components/employee/WorkspacePrimitives';
import { JobRowDialog } from './JobRowDialog';
import s from './RecruiterJobTable.module.css';

type Template = { id: string; title: string; location: string | null; updatedAt: string };

export function JobTemplateDialog({companyId,busy,onClose,onUse,returnFocus}:{
  companyId:string; busy:boolean; onClose:()=>void;
  onUse:(templateId:string)=>Promise<void>; returnFocus:RefObject<HTMLButtonElement|null>;
}){
  const c=useHrCopy(), {locale}=useI18n();
  const [templates,setTemplates]=useState<Template[]|null>(null);
  const [loadError,setLoadError]=useState(false), [error,setError]=useState(''), [retry,setRetry]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();
    setLoadError(false);setTemplates(null);
    api<Template[]>('/hr-flow/job-templates?companyId='+encodeURIComponent(companyId),{cache:'no-store',signal:abort.signal})
      .then(rows=>{if(!abort.signal.aborted)setTemplates(rows);})
      .catch(()=>{if(!abort.signal.aborted)setLoadError(true);});
    return()=>abort.abort();
  },[companyId,retry]);
  async function useTemplate(id:string){
    setError('');
    try{await onUse(id);}catch(reason){setError(reason instanceof Error?reason.message:c('Template lowongan tidak dapat digunakan.'));}
  }
  return <JobRowDialog title={c('Template lowongan')} busy={busy} onClose={onClose} returnFocus={returnFocus}>
    {error&&<p className={s.readError} role="alert">{error}</p>}
    {loadError?<div className={s.readError} role="alert"><p>{c('Template lowongan gagal dimuat.')}</p><button type="button" className={s.secondary} onClick={()=>setRetry(n=>n+1)}>{c('Coba lagi')}</button></div>
      :templates===null?<p role="status">{c('Memuat template lowongan...')}</p>
      :templates.length===0?<p className={s.explanation}>{c('Belum ada template. Buka menu lowongan yang pernah terbit dan pilih Jadikan template.')}</p>
      :<ul className={s.templateList}>{templates.map(template=><li key={template.id}>
        <div><strong>{template.title}</strong><small>{[template.location,dateLabel(template.updatedAt,locale)].filter(Boolean).join(' · ')}</small></div>
        <button type="button" className={s.secondary} disabled={busy} onClick={()=>void useTemplate(template.id)}>{c('Gunakan template')}</button>
      </li>)}</ul>}
  </JobRowDialog>;
}
