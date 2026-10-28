'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { postOnce } from '@/lib/hr-benefits';
import { ApplicantFilters } from './ApplicantFilters';
import { api } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { WorkspaceIcon } from '@/components/employee/WorkspaceIcon';
import { SearchField, WorkspaceEmpty, WorkspaceLoading, dateLabel } from '@/components/employee/WorkspacePrimitives';
import { ApplicationDetail } from './ApplicationDetail';
import { ApplicationCvAction } from './ApplicationActions';
import { employerJobHref } from '@/lib/accountNavigation';
import { WorkspaceSelect } from '@/components/jobs/WorkspaceSelect';
import { RecruiterAvatar, JobContextSelect } from './RecruiterPrimitives';
import s from './RecruiterWorkspace.module.css';

const STAGES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
type Props = { embedded?: boolean; meta:any; companyId: string; companyName: string; jobs: any[]; selectedJob: string; onJobChange: (id: string) => void; applicants: any[]; loading: boolean; applicationId?: string; templates: Array<{ id: string; name: string; body: string }>; onReload: () => Promise<void>; onTemplates: () => void; onFlash: (message: string, tone?: 'success' | 'error') => void };

export function RecruiterPipeline({ embedded = false, meta, companyId, companyName, jobs, selectedJob, onJobChange, applicants: initialApplicants, loading: initialLoading, applicationId, templates, onReload, onTemplates, onFlash }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const [applicants,setApplicants]=useState<any[]>([]),[loading,setLoading]=useState(false),[filters,setFilters]=useState<Record<string,string>>({});
  const [columns,setColumns]=useState<Record<string,{total:number;page:number;hasMore:boolean}>>({}),[moreBusy,setMoreBusy]=useState<Record<string,boolean>>({});
  const generation=useRef(0),pendingColumns=useRef(new Set<string>()),highlight=useRef<HTMLElement|null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState<any>(null);
  const openedLink = useRef('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bulk, setBulk] = useState(false);
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [channels, setChannels] = useState({ app: true, email: false, telegram: false });
  const [preview, setPreview] = useState(false);
  const filterKey=JSON.stringify(filters);
  useEffect(()=>{setSelected([]);setActive(null);},[selectedJob,query,status,filterKey]);
  useEffect(()=>{
    if(!selectedJob){setApplicants([]);return;}
    let alive=true;const version=++generation.current;setLoading(true);setApplicants([]);setColumns({});setMoreBusy({});pendingColumns.current.clear();
    const params=new URLSearchParams({q:query,page:'1',limit:'20',...Object.fromEntries(Object.entries(filters).filter(([,value])=>value!=='')),...(status?{status}:{})});
    const timer=setTimeout(()=>{api<any>('/applications/jobs/'+selectedJob+'/kanban?'+params).then(data=>{
      if(alive&&version===generation.current){setApplicants(data.columns.flatMap((column:any)=>column.items));setColumns(Object.fromEntries(data.columns.map((column:any)=>[column.status,{total:column.total,page:column.page,hasMore:column.hasMore}])));setError('');}
    }).catch(error=>{if(alive)setError(error.message);}).finally(()=>{if(alive)setLoading(false);});},200);
    return()=>{alive=false;++generation.current;clearTimeout(timer);};
  },[selectedJob,query,status,filterKey,initialApplicants,locale]);
  async function loadMore(stage:string) {
    if(pendingColumns.current.has(stage)||!columns[stage]?.hasMore)return;
    pendingColumns.current.add(stage);setMoreBusy(value=>({...value,[stage]:true}));const version=generation.current;
    const params=new URLSearchParams({q:query,...Object.fromEntries(Object.entries(filters).filter(([,value])=>value!=='')),status:stage,page:String(columns[stage].page+1),limit:'20'});
    try{const data=await api<any>('/applications/jobs/'+selectedJob+'/kanban?'+params);if(version!==generation.current)return;const column=data.columns[0];setApplicants(rows=>[...rows,...column.items.filter((item:any)=>!rows.some(row=>row.id===item.id))]);setColumns(value=>({...value,[stage]:{total:column.total,page:column.page,hasMore:column.hasMore}}));}
    catch(reason){if(version===generation.current)setError(reason instanceof Error?reason.message:t('ew.loadFailed'));}
    finally{if(version===generation.current){pendingColumns.current.delete(stage);setMoreBusy(value=>({...value,[stage]:false}));}}
  }
  const job = jobs.find((item) => item.id === selectedJob);
  useEffect(() => { setActive(null); setSelected([]); setBulk(false); setStatus(''); setError(''); }, [selectedJob]);
  useEffect(() => { setSelected((ids) => ids.filter((id) => applicants.some((item) => item.id === id))); }, [applicants]);
  const visible = useMemo(() => {
    const rows=focused?.kanbanEnteredAt&&!query&&!Object.values(filters).some(Boolean)&&!applicants.some(row=>row.id===focused.id)?[focused,...applicants]:applicants;
    return rows.filter(item=>!status||item.status===status);
  },[applicants,focused,status,query,filterKey]);
  useEffect(()=>{if(!loading&&applicationId)highlight.current?.scrollIntoView({block:'nearest',inline:'center'});},[loading,applicationId,focused]);
  useEffect(() => {
    if (!applicationId || !selectedJob) { setFocused(null); openedLink.current = ''; return; }
    const identity = selectedJob + ':' + applicationId;
    if (openedLink.current === identity) return;
    let alive = true;
    api('/applications/jobs/' + selectedJob + '/applicants/' + applicationId)
      .then(value => { if (alive) { setFocused(value); openedLink.current = identity; } })
      .catch(reason => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [applicationId, selectedJob, locale]);

  async function reload() {
    await onReload();
    if (focused && selectedJob) {
      const value = await api('/applications/jobs/' + selectedJob + '/applicants/' + focused.id);
      setFocused(value);
    }
  }
  const toggle = (id: string) => { if (!selected.includes(id) && selected.length >= 50) { setError(t('rw.bulkLimit')); return; } setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); };
  async function sendBulk() {
    if (!selected.length || busy || (!nextStatus && !message.trim())) return;
    if (selected.length > 50) { setError(t('rw.bulkLimit')); return; }
    if (message.trim() && !channels.app && !channels.email && !channels.telegram) { setError(t('rec.bulkChooseTarget')); return; }
    if (!await confirm({ title: t('rw.sendUpdate'), message: t('rec.selectedCount').replace('{n}', String(selected.length)) + (nextStatus ? ' | ' + enumLabel('applicationStatus', nextStatus) : ''), confirmLabel: t('rw.sendUpdate') })) return;
    setBusy(true); setError('');
    try {
      const result = await postOnce<any>('/bulk-comms/campaigns', { companyId, jobPostId: selectedJob, applicationIds: selected, toStatus: nextStatus || undefined, templateId: templateId || undefined, messageBody: message.trim() || undefined, channels: message.trim() ? channels : undefined });
      const rows = result.recipients || []; const count = (key: string) => rows.filter((row: any) => row.deliveryStatus === key).length;
      onFlash(t('rec.bulkDoneSent').replace('{n}', String(count('SENT'))) + ' | ' + t('rec.bulkDoneSkipped').replace('{n}', String(count('SKIPPED_OPTED_OUT'))) + ' | ' + t('rec.bulkDoneFailed').replace('{n}', String(count('FAILED'))));
      setSelected([]); setBulk(false); setMessage(''); setTemplateId(''); setNextStatus(''); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('rec.bulkActionFailed')); }
    finally { setBusy(false); }
  }
  const previewText = message.replace(/\{\{name\}\}/g, applicants.find((item) => selected.includes(item.id))?.profile?.user?.fullName || '').replace(/\{\{jobTitle\}\}/g, job?.title || '').replace(/\{\{companyName\}\}/g, companyName).replace(/\{\{status\}\}/g, nextStatus ? enumLabel('applicationStatus', nextStatus) : '');
  return <>
    {!embedded && <div className={s.context}><Link className={s.textButton} href="/dashboard/recruiter?tab=jobs"><WorkspaceIcon kind="left" />{t('jobs')}</Link><JobContextSelect jobs={jobs} value={selectedJob} onChange={onJobChange} allowBrowse={false} />{selectedJob && <Link href={employerJobHref(selectedJob, 'applicants', companyId)} className={s.textButton}>{t('ranking.applicants')}<WorkspaceIcon kind="arrow" /></Link>}</div>}
    <div className={s.toolbar}><SearchField value={query} onChange={setQuery} placeholder={t('rw.searchApplicants')} /><WorkspaceSelect value={status} options={[{value:'',label:t('rw.allApplicants')},...STAGES.map(value=>({value,label:enumLabel('applicationStatus',value)}))]} label={t('status')} onChange={setStatus}/><button className={s.textButton} onClick={onTemplates}>{t('rec.templatesHistory')}</button></div>
    {error && <div className={s.notice} role="alert">{error}</div>}
    <ApplicantFilters meta={meta} onApply={setFilters}/>
    {selected.length > 0 && <div className={s.bulkBar}><strong>{t('rec.selectedCount').replace('{n}', String(selected.length))}</strong><span className={s.emptyNote}>{t('rw.bulkLimit')}</span><button className={s.textButton} onClick={() => setSelected([])}>{t('rw.clearSelection')}</button><button className={s.secondary} onClick={() => setBulk((open) => !open)} aria-expanded={bulk}>{t('rw.bulkActions')}</button></div>}
    {bulk && selected.length > 0 && <div className={s.bulkComposer}><div className={s.bulkRecipients} aria-label={t('ui.candidate')}>{applicants.filter((item) => selected.includes(item.id)).map((item) => <span key={item.id} className={s.tag}>{item.profile?.user?.fullName}</span>)}</div><div className={s.fields}><div className={s.fieldRow}><label>{t('rec.moveToStage')}<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}><option value="">{t('rec.keepStage')}</option>{STAGES.map((value) => <option key={value} value={value}>{enumLabel('applicationStatus', value)}</option>)}</select></label><label>{t('rec.template')}<select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setMessage(templates.find((item) => item.id === event.target.value)?.body || ''); }}><option value="">{t('rec.customNone')}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{t('rec.messageOptional')}<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={5000} /></label></div><div className={s.actions} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><div className={s.actions}>{(['app', 'email', 'telegram'] as const).map((key) => <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={channels[key]} onChange={(event) => setChannels((current) => ({ ...current, [key]: event.target.checked }))} />{t(key === 'app' ? 'rec.channelApp' : key === 'email' ? 'email' : 'telegram')}</label>)}</div><button className={s.textButton} onClick={() => setPreview((open) => !open)}>{t('rw.previewMessage')}</button><button className={s.primary} disabled={busy || (!message.trim() && !nextStatus)} onClick={() => void sendBulk()}>{t(busy ? 'saving' : 'rw.sendUpdate')}</button></div>{preview && <p style={{ whiteSpace: 'pre-wrap', color: '#6b7890', lineHeight: 1.8 }}>{previewText}</p>}</div></div>}
    {!selectedJob ? <WorkspaceEmpty title={t('rec.pipelineEmpty')} /> : <div className={s.pipelineLayout}><div className={s.pipelineMain}>
      {loading ? <WorkspaceLoading/> : <div className={s.board}>{STAGES.filter(stage=>!status||stage===status).map(stage=>{
        const rows=visible.filter(item=>item.status===stage);
        return <section className={s.column} key={stage}><header><label><input type="checkbox" checked={rows.length>0&&rows.every(item=>selected.includes(item.id))} disabled={!rows.length} onChange={()=>setSelected(ids=>rows.every(item=>ids.includes(item.id))?ids.filter(id=>!rows.some(item=>item.id===id)):[...new Set([...ids,...rows.map(item=>item.id)])].slice(0,50))}/>{enumLabel('applicationStatus',stage)}</label><span className={s.count}>{columns[stage]?.total??0}</span></header><div className={s.columnBody}>
          {!rows.length&&<p className={s.emptyNote}>{t('rec.noCandidates')}</p>}
          {rows.map(item=><article key={item.id} className={s.applicant} data-active={item.id===applicationId||item.id===active} ref={item.id===applicationId?highlight:undefined}><div><input type="checkbox" checked={selected.includes(item.id)} aria-label={t('rec.selectCandidate').replace('{name}',item.profile?.user?.fullName||'')} onChange={()=>toggle(item.id)}/><RecruiterAvatar name={item.profile?.user?.fullName||''} src={item.profile?.user?.avatarUrl}/><div style={{minWidth:0}}><button onClick={()=>setActive(item.id)}>{item.profile?.user?.fullName}</button><span className={s.sub}>{item.profile?.headline||'-'}</span></div></div><footer><time dateTime={item.createdAt}>{dateLabel(item.createdAt,locale)}</time><ApplicationCvAction application={item}/><button aria-label={t('applicants.details')} onClick={()=>setActive(item.id)}><WorkspaceIcon kind="right"/></button></footer></article>)}
          {columns[stage]?.hasMore&&<button className={s.secondary} disabled={moreBusy[stage]} onClick={()=>void loadMore(stage)}>{t(moreBusy[stage]?'loading':'applicants.loadMore')}</button>}
        </div></section>;
      })}</div>}
    </div>{active&&<ApplicationDetail key={selectedJob+':'+active} applicationId={active} jobId={selectedJob} companyId={companyId} from="kanban" onClose={()=>setActive(null)} onChanged={()=>{void reload().catch(reason=>setError(reason.message));}}/>}</div>}

  </>;
}
