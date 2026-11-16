'use client';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { useHrCopy } from '@/lib/i18n/hr-flow';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/lib/navigation';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { ResourceError, WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { CandidateImportDialog } from './CandidateImportDialog';
import { CandidateMessageDialog } from './CandidateMessageDialog';
import { candidateReviewHref, candidateStages, readCandidateListFilters } from './candidate-review-route';
import { candidateScore, cvPending, useCvStatus, type CvStatus } from './cv-status';
export { candidateScore } from './cv-status';
import s from './CandidateWorkspace.module.css';
export type CandidateRow=CvStatus&{companyId:string;jobId:string|null;applicationId:string|null;fullName:string;email:string|null;headline:string;filename:string;contentType:string;stage:string;createdAt:string;assignedTo:{id:string;fullName:string}|null;interviews?:Array<{id:string;scheduledAt:string;meetingUrl:string|null}>;application?:{interviews:Array<{id:string;scheduledAt:string;meetingUrl:string|null}>}|null};
const candidatePhases = [['all', 'Semua kandidat'], ['review', 'Perlu ditinjau'], ['progress', 'Dalam proses'], ['finished', 'Selesai']] as const;
type Result={items:CandidateRow[];overallTotal?:number;total:number;page:number;limit:number;counts:Record<string,number>;hasMoreToImport:boolean};
const empty:Result={items:[],total:0,page:1,limit:10,counts:{all:0,review:0,progress:0,finished:0},hasMoreToImport:false};
export function CandidateWorkspace({jobId,jobTitle,companyId,applicationId,onChanged,onCount}:{jobId?:string;jobTitle?:string;companyId:string;applicationId?:string;onChanged:()=>void;onCount?:(count:number)=>void}){
 const uiCopy=useHrCopy();
  const router = useRouter();
  const initialFilters = readCandidateListFilters(useSearchParams());
  const [phase,setPhase]=useState(initialFilters.phase),[q,setQ]=useState(initialFilters.q),[stage,setStage]=useState(initialFilters.stage),[sort,setSort]=useState(initialFilters.sort),[limit,setLimit]=useState(initialFilters.limit),[page,setPage]=useState(initialFilters.page);
  const [data,setData]=useState<Result>(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
  const [filters,setFilters]=useState(Boolean(initialFilters.stage)),[upload,setUpload]=useState(false),[hasUpdates,setHasUpdates]=useState(false);
  const [message,setMessage]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[all,setAll]=useState(false),[excluded,setExcluded]=useState<Set<string>>(new Set());
  const [action,setAction]=useState<'move'|'assign'|'job'|'rescore'|null>(null),[targetStage,setTargetStage]=useState('IN_REVIEW'),[assignee,setAssignee]=useState(''),[members,setMembers]=useState<Array<{user:{id:string;fullName:string}}>>([]),[busy,setBusy]=useState(false);
  const [jobs,setJobs]=useState<Array<{id:string;title:string}>>([]),[targetJob,setTargetJob]=useState('');
  useEffect(()=>{onCount?.(data.overallTotal??data.counts.all);},[data.overallTotal,data.counts.all,onCount]);
  useEffect(()=>{if(action==='job')void api<Array<{id:string;title:string}>>('/recruitment/companies/'+companyId+'/jobs').then(setJobs).catch(e=>setError(e.message));},[action,companyId]);
  const modal=useRef<HTMLDialogElement>(null),headerCheck=useRef<HTMLInputElement>(null),read=useRef(0),openedApplication=useRef('');
  const query={companyId,...(jobId?{jobId}:{}),q,phase,...(stage?{stage}:{}),sort,page,limit};
  const queryKey=JSON.stringify(query);
  const load=useCallback(async(signal?:AbortSignal)=>api<Result>('/recruitment/candidates?'+new URLSearchParams(Object.entries(JSON.parse(queryKey)).map(([key,value])=>[key,String(value)])),{signal,cacheMode:'no-store'}),[queryKey]);
  useEffect(()=>{const sequence=++read.current,controller=new AbortController();setLoading(true);setError('');const timer=setTimeout(()=>{void load(controller.signal).then(result=>{if(sequence===read.current){setData(result);setHasUpdates(false);if(result.page!==page)setPage(result.page);}}).catch(e=>{if(!controller.signal.aborted&&sequence===read.current)setError(e.message);}).finally(()=>{if(sequence===read.current)setLoading(false);});},180);return()=>{clearTimeout(timer);controller.abort();};},[load,revision,page]);
  useEffect(()=>{setSelected(new Set());setExcluded(new Set());setAll(false);},[queryKey]);
  useEffect(()=>{const update=()=>setHasUpdates(true);window.addEventListener('candidate-import-updated',update);return()=>window.removeEventListener('candidate-import-updated',update);},[]);
  const pendingIds = loading ? '' : data.items.filter(cvPending).map(row => row.id).join(',');
  useCvStatus(companyId, pendingIds, rows => {
    const byId = new Map(rows.map(row => [row.id, row]));
    if (rows.some(row => row.scoreStatus === 'READY')) {
      const sequence = read.current;
      void load().then(result => { if (sequence === read.current) setData(result); }).catch(() => setHasUpdates(true));
    }
    setData(current => ({ ...current, items: current.items.map(row => {
      const next = byId.get(row.id);
      return next && (next.revision ?? 0) >= (row.revision ?? 0) ? { ...row, ...next } : row;
    }) }));
  });
  useEffect(()=>{if(!data.hasMoreToImport)return;const timer=setTimeout(()=>{if(!document.hidden)void load().then(()=>setHasUpdates(true)).catch(()=>{});},5000);return()=>clearTimeout(timer);},[data.hasMoreToImport,load,revision]);
  useEffect(()=>{
    if(!applicationId||!jobId||openedApplication.current===applicationId)return;
    let live=true;
    void api<CandidateRow>('/recruitment/jobs/'+encodeURIComponent(jobId)+'/applications/'+encodeURIComponent(applicationId)+'/candidate').then(row=>{if(live){openedApplication.current=applicationId;router.replace(candidateReviewHref(row.id, initialFilters));}}).catch(e=>{if(live){openedApplication.current='';setError(e.message);}});
    return()=>{live=false;};
  },[applicationId,jobId,router]);
  useEffect(()=>{if(action)modal.current?.showModal();},[action]);
  useEffect(()=>{if(action!=='assign')return;void api<Array<{user:{id:string;fullName:string}}>>('/recruitment/companies/'+companyId+'/members').then(setMembers).catch(e=>setError(e.message));},[action,companyId]);
  const isSelected=(id:string)=>all?!excluded.has(id):selected.has(id),count=all?data.total-excluded.size:selected.size;
  const pageSelected=data.items.length>0&&data.items.every(row=>isSelected(row.id));
  useEffect(()=>{if(headerCheck.current)headerCheck.current.indeterminate=!pageSelected&&data.items.some(row=>isSelected(row.id));});
  function toggle(id:string){if(all)setExcluded(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});else setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});}
  function togglePage(){for(const row of data.items){if(pageSelected&&isSelected(row.id)||!pageSelected&&!isSelected(row.id))toggle(row.id);}}
  function changePhase(value: string) {
    setPhase(value);
    setStage('');
    setPage(1);
  }

  function clear(){setSelected(new Set());setAll(false);setExcluded(new Set());}
  function refresh(){setRevision(n=>n+1);onChanged();}
  async function submit(){setBusy(true);setError('');try{const selection=all?{filter:query,expectedCount:count,excludedIds:[...excluded]}:{ids:[...selected]};const result=await api<{count:number}>('/recruitment/candidates/bulk',{method:'POST',body:JSON.stringify({companyId,selection,action:action==='rescore'?{kind:'rescore'}:action==='job'?{kind:'job',jobId:targetJob}:action==='assign'?{kind:'assign',userId:assignee||null}:{kind:'move',stage:targetStage}})});setNotice(`${result.count} kandidat ${action==='rescore'?'masuk antrean penilaian ulang':action==='job'?'ditambahkan ke lowongan untuk dinilai':action==='assign'?'berhasil ditugaskan':'berhasil diperbarui'}.`);setAction(null);clear();refresh();}catch(e){setError(e instanceof Error?e.message:'Perubahan belum berhasil.');}finally{setBusy(false);}}
  const pages=Math.max(1,Math.ceil(data.total/limit)),first=Math.max(1,Math.min(page-2,pages-4)),numbers=Array.from({length:Math.min(5,pages)},(_,i)=>first+i);
  const sortOptions = <>
    <option value="score">Urutkan: Kecocokan CV</option>
    <option value="newest">Urutkan: Terbaru</option>
    {jobId && <option value="schedule">Urutkan: Jadwal terdekat</option>}
  </>;
  const changeSort = (value: string) => { setSort(value); setPage(1); };

  return <section className={s.workspace} aria-label="Kandidat">
    <nav className={s.phases} aria-label={uiCopy("Kelompok kandidat")}>
      {candidatePhases.map(([value, label]) => <button type="button" key={value} aria-current={phase === value ? 'page' : undefined} onClick={() => changePhase(value)}>{label}<span>{data.counts[value] ?? 0}</span></button>)}
    </nav>
    <div className={s.toolbar}>
      <label className={s.search}><WorkspaceIcon kind="search"/><input type="search" value={q} aria-label={uiCopy("Cari kandidat")} placeholder="Cari kandidat&#x2026;" onChange={e => { setQ(e.target.value); setPage(1); }} /></label>
      {phase === 'progress' && <select className={s.processStage} aria-label={uiCopy("Tahap proses")} value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}>
        <option value="">{uiCopy("Semua tahap")}</option>
        {['IN_REVIEW', 'INTERVIEW', 'OFFER'].map(value => <option value={value} key={value}>{candidateStages[value]}</option>)}
      </select>}
      <select className={s.mobilePhase} aria-label={uiCopy("Kelompok kandidat")} value={phase} onChange={event => changePhase(event.target.value)}>
        {candidatePhases.map(([value, label]) => <option key={value} value={value}>{value === 'all' ? uiCopy('Semua') : label} ({data.counts[value] ?? 0})</option>)}
      </select>
      <button type="button" className={s.secondary} aria-expanded={filters} aria-controls={filters ? 'candidate-filters' : undefined} onClick={() => setFilters(value => !value)}>
        <WorkspaceIcon kind="filter"/>Filter{stage && <span className={s.filterCount}>1</span>}
      </button>
      <div className={s.spacer}/>
      <button type="button" className={s.secondary} onClick={() => setUpload(true)}><WorkspaceIcon kind="upload"/>{uiCopy("Upload CV")}</button>
      <select className={s.desktopSort} aria-label={uiCopy("Urutan kandidat")} value={sort} onChange={event => changeSort(event.target.value)}>{sortOptions}</select>
    </div>
    {filters && <div className={s.filters} id="candidate-filters">
      <label>Tahap<select aria-label={uiCopy("Filter tahap")} value={stage} onChange={event => { setStage(event.target.value); setPage(1); }}>
        <option value="">{uiCopy("Semua tahap")}</option>
        {Object.entries(candidateStages).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label className={s.mobileSort}>{uiCopy("Urutan kandidat")}<select value={sort} onChange={event => changeSort(event.target.value)}>{sortOptions}</select></label>
      <button type="button" className={s.textButton} onClick={() => { setStage(''); setQ(''); setPage(1); }}>{uiCopy("Reset filter")}</button>
    </div>}
    {notice&&<p role="status" className={s.notice}>{notice}</p>}
    {hasUpdates&&<button type="button" className={s.updates} onClick={refresh}>Hasil kandidat diperbarui &#xb7; Tampilkan pembaruan</button>}
    {count>0&&<><div className={s.bulk}><strong>{count} kandidat dipilih</strong><button className={s.textButton} onClick={clear}>{uiCopy("Hapus pilihan")}</button><div className={s.spacer}/>{jobId&&<button className={s.secondary} onClick={()=>setMessage(true)}>{uiCopy("Kirim pesan")}</button>}{jobId&&<button className={s.secondary} onClick={()=>setAction('rescore')}>{uiCopy("Nilai ulang CV")}</button>}<button className={s.secondary} onClick={()=>setAction('assign')}>{uiCopy("Tugaskan HR")}</button>{jobId?<button className={s.primary} onClick={()=>{setTargetStage('IN_REVIEW');setAction('move');}}>{uiCopy("Masukkan ke proses")}</button>:<button className={s.primary} onClick={()=>setAction('job')}>{uiCopy("Tambahkan ke lowongan")}</button>}</div>{!all&&pageSelected&&data.total>selected.size&&<div className={s.selectAll}>{selected.size} kandidat dipilih. <button className={s.textButton} onClick={()=>{setAll(true);setExcluded(new Set());}}>Pilih seluruh {data.total} hasil</button></div>}</>}
    {error && !action ? <ResourceError message={error} onRetry={refresh} /> : loading ? <WorkspaceLoading /> : <div className={s.scroll}>
      {data.items.length > 0 ? <table className={s.table} data-phase={phase} role="table">
        <thead role="rowgroup"><tr role="row">
          <th className={s.checkbox} scope="col" role="columnheader">
            <label className={s.selectPage}>
              <input ref={headerCheck} type="checkbox" aria-label={uiCopy("Pilih kandidat di halaman ini")} checked={pageSelected} onChange={togglePage} />
              <span>{uiCopy("Pilih kandidat di halaman ini")}</span>
            </label>
          </th>
          <th scope="col" role="columnheader">Kandidat</th>
          <th scope="col" role="columnheader">{uiCopy("Kecocokan CV")}</th>
          {phase === 'progress' ? <>
            <th scope="col" role="columnheader">{uiCopy("Jadwal berikutnya")}</th>
            <th scope="col" role="columnheader">{uiCopy("Penanggung jawab")}</th>
            <th scope="col" role="columnheader">{uiCopy("Tindak lanjut")}</th>
          </> : <>
            <th scope="col" role="columnheader">Tahap</th><th scope="col" role="columnheader">Masuk</th>
          </>}
          <th scope="col" role="columnheader"><span className="sr-only">Tindakan</span></th>
        </tr></thead>
        <tbody role="rowgroup">{data.items.map(row => {
          const interview = row.application?.interviews?.[0] ?? row.interviews?.[0];
          return <tr key={row.id} role="row" data-selected={isSelected(row.id)}>
            <td className={s.checkbox} role="cell">
              <label className={s.selectCandidate}><input type="checkbox" aria-label={'Pilih ' + row.fullName} checked={isSelected(row.id)} onChange={() => toggle(row.id)} /></label>
            </td>
            <td className={s.candidateCell} role="cell">
              <div className={s.identity}>
                <span className={s.avatar}>{row.fullName.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join('').toUpperCase()}</span>
                <span><Link className={s.name} href={candidateReviewHref(row.id, { q, phase, stage, sort, page, limit })} prefetch={false}>{row.fullName}</Link><small>{row.headline || row.filename}</small></span>
              </div>
            </td>
            <td className={s.scoreCell} role="cell">
              <span className={s.cellLabel} aria-hidden="true">{uiCopy("Kecocokan CV")}</span>
              <span className={row.cvScore === null ? s.scorePending : s.score}>{candidateScore(row)}</span>
            </td>
            {phase === 'progress' ? <>
              <td className={s.stageCell} role="cell">
                <span className={s.cellLabel} aria-hidden="true">{uiCopy("Jadwal berikutnya")}</span>
                {interview ? new Date(interview.scheduledAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : <span className={s.muted}>{uiCopy("Belum dijadwalkan")}</span>}
              </td>
              <td className={s.dateCell} role="cell">
                <span className={s.cellLabel} aria-hidden="true">{uiCopy("Penanggung jawab")}</span>
                {row.assignedTo?.fullName ?? 'Belum ditugaskan'}
              </td>
              <td className={s.scheduleCell} role="cell"><Link className={s.textButton} href={candidateReviewHref(row.id, { q, phase, stage, sort, page, limit }, 'schedule')} prefetch={false}>{interview ? 'Lihat jadwal' : 'Jadwalkan'}</Link></td>
            </> : <>
              <td className={s.stageCell} role="cell"><span className={s.stage}><i />{candidateStages[row.stage] ?? row.stage}</span></td>
              <td className={s.dateCell} role="cell">{new Date(row.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
            </>}
            <td className={s.detailCell} role="cell"><Link className={s.more} aria-label={'Buka detail ' + row.fullName} href={candidateReviewHref(row.id, { q, phase, stage, sort, page, limit })} prefetch={false}>&#x2022;&#x2022;&#x2022;</Link></td>
          </tr>;
        })}</tbody>
      </table> : <div className={s.empty}>
        <h3>{q || stage ? 'Tidak ada kandidat yang sesuai' : 'Belum ada kandidat'}</h3>
        <p>{q || stage ? 'Coba ubah pencarian atau filter.' : 'Upload CV atau bagikan lowongan untuk mulai mengumpulkan kandidat.'}</p>
      </div>}
    </div>}
    <footer className={s.pagination}><span>Menampilkan {data.total?(page-1)*limit+1:0}&#x2013;{Math.min(page*limit,data.total)} dari {data.total} kandidat</span><div className={s.spacer}/><select aria-label={uiCopy("Kandidat per halaman")} value={limit} onChange={e=>{setLimit(Number(e.target.value));setPage(1);}}>{[10,25,50,100].map(n=><option key={n} value={n}>{n} per halaman</option>)}</select><nav aria-label={uiCopy("Halaman kandidat")}><button aria-label={uiCopy("Halaman sebelumnya")} disabled={page<=1} onClick={()=>setPage(p=>p-1)}><DirectionalIcon direction="left" size={16} /></button><span className={s.mobilePageNumber} aria-current="page">{page} / {pages}</span>{numbers.map(n=><button key={n} aria-current={n===page?'page':undefined} onClick={()=>setPage(n)}>{n}</button>)}{numbers.at(-1)!<pages&&<><span>&#x2026;</span><button onClick={()=>setPage(pages)}>{pages}</button></>}<button aria-label={uiCopy("Halaman berikutnya")} disabled={page>=pages} onClick={()=>setPage(p=>p+1)}><DirectionalIcon direction="right" size={16} /></button></nav></footer>
    {message&&<CandidateMessageDialog companyId={companyId} selection={all?{filter:query,expectedCount:count,excludedIds:[...excluded]}:{ids:[...selected]}} count={count} email={count===1?data.items.find(row=>isSelected(row.id))?.email:undefined} onClose={()=>setMessage(false)} onQueued={()=>{setNotice('Pesan sedang dikirim. Status tersedia di detail kandidat.');refresh();}}/>}
    {upload&&<CandidateImportDialog companyId={companyId} jobId={jobId} onClose={()=>setUpload(false)} onStarted={refresh}/>}
    {action&&<dialog ref={modal} className={s.modal} aria-labelledby="candidate-bulk-title" onCancel={e=>{if(busy)e.preventDefault();else setAction(null);}}><header><h2 id="candidate-bulk-title">{action==='rescore'?'Nilai ulang CV kandidat?':action==='job'?'Tambahkan CV ke lowongan':action==='assign'?'Tugaskan penanggung jawab':'Masukkan kandidat ke proses?'}</h2><button disabled={busy} aria-label="Tutup" onClick={()=>setAction(null)}>×</button></header><p>{count} kandidat untuk <strong>{jobTitle??'perusahaan ini'}</strong>.</p>{action!=='rescore'&&<label className={s.field}>{action==='job'?'Lowongan tujuan':action==='assign'?'Penanggung jawab':'Tahap tujuan'}<select value={action==='job'?targetJob:action==='assign'?assignee:targetStage} onChange={e=>action==='job'?setTargetJob(e.target.value):action==='assign'?setAssignee(e.target.value):setTargetStage(e.target.value)}>{action==='job'?<><option value="">{uiCopy("Pilih lowongan")}</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</>:action==='assign'?<><option value="">{uiCopy("Belum ditugaskan")}</option>{members.map(m=><option key={m.user.id} value={m.user.id}>{m.user.fullName}</option>)}</>:['IN_REVIEW','INTERVIEW','REJECTED'].map(value=><option key={value} value={value}>{candidateStages[value]}</option>)}</select></label>}{action==='rescore'&&<p>Hanya CV yang skornya kedaluwarsa atau penilaiannya belum berhasil yang akan diproses. Penilaian menggunakan kriteria lowongan terbaru.</p>}<h3>{uiCopy("Kandidat yang dipilih")}</h3><ul className={s.chosen}>{data.items.filter(r=>isSelected(r.id)).slice(0,3).map(r=><li key={r.id}>{r.fullName}</li>)}</ul>{count>3&&<p className={s.purple}>+{count-3} kandidat lainnya</p>}{error&&<p className={s.error} role="alert">{error}</p>}<footer><button className={s.secondary} disabled={busy} onClick={()=>setAction(null)}>Batal</button><button className={s.primary} disabled={busy||action==='job'&&!targetJob} onClick={()=>void submit()}>{busy?'Menyimpan\u2026':action==='rescore'?'Mulai penilaian ulang':action==='job'?'Tambahkan & nilai CV':action==='assign'?'Tugaskan':`Masukkan ${count} kandidat`}</button></footer></dialog>}
  </section>;
}
