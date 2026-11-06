'use client';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useEffect, useRef, useState } from 'react';
import { api, getSession, saveSession } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { employerWorkspaceHref } from '@/lib/accountNavigation';
import { LocationFields } from '@/components/ui/LocationFields';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { HrCreationFlow, HrFlowHeader } from '@/components/recruiter/HrCreationFlow';
import { RecruiterJobEditorV2 } from '@/components/recruiter/RecruiterJobEditorV2';
import s from '@/components/recruiter/HrFlow.module.css';
import { useEmployerUnsaved } from '@/components/recruiter/useEmployerUnsaved';
import { HrIcon, HrIntroIllustration, useHrFlowSurface } from '@/components/recruiter/HrFlowPresentation';

type Group={code:string;name:string;nameId?:string};
const companyDraft=(company?:any)=>({name:company?.name??'',description:company?.description??'',website:company?.website??'',countryId:company?.city?.province?.country?.id??'',citySlug:company?.city?.slug??'',size:company?.size??'',industryGroupCodes:company?.industryGroups?.length?company.industryGroups.map((g:any)=>g.code):company?.industryGroup?[company.industryGroup.code]:[],profileSource:company?.profileSource??'DOCUMENT',profileDocumentId:company?.profileDocumentId??null,industrySlug:company?.industry?.slug??undefined});
export function RecruiterOnboardingV2(){
  const c=useHrCopy();
  const router=useRouter();
  const [progress,setProgress]=useState<any>(null),[companyId,setCompanyId]=useState(''),[values,setValues]=useState<Record<string,any>>(companyDraft()),[phase,setPhase]=useState('COMPANY'),[groups,setGroups]=useState<Group[]>([]),[file,setFile]=useState<any>(null),[logo,setLogo]=useState<any>(null),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[retry,setRetry]=useState(0),[legacyJob,setLegacyJob]=useState<any>(null);
  const progressRef=useRef<any>(null),valuesRef=useRef(values),lastSaved=useRef(''),queue=useRef<Promise<any>>(Promise.resolve()),alive=useRef(false),menu=useRef<HTMLDivElement>(null);
  valuesRef.current=values;
  const company=progress?.memberships?.find((row:any)=>row.companyId===companyId)?.company;
  useHrFlowSurface(values.name || company?.name || '');
  const logoInput=useRef<HTMLInputElement>(null),documentInput=useRef<HTMLInputElement>(null);
  const uploadLock=useRef(false);
  const [dragging,setDragging]=useState(false),[logoPreview,setLogoPreview]=useState('');
  useEffect(()=>()=>{if(logoPreview.startsWith('blob:'))URL.revokeObjectURL(logoPreview);},[logoPreview]);
  useEffect(()=>{setLogoPreview('');},[companyId]);
  useEffect(()=>{if(!values.logoAssetId||logoPreview)return;const abort=new AbortController();api<any>('/hr-flow/documents/'+values.logoAssetId+'/download',{signal:abort.signal}).then(result=>{if(!abort.signal.aborted)setLogoPreview(result.downloadUrl);}).catch(()=>undefined);return()=>abort.abort();},[values.logoAssetId,logoPreview]);
  const membership=progress?.memberships?.find((row:any)=>row.companyId===companyId),canManage=!companyId||['OWNER','ADMIN'].includes(membership?.role);
  useEffect(()=>{
    alive.current=true;const abort=new AbortController();
    Promise.all([api<any>('/recruiter-onboarding',{signal:abort.signal,cache:'no-store'}),api<{groups:Group[]}>('/meta/industry-groups',{auth:false,signal:abort.signal})]).then(async([state,catalog])=>{
      if(abort.signal.aborted)return;
      if(state.status!=='IN_PROGRESS'){router.replace(employerWorkspaceHref('jobs',state.companyId));return;}
      const chosen=state.memberships.find((row:any)=>row.companyId===state.companyId)??state.memberships[0];
      const initial=state.companyDraft&&(state.companyId??'')===(chosen?.companyId??'')?{...companyDraft(chosen?.company),...state.companyDraft}:companyDraft(chosen?.company);
      setGroups(catalog.groups);setCompanyId(chosen?.companyId??'');setValues(initial);valuesRef.current=initial;lastSaved.current=JSON.stringify(initial);progressRef.current=state;setProgress(state);
      setPhase(state.creationSessionId?'JOB':state.flowVersion===2?state.phase??'COMPANY':'COMPANY');
      if(initial.profileDocumentId)api<any>('/hr-flow/documents/'+initial.profileDocumentId,{signal:abort.signal}).then(setFile).catch(()=>undefined);
      if(state.jobId&&!state.creationSessionId){const old=await api<any>('/jobs/'+state.jobId,{signal:abort.signal});if(!abort.signal.aborted){setLegacyJob(old);setPhase('LEGACY');}}
    }).catch(reason=>{if(!abort.signal.aborted)setError(reason.message);});
    return()=>{alive.current=false;abort.abort();};
  },[retry]);
  useEffect(()=>{const close=(event:MouseEvent)=>{if(menu.current&&!menu.current.contains(event.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[]);
  function persistDraft(){
    const task=queue.current.catch(()=>undefined).then(async()=>{
      if(!alive.current||!progressRef.current)return;
      const draft=valuesRef.current,serialized=JSON.stringify(draft);
      if(serialized===lastSaved.current)return;
      setStatus(c("Menyimpan..."));
      const result=await api<any>('/recruiter-onboarding',{method:'PATCH',body:JSON.stringify({step:1,companyId:companyId||null,flowVersion:2,phase:'COMPANY',companyDraft:draft,expectedRevision:progressRef.current.revision})});
      if(alive.current){progressRef.current={...progressRef.current,...result};lastSaved.current=serialized;setStatus(serialized===JSON.stringify(valuesRef.current)?c("Tersimpan"):c("Perubahan belum tersimpan"));}
    });queue.current=task;return task;
  }
  const serialized=JSON.stringify(values);
  useEmployerUnsaved(phase==='COMPANY'&&serialized!==lastSaved.current,busy||uploading);
  useEffect(()=>{if(!progress||phase!=='COMPANY'||serialized===lastSaved.current)return;setStatus(c("Perubahan belum tersimpan"));const timer=setTimeout(()=>void persistDraft().catch(reason=>{if(alive.current){setStatus(c("Belum tersimpan"));setError(reason.message);}}),700);return()=>clearTimeout(timer);},[serialized,phase,companyId,progress?.userId]);
  async function upload(file:File,kind:'DOCUMENT'|'LOGO'){
    if(uploadLock.current||busy||!canManage)return;
    if(file.size>5*1024*1024){setError(c("Ukuran file maksimal 5 MB."));return;}
    uploadLock.current=true;setUploading(true);setError('');
    try{const body=new FormData();body.set('file',file);const result=await api<any>('/hr-flow/'+(kind==='LOGO'?'logos':'documents'),{method:'POST',body});if(!alive.current)return;if(kind==='LOGO'){setLogo(result);setLogoPreview(URL.createObjectURL(file));setValues(previous=>({...previous,logoAssetId:result.id}));}else{setFile(result);setValues(previous=>({...previous,profileDocumentId:result.id}));}}
    catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:String(reason));}finally{uploadLock.current=false;if(alive.current)setUploading(false);}
  }
  async function next(){
    if(busy||uploading)return;setBusy(true);setError('');
    try{
      await persistDraft();
      const input=valuesRef.current;
      if(!input.industryGroupCodes?.length)throw Error(c("Pilih setidaknya satu grup industri."));
      if(input.profileSource==='DOCUMENT'&&!input.profileDocumentId)throw Error(c("Unggah company profile atau pilih deskripsi manual."));
      if(input.profileSource==='MANUAL'&&input.description.trim().length<20)throw Error(c("Deskripsi perusahaan minimal 20 karakter."));
      if(companyId&&canManage)await api('/companies/'+companyId,{method:'PATCH',body:JSON.stringify(input)});
      const result=await api<any>('/recruiter-onboarding',{method:'PATCH',body:JSON.stringify({step:2,companyId:companyId||null,flowVersion:2,phase:'INTRO',companyDraft:input,expectedRevision:progressRef.current.revision})});
      const fresh=await api<any>('/recruiter-onboarding',{cache:'no-store'});progressRef.current=fresh;setProgress(fresh);setCompanyId(result.companyId);
      if(fresh.jobId&&!fresh.creationSessionId){setLegacyJob(await api('/jobs/'+fresh.jobId,{cache:'no-store'}));setPhase('LEGACY');}else setPhase('INTRO');
      window.scrollTo({top:0});
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function published(jobId:string){
    await api('/recruiter-onboarding/complete',{method:'POST',body:JSON.stringify({skipJob:false})});
    const auth=getSession();if(auth)saveSession({...auth,user:{...auth.user,recruiterOnboarding:{status:'COMPLETE',step:3}}});
    router.replace(employerWorkspaceHref('jobs',companyId));
  }
  async function returnToCompany(){
    if(busy)return;setBusy(true);setError('');
    try{await queue.current;const fresh=await api<any>('/recruiter-onboarding',{cache:'no-store'});progressRef.current=fresh;setProgress(fresh);setPhase('COMPANY');}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  async function switchCompany(id:string){
    if(busy||uploading)return;setBusy(true);setError('');
    try{
      await persistDraft();
      const row=progress.memberships.find((m:any)=>m.companyId===id),draft=companyDraft(row.company);
      const result=await api<any>('/recruiter-onboarding',{method:'PATCH',body:JSON.stringify({step:1,companyId:id,flowVersion:2,phase:'COMPANY',companyDraft:draft,expectedRevision:progressRef.current.revision})});
      progressRef.current={...progressRef.current,...result};setProgress(progressRef.current);valuesRef.current=draft;lastSaved.current=JSON.stringify(draft);setValues(draft);setCompanyId(id);setFile(null);setLogo(null);
      const url=new URL(window.location.href);url.searchParams.delete('creationSession');window.history.replaceState(null,'',url);
      if(draft.profileDocumentId)setFile(await api('/hr-flow/documents/'+draft.profileDocumentId));
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}
  }
  if(!progress)return <div className={s.page} data-hr-surface>{error?<div className={s.error} role="alert">{error}<button className={s.link} onClick={()=>setRetry(v=>v+1)}>{c("Coba lagi")}</button></div>:<WorkspaceLoading/>}</div>;
  if(phase==='LEGACY'&&legacyJob)return <RecruiterJobEditorV2 companyId={companyId} company={company} job={legacyJob} onClose={()=>setPhase('COMPANY')} onPublished={published} onSaved={async()=>{}}/>;
  if(['PACKAGE','CHECKOUT','JOB'].includes(phase))return <HrCreationFlow key={companyId} companyId={companyId} company={company} sessionId={progress.creationSessionId??undefined} onboarding onClose={()=>setPhase('INTRO')} onSession={id=>{progressRef.current.creationSessionId=id;setProgress((previous:any)=>({...previous,creationSessionId:id}));}} onPublished={published}/>;
  const selected:string[]=values.industryGroupCodes??[];
  return <div className={s.page} data-hr-surface><HrFlowHeader companyName={company?.name} onboarding stage={phase==='COMPANY'?0:1}/>
    {phase==='INTRO'?<><section className={s.intro}><div><span className={s.introBadge}>{c("PROFIL PERUSAHAAN SIAP")}</span><h1>{c("Buat lowongan pertamamu!")}</h1><p className={s.subtitle}>{c("Pilih paket, konfirmasi checkout, lalu susun lowongan sesuai kebutuhan tim Anda.")}</p><span className={s.companyBadge}><HrIcon kind="building"/>{company?.name}</span><ol className={s.introSteps}>{[
        [c("Pilih paket lowongan"),c("Tentukan paket yang sesuai dengan kebutuhan rekrutmen Anda.")],
        [c("Konfirmasi paket atau selesaikan pembayaran"),c("Paket Free cukup dikonfirmasi. Paket berbayar dilanjutkan ke pembayaran.")],
        [c("Tulis dan publikasikan lowongan"),c("Susun detail lowongan agar kandidat memahami kebutuhan tim Anda.")],
      ].map(([title,description],i)=><li key={title}><span>{i+1}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol></div><div className={s.introArt}><HrIntroIllustration/></div></section><footer className={s.footer}><div className={s.footerInner}><button className={s.secondary} disabled={busy} onClick={()=>void returnToCompany()}><HrIcon kind="back"/>{c("Kembali")}</button><span className={s.saved} data-saved="true"><HrIcon kind="check"/>{c("Informasi perusahaan sudah tersimpan")}</span><button className={s.primary} onClick={()=>setPhase('PACKAGE')}>{c("Lanjut ke pilihan paket")}<HrIcon kind="arrow"/></button></div></footer></>:<>
      <h1 className={s.title}>{c("Ceritakan perusahaan Anda")}</h1><p className={s.subtitle}>{c("Lengkapi profil perusahaan sebelum membuat lowongan pertama.")}</p>{error&&<div className={s.error} role="alert">{error}</div>}
      {progress.memberships.length>1&&<label className={s.field}><span>{c("Perusahaan")}</span><select value={companyId} disabled={busy||uploading} onChange={event=>void switchCompany(event.target.value)}>{progress.memberships.map((row:any)=><option key={row.companyId} value={row.companyId}>{row.company.name}</option>)}</select></label>}
      <form id="hr-company-form" onSubmit={e=>{e.preventDefault();void next();}}><fieldset disabled={busy||!canManage} style={{border:0,padding:0,margin:0,minWidth:0}}><section className={s.section}>
        <div className={s.logoUpload}><span className={s.label}>{c("Logo perusahaan (opsional)")}</span><div className={s.logoRow}><div className={s.logoTile}>{logoPreview||company?.logoUrl?<img src={logoPreview||company.logoUrl} alt={c("Logo perusahaan")}/>:<HrIcon kind="image" size={28}/>}</div><button type="button" className={s.secondary} disabled={uploading} onClick={()=>logoInput.current?.click()}><HrIcon kind="upload"/>{logo||logoPreview||company?.logoUrl?c("Ganti logo"):c("Unggah logo")}</button><span className={s.hint}>{c("Format JPG, PNG, atau WEBP. Maks. 5 MB.")}<br/>{c("Rekomendasi 400 × 400 px.")}</span><input ref={logoInput} className={s.srOnly} type="file" aria-label={c("Unggah logo perusahaan")} accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e=>{const chosen=e.target.files?.[0];e.target.value='';if(chosen)void upload(chosen,'LOGO');}}/></div></div>
        <label className={s.field}><span>{c("Nama perusahaan *")}</span><input required minLength={2} maxLength={160} value={values.name} onChange={e=>setValues(previous=>({...previous,name:e.target.value}))}/></label>
        <label className={s.field}><span>{c("Website (opsional)")}</span><input type="url" maxLength={500} placeholder="https://www.perusahaan.co.id" value={values.website} onChange={e=>setValues(previous=>({...previous,website:e.target.value}))}/></label>
        <div className={s.location}><LocationFields countryId={values.countryId} citySlug={values.citySlug} initialCity={company?.city} required cityRequired onChange={location=>setValues(previous=>({...previous,countryId:location.countryId,citySlug:location.citySlug}))}/></div>
        <label className={s.field} style={{marginTop:22}}><span>{c("Ukuran perusahaan *")}</span><select required value={values.size} onChange={e=>setValues(previous=>({...previous,size:e.target.value}))}><option value="">{c("Pilih ukuran perusahaan")}</option>{[['SIZE_1_10','1-10 karyawan'],['SIZE_11_50','11-50 karyawan'],['SIZE_51_200','51-200 karyawan'],['SIZE_201_1000','201-1.000 karyawan'],['SIZE_1000_PLUS',c("Lebih dari 1.000 karyawan")]].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
        <div className={s.label} id="industry-label">{c("Industri *")}</div><div className={s.industries} ref={menu} style={{marginTop:10}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}><div className={s.chips}>{selected.map(code=><span className={s.chip} key={code}>{groups.find(g=>g.code===code)?.name??code}<button type="button" aria-label={`Hapus industri ${code}`} onClick={()=>setValues(previous=>({...previous,industryGroupCodes:selected.filter(v=>v!==code)}))}>×</button></span>)}<input aria-labelledby="industry-label" aria-expanded={open} aria-controls="hr-industry-options" placeholder={c("Cari dari 29 grup industri")} value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}}/><button type="button" className={s.icon} aria-label={c("Buka pilihan industri")} onClick={()=>setOpen(v=>!v)}>⌄</button></div>{open&&<div className={s.menu} id="hr-industry-options"><span className={s.hint}>{groups.length} {c("grup industri |")+" "}{selected.length} {c("dipilih")}</span><div className={s.menuList} role="group" aria-labelledby="industry-label">{groups.filter(g=>(g.name+' '+g.nameId).toLowerCase().includes(query.toLowerCase())).map(group=><label key={group.code}><input type="checkbox" checked={selected.includes(group.code)} onChange={e=>setValues(previous=>({...previous,industryGroupCodes:e.target.checked?[...selected,group.code]:selected.filter(v=>v!==group.code)}))}/>{group.nameId??group.name}</label>)}</div><button className={s.link} type="button" onClick={()=>{setOpen(false);setQuery('');}}>{c("Selesai")}</button></div>}</div><p className={s.hint}>{c("Pilih satu atau beberapa grup sesuai aktivitas bisnis perusahaan.")}</p>
        {values.industrySlug&&<div className={s.check}><label><input type="checkbox" checked={!values.industrySlug} onChange={()=>setValues(previous=>({...previous,industrySlug:''}))}/> {c("Hapus pilihan industri detail sebelumnya jika sudah tidak sesuai dengan industri perusahaan.")}</label></div>}
        <h3>{c("Tentang perusahaan *")}</h3><div className={s.choices}><label className={s.choice}><input type="radio" name="profile-source" checked={values.profileSource==='DOCUMENT'} onChange={()=>setValues(previous=>({...previous,profileSource:'DOCUMENT'}))}/><strong>{c("Unggah company profile")}</strong><span className={s.recommend}>{c("Direkomendasikan")}</span></label><label className={s.choice}><input type="radio" name="profile-source" checked={values.profileSource==='MANUAL'} onChange={()=>setValues(previous=>({...previous,profileSource:'MANUAL'}))}/><strong>{c("Tulis deskripsi manual")}</strong></label></div>
        {values.profileSource==='DOCUMENT'?<><div className={s.drop} data-dragging={dragging} aria-busy={uploading} onDragOver={e=>{e.preventDefault();if(!uploading&&canManage)setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);const chosen=e.dataTransfer.files[0];if(chosen)void upload(chosen,'DOCUMENT');}}><HrIcon kind="upload" size={30}/><div><strong>{uploading?c("Mengunggah..."):<>{c("Seret dokumen atau")} <button type="button" className={s.link} disabled={uploading} onClick={()=>documentInput.current?.click()}>{c("pilih file")}</button></>}</strong><span className={s.hint}>{c("PDF atau DOCX | Maks. 5 MB")}</span></div></div><input ref={documentInput} className={s.srOnly} type="file" accept=".pdf,.docx" aria-label={c("Unggah company profile")} disabled={uploading} onChange={e=>{const chosen=e.target.files?.[0];e.target.value='';if(chosen)void upload(chosen,'DOCUMENT');}}/>{file&&<div className={s.file}><HrIcon kind="file"/><strong className={s.filename}>{file.filename}</strong><span className={s.badge}><HrIcon kind="check" size={16}/>{c("Terunggah")}</span><button type="button" className={s.link} disabled={uploading} onClick={()=>documentInput.current?.click()}>{c("Ganti file")}</button></div>}<span className={s.hint}><HrIcon kind="shield" size={14} style={{verticalAlign:'middle',marginRight:5}}/>{c("Dokumen tersimpan privat dan tidak ditampilkan pada profil publik.")}</span></>:<label className={s.field}><span>{c("Deskripsi perusahaan *")}</span><textarea required minLength={20} maxLength={5000} rows={6} value={values.description} onChange={e=>setValues(previous=>({...previous,description:e.target.value}))}/><small className={s.hint}>{values.description.length}/5000</small></label>}
      </section></fieldset></form>{!canManage&&<div className={s.notice}>{c("Perubahan profil perusahaan memerlukan akses owner atau admin. Profil yang sudah lengkap tetap dapat digunakan.")}</div>}
      <footer className={s.footer}><div className={s.footerInner}><button type="button" className={s.secondary} disabled={busy||uploading} onClick={()=>{setBusy(true);void persistDraft().then(()=>router.push('/employers')).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}><HrIcon kind="back"/>{c("Kembali")}</button><span className={s.saved} data-saved={status===c("Tersimpan")} role="status">{status===c("Tersimpan")&&<HrIcon kind="check"/>}{uploading?c("Mengunggah..."):status||c("Lengkapi informasi perusahaan")}</span><button className={s.primary} type="submit" form="hr-company-form" disabled={busy||uploading}>{busy?c("Menyimpan..."):c("Lanjutkan")}<HrIcon kind="arrow"/></button></div></footer>
    </>}
  </div>;
}
