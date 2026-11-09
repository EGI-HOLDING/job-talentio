'use client';
import { useEffect, useState } from 'react';
import { api, getSession, saveSession, type AuthSession } from '@/lib/api';
import { localeUrl } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useAccountRole } from '@/lib/useAccountRole';
import { TaraApplication } from './TaraApplication';
import { VoiceInterview } from './VoiceInterview';
import s from './ScreeningInvitation.module.css';

type Preview={mode:'TEXT'|'VOICE';jobTitle:string;companyName:string;expiresAt:string;status:string};
type Claim={invitationId:string;mode:'TEXT'|'VOICE';session:{id:string;job:{id:string}}};

function maskEmail(email:string|null|undefined){
 if(!email)return '';
 const [local,domain]=email.split('@');
 if(!local||!domain)return '';
 return local.length<3?local[0]+'•••@'+domain:local.slice(0,2)+'•••@'+domain;
}

function CalendarIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17"/></svg>;}
function MessageIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.2a7.7 7.7 0 0 1-8 7.2 9 9 0 0 1-3.6-.75L4 19l1.3-3.65a6.8 6.8 0 0 1-1.3-4.15A7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.2Z"/><path d="M8.5 11.5h7"/></svg>;}
function ListIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/></svg>;}
function ClockIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;}
function EnvelopeIcon(){return <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="6"/><path d="m7 14 17 13 17-13"/></svg>;}

