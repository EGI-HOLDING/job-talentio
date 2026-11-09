'use client';
import { useEffect, useState } from 'react';
import { api, getSession } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useAccountRole } from '@/lib/useAccountRole';
import { TaraApplication } from './TaraApplication';
import { VoiceInterview } from './VoiceInterview';
import s from './ScreeningInvitation.module.css';
type Preview={mode:'TEXT'|'VOICE';jobTitle:string;companyName:string;expiresAt:string;status:string};
type Claim={invitationId:string;mode:'TEXT'|'VOICE';session:{id:string;job:{id:string}}};
export function ScreeningInvitation({token}:{token:string}){
 const {locale}=useI18n(),role=useAccountRole();
 const [preview,setPreview]=useState<Preview|null>(null),[claim,setClaim]=useState<Claim|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void api<Preview>('/recruitment/invitations/open/'+encodeURIComponent(token),{auth:false,cacheMode:'no-store'}).then(value=>{if(live)setPreview(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[token]);
 async function open(){if(busy)return;setBusy(true);setError('');try{setClaim(await api<Claim>('/recruitment/invitations/open/'+encodeURIComponent(token)+'/claim',{method:'POST',body:'{}'}));}catch(e){setError(e instanceof Error?e.message:'Undangan belum bisa dibuka.');}finally{setBusy(false);}}
 async function verify(){setBusy(true);setError('');try{await api('/auth/request-verification',{method:'POST',body:'{}'});setNotice('Email verifikasi sudah diminta. Periksa kotak masuk, verifikasi email, lalu buka kembali undangan ini.');}catch(e){setError(e instanceof Error?e.message:'Email verifikasi belum bisa dikirim.');}finally{setBusy(false);}}
 if(claim?.mode==='TEXT')return <TaraApplication key={claim.session.id} invitedSessionId={claim.session.id}/>;
 if(claim?.mode==='VOICE'&&preview)return <VoiceInterview sessionId={claim.session.id} jobTitle={preview.jobTitle} companyName={preview.companyName}/>;
 const next='/screening/'+token,auth=getSession();
 return <main className={s.page}><section className={s.card}><span className={s.eyebrow}>UNDANGAN SCREENING</span><h1>Interview bersama Tara</h1>{preview?<><h2>{preview.jobTitle}</h2><p className={s.company}>{preview.companyName}</p><div className={s.format}><strong>{preview.mode==='VOICE'?'Interview suara':'Interview teks'}</strong><span>{preview.mode==='VOICE'?'Maksimal 15 menit · Siapkan mikrofon':'Maksimal 25 pertanyaan · 1 menit per pertanyaan'}</span></div><p>Tim HR mengundangmu untuk membahas pengalaman di CV dan posisi yang kamu lamar. Percakapan akan direkap untuk membantu penilaian tim HR.</p><small>Berlaku sampai {new Date(preview.expiresAt).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}.</small></>:!error&&<p role="status">Memuat undangan…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className={s.error}>{error}</p>}
 {preview&&!role?<div className={s.actions}><a className={s.primary} href={localeUrl(locale,'/login?role=EMPLOYEE&next='+encodeURIComponent(next))}>Masuk untuk melanjutkan</a><a href={localeUrl(locale,'/register?role=EMPLOYEE&next='+encodeURIComponent(next))}>Belum punya akun? Daftar</a></div>:preview&&role!=='EMPLOYEE'?<p>Gunakan akun kandidat penerima undangan untuk melanjutkan.</p>:preview&&<div className={s.actions}>{!auth?.user.emailVerified&&<div><p>Pastikan email akunmu sama dengan penerima undangan dan sudah diverifikasi.</p><button type="button" disabled={busy} onClick={()=>void verify()}>Kirim email verifikasi</button></div>}<button type="button" className={s.primary} disabled={busy} onClick={()=>void open()}>{busy?'Menyiapkan interview…':'Buka interview'}</button></div>}
 </section></main>;
}
