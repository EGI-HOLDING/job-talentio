'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { restoreCandidateImports, resumeCandidateTransfer, dismissCandidateImport, markCandidateProcessing, refreshCandidateImports, retryCandidateTransfer, useCandidateImports } from '@/lib/candidateImports';
import { useHrAssistantContext } from './HrFlowPresentation';
import s from './CandidateImportProgress.module.css';
export function CandidateImportProgress(){
 const uiCopy=useHrCopy();
  const assistant = useHrAssistantContext();
  const imports=useCandidateImports(),[expanded,setExpanded]=useState(false),[session,setSession]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const sync=()=>{const id=getSession()?.user.id??'';setSession(id);if(id)void restoreCandidateImports(id);};sync();window.addEventListener('jt-session-updated',sync);return()=>window.removeEventListener('jt-session-updated',sync);},[]);
  const batches=imports.filter(b=>b.userId===session),files=batches.flatMap(b=>b.files);
  const transferring=files.some(f=>['queued','uploading'].includes(f.status));
  const processing=files.some(f=>f.status==='processing');
  useEffect(()=>{if(!transferring)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[transferring]);
  const needsRefresh=processing||files.some(f=>f.needsReselect);
  useEffect(()=>{if(!needsRefresh)return;const timer=setInterval(()=>{if(!document.hidden)void refreshCandidateImports();},4000);return()=>clearInterval(timer);},[needsRefresh]);
  if (assistant || !files.length) return null;
  const uploaded=files.filter(f=>['processing','done','duplicate'].includes(f.status)).length,done=files.filter(f=>f.status==='done').length,failed=files.filter(f=>f.status==='error').length;
  const totalBytes=files.reduce((n,f)=>n+f.size,0),loadedBytes=files.reduce((n,f)=>n+f.loaded,0);
  async function retryAnalysis(id:string){setError('');try{await api('/recruitment/candidates/'+id+'/retry',{method:'POST',body:'{}'});markCandidateProcessing(id);window.dispatchEvent(new Event('candidate-import-updated'));}catch(e){setError(e instanceof Error?e.message:'Coba lagi.');}}
  return <aside className={s.panel} aria-label={uiCopy("Progres impor CV")}>
    <button type="button" className={s.heading} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><strong>{transferring?'Mengupload CV':processing?'Menilai CV':failed?'Impor CV perlu diperiksa':'Impor CV selesai'}</strong><span>{done}/{files.length} siap {expanded?'⌄':'⌃'}</span></button>
    <div className={s.summary}><span>{uploaded} diupload &#xb7; {done} siap{failed?` \u00b7 ${failed} perlu diperiksa`:''}</span><progress value={loadedBytes} max={totalBytes||1} aria-label={uiCopy("Progres transfer berkas")}/></div>
    {transferring&&<p className={s.hint}>Kamu bisa lanjut bekerja. Biarkan tab ini terbuka hingga upload selesai.</p>}
    {error&&<p role="alert">{error}</p>}
    {expanded&&<div className={s.files}>{batches.map(batch=><section key={batch.id}>{batch.files.map(file=><div key={file.id} className={s.file}><span><strong>{file.name}</strong><small>{file.error??({queued:'Menunggu upload',uploading:'Mengupload',processing:'Menunggu penilaian',done:'Siap ditinjau',error:'Perlu diperiksa',duplicate:'CV duplikat dilewati'}[file.status])}</small></span>{file.needsReselect&&<label>{uiCopy("Teruskan upload")}<input type="file" accept=".pdf,.doc,.docx" aria-label={'Pilih kembali '+file.name} onChange={event=>{const chosen=event.target.files?.[0];if(chosen)try{resumeCandidateTransfer(batch.id,file.id,chosen);setError('');}catch(e){setError(e instanceof Error?e.message:'Berkas belum sesuai.');}}}/></label>}{file.status==='error'&&!file.needsReselect&&<button type="button" onClick={()=>file.file?retryCandidateTransfer(batch.id,file.id):void retryAnalysis(file.id)}>{uiCopy("Coba lagi")}</button>}</div>)}{!batch.files.some(f=>['queued','uploading','processing'].includes(f.status))&&<button className={s.dismiss} onClick={()=>dismissCandidateImport(batch.id)}>{uiCopy("Tutup progres ini")}</button>}</section>)}</div>}
  </aside>;
}
