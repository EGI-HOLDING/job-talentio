'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { startCandidateImport } from '@/lib/candidateImports';
import { CandidateCvFiles } from './CandidateCvFiles';
import s from './CandidateWorkspace.module.css';
export function CandidateImportDialog({companyId,jobId,onClose,onStarted}:{companyId:string;jobId?:string;onClose:()=>void;onStarted:()=>void}){
 const uiCopy=useHrCopy();
  const dialog=useRef<HTMLDialogElement>(null);
  const [files,setFiles]=useState<File[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function start(){if(!files.length||busy)return;setBusy(true);setError('');try{await startCandidateImport(companyId,jobId,files);onStarted();onClose();}catch(e){setError(e instanceof Error?e.message:'Upload belum dapat dimulai.');}finally{setBusy(false);}}
  return <dialog ref={dialog} className={s.modal} aria-labelledby="candidate-import-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <header><h2 id="candidate-import-title">{uiCopy("Upload CV kandidat")}</h2><button type="button" aria-label="Tutup" disabled={busy} onClick={onClose}>×</button></header>
    <p>Tambahkan CV kandidat ke {jobId?'lowongan ini':'kumpulan kandidat perusahaan'}. {jobId?'CV akan dinilai berdasarkan kebutuhan lowongan.':'Pilih lowongan nanti untuk mendapatkan skor kecocokan.'}</p>
    <CandidateCvFiles files={files} setFiles={setFiles} disabled={busy}/>
    <p className={s.muted}>Setelah lanjut, kamu bisa bekerja di dashboard selama upload dan penilaian berjalan. Biarkan tab terbuka hingga semua berkas selesai diupload.</p>
    {error&&<p role="alert" className={s.error}>{error}</p>}
    <footer><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Batal</button><button type="button" className={s.primary} disabled={!files.length||busy} onClick={()=>void start()}>{busy?'Menyiapkan upload\u2026':'Lanjut'}</button></footer>
  </dialog>;
}
