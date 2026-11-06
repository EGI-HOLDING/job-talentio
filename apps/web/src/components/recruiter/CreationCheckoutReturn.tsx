'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { employerWorkspaceHref } from '@/lib/accountNavigation';
import s from './HrFlow.module.css';
export function CreationCheckoutReturn({order}:{order:any}){
  const c=useHrCopy();
  const router=useRouter();const [status,setStatus]=useState(order.status),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setStatus(order.status),[order.id,order.status]);
  async function check(){setBusy(true);setError('');try{const result=await api<any>('/job-commerce/orders/'+order.id+'/reconcile',{method:'POST'});setStatus(result.status);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}
  useEffect(()=>{if(order.status==='PENDING'&&order.provider!=='free')void check();},[order.id]);
  async function resume(){
    setBusy(true);try{const progress=await api<any>('/recruiter-onboarding',{cache:'no-store'});const base=progress.status==='IN_PROGRESS'?'/onboarding/recruiter':employerWorkspaceHref('jobs',order.companyId);router.replace(base+(base.includes('?')?'&':'?')+'creationSession='+encodeURIComponent(order.creationSessionId)+'&create=1');}catch(reason){setError(reason instanceof Error?reason.message:String(reason));setBusy(false);}
  }
  return <div className={s.page}><header className={s.header}><img className={s.logo} src="/brand/talentio-logo.webp" alt="Talentio"/><span>{order.companyName}</span></header><section className={s.section+' '+s.success}><span className={s.badge}>{status==='PAID'?'✓ Terkonfirmasi':status==='PENDING'?c("Menunggu konfirmasi"):status}</span><h1 className={s.title}>{status==='PAID'?order.amount===0?c("Paket Free dikonfirmasi"):c("Pembayaran berhasil"):c("Periksa status pembayaran")}</h1><p className={s.subtitle}>{status==='PAID'?c("Paket siap digunakan untuk lowongan ini."):c("Status diverifikasi melalui server pembayaran. Draft dan pesanan Anda tetap tersimpan.")}</p>{error&&<div className={s.error} role="alert">{error}</div>}<div className={s.actions} style={{justifyContent:'center'}}>{status!=='PAID'&&<button className={s.secondary} disabled={busy} onClick={()=>void check()}>{c("Periksa status")}</button>}<button className={s.primary} disabled={busy} onClick={()=>void resume()}>{status==='PAID'?c("Lanjut membuat lowongan"):c("Kembali ke pesanan")}</button></div></section></div>;
}
