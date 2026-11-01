'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api,getSession } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ProfileDialog } from './ProfileDialog';
import { CvFileDrop } from './CvFileDrop';
import { ProfileIcon } from './ProfileIcon';
import { cvFileError } from './types';
import s from './ProfileWorkspace.module.css';

export function CvUploadDialog({onClose,onUploaded}:{onClose:()=>void;onUploaded:(id:string)=>Promise<void>}) {
  const {t}=useI18n();const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function upload(event:FormEvent){event.preventDefault();if(!file||pending.current)return;pending.current=true;setBusy(true);setError('');
    const actor=getSession()?.user.id;
    try{const data=new FormData();data.append('file',file);const created=await api<{id:string}>('/profiles/me/resumes/upload',{method:'POST',body:data});if(!mounted.current||getSession()?.user.id!==actor)return;await onUploaded(created.id);if(mounted.current)onClose();}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:t('emp.saveFailed'));}finally{pending.current=false;if(mounted.current)setBusy(false);}}
  return <ProfileDialog title={t('cv.upload')} subtitle={t('cv.uploadHint')} onClose={onClose} busy={busy}><form className={s.form} onSubmit={upload} aria-busy={busy}>
    <CvFileDrop file={file} disabled={busy} onPick={value=>{const invalid=value?cvFileError(value,t):null;setError(invalid||'');setFile(invalid?null:value);}} />
    <p className={s.inlineNote}><ProfileIcon kind="info" />{t('pc.newPrimary')}</p>
    {busy&&<div role="status"><progress aria-label={t('cv.uploading')} /><p>{t('cv.uploading')}</p></div>}
    {error&&<p className={s.formError} role="alert">{error}</p>}
    <footer className={s.dialogFooter}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>{t('cancel')}</button><button type="submit" className={s.primary} disabled={!file||busy}><ProfileIcon kind="upload" />{t(busy?'cv.uploading':'cv.upload')}</button></footer>
  </form></ProfileDialog>;
}
