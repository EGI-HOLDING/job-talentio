'use client';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { startCandidateImport } from '@/lib/candidateImports';
import { api, getSession } from '@/lib/api';
import { validateHrDraft, focusHrDraftIssue, hrJobError, type HrDraftIssue } from './hrDraftValidation';
import { useI18n } from '@/lib/i18n';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { PackageCatalog, PackageCode, money } from '@/lib/jobCommerce';
import { JobFormV2, cleanHrDraft, initialHrDraft, HrDraft } from './JobFormV2';
import s from './HrFlow.module.css';
import { useEmployerUnsaved } from './useEmployerUnsaved';
import { HrIcon, useHrFlowSurface } from './HrFlowPresentation';
import { HrAssistantOnboarding, type AssistantFinishAction } from './HrAssistantOnboarding';
import { clearAssistantProgress, readAssistantProgress, saveAssistantProgress, type AssistantSceneId } from './hrAssistantState';

type AssistantAttempt = {
  action: AssistantFinishAction;
  sessionId: string;
  revision: number;
  publishKey: string;
  files: File[];
  jobId?: string;
  importRegistered?: boolean;
};

export const hrFlowV2Enabled=process.env.NEXT_PUBLIC_HR_CREATION_V2==='true'||process.env.NEXT_PUBLIC_PRIVACY_MARKET==='id';
export function HrFlowHeader({companyName,stage,onboarding=false}:{companyName?:string;stage:number;onboarding?:boolean}){
  const c=useHrCopy();
  const labels=onboarding?['Perusahaan','Paket','Checkout','Lowongan']:['Paket','Checkout','Lowongan'];
  return <ol className={s.steps} aria-label={c("Tahapan pembuatan lowongan")}>{labels.map((label,i)=><li key={label} aria-current={stage===i?'step':undefined} data-complete={stage>i}><span className={s.stepNumber} aria-hidden="true">{stage>i?<HrIcon kind="check"/>:i+1}</span>{c(label)}</li>)}</ol>;
}
type Props={companyId:string;company:any;sessionId?:string;onboarding?:boolean;onClose:()=>void;onPublished:(id:string,fromTemplate?:boolean)=>void|Promise<void>;onSession?:(id:string)=>void};
export function HrCreationFlow({companyId,company,sessionId,onboarding=false,onClose,onPublished,onSession}:Props){
  useHrFlowSurface(company?.name);
  const c=useHrCopy();
  const {locale}=useI18n();
  const [session,setSession]=useState<any>(null),[catalog,setCatalog]=useState<PackageCatalog|null>(null),[selected,setSelected]=useState<PackageCode|''>(''),[phase,setPhase]=useState('PACKAGE');
  const [draftIssues,setDraftIssues]=useState<HrDraftIssue[]>([]);
  const [draft,setDraft]=useState<HrDraft>(initialHrDraft()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[retry,setRetry]=useState(0);
  const [details,setDetails]=useState<PackageCode|null>(null);
  const [assistantScene,setAssistantScene]=useState<AssistantSceneId|null>(null);
  const [assistantFiles, setAssistantFiles] = useState<File[]>([]);
  const [assistantAttempt, setAssistantAttempt] = useState<AssistantAttempt | null>(null);
  const sessionRef=useRef<any>(null),draftRef=useRef(draft),lastSaved=useRef(''),queue=useRef<Promise<any>>(Promise.resolve()),alive=useRef(false),lock=useRef(false),intentKey=useRef(''),orderKey=useRef<Record<string,string>>({}),publishKeys=useRef<Record<string,string>>({});
  draftRef.current=draft;
  const templateId = session?.templateId;
  const templateIssue = session?.templateIssue;
  const editable = !templateId || Boolean(templateIssue);
  const publishedTemplate = useRef<string | null>(null);
  async function openPublishedTemplate(jobId: string) {
    if (!alive.current || publishedTemplate.current === jobId) return;
    publishedTemplate.current = jobId;
    await onPublished(jobId, true);
  }
  function accept(value:any){if(value.id===sessionRef.current?.id&&value.revision<sessionRef.current.revision)return sessionRef.current;sessionRef.current=value;if(alive.current)setSession(value);return value;}
  const loadSession=async(id:string,signal?:AbortSignal)=>{const value=await api<any>('/hr-flow/sessions/'+id,{cache:'no-store',signal});if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(value.companyId!==companyId)throw Error(c("Draft berasal dari perusahaan lain."));return accept(value);};
  useEffect(()=>{
    if(sessionId&&sessionRef.current?.id===sessionId&&catalog&&!retry){alive.current=true;return()=>{alive.current=false;};}
    alive.current=true;const abort=new AbortController();intentKey.current||=crypto.randomUUID();
    setError('');setAssistantScene(null);
    setAssistantFiles([]);
    setAssistantAttempt(null);
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
      if(onboarding&&full.order?.status==='PAID'&&!full.jobId){
        setAssistantScene(readAssistantProgress(getSession()?.user.id??'',full.id));
      }
      if(full.jobId&&!onboarding){
        if(full.templateId)await openPublishedTemplate(full.jobId);
        else await onPublished(full.jobId);
      }
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
  useEmployerUnsaved(editable&&phase==='JOB'&&serialized!==lastSaved.current,busy);
  useEffect(()=>{
    if(!editable||!session||phase!=='JOB'||session.order?.status!=='PAID'||serialized===lastSaved.current)return;
    setStatus(c("Perubahan belum tersimpan"));const timer=setTimeout(()=>void saveDraft().catch(reason=>{if(alive.current)setError(reason.message);}),700);return()=>clearTimeout(timer);
  },[serialized,phase,session?.id,editable]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if((!sessionRef.current?.templateId||sessionRef.current.templateIssue)&&JSON.stringify(cleanHrDraft(draftRef.current))!==lastSaved.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[]);
  useEffect(()=>{
    const waitingForPayment = phase === 'CHECKOUT' && session?.order?.status === 'PENDING';
    const waitingForPublication = phase === 'JOB' && templateId && !templateIssue && !session?.jobId;
    if (!session || (!waitingForPayment && !waitingForPublication)) return;
    const abort = new AbortController();
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (abort.signal.aborted || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const value = await loadSession(session.id, abort.signal);
        if (value.templateId && value.jobId) await openPublishedTemplate(value.jobId);
        else if (value.order?.status === 'PAID') setPhase('JOB');
      } catch { /* The server continues publishing during transient network failures. */ }
      finally {
        inFlight = false;
        if (!abort.signal.aborted) timer = setTimeout(poll, 3500);
      }
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    timer = setTimeout(poll, 3500);
    document.addEventListener('visibilitychange', visible);
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  },[phase,session?.id,session?.jobId,session?.order?.status,templateId,templateIssue]);
  async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(reason){if(alive.current)setError(c(hrJobError(reason)));}finally{lock.current=false;if(alive.current)setBusy(false);}}
  async function go(next:string){
    await queue.current.catch(()=>undefined);
    if(phase==='JOB')await saveDraft();
    const previousOrder=sessionRef.current.order;
    if(next==='CHECKOUT'&&previousOrder?.status==='PENDING'&&previousOrder.code!==selected){
      await api('/job-commerce/orders/'+previousOrder.id+'/cancel',{method:'POST'});await loadSession(sessionRef.current.id);
    }
    const value=await api<any>('/hr-flow/sessions/'+sessionRef.current.id,{method:'PATCH',body:JSON.stringify({revision:sessionRef.current.revision,phase:next,...(selected?{packageCode:selected}:{})})});accept(value);setPhase(next);window.scrollTo({top:0,behavior:'instant'});
  }
  async function confirmed(value: { id: string; templateId?: string; jobId?: string }) {
    if (!alive.current) return;
    setPhase('JOB');
    if (!value.templateId) return;
    if (value.jobId) { await openPublishedTemplate(value.jobId); return; }
    const result = await api<{ jobId: string | null }>('/hr-flow/sessions/' + value.id + '/publish-template', { method: 'POST' });
    if (!alive.current) return;
    if (result.jobId) await openPublishedTemplate(result.jobId);
    else await loadSession(value.id);
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
    if(order.status==='PAID'){await confirmed(value);return;}
    if(order.status!=='PENDING')throw Error(c("Pesanan memerlukan pemeriksaan status sebelum dilanjutkan."));
    if(!catalog?.paymentAvailable&&!catalog?.testMode)throw Error(c("Pembayaran belum tersedia. Paket Free tetap dapat dipilih."));
    if(catalog.testMode){await api('/job-commerce/orders/'+order.id+'/complete-test',{method:'POST'});await confirmed(await loadSession(value.id));return;}
    const checkout=await api<{redirectUrl:string}>('/job-commerce/orders/'+order.id+'/payment-session',{method:'POST'});
    const target=new URL(checkout.redirectUrl);if(target.protocol!=='https:')throw Error(c("Alamat pembayaran tidak valid."));window.location.assign(target.href);
  }
  function validateJob(){
    const {issues}=validateHrDraft(draftRef.current);
    setDraftIssues(issues);
    if(issues.length){requestAnimationFrame(()=>focusHrDraftIssue(issues[0].field));return false;}
    return true;
  }
  async function publish(){
    if(!validateJob())return;
    const value=await saveDraft();
    const key=String(value.revision);publishKeys.current[key]??=crypto.randomUUID();
    const result=await api<{jobId:string}>('/hr-flow/sessions/'+value.id+'/publish',{method:'POST',headers:{'Idempotency-Key':publishKeys.current[key]},body:JSON.stringify({revision:value.revision})});
    lastSaved.current=JSON.stringify(cleanHrDraft(draftRef.current));
    if(value.templateId)await openPublishedTemplate(result.jobId);
    else await onPublished(result.jobId);
  }
  async function finishAssistant(action: AssistantFinishAction) {
    let attempt = assistantAttempt;
    if (!attempt) {
      const saved = await saveDraft();
      attempt = {
        action,
        sessionId: saved.id,
        revision: saved.revision,
        publishKey: crypto.randomUUID(),
        files: action === 'upload' ? [...assistantFiles] : [],
      };
      setAssistantAttempt(attempt);
    }

    let jobId = attempt.jobId;
    if (!jobId) {
      const published = await api<{ jobId: string }>('/hr-flow/sessions/' + attempt.sessionId + '/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': attempt.publishKey },
        body: JSON.stringify({ revision: attempt.revision }),
      });
      jobId = published.jobId;
      setAssistantAttempt({ ...attempt, jobId });
    }
    if (attempt.action === 'upload' && !attempt.importRegistered) {
      await startCandidateImport(companyId, jobId, attempt.files);
      setAssistantAttempt({ ...attempt, jobId, importRegistered: true });
    }
    await onPublished(jobId);
    setAssistantFiles([]);
  }
  function returnToJob() {
    clearAssistantProgress(getSession()?.user.id ?? '', session.id);
    setAssistantScene(null);
    setPhase('JOB');
    window.scrollTo({ top: 0 });
  }
  async function continueToAssistant(){
    if(!validateJob())return;
    if(sessionRef.current?.order?.status!=='PAID')throw Error(c('Konfirmasikan paket terlebih dahulu.'));
    const value=await saveDraft();
    saveAssistantProgress(getSession()?.user.id??'',value.id,'taka-intro');
    setAssistantScene('taka-intro');
  }
  const choice=catalog?.packages.find(v=>v.code===selected),order=session?.order,paid=order?.status==='PAID';
  const packageName=(code:string)=>code==='FREE'?'Free':code==='STANDARD'?'Standard':'Premium';
  const orderState=(state:string)=>c(({PAID:'Paket dikonfirmasi',PENDING:'Menunggu pembayaran',REVIEW:'Sedang diperiksa',EXPIRED:'Pesanan kedaluwarsa',CANCELLED:'Pesanan dibatalkan',FAILED:'Pembayaran gagal',REFUNDED:'Pembayaran dikembalikan'} as Record<string,string>)[state]??'Perlu pemeriksaan status');
  if(!catalog||!session)return <div className={s.page} data-hr-surface>{error?<div className={s.error} role="alert">{error}<br/><button className={s.link} onClick={()=>setRetry(v=>v+1)}>{c("Coba lagi")}</button><button className={s.link} onClick={onClose}>{c("Kembali")}</button></div>:<WorkspaceLoading/>}</div>;
  if (onboarding && assistantScene) return <HrAssistantOnboarding
    key={session.id}
    companyId={companyId}
    companyName={company?.name ?? session.company?.name ?? ''}
    userId={getSession()?.user.id ?? ''}
    creationSessionId={session.id}
    initialScene={assistantScene}
    selectedFiles={assistantFiles}
    setSelectedFiles={setAssistantFiles}
    pendingAction={assistantAttempt?.action}
    onBackToJob={returnToJob}
    onFinish={finishAssistant}
  />;
  const templateSummary = templateId && <div className={s.templateSummary}><HrIcon kind="briefcase"/><div><strong>{session.draft?.title}</strong>{session.draft?._templateFields?.location && <p>{session.draft._templateFields.location}</p>}</div></div>;
  const heading=<><h1 className={s.title}>{phase==='PACKAGE'?c("Pilih paket untuk lowongan ini"):phase==='CHECKOUT'?c("Periksa pesanan Anda"):c(templateId?(editable?"Perbaiki draf":"Menerbitkan lowongan"):"Buat lowongan")}</h1><p className={s.subtitle}>{phase==='PACKAGE'?c("Pembelian berlaku untuk satu lowongan. Tidak berlangganan otomatis."):phase==='CHECKOUT'?c("Pastikan paket dan perusahaan sudah sesuai sebelum melanjutkan."):templateId?(editable?c("Paket Anda sudah dikonfirmasi. Perbarui draf lalu terbitkan lowongan."):c("Anda boleh kembali ke daftar lowongan. Publikasi tetap berjalan.")):c("Susun kebutuhan posisi dengan jelas untuk kandidat.")}</p></>;
  return <div className={s.page} data-hr-flow-v2 data-hr-surface>
    <HrFlowHeader companyName={company?.name??session.company?.name} stage={(phase==='PACKAGE'?0:phase==='CHECKOUT'?1:2)+(onboarding?1:0)} onboarding={onboarding}/>
    {error&&<div className={s.error} role="alert">{error}</div>}
    {draftIssues.length>0&&<div className={s.error} role="alert"><strong>{c("Periksa isian berikut untuk melanjutkan:")}</strong><ul>{draftIssues.map(issue=><li key={issue.path}><button type="button" className={s.link} onClick={()=>focusHrDraftIssue(issue.field)}>{c(issue.message)}</button></li>)}</ul></div>}
    {phase==='PACKAGE'?<section className={s.stageCard}><p className={s.eyebrow}><HrIcon kind="building"/>{company?.name??session.company?.name}<span aria-hidden="true">|</span>{c("Lowongan baru")}</p>{heading}{templateSummary}
      <div className={s.packages} role="group" aria-label={c("Pilihan paket lowongan")}>{catalog.packages.map(pack=><div className={s.package} key={pack.code} data-selected={selected===pack.code}>
        <label className={s.packageSelect}><input type="radio" name="job-package" aria-label={packageName(pack.code)} checked={selected===pack.code} disabled={busy||paid&&pack.code!==order.code} onChange={()=>setSelected(pack.code)}/><h2>{packageName(pack.code)}</h2>{selected===pack.code&&<span className={s.selectedBadge}><HrIcon kind="check" size={14}/>{c("Dipilih")}</span>}</label>
        <p className={s.price}>{money(pack.amount,locale,pack.currency)}</p><span className={s.priceUnit}>/ {c("lowongan")}</span>
        <ul>{[c("Publikasi")+' '+pack.settings.durationDays+' '+c("hari"),c("Kelola seluruh pelamar"),c("Statistik lowongan"),pack.settings.boostDays?`Boost ${pack.settings.boostDays} ${c("hari")}`:c("Tanpa boost tambahan"),pack.settings.featuredDays?`Featured ${pack.settings.featuredDays} ${c("hari")}`:c("Visibilitas reguler")].map(text=><li key={text}><HrIcon kind="check" size={20}/><span>{text}</span></li>)}</ul>
        {details===pack.code&&<p className={s.packageDetails} id={'package-details-'+pack.code}>{c("Laporan")}: {pack.settings.reports?c("Tersedia"):c("Tidak termasuk")}. {c("Dukungan prioritas")}: {pack.settings.prioritySupport?c("Tersedia"):c("Tidak termasuk")}.</p>}
        <button type="button" className={s.link} aria-expanded={details===pack.code} aria-controls={details===pack.code?'package-details-'+pack.code:undefined} onClick={()=>setDetails(details===pack.code?null:pack.code)}>{c("Lihat rincian paket")}<DirectionalIcon direction={details === pack.code ? "up" : "down"} size={16} /></button>
      </div>)}</div>
      <details className={s.features}><summary><HrIcon kind="briefcase"/>{c("Bandingkan fitur paket")}<HrIcon kind="chevron"/></summary><div className={s.featureScroll}><table className={s.featureTable}><thead><tr><th>{c("Fitur")}</th>{catalog.packages.map(p=><th key={p.code}>{packageName(p.code)}</th>)}</tr></thead><tbody>{[[c("Durasi tayang"),(p:any)=>p.settings.durationDays+' '+c("hari")],['Boost',(p:any)=>p.settings.boostDays+' '+c("hari")],['Featured',(p:any)=>p.settings.featuredDays+' '+c("hari")],[c("Laporan"),(p:any)=>p.settings.reports?c("Tersedia"):c("Tidak termasuk")],[c("Dukungan prioritas"),(p:any)=>p.settings.prioritySupport?c("Tersedia"):c("Tidak termasuk")]].map(([label,value]:any)=><tr key={label}><th>{label}</th>{catalog.packages.map(p=><td key={p.code}>{value(p)}</td>)}</tr>)}</tbody></table></div></details><p className={s.hint}>{c("Harga dan manfaat mengikuti katalog paket aktif.")}</p>
    </section>:<>{heading}{templateSummary}
      {phase==='CHECKOUT'&&choice&&<div className={s.receipt}><div><section className={s.section}><h2>{c("Informasi pesanan")}</h2><div className={s.orderCompany}><HrIcon kind="building"/><div><strong>{company?.name??session.company?.name}</strong><p>{packageName(choice.code)} | {c("1 lowongan")}</p><p className={s.hint}>{templateId?c("Lowongan terbit otomatis setelah paket dikonfirmasi."):c("Lowongan akan diisi setelah paket dikonfirmasi")+(choice.amount>0?c(" dan pembayaran selesai"):"")+"."}</p></div></div><button type="button" className={`${s.link} ${s.inlineChange}`} disabled={busy} onClick={()=>void run(()=>go('PACKAGE'))}>{c("Ubah paket")}</button></section>
        <section className={s.section}><h2>{choice.amount===0?c("Konfirmasi paket Free"):c("Pembayaran")}</h2><div className={s.paymentBody}><HrIcon kind={choice.amount===0?'check':'shield'}/><div><strong>{choice.amount===0?c("Tidak ada pembayaran uang untuk paket ini."):c("Pilih metode pembayaran di halaman penyedia pembayaran.")}</strong><p className={s.hint}>{choice.amount===0?c(templateId?"Konfirmasikan paket untuk menerbitkan lowongan.":"Konfirmasikan paket untuk mulai menyusun lowongan."):c("Anda akan diarahkan ke Midtrans untuk menyelesaikan pembayaran.")}</p></div></div>{order&&<p className={s.hint}>{c("Status:")} {orderState(order.status)}</p>}{order?.paymentRedirectUrl&&order.status==='PENDING'&&<button className={s.link} disabled={busy} onClick={()=>void run(async()=>{await api('/job-commerce/orders/'+order.id+'/reconcile',{method:'POST'});const value=await loadSession(session.id);if(value.order?.status==='PAID')await confirmed(value);})}>{c("Periksa status pembayaran")}</button>}</section>
        <div className={s.notice}><HrIcon kind="info"/><p>{choice.amount===0?c("Paket Free dapat digunakan setelah Anda mengonfirmasi."):c("Pembayaran dikonfirmasi otomatis setelah berhasil.")}</p></div>
        {choice.amount>0&&!catalog.paymentAvailable&&!paid&&<p className={s.hint}>{c("Pembayaran belum tersedia. Paket Free tetap dapat dipilih.")}</p>}
      </div><section className={s.section}><h2>{c("Ringkasan pesanan")}</h2><dl><div><dt>{c("Paket")} {packageName(choice.code)}</dt><dd>{money(order?.amount??choice.amount,locale,order?.currency??choice.currency)}</dd></div><div className={s.total}><dt>{choice.amount===0?c("Total"):c("Total pembayaran")}</dt><dd>{money(order?.amount??choice.amount,locale,order?.currency??choice.currency)}</dd></div></dl><p className={s.hint}>{choice.amount===0?c("Satu paket untuk satu lowongan."):c("Sekali bayar untuk lowongan ini.")}</p></section></div>}
      {phase==='JOB'&&!editable&&<div className={s.section} role="status"><WorkspaceLoading/></div>}
      {phase==='JOB'&&editable&&<>{templateIssue&&<p className={s.error} role="alert">{c(hrJobError(templateIssue))}</p>}<div className={s.context}><strong><HrIcon kind="building"/>{company?.name??session.company?.name}</strong><span className={s.badge}>{selected&&packageName(selected)} | {choice?.amount===0?c("Paket dikonfirmasi"):c("Sudah dibayar")}</span><span className={s.saved} data-saved={status===c("Tersimpan")} role="status">{status===c("Tersimpan")&&<HrIcon kind="check" size={17}/>} {status}</span></div><form id="hr-job-form" onSubmit={e=>{e.preventDefault();void run(onboarding?continueToAssistant:publish);}}><JobFormV2 draft={draft} companyId={companyId} initialCity={company?.city} disabled={busy} validationIssues={draftIssues} onChange={patch=>{setDraftIssues(previous=>previous.filter(issue=>!(issue.field in patch)));setDraft(previous=>({...previous,...patch}));}}/></form></>}
    </>}
    <footer className={s.footer}><div className={s.footerInner}>
      {phase==='PACKAGE'?<div className={s.footerSummary}><span>{c("Paket dipilih:")} <strong>{selected?packageName(selected):c("Belum dipilih")}</strong></span><span>{c("Total")} <b>{money(order?.amount??choice?.amount??0,locale,order?.currency??choice?.currency??'IDR')}</b></span></div>:<button type="button" className={s.secondary} disabled={busy} onClick={()=>templateId&&phase==='JOB'?onClose():void run(()=>go(phase==='JOB'?'CHECKOUT':'PACKAGE'))}><HrIcon kind="back"/>{c(templateId&&phase==='JOB'?"Kembali ke lowongan":"Kembali")}</button>}
      {phase==='CHECKOUT'&&<span className={s.status}>{paid?orderState('PAID'):choice?.amount===0?c("Paket belum dikonfirmasi"):order?orderState(order.status):c("Pesanan belum dibayar")}</span>}
      <div className={s.actions}>{phase==='PACKAGE'&&<button type="button" className={s.secondary} disabled={busy} onClick={()=>void run(async()=>{onClose();})}>{c("Kembali")}</button>}{phase==='JOB'?editable?<><button className={s.secondary} disabled={busy} onClick={()=>void run(async()=>{await saveDraft();setError('');})}>{c("Simpan draf")}</button><button className={s.primary} type="submit" form="hr-job-form" disabled={busy}>{c(onboarding?'Lanjut':'Publikasikan lowongan')}</button></>:error?<button className={s.primary} disabled={busy} onClick={()=>void run(()=>confirmed(session))}>{c("Coba lagi")}</button>:null:<button className={s.primary} disabled={busy||!selected} onClick={()=>void run(phase==='PACKAGE'?()=>go('CHECKOUT'):pay)}>{busy?c("Memproses..."):phase==='PACKAGE'?c("Lanjut ke checkout"):choice?.amount===0?c("Konfirmasi paket Free"):paid?c(templateId?"Terbitkan lowongan":"Lanjut membuat lowongan"):c("Lanjut ke pembayaran")}{!busy && (phase === 'PACKAGE' || paid) && <HrIcon kind="next"/>}</button>}</div>
    </div></footer>
  </div>;
}
