'use client';
import { useEffect, useRef, useState } from 'react';
import { startCandidateImport } from '@/lib/candidateImports';
import s from './CandidateWorkspace.module.css';
export function CandidateImportDialog({companyId,jobId,onClose,onStarted}:{companyId:string;jobId?:string;onClose:()=>void;onStarted:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
  const [files,setFiles]=useState<File[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  function add(list:File[]){setError('');const invalid=list.find(f=>! /\.(pdf|docx?)$/i.test(f.name)||!f.size||f.size>5*1024*1024);if(invalid){setError(invalid.name+': gunakan PDF, DOC atau DOCX maksimal 5 MB.');return;}setFiles(previous=>[...previous,...list.filter(f=>!previous.some(p=>p.name===f.name&&p.size===f.size&&p.lastModified===f.lastModified))]);}
  async function start(){if(!files.length||busy)return;setBusy(true);setError('');try{await startCandidateImport(companyId,jobId,files);onStarted();onClose();}catch(e){setError(e instanceof Error?e.message:'Upload belum dapat dimulai.');}finally{setBusy(false);}}
  return <dialog ref={dialog} className={s.modal} aria-labelledby="candidate-import-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <header><h2 id="candidate-import-title">Upload CV kandidat</h2><button type="button" aria-label="Tutup" disabled={busy} onClick={onClose}>×</button></header>
    <p>Tambahkan CV kandidat ke {jobId?'lowongan ini':'kumpulan kandidat perusahaan'}. {jobId?'CV akan dinilai berdasarkan kebutuhan lowongan.':'Pilih lowongan nanti untuk mendapatkan skor kecocokan.'}</p>
    <input ref={input} hidden type="file" multiple accept=".pdf,.doc,.docx" onChange={event=>{add(Array.from(event.target.files??[]));event.target.value='';}}/>
    <button type="button" className={s.dropzone} data-dragging={dragging} disabled={busy} onClick={()=>input.current?.click()} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);add(Array.from(event.dataTransfer.files));}}><span aria-hidden="true">↑</span><strong>Tarik CV ke sini atau pilih berkas</strong><small>PDF, DOC, DOCX · Maksimal 5 MB per berkas</small></button>
    {files.length>0&&<div className={s.uploadFiles}><strong>{files.length} CV dipilih</strong>{files.slice(0,4).map((file,index)=><div key={index}><span>{file.name}</span><button type="button" disabled={busy} aria-label={'Hapus '+file.name} onClick={()=>setFiles(value=>value.filter((_,i)=>i!==index))}>×</button></div>)}{files.length>4&&<small>+{files.length-4} CV lainnya</small>}</div>}
    <p className={s.muted}>Setelah lanjut, kamu bisa bekerja di dashboard selama upload dan penilaian berjalan. Biarkan tab terbuka hingga semua berkas selesai diupload.</p>
    {error&&<p role="alert" className={s.error}>{error}</p>}
    <footer><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Batal</button><button type="button" className={s.primary} disabled={!files.length||busy} onClick={()=>void start()}>{busy?'Menyiapkan upload…':'Lanjut'}</button></footer>
  </dialog>;
}