export function ScreeningInvitation({token}:{token:string}){
 const {locale}=useI18n(),role=useAccountRole();
 const [preview,setPreview]=useState<Preview|null>(null),[claim,setClaim]=useState<Claim|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[auth,setAuth]=useState<AuthSession|null>(null);
 useEffect(()=>{let live=true;void api<Preview>('/recruitment/invitations/open/'+encodeURIComponent(token),{auth:false,cacheMode:'no-store'}).then(value=>{if(live)setPreview(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[token]);
 useEffect(()=>{
   let live=true;
   const syncStoredSession=()=>setAuth(getSession());
   const refreshVerifiedStatus=async()=>{
     const current=getSession();
     setAuth(current);
     if(!current||current.user.role!=='EMPLOYEE'||current.user.emailVerified)return;
     try{
       const fresh=await api<AuthSession>('/auth/me',{cacheMode:'no-store'});
       const stored=getSession();
       if(!live||!stored||stored.user.id!==current.user.id||fresh.user.id!==current.user.id||!fresh.user.emailVerified)return;
       const updated={...stored,user:{...stored.user,emailVerified:true}};
       saveSession(updated);
       setAuth(updated);
       setNotice('Email berhasil diverifikasi. Kamu bisa membuka interview sekarang.');
     }catch{/* Keep the current page usable if the account status cannot be refreshed. */}
   };
   const onPageActive=()=>{syncStoredSession();if(document.visibilityState==='visible')void refreshVerifiedStatus();};
   syncStoredSession();
   void refreshVerifiedStatus();
   window.addEventListener('storage',syncStoredSession);
   window.addEventListener('jt-session-updated',syncStoredSession);
   window.addEventListener('focus',onPageActive);
   document.addEventListener('visibilitychange',onPageActive);
   return()=>{live=false;window.removeEventListener('storage',syncStoredSession);window.removeEventListener('jt-session-updated',syncStoredSession);window.removeEventListener('focus',onPageActive);document.removeEventListener('visibilitychange',onPageActive);};
 },[]);
 async function open(){if(busy)return;setBusy(true);setError('');try{setClaim(await api<Claim>('/recruitment/invitations/open/'+encodeURIComponent(token)+'/claim',{method:'POST',body:'{}'}));}catch(e){setError(e instanceof Error?e.message:'Undangan belum bisa dibuka.');}finally{setBusy(false);}}
 async function verify(){setBusy(true);setError('');setNotice('');try{await api('/auth/request-verification',{method:'POST',body:'{}'});setNotice('Email verifikasi sudah diminta. Periksa kotak masuk, verifikasi email, lalu buka kembali undangan ini.');}catch(e){setError(e instanceof Error?e.message:'Email verifikasi belum bisa dikirim.');}finally{setBusy(false);}}
 async function checkVerification(){if(busy)return;setBusy(true);setError('');setNotice('');try{const fresh=await api<AuthSession>('/auth/me',{cacheMode:'no-store'}),current=getSession();if(!current||current.user.id!==fresh.user.id)throw new Error('Sesi akun berubah. Muat ulang halaman dan masuk kembali.');if(!fresh.user.emailVerified){setNotice('Status verifikasi belum terlihat. Pastikan tautan sudah dibuka, lalu cek kembali.');return;}const updated={...current,user:{...current.user,emailVerified:true}};saveSession(updated);setAuth(updated);setNotice('Email berhasil diverifikasi. Kamu bisa membuka interview sekarang.');}catch(e){setError(e instanceof Error?e.message:'Status email belum bisa diperiksa.');}finally{setBusy(false);}}
 if(claim?.mode==='TEXT')return <TaraApplication key={claim.session.id} invitedSessionId={claim.session.id}/>;
 if(claim?.mode==='VOICE'&&preview)return <VoiceInterview sessionId={claim.session.id} jobTitle={preview.jobTitle} companyName={preview.companyName}/>;
 const next='/screening/'+token,email=auth?.user.email??'',maskedEmail=maskEmail(email);
 const expires=preview&&!Number.isNaN(Date.parse(preview.expiresAt))?new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric'}).format(new Date(preview.expiresAt)):'';
 const backHref=auth?'/dashboard/employee?tab=applications':'/login?role=EMPLOYEE&next='+encodeURIComponent(next);
 const message=preview?.mode==='VOICE'?'Tim HR mengundangmu untuk membahas pengalaman di CV dan posisi yang kamu lamar. Percakapan akan direkap untuk membantu penilaian tim HR.':'Tim HR mengundangmu untuk membahas pengalaman di CV dan posisi yang kamu lamar.';
 return <main className={s.page}>
   <a className={s.backLink} href={localeUrl(locale,backHref)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg>Kembali ke lamaran</a>
   {preview&&<>
     <div className={s.pageHeading}>
       <span className={s.eyebrow}>UNDANGAN SCREENING</span>
       <h1>Undangan interview dengan Tara</h1>
     </div>
     <div className={s.jobSummary}><span className={s.briefcase} aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="13.5" rx="2.5"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3.5 12h17m-11 0v2h5v-2"/></svg></span><div><h2>{preview.jobTitle}</h2><p>{preview.companyName}</p></div></div>
     <div className={s.contentGrid}>
       <section className={s.inviteDetails} aria-label="Detail interview">
         <p className={s.intro}>{message}</p>
         <div className={s.detailsGrid}>
           <div className={s.detailItem}><span className={s.detailIcon}><MessageIcon/></span><span><strong>{preview.mode==='VOICE'?'Interview suara':'Interview teks'}</strong>{preview.mode==='VOICE'&&<small>Siapkan mikrofon</small>}</span></div>
           <div className={s.detailItem}><span className={s.detailIcon}>{preview.mode==='VOICE'?<ClockIcon/>:<ListIcon/>}</span><span><strong>{preview.mode==='VOICE'?'Maksimal 15 menit':'Maksimal 25 pertanyaan'}</strong></span></div>
           {preview.mode==='TEXT'&&<div className={s.detailItem}><span className={s.detailIcon}><ClockIcon/></span><span><strong>1 menit per pertanyaan</strong></span></div>}
         </div>
         {preview.mode==='TEXT'&&<p className={s.transcriptNote}>Percakapan akan direkap untuk membantu penilaian tim HR.</p>}
         {expires&&<p className={s.expiry}><CalendarIcon/> Berlaku sampai {expires}</p>}
       </section>
       <aside className={s.actionPanel} aria-label="Langkah berikutnya">
         <EnvelopeIcon/>
         {!role?<>
           <h2>Masuk untuk melanjutkan</h2>
           <p>Masuk menggunakan akun kandidat penerima undangan untuk melanjutkan interview.</p>
           <a className={s.primary} href={localeUrl(locale,'/login?role=EMPLOYEE&next='+encodeURIComponent(next))}>Masuk ke Talentio</a>
           <a className={s.secondaryLink} href={localeUrl(locale,'/register?role=EMPLOYEE&next='+encodeURIComponent(next))}>Belum punya akun? Daftar</a>
         </>:role!=='EMPLOYEE'?<>
           <h2>Gunakan akun kandidat</h2>
           <p>Masuk dengan email penerima undangan yang sudah diverifikasi.</p>
         </>:!auth?.user.emailVerified?<>
           <h2>Verifikasi email sebelum mulai</h2>
           <p>Pastikan kamu masuk dengan email penerima undangan dan sudah diverifikasi.</p>
           {maskedEmail&&<span className={s.emailBadge}>{maskedEmail}</span>}
           {notice&&<p role="status" className={s.notice}>{notice}</p>}
           {error&&<p role="alert" className={s.error}>{error}</p>}
           <button type="button" className={s.primary} disabled={busy} onClick={()=>void verify()}>{busy?'Mengirim email…':'Kirim email verifikasi'}</button>
           <button type="button" className={s.refreshVerification} disabled={busy} onClick={()=>void checkVerification()}>{busy?'Memeriksa status…':'Saya sudah verifikasi · Cek status'}</button>
           <small>Kamu bisa membuka interview setelah email terverifikasi.</small>
         </>:<>
           <h2>Email siap digunakan</h2>
           <p>Undangan sudah siap. Kamu bisa mulai interview bersama Tara.</p>
           {maskedEmail&&<span className={s.emailBadge}>{maskedEmail} · Terverifikasi</span>}
           {error&&<p role="alert" className={s.error}>{error}</p>}
           <button type="button" className={s.primary} disabled={busy} onClick={()=>void open()}>{busy?'Menyiapkan interview…':'Buka interview'}</button>
         </>}
       </aside>
     </div>
   </>}
   {!preview&&!error&&<section className={s.loading} role="status">Memuat undangan…</section>}
   {error&&!preview&&<section className={s.errorPage}><p role="alert" className={s.error}>{error}</p></section>}
 </main>;
}
