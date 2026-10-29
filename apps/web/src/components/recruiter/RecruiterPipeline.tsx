'use client';

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { postOnce } from '@/lib/hr-benefits';
import { useLiveRefresh } from '@/lib/useLiveRefresh';
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
import { KANBAN_STAGES } from '@job-talentio/shared';
import s from './RecruiterWorkspace.module.css';

const STAGES = KANBAN_STAGES;
type DragSession = { id:string; name:string; sourceStatus:string; targetStatus:string|null; mode:'pointer'|'keyboard'; pointerId?:number; startX?:number; startY?:number; clientX?:number; clientY?:number; dragging:boolean };
type Props = { embedded?: boolean; meta:any; companyId: string; companyName: string; jobs: any[]; selectedJob: string; onJobChange: (id: string) => void; applicants: any[]; loading: boolean; applicationId?: string; templates: Array<{ id: string; name: string; body: string }>; onReload: () => Promise<void>; onTemplates: () => void; onFlash: (message: string, tone?: 'success' | 'error') => void };

export function RecruiterPipeline({ embedded = false, meta, companyId, companyName, jobs, selectedJob, onJobChange, applicants: initialApplicants, loading: initialLoading, applicationId, templates, onReload, onTemplates, onFlash }: Props) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const confirm = useConfirm();
  const dragHintId=useId();
  const [applicants,setApplicants]=useState<any[]>([]),[loading,setLoading]=useState(false),[filters,setFilters]=useState<Record<string,string>>({});
  const [columns,setColumns]=useState<Record<string,{total:number;page:number;hasMore:boolean}>>({}),[moreBusy,setMoreBusy]=useState<Record<string,boolean>>({});
  const generation=useRef(0),pendingColumns=useRef(new Set<string>()),highlight=useRef<HTMLElement|null>(null);
  const [drag,setDrag]=useState<DragSession|null>(null),dragSession=useRef<DragSession|null>(null),boardRef=useRef<HTMLDivElement|null>(null),autoScrollFrame=useRef<number|null>(null),autoScrollPoint=useRef<{x:number;y:number}|null>(null);
  const [movingId,setMovingId]=useState<string|null>(null),movingRef=useRef<string|null>(null),[moveAnnouncement,setMoveAnnouncement]=useState('');
  const moveHandleRefs=useRef(new Map<string,HTMLButtonElement>()),pendingFocus=useRef<string|null>(null);
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
  const actionContext=useRef('');actionContext.current=companyId+':'+selectedJob;
  const [liveRevision,setLiveRevision]=useState(0);
  const loaded=useRef('');
  const loadedPages=useRef<Record<string,number>>({});
  useLiveRefresh('applications',async()=>{setLiveRevision(value=>value+1);},!busy&&!movingId,companyId+':'+selectedJob);
  useEffect(()=>{setSelected([]);setActive(null);dragSession.current=null;setDrag(null);stopAutoScroll();},[selectedJob,query,status,filterKey]);
  useEffect(()=>()=>stopAutoScroll(),[]);
  useEffect(()=>{
    if(!selectedJob){setApplicants([]);return;}
    const identity=JSON.stringify([companyId,selectedJob,query,status,filterKey,locale]);
    let alive=true;const version=++generation.current;const reset=loaded.current!==identity;setLoading(reset);if(reset){setApplicants([]);setColumns({});loadedPages.current={};}setMoreBusy({});pendingColumns.current.clear();
    const params=new URLSearchParams({q:query,page:'1',limit:'20',...Object.fromEntries(Object.entries(filters).filter(([,value])=>value!=='')),...(status?{status}:{})});
    const timer=setTimeout(()=>{(async()=>{
      const data=await api<any>('/applications/jobs/'+selectedJob+'/kanban?'+params);
      const extra=await Promise.all(data.columns.flatMap((column:any)=>Array.from({length:Math.max(0,Math.min(loadedPages.current[column.status]||1,column.totalPages||1)-1)},(_,index)=>{
        const pageParams=new URLSearchParams(params);pageParams.set('status',column.status);pageParams.set('page',String(index+2));
        return api<any>('/applications/jobs/'+selectedJob+'/kanban?'+pageParams).then(value=>value.columns[0]);
      })));
      for(const column of data.columns){
        const pages=[column,...extra.filter(value=>value.status===column.status)].sort((a,b)=>a.page-b.page);
        column.items=[...new Map(pages.flatMap(value=>value.items).map((item:any)=>[item.id,item])).values()];
        column.page=pages.at(-1).page;column.hasMore=pages.at(-1).hasMore;
      }
      return data;
    })().then(data=>{
      if(alive&&version===generation.current){loaded.current=identity;setApplicants(data.columns.flatMap((column:any)=>column.items));setColumns(Object.fromEntries(data.columns.map((column:any)=>[column.status,{total:column.total,page:column.page,hasMore:column.hasMore}])));setError('');}
    }).catch(error=>{if(alive)setError(error.message);}).finally(()=>{if(alive)setLoading(false);});},200);
    return()=>{alive=false;++generation.current;clearTimeout(timer);};
  },[companyId,selectedJob,query,status,filterKey,initialApplicants,locale,liveRevision]);
  async function loadMore(stage:string) {
    if(pendingColumns.current.has(stage)||!columns[stage]?.hasMore)return;
    pendingColumns.current.add(stage);setMoreBusy(value=>({...value,[stage]:true}));const version=generation.current;
    const params=new URLSearchParams({q:query,...Object.fromEntries(Object.entries(filters).filter(([,value])=>value!=='')),status:stage,page:String(columns[stage].page+1),limit:'20'});
    try{const data=await api<any>('/applications/jobs/'+selectedJob+'/kanban?'+params);if(version!==generation.current)return;const column=data.columns[0];loadedPages.current[stage]=column.page;setApplicants(rows=>[...rows,...column.items.filter((item:any)=>!rows.some(row=>row.id===item.id))]);setColumns(value=>({...value,[stage]:{total:column.total,page:column.page,hasMore:column.hasMore}}));}
    catch(reason){if(version===generation.current)setError(reason instanceof Error?reason.message:t('ew.loadFailed'));}
    finally{if(version===generation.current){pendingColumns.current.delete(stage);setMoreBusy(value=>({...value,[stage]:false}));}}
  }
  const job = jobs.find((item) => item.id === selectedJob);
  useEffect(() => { setActive(null); setSelected([]); setBulk(false); setBusy(false); setMessage(''); setStatus(''); setError(''); dragSession.current=null;setDrag(null);stopAutoScroll();movingRef.current=null;setMovingId(null); }, [companyId,selectedJob]);
  useEffect(() => { setSelected((ids) => ids.filter((id) => applicants.some((item) => item.id === id))); }, [applicants]);
  const visible = useMemo(() => {
    const rows=focused?.kanbanEnteredAt&&!query&&!Object.values(filters).some(Boolean)&&!applicants.some(row=>row.id===focused.id)?[focused,...applicants]:applicants;
    return rows.filter(item=>!status||item.status===status);
  },[applicants,focused,status,query,filterKey]);
  useEffect(()=>{if(!loading&&applicationId)highlight.current?.scrollIntoView({block:'nearest',inline:'center'});},[loading,applicationId,focused]);
  useEffect(() => {
    if (!applicationId || !selectedJob) { setFocused(null); openedLink.current = ''; return; }
    const identity = selectedJob + ':' + applicationId + ':' + locale + ':' + liveRevision;
    if (openedLink.current === identity) return;
    let alive = true;
    api('/applications/jobs/' + selectedJob + '/applicants/' + applicationId)
      .then(value => { if (alive) { setFocused(value); openedLink.current = identity; } })
      .catch(reason => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [applicationId, selectedJob, locale, liveRevision]);

  useEffect(()=>{
    if(!pendingFocus.current||movingId)return;
    const handle=moveHandleRefs.current.get(pendingFocus.current);
    if(handle){pendingFocus.current=null;handle.focus();}
  },[applicants,movingId]);

  const setDragSession=(value:DragSession|null)=>{dragSession.current=value;setDrag(value);};
  const canStartDrag=(item:any)=>!status&&item.status!=='WITHDRAWN'&&!movingId&&!busy;
  function stopAutoScroll(){autoScrollPoint.current=null;if(autoScrollFrame.current!==null){cancelAnimationFrame(autoScrollFrame.current);autoScrollFrame.current=null;}}
  function startAutoScroll(x:number,y:number){
    autoScrollPoint.current={x,y};
    if(autoScrollFrame.current!==null)return;
    const tick=()=>{
      const point=autoScrollPoint.current,board=boardRef.current;if(!point||!board){autoScrollFrame.current=null;return;}
      const boardRect=board.getBoundingClientRect(),horizontal=point.x<boardRect.left+48&&board.scrollLeft>0?-1:point.x>boardRect.right-48&&board.scrollLeft+board.clientWidth<board.scrollWidth-1?1:0;
      const body=document.elementFromPoint(point.x,point.y)?.closest<HTMLElement>('[data-kanban-column-body]');
      const bodyRect=body?.getBoundingClientRect(),vertical=body&&bodyRect?(point.y<bodyRect.top+42&&body.scrollTop>0?-1:point.y>bodyRect.bottom-42&&body.scrollTop+body.clientHeight<body.scrollHeight-1?1:0):0;
      if(!horizontal&&!vertical){autoScrollFrame.current=null;return;}
      if(horizontal)board.scrollBy({left:horizontal*7,behavior:'auto'});
      if(vertical&&body)body.scrollBy({top:vertical*6,behavior:'auto'});
      const current=dragSession.current,stage=stageAtPoint(point.x,point.y);
      if(current?.mode==='pointer'&&current.targetStatus!==stage)setDragSession({...current,targetStatus:stage,clientX:point.x,clientY:point.y});
      autoScrollFrame.current=requestAnimationFrame(tick);
    };
    autoScrollFrame.current=requestAnimationFrame(tick);
  }
  function stageAtPoint(x:number,y:number) {
    const target=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-kanban-stage]');
    const stage=target?.dataset.kanbanStage;
    return stage&&STAGES.includes(stage as never)?stage:null;
  }
  function beginPointerDrag(event:ReactPointerEvent<HTMLButtonElement>,item:any) {
    if(event.button!==0||!canStartDrag(item))return;
    event.stopPropagation();
    const name=item.profile?.user?.fullName||'';
    const session:DragSession={id:item.id,name,sourceStatus:item.status,targetStatus:item.status,mode:'pointer',pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,clientX:event.clientX,clientY:event.clientY,dragging:false};
    setDragSession(session);
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}
  }
  function movePointerDrag(event:ReactPointerEvent<HTMLButtonElement>) {
    const current=dragSession.current;
    if(!current||current.mode!=='pointer'||current.pointerId!==event.pointerId)return;
    const distance=Math.hypot(event.clientX-(current.startX||0),event.clientY-(current.startY||0));
    const dragging=current.dragging||distance>=6;
    if(dragging){
      startAutoScroll(event.clientX,event.clientY);
      const column=stageAtPoint(event.clientX,event.clientY);
      setDragSession({...current,dragging,targetStatus:column,clientX:event.clientX,clientY:event.clientY});
    }
  }
  function cancelPointerDrag(event:ReactPointerEvent<HTMLButtonElement>) {
    const current=dragSession.current;
    if(current?.mode==='pointer'&&current.pointerId===event.pointerId){setDragSession(null);stopAutoScroll();}
  }
  async function finishPointerDrag(event:ReactPointerEvent<HTMLButtonElement>) {
    const current=dragSession.current;
    if(!current||current.mode!=='pointer'||current.pointerId!==event.pointerId)return;
    const destination=current.dragging?stageAtPoint(event.clientX,event.clientY):null;
    setDragSession(null);stopAutoScroll();
    if(current.dragging&&destination&&destination!==current.sourceStatus){
      const item=applicants.find(row=>row.id===current.id)||focused;
      if(item?.id===current.id)await moveCandidate(item,destination);
    }
  }
  async function handleMoveKey(event:ReactKeyboardEvent<HTMLButtonElement>,item:any) {
    if(!canStartDrag(item)&&dragSession.current?.id!==item.id)return;
    const current=dragSession.current;
    if(current&&event.key==='Escape'&&current.id===item.id){event.preventDefault();setDragSession(null);stopAutoScroll();if(current.mode==='pointer'&&current.pointerId!==undefined){try{event.currentTarget.releasePointerCapture(current.pointerId);}catch{}}setMoveAnnouncement(t('applicants.dragCancelled'));return;}
    if(!current&&[' ','Enter'].includes(event.key)){
      event.preventDefault();const name=item.profile?.user?.fullName||'';
      setDragSession({id:item.id,name,sourceStatus:item.status,targetStatus:item.status,mode:'keyboard',dragging:true});
      setMoveAnnouncement(t('applicants.dragPickedUp').replace('{name}',name).replace('{stage}',enumLabel('applicationStatus',item.status)));return;
    }
    if(!current||current.id!==item.id||current.mode!=='keyboard')return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const index=STAGES.indexOf((current.targetStatus||current.sourceStatus) as never),next=Math.max(0,Math.min(STAGES.length-1,index+(event.key==='ArrowRight'?1:-1))),target=STAGES[next];
      const updated={...current,targetStatus:target};setDragSession(updated);
      setMoveAnnouncement(t('applicants.dragMoveTo').replace('{name}',current.name).replace('{stage}',enumLabel('applicationStatus',target)));return;
    }
    if([' ','Enter'].includes(event.key)){
      event.preventDefault();setDragSession(null);const target=current.targetStatus;
      if(target&&target!==current.sourceStatus){const candidate=applicants.find(row=>row.id===current.id)||focused;if(candidate?.id===current.id)await moveCandidate(candidate,target);}
    }
  }
  async function moveCandidate(item:any,targetStatus:string) {
    if(!item||item.status===targetStatus||movingRef.current)return;
    const context=actionContext.current,sourceStatus=item.status,name=item.profile?.user?.fullName||'';
    if(['HIRED','REJECTED'].includes(targetStatus)&&!await confirm({title:enumLabel('applicationStatus',targetStatus),message:name,confirmLabel:t('rec.saveChanges')}))return;
    if(context!==actionContext.current||movingRef.current)return;
    movingRef.current=item.id;setMovingId(item.id);setError('');setMoveAnnouncement('');pendingFocus.current=item.id;
    setApplicants(rows=>rows.map(row=>row.id===item.id?{...row,status:targetStatus}:row));
    setFocused((row:any)=>row?.id===item.id?{...row,status:targetStatus}:row);
    setColumns(values=>({...values,[sourceStatus]:values[sourceStatus]?{...values[sourceStatus],total:Math.max(0,values[sourceStatus].total-1)}:values[sourceStatus],[targetStatus]:values[targetStatus]?{...values[targetStatus],total:values[targetStatus].total+1}:values[targetStatus]}));
    try{
      const value=await api<any>('/applications/'+encodeURIComponent(item.id)+'/status',{method:'POST',body:JSON.stringify({status:targetStatus})});
      if(context!==actionContext.current)return;
      if(value?.status)setApplicants(rows=>rows.map(row=>row.id===item.id?{...row,status:value.status}:row));
      setMoveAnnouncement(t('applicants.movedToStage').replace('{name}',name).replace('{stage}',enumLabel('applicationStatus',targetStatus)));
    }catch(reason){
      if(context===actionContext.current){setApplicants(rows=>rows.map(row=>row.id===item.id?{...row,status:sourceStatus}:row));setFocused((row:any)=>row?.id===item.id?{...row,status:sourceStatus}:row);setColumns(values=>({...values,[sourceStatus]:values[sourceStatus]?{...values[sourceStatus],total:values[sourceStatus].total+1}:values[sourceStatus],[targetStatus]:values[targetStatus]?{...values[targetStatus],total:Math.max(0,values[targetStatus].total-1)}:values[targetStatus]}));setError(reason instanceof Error?reason.message:t('applicants.moveFailed'));setMoveAnnouncement(t('applicants.moveFailed'));}
    }finally{
      if(context===actionContext.current){movingRef.current=null;setMovingId(null);setLiveRevision(value=>value+1);}
    }
  }

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
    const context=actionContext.current;
    if (selected.length > 50) { setError(t('rw.bulkLimit')); return; }
    if (message.trim() && !channels.app && !channels.email && !channels.telegram) { setError(t('rec.bulkChooseTarget')); return; }
    if (!await confirm({ title: t('rw.sendUpdate'), message: t('rec.selectedCount').replace('{n}', String(selected.length)) + (nextStatus ? ' | ' + enumLabel('applicationStatus', nextStatus) : ''), confirmLabel: t('rw.sendUpdate') })) return;
    if(context!==actionContext.current)return;
    setBusy(true); setError('');
    try {
      const result = await postOnce<any>('/bulk-comms/campaigns', { companyId, jobPostId: selectedJob, applicationIds: selected, toStatus: nextStatus || undefined, templateId: templateId || undefined, messageBody: message.trim() || undefined, channels: message.trim() ? channels : undefined });
      if(context!==actionContext.current)return;
      const rows = result.recipients || []; const count = (key: string) => rows.filter((row: any) => row.deliveryStatus === key).length;
      onFlash(t('rec.bulkDoneSent').replace('{n}', String(count('SENT'))) + ' | ' + t('rec.bulkDoneSkipped').replace('{n}', String(count('SKIPPED_OPTED_OUT'))) + ' | ' + t('rec.bulkDoneFailed').replace('{n}', String(count('FAILED'))));
      setSelected([]); setBulk(false); setMessage(''); setTemplateId(''); setNextStatus(''); await reload();
    } catch (reason) { if(context===actionContext.current)setError(reason instanceof Error ? reason.message : t('rec.bulkActionFailed')); }
    finally { if(context===actionContext.current)setBusy(false); }
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
      {loading ? <WorkspaceLoading/> : <div className={s.board} ref={boardRef}>
        <div className={s.srOnly} aria-live="polite" aria-atomic="true">{moveAnnouncement}</div>
        {STAGES.filter(stage=>!status||stage===status).map(stage=>{
        const rows=visible.filter(item=>item.status===stage);
        return <section className={s.column} key={stage} data-kanban-stage={stage} data-drop-target={Boolean(drag?.dragging&&drag.targetStatus===stage)}><header><label><input type="checkbox" checked={rows.length>0&&rows.every(item=>selected.includes(item.id))} disabled={!rows.length} onChange={()=>setSelected(ids=>rows.every(item=>ids.includes(item.id))?ids.filter(id=>!rows.some(item=>item.id===id)):[...new Set([...ids,...rows.map(item=>item.id)])].slice(0,50))}/>{enumLabel('applicationStatus',stage)}</label><span className={s.count}>{columns[stage]?.total??0}</span></header><div className={s.columnBody} data-kanban-column-body>
          {!rows.length&&<p className={s.emptyNote}>{t('rec.noCandidates')}</p>}
        {rows.map(item=>{const name=item.profile?.user?.fullName||'',canDrag=canStartDrag(item),isDragging=drag?.id===item.id&&drag?.dragging,dragDisabledReason=status?t('applicants.dragDisabledFilter'):item.status==='WITHDRAWN'?t('applicants.dragWithdrawn'):busy||movingId?t('applicants.moveBusy'):t('applicants.dragHint'),moveLabel=t('applicants.moveCandidate').replace('{name}',name);return <article key={item.id} className={s.applicant} data-active={item.id===applicationId||item.id===active} data-dragging={Boolean(isDragging)} ref={item.id===applicationId?highlight:undefined}><div><button type="button" className={s.moveHandle} disabled={!canDrag&&drag?.id!==item.id} title={dragDisabledReason} aria-label={!canDrag?moveLabel+'. '+dragDisabledReason:moveLabel} aria-describedby={dragHintId} aria-pressed={drag?.id===item.id&&drag?.mode==='keyboard'} aria-keyshortcuts="Space ArrowLeft ArrowRight Enter Escape" ref={node=>{if(node)moveHandleRefs.current.set(item.id,node);else moveHandleRefs.current.delete(item.id);}} onPointerDown={event=>beginPointerDrag(event,item)} onPointerMove={movePointerDrag} onPointerUp={event=>{void finishPointerDrag(event);}} onPointerCancel={cancelPointerDrag} onLostPointerCapture={cancelPointerDrag} onKeyDown={event=>{void handleMoveKey(event,item);}}><svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.2"/><circle cx="11" cy="3" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="13" r="1.2"/><circle cx="11" cy="13" r="1.2"/></svg></button><input type="checkbox" checked={selected.includes(item.id)} aria-label={t('rec.selectCandidate').replace('{name}',name)} onChange={()=>toggle(item.id)}/><RecruiterAvatar name={name} src={item.profile?.user?.avatarUrl}/><div style={{minWidth:0}}><button onClick={()=>setActive(item.id)}>{name}</button><span className={s.sub}>{item.profile?.headline||'-'}</span></div></div><footer><time dateTime={item.createdAt}>{dateLabel(item.createdAt,locale)}</time><ApplicationCvAction application={item}/><button aria-label={t('applicants.details')} onClick={()=>setActive(item.id)}><WorkspaceIcon kind="right"/></button></footer></article>;})}
          {columns[stage]?.hasMore&&<button className={s.secondary} disabled={moreBusy[stage]} onClick={()=>void loadMore(stage)}>{t(moreBusy[stage]?'loading':'applicants.loadMore')}</button>}
        </div></section>;
      })}
        {drag?.dragging&&drag.mode==='pointer'&&typeof drag.clientX==='number'&&typeof drag.clientY==='number'&&<div className={s.dragPreview} style={{left:typeof window==='undefined'?drag.clientX+14:Math.max(8,Math.min(drag.clientX+14,window.innerWidth-258)),top:typeof window==='undefined'?drag.clientY+14:Math.max(8,Math.min(drag.clientY+14,window.innerHeight-78))}} aria-hidden="true"><span>{drag.name}</span><small>{t('applicants.dragPreview').replace('{stage}',enumLabel('applicationStatus',drag.targetStatus||drag.sourceStatus))}</small></div>}
      </div>}
      <span id={dragHintId} className={s.srOnly}>{t('applicants.dragHint')}</span>
    </div>{active&&<ApplicationDetail key={selectedJob+':'+active} applicationId={active} jobId={selectedJob} companyId={companyId} from="kanban" onClose={()=>setActive(null)} onChanged={()=>{void reload().catch(reason=>setError(reason.message));}}/>}</div>}

  </>;
}
