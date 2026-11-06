'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { PackageCatalog, PackageCode, money } from '@/lib/jobCommerce';
import { JobFormV2, cleanHrDraft, initialHrDraft, HrDraft } from './JobFormV2';
import s from './HrFlow.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';

export const hrFlowV2Enabled=process.env.NEXT_PUBLIC_HR_CREATION_V2==='true';
export function HrFlowHeader({companyName,stage,onboarding=false}:{companyName?:string;stage:number;onboarding?:boolean}){
  const c=useHrCopy();
  const labels=onboarding?['Perusahaan','Paket','Checkout','Lowongan']:['Paket','Checkout','Lowongan'];
  return <><ol className={s.steps} aria-label={c("Tahapan pembuatan lowongan")}>{labels.map((label,i)=><li key={label} aria-current={stage===i?'step':undefined} data-complete={stage>i}><span aria-hidden="true">{stage>i?'✓':i+1}</span>{c(label)}</li>)}</ol></>;
}
type Props={companyId:string;company:any;sessionId?:string;onboarding?:boolean;onClose:()=>void;onPublished:(id:string)=>void|Promise<void>;onSession?:(id:string)=>void};
export function HrCreationFlow({companyId,company,sessionId,onboarding=false,onClose,onPublished,onSession}:Props){
  const c=useHrCopy();
  const {locale}=useI18n();
  const [session,setSession]=useState<any>(null),[catalog,setCatalog]=useState<PackageCatalog|null>(null),[selected,setSelected]=useState<PackageCode|''>(''),[phase,setPhase]=useState('PACKAGE');
  const [draft,setDraft]=useState<HrDraft>(initialHrDraft()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[retry,setRetry]=useState(0);
  const sessionRef=useRef<any>(null),draftRef=useRef(draft),lastSaved=useRef(''),queue=useRef<Promise<any>>(Promise.resolve()),alive=useRef(false),lock=useRef(false),intentKey=useRef(''),orderKey=useRef<Record<string,string>>({}),publishKeys=useRef<Record<string,string>>({});
  draftRef.current=draft;
  function accept(value:any){if(value.id===sessionRef.current?.id&&value.revision<sessionRef.current.revision)return sessionRef.current;sessionRef.current=value;if(alive.current)setSession(value);return value;}
  const loadSession=async(id:string,signal?:AbortSignal)=>{const value=await api<any>('/hr-flow/sessions/'+id,{cache:'no-store',signal});if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(value.companyId!==companyId)throw Error(c("Draft berasal dari perusahaan lain."));return accept(value);};
  useEffect(()=>{
    if(sessionId&&sessionRef.current?.id===sessionId&&catalog&&!retry){alive.current=true;return()=>{alive.current=false;};}
    alive.current=true;const abort=new AbortController();intentKey.current||=crypto.randomUUID();
    setError('');
    (async()=>{
      const packages=await api<PackageCatalog>('/job-commerce/catalog',{auth:false,signal:abort.signal});
      if(!('hrFlowV2' in packages)||!packages.hrFlowV2)throw Error(c("Alur baru belum diaktifkan pada server."));
      const fromUrl=new URL(window.location.href).searchParams.get('creationSession');
      const currentId=sessionId??fromUrl;
      const value=currentId?await loadSession(currentId,abort.signal):await api<any>('/hr-flow/sessions',{method:'POST',headers:{'Idempotency-Key':intentKey.current},body:JSON.stringify({companyId}),signal:abort.signal});
      if(abort.signal.aborted)return;
      if(value.companyId!==companyId)throw Error(c("Draft berasal dari perusahaan lain."));
      const full=value.company?value:await loadSession(value.id,abort.signal);
      if(abort.signal.aborted)return;
      accept(full);setCatalog(packages);setSelected(full.order?.code??full.draft?._selectedPackageCode??'');
      setPhase(full.order?.status==='PAID'&&full.phase==='CHECKOUT'?'JOB':full.phase);
      const initial={...initialHrDraft(),countryId:company?.city?.province?.country?.id??null,citySlug:company?.city?.slug??'',...cleanHrDraft(full.draft??{})};
      draftRef.current=initial;setDraft(initial);lastSaved.current=JSON.stringify(cleanHrDraft(initial));setStatus(c("Tersimpan"));
      const url=new URL(window.location.href);url.searchParams.set('creationSession',full.id);window.history.replaceState(null,'',url);onSession?.(full.id);
      if(full.jobId)await onPublished(full.jobId);
    })().catch(reason=>{if(!abort.signal.aborted)setError(reason.message);});
    return()=>{alive.current=false;abort.abort();};
  },[companyId,sessionId,retry]);
  function saveDraft(){
    const run=queue.current.catch(()=>undefined).then(async()=>{
      if(!alive.current||!sessionRef.current)throw Error(c("Halaman sudah berubah."));
      const body=cleanHrDraft(draftRef.current),serialized=JSON.stringify(body);
      if(serialized===lastSaved.current)return sessionRef.current;
      setStatus(c("Menyimpan..."));
      try{
        const value=await api<any>('/hr-flow/sessions/'+sessionRef.current.id,{method:'PATCH',body:JSON.stringify({revision:sessionRef.current.revision,draft:body})});
        if(!alive.current)return value;
        accept(value);lastSaved.current=serialized;setStatus(serialized===JSON.stringify(cleanHrDraft(draftRef.current))?c("Tersimpan"):c("Perubahan belum tersimpan"));return value;
      }catch(reason){if(alive.current)setStatus(c("Belum tersimpan"));throw reason;}
    });queue.current=run;return run;
  }
  const serialized=JSON.stringify(cleanHrDraft(draft));
  useEmployerUnsaved(phase==='JOB'&&serialized!==lastSaved.current,busy);
  useEffect(()=>{
    if(!session||phase!=='JOB'||session.order?.status!=='PAID'||serialized===lastSaved.current)return;
    setStatus(c("Perubahan belum tersimpan"));const timer=setTimeout(()=>void saveDraft().catch(reason=>{if(alive.current)setError(reason.message);}),700);return()=>clearTimeout(timer);
  },[serialized,phase,session?.id]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(JSON.stringify(cleanHrDraft(draftRef.current))!==lastSaved.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[]);
  useEffect(()=>{
    if(phase!=='CHECKOUT'||session?.order?.status!=='PENDING')return;
    let cancelled=false,inFlight=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{if(cancelled||document.hidden||inFlight)return;inFlight=true;try{const value=await loadSession(session.id);if(!cancelled&&value.order?.status==='PAID')setPhase('JOB');}catch{}finally{inFlight=false;if(!cancelled)timer=setTimeout(poll,5000);}};
    const visible=()=>{if(!document.hidden){clearTimeout(timer);void poll();}};
    timer=setTimeout(poll,5000);document.addEventListener('visibilitychange',visible);
    return()=>{cancelled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[phase,session?.id,session?.order?.status]);
  async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:String(reason));}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function go(next:string){
    await queue.current.catch(()=>undefined);
    if(phase==='JOB')await saveDraft();
    const previousOrder=sessionRef.current.order;
    if(next==='CHECKOUT'&&previousOrder?.status==='PENDING'&&previousOrder.code!==selected){
      await api('/job-commerce/orders/'+previousOrder.id+'/cancel',{method:'POST'});await loadSession(sessionRef.current.id);
    }
    const value=await api<any>('/hr-flow/sessions/'+sessionRef.current.id,{method:'PATCH',body:JSON.stringify({revision:sessionRef.current.revision,phase:next,...(selected?{packageCode:selected}:{})})});accept(value);setPhase(next);window.scrollTo({top:0,behavior:'instant'});
  }
  async function pay(){
    if(!selected)throw Error(c("Pilih paket terlebih dahulu."));
    let value=sessionRef.current;
    let order=value.order;
    if(!order||!['PENDING','PAID','REVIEW'].includes(order.status)){
      const orderIntent=selected+':'+(order?.id??'new');orderKey.current[orderIntent]??=crypto.randomUUID();
      order=await api<any>('/job-commerce/orders',{method:'POST',headers:{'Idempotency-Key':orderKey.current[orderIntent]},body:JSON.stringify({creationSessionId:value.id,code:selected,intent:'PURCHASE'})});
      value=await loadSession(value.id);
      if(order.amount!==catalog?.packages.find(v=>v.code===selected)?.amount)throw Error(c("Harga paket berubah. Periksa kembali ringkasan pesanan sebelum melanjutkan."));
    }
    if(order.status==='PAID'){setPhase('JOB');return;}
    if(order.status!=='PENDING')throw Error(c("Pesanan memerlukan pemeriksaan status sebelum dilanjutkan."));
    if(!catalog?.paymentAvailable&&!catalog?.testMode)throw Error(c("Pembayaran belum tersedia. Paket Free tetap dapat dipilih."));
    if(catalog.testMode){await api('/job-commerce/orders/'+order.id+'/complete-test',{method:'POST'});await loadSession(value.id);setPhase('JOB');return;}
    const checkout=await api<{redirectUrl:string}>('/job-commerce/orders/'+order.id+'/payment-session',{method:'POST'});
    const target=new URL(checkout.redirectUrl);if(target.protocol!=='https:')throw Error(c("Alamat pembayaran tidak valid."));window.location.assign(target.href);
  }
  async function publish(){
    const value=await saveDraft();
    const key=String(value.revision);publishKeys.current[key]??=crypto.randomUUID();
    const result=await api<{jobId:string}>('/hr-flow/sessions/'+value.id+'/publish',{method:'POST',headers:{'Idempotency-Key':publishKeys.current[key]},body:JSON.stringify({revision:value.revision})});
    lastSaved.current=JSON.stringify(cleanHrDraft(draftRef.current));await onPublished(result.jobId);
  }
  const choice=catalog?.packages.find(v=>v.code===selected),order=session?.order,paid=order?.status==='PAID';
  if(!catalog||!session)return <div className={s.page}>{error?<div className={s.error} role="alert">{error}<br/><button className={s.link} onClick={()=>setRetry(v=>v+1)}>{c("Coba lagi")}</button><button className={s.link} onClick={onClose}>{c("Kembali")}</button></div>:<WorkspaceLoading/>}</div>;
  return <div className={s.page} data-hr-flow-v2>
    <HrFlowHeader companyName={company?.name??session.company?.name} stage={(phase==='PACKAGE'?0:phase==='CHECKOUT'?1:2)+(onboarding?1:0)} onboarding={onboarding}/>
    <h1 className={s.title}>{phase==='PACKAGE'?c("Pilih paket untuk lowongan ini"):phase==='CHECKOUT'?c("Periksa pesanan Anda"):c("Buat lowongan")}</h1>
    <p className={s.subtitle}>{phase==='PACKAGE'?c("Pilih dari tiga paket sesuai kebutuhan rekrutmen. Pembelian berlaku untuk satu lowongan."):phase==='CHECKOUT'?c("Pastikan paket dan perusahaan sudah sesuai sebelum melanjutkan."):c("Susun kebutuhan posisi dengan jelas untuk kandidat.")}</p>
    {error&&<div className={s.error} role="alert" tabIndex={-1}>{error}</div>}
    {phase==='PACKAGE'&&<><div className={s.packages}>{catalog.packages.map(pack=><button type="button" className={s.package} key={pack.code} data-selected={selected===pack.code} aria-pressed={selected===pack.code} disabled={busy||paid&&pack.code!==order.code} onClick={()=>setSelected(pack.code)}><h2>{pack.code==='FREE'?'Free':pack.code==='STANDARD'?'Standard':'Premium'}</h2><p className={s.price}>{money(pack.amount,locale,pack.currency)}</p><span className={s.hint}>{c("per lowongan")}</span><ul><li>{c("Publikasi")+" "}{pack.settings.durationDays} {c("hari")}</li><li>{c("Kelola seluruh pelamar")}</li><li>{c("Statistik lowongan")}</li><li>{pack.settings.boostDays?`Boost ${pack.settings.boostDays} hari`:c("Tanpa boost tambahan")}</li><li>{pack.settings.featuredDays?`Featured ${pack.settings.featuredDays} hari`:c("Visibilitas reguler")}</li></ul>{selected===pack.code&&<span className={s.badge}>{c("✓ Dipilih")}</span>}</button>)}</div><details className={s.features}><summary>{c("Bandingkan fitur paket")}</summary><table className={s.featureTable}><thead><tr><th>{c("Fitur")}</th>{catalog.packages.map(p=><th key={p.code}>{p.code==='FREE'?'Free':p.code==='STANDARD'?'Standard':'Premium'}</th>)}</tr></thead><tbody>{[[c("Durasi tayang"),(p:any)=>p.settings.durationDays+' hari'],['Boost',(p:any)=>p.settings.boostDays+' hari'],['Featured',(p:any)=>p.settings.featuredDays+' hari'],['Laporan',(p:any)=>p.settings.reports?'Tersedia':'-'],[c("Dukungan prioritas"),(p:any)=>p.settings.prioritySupport?'Tersedia':'-']].map(([label,value]:any)=><tr key={label}><th>{label}</th>{catalog.packages.map(p=><td key={p.code}>{value(p)}</td>)}</tr>)}</tbody></table></details><p className={s.hint}>{c("Tidak berlangganan otomatis. Harga dan manfaat mengikuti katalog paket aktif.")}</p></>}
    {phase==='CHECKOUT'&&choice&&<div className={s.receipt}><section className={s.section}><h2>{c("Informasi pesanan")}</h2><strong>{company?.name??session.company?.name}</strong><p>{choice.code==='FREE'?'Free':choice.code==='STANDARD'?'Standard':'Premium'} {c("| 1 lowongan")}</p><p className={s.hint}>{c("Lowongan akan diisi setelah paket dikonfirmasi")}{choice.amount>0?c(" dan pembayaran selesai"):''}.</p><hr className={s.separator}/><h3>{choice.amount===0?c("Konfirmasi paket Free"):'Pembayaran'}</h3><p className={s.hint}>{choice.amount===0?c("Tidak ada pembayaran uang untuk paket ini."):c("Pilih metode pembayaran di halaman Midtrans. Status pembayaran dikonfirmasi oleh server.")}</p>{order&&<p className={s.hint}>{c("Status:")+" "}{order.status==='PAID'?'Terkonfirmasi':order.status==='PENDING'?c("Menunggu pembayaran"):order.status}</p>}{order?.paymentRedirectUrl&&order.status==='PENDING'&&<button className={s.link} disabled={busy} onClick={()=>void run(async()=>{await api('/job-commerce/orders/'+order.id+'/reconcile',{method:'POST'});const value=await loadSession(session.id);if(value.order?.status==='PAID')setPhase('JOB');})}>{c("Periksa status pembayaran")}</button>}</section><section className={s.section}><h2>{c("Ringkasan pesanan")}</h2><dl><div><dt>{c("Paket")}</dt><dd>{choice.code}</dd></div><div className={s.total}><dt>{c("Total")}</dt><dd>{money(order?.amount??choice.amount,locale,order?.currency??choice.currency)}</dd></div></dl><p className={s.hint}>{c("Untuk satu lowongan di perusahaan ini.")}</p></section></div>}
    {phase==='JOB'&&paid&&<><div className={s.context}><strong>{company?.name??session.company?.name}</strong><span className={s.badge}>{order.code==='FREE'?'Free | Dikonfirmasi':order.code+c(" | Sudah dibayar")}</span></div><form id="hr-job-form" onSubmit={e=>{e.preventDefault();void run(publish);}}><JobFormV2 draft={draft} initialCity={company?.city} disabled={busy} onChange={patch=>setDraft(previous=>({...previous,...patch}))}/></form></>}
    <footer className={s.footer}><div className={s.footerInner}><button className={s.link} disabled={busy} onClick={()=>void run(async()=>{if(phase==='PACKAGE')onClose();else await go(phase==='JOB'?'CHECKOUT':'PACKAGE');})}>{c("← Kembali")}</button><span className={s.status} role="status">{phase==='JOB'?status:selected?`${selected} | ${money(order?.amount??choice?.amount??0,locale,order?.currency??choice?.currency??'IDR')}`:c("Pilih satu paket")}</span><div className={s.actions}>{phase==='JOB'?<><button className={s.secondary} disabled={busy} onClick={()=>void run(async()=>{await saveDraft();setError('');})}>{c("Simpan draf")}</button><button className={s.primary} type="submit" form="hr-job-form" disabled={busy}>{c("Publikasikan lowongan")}</button></>:<button className={s.primary} disabled={busy||!selected} onClick={()=>void run(phase==='PACKAGE'?()=>go('CHECKOUT'):pay)}>{busy?'Memproses...':phase==='PACKAGE'?c("Lanjut ke checkout"):choice?.amount===0?c("Konfirmasi paket Free"):paid?c("Lanjut membuat lowongan"):c("Lanjut ke pembayaran")}</button>}</div></div></footer>
  </div>;
}
