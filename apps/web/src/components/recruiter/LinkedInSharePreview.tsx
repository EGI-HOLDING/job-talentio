'use client';

import { useEffect, useRef, useState } from 'react';
import { useEnumLabel, useI18n } from '@/lib/i18n';
import { Link, localeUrl } from '@/lib/navigation';
import { api } from '@/lib/api';
import { packageHref } from '@/lib/jobCommerce';
import { linkedInActionError, activeLinkedInPost, type LinkedInConnection, type LinkedInPreview } from '@/lib/linkedin';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { LinkedInPostStatus, useLinkedInPosts } from './LinkedInPostStatus';
import s from './LinkedInSharePreview.module.css';

const SITE_URL=(process.env.NEXT_PUBLIC_SITE_URL || 'https://jobtalent.io').replace(/\/$/,'');
type Props={jobId?:string;title:string;companyName:string;location?:string;employmentType?:string;workMode?:string;isAnonymous?:boolean;published?:boolean;draftKey?:string;onPrepare?:()=>Promise<string|null>;onOpenSettings?:()=>Promise<void>;onApprovalChange?:(id:string|null)=>void;onShareIntentChange?:(selected:boolean)=>void};

export function LinkedInSharePreview({jobId,title,companyName,location,employmentType,workMode,isAnonymous=false,published=false,draftKey,onPrepare,onOpenSettings,onApprovalChange,onShareIntentChange}:Props) {
  const {t,locale}=useI18n(),enumLabel=useEnumLabel(),confirm=useConfirm();
  const [connection,setConnection]=useState<LinkedInConnection|null>(null),[loading,setLoading]=useState(true),[connectionRetry,setConnectionRetry]=useState(0);
  const [packageState,setPackageState]=useState<'loading'|'premium'|'free'|'failed'>(jobId?'loading':'free');
  useEffect(()=>{if(!jobId){setPackageState('free');return;}const abort=new AbortController();setPackageState('loading');api<{code:string;selected:boolean;expiresAt:string|null}>('/benefits/jobs/'+jobId,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setPackageState(value.selected&&value.code==='PREMIUM'&&(!value.expiresAt||new Date(value.expiresAt)>new Date())?'premium':'free');}).catch(()=>{if(!abort.signal.aborted)setPackageState('failed');});return()=>abort.abort();},[jobId,connectionRetry]);
  const [preview,setPreview]=useState<LinkedInPreview|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retryTarget,setRetryTarget]=useState<string|null>(null);
  const draft=useRef(draftKey);draft.current=draftKey;
  const mounted=useRef(true);
  const defaultApplied=useRef(false);
  const autoPrepared=useRef('');
  const {posts,error:postError,reload}=useLinkedInPosts(jobId);
  const post=posts[0],locked=Boolean(post && (activeLinkedInPost(post)||['PUBLISHED','UNKNOWN'].includes(post.status)));
  useEffect(()=>{
    const key=jobId+':'+draftKey+':'+locale;
    if(packageState==='premium'&&checked&&connection?.connected&&connection.sharingEnabled&&!published&&!post&&!preview&&!busy&&autoPrepared.current!==key){
      autoPrepared.current=key;void prepare();
    }
    // One automatic preview per saved draft. Manual retry remains available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[packageState,checked,connection,published,post,preview,busy,jobId,draftKey,locale]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{let alive=true;setLoading(true);api<LinkedInConnection>('/integrations/linkedin').then(value=>{if(alive){setConnection(value);setError('');if(!defaultApplied.current){defaultApplied.current=true;setChecked(!published && value.connected && value.sharingEnabled && value.autoShareEnabled);}}}).catch(()=>{if(alive)setError(t('li.loadFailed'));}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[locale,connectionRetry,t,published]);
  useEffect(()=>{setPreview(null);onApprovalChange?.(null);},[draftKey,onApprovalChange]);
  useEffect(()=>{onShareIntentChange?.(Boolean(packageState==='premium' && checked && !published && !post && connection?.sharingEnabled));},[packageState,checked,published,post,connection?.sharingEnabled,onShareIntentChange]);
  useEffect(()=>{onApprovalChange?.(packageState==='premium' && checked && preview && !locked && !post && connection?.sharingEnabled && new Date(preview.expiresAt).getTime()>Date.now()?preview.id:null);},[packageState,checked,preview,connection?.sharingEnabled,locked,post,onApprovalChange]);
  useEffect(()=>{
    if(!preview)return;
    const timeout=setTimeout(()=>{setPreview(null);setError(t('li.previewExpired'));onApprovalChange?.(null);},Math.max(0,new Date(preview.expiresAt).getTime()-Date.now()));
    return()=>clearTimeout(timeout);
  },[preview,onApprovalChange,t]);
  async function prepare(retryId?:string) {
    if(busy)return;
    if(!connection?.connected){setError(t('li.error.RECONNECT_REQUIRED'));return;}
    if(!connection.sharingEnabled){setError(t('li.serviceUnavailable'));return;}
    setBusy(true);setError('');onApprovalChange?.(null);
    const wanted=checked || connection.autoShareEnabled;
    const requestedDraft=draft.current;
    try {
      const id=onPrepare?await onPrepare():jobId;
      if(!id || !mounted.current || draft.current!==requestedDraft)return;
      const result=await api<LinkedInPreview>('/jobs/'+encodeURIComponent(id)+'/linkedin/preview',{method:'POST',body:JSON.stringify({locale})});
      if(!mounted.current || draft.current!==requestedDraft)return;
      setPreview(result);setRetryTarget(retryId || null);setChecked(!published && !retryId && wanted);
    }catch(reason){if(mounted.current){setError(linkedInActionError(reason,t));setChecked(false);onShareIntentChange?.(false);}}finally{if(mounted.current)setBusy(false);}
  }
  async function share() {
    if(busy || !preview || !jobId)return;
    if(new Date(preview.expiresAt).getTime()<=Date.now()){setError(t('li.previewExpired'));setPreview(null);return;}
    if(!await confirm({title:t('li.shareConfirm'),message:t('li.shareConfirmHint'),confirmLabel:t(retryTarget?'li.retryApproved':'li.shareNow')}))return;
    setBusy(true);setError('');
    try {await api(retryTarget?'/social-posts/'+encodeURIComponent(retryTarget)+'/retry':'/jobs/'+encodeURIComponent(jobId)+'/social-posts',{method:'POST',body:JSON.stringify({previewId:preview.id})});setPreview(null);setChecked(false);setRetryTarget(null);onApprovalChange?.(null);reload();}
    catch(reason){setError(linkedInActionError(reason,t));setChecked(false);onApprovalChange?.(null);}finally{setBusy(false);}
  }
  async function settings(){if(busy)return;setBusy(true);try{await onOpenSettings?.();}catch(reason){setError(linkedInActionError(reason,t));}finally{if(mounted.current)setBusy(false);}}
  let jobUrl:string|null=null;
  try{jobUrl=jobId?new URL(localeUrl(locale,'/jobs/'+encodeURIComponent(jobId)),SITE_URL).toString():null;}catch{/* unavailable until configuration is corrected */}
  const publicCompanyName=isAnonymous?t('rec.anonymousChip'):companyName,displayTitle=title.trim()||t('li.jobTitlePlaceholder');
  const caption=preview?.caption || [t('li.captionHiring')+' '+displayTitle,publicCompanyName?t('li.captionCompany')+' '+publicCompanyName:'',location?t('li.captionLocation')+' '+location:'',employmentType?t('li.captionType')+' '+enumLabel('employmentType',employmentType):'',t('li.captionApply')+' '+(jobUrl || t('li.linkAfterSave')),'#Hiring #Jobs'].filter(Boolean).join('\n');
  if(packageState!=='premium')return <section className={s.panel}><div className={s.panelHeading}><span className={s.brandMark} aria-hidden="true">in</span><div className={s.headingText}><h3>{t('commerce.linkedin')}</h3><p>{t('commerce.PREMIUM')}</p></div></div><p>{t('commerce.linkedinHint')}</p>{packageState==='failed'?<button type="button" className={s.secondaryButton} onClick={()=>setConnectionRetry(n=>n+1)}>{t('workspace.retry')}</button>:packageState==='loading'?<p role="status">{t('loading')}</p>:<button type="button" className={s.secondaryButton} disabled={busy} onClick={async()=>{setBusy(true);try{const id=jobId||await onPrepare?.();if(id){const returnTo=window.location.pathname.endsWith('/onboarding/recruiter')?'/onboarding/recruiter':undefined;window.location.assign(localeUrl(locale,packageHref(id,returnTo)));}}catch(reason){setError(linkedInActionError(reason,t));}finally{setBusy(false);}}}>{t('commerce.upgrade')} →</button>}{error&&<p role="alert">{error}</p>}</section>;
  return <section className={s.panel} aria-labelledby="linkedin-share-title" aria-busy={busy||loading}>
    <div className={s.panelHeading}><span className={s.brandMark} aria-hidden="true">in</span><div className={s.headingText}><h3 id="linkedin-share-title">{t('li.shareTitle')}</h3><p>{connection?.displayName || t('li.personalProfile')}</p></div><span className={s.connectionStatus}>{loading?t('li.loadingConnection'):connection?t('li.connection.'+connection.status):t('li.loadFailed')}</span></div>
    {error && <div className={s.error} role="alert">{error} {!connection && <button type="button" className={s.secondaryButton} onClick={()=>setConnectionRetry(value=>value+1)}>{t('workspace.retry')}</button>}</div>}
    {postError && <div className={s.error} role="alert">{postError} <button type="button" className={s.secondaryButton} onClick={reload}>{t('workspace.retry')}</button></div>}
    {connection && !connection.sharingEnabled && <p className={s.notice} role="status">{t('li.serviceUnavailable')}</p>}
    {post && <LinkedInPostStatus post={post} onReload={reload} onRetry={id=>void prepare(id)}/>}
    <div className={s.connectionNote}><p>{t('li.feedOnly')}</p>{onOpenSettings?<button type="button" className={s.linkButton} disabled={busy||loading} onClick={()=>void settings()}>{t('li.connectSaved')}</button>:<Link href={jobId?"/settings?returnTo="+encodeURIComponent("/dashboard/recruiter/jobs/"+encodeURIComponent(jobId)+"?section=details")+"#integrations":"/settings#integrations"}>{t('li.openSettings')}</Link>}</div>
    {!locked && <>
      {connection?.connected && connection.sharingEnabled && (!post || ['FAILED','CANCELLED'].includes(post.status)) && <button type="button" className={s.secondaryButton} disabled={busy} onClick={()=>void prepare(post?.id)}>{t(busy?'li.preparing':onPrepare?'li.prepare':'li.prepareSaved')}</button>}
      {!published && !post && <label className={s.shareChoice}><input type="checkbox" disabled={busy||!connection?.connected||!connection?.sharingEnabled} checked={checked} onChange={event=>{setChecked(event.target.checked);onShareIntentChange?.(event.target.checked);onApprovalChange?.(event.target.checked && preview?preview.id:null);}}/><span><strong>{t('li.shareCheckbox')}</strong><small>{t(preview?'li.previewExact':'li.previewRequired')}</small></span></label>}
      {(!post || preview) && <div className={s.previewSection}><h4>{t('li.previewTitle')}</h4><div className={s.previewGrid}>
        {preview ? /* eslint-disable-next-line @next/next/no-img-element */ <img className={s.approvedPoster} src={preview.posterDataUrl} alt={t('li.posterPreview')+': '+displayTitle}/> : <div className={s.poster} role="img" aria-label={t('li.posterPreview')+': '+displayTitle}><span className={s.posterKicker}>{t('li.posterKicker')}</span><div className={s.posterIdentity}><span className={s.posterMonogram} aria-hidden="true">{publicCompanyName.slice(0,1).toLocaleUpperCase(locale)}</span><span>{publicCompanyName || t('li.companyPlaceholder')}</span></div><strong className={s.posterTitle}>{displayTitle}</strong><div className={s.posterMeta}>{location&&<span>{location}</span>}{workMode&&<span>{enumLabel('workMode',workMode)}</span>}{employmentType&&<span>{enumLabel('employmentType',employmentType)}</span>}</div><span className={s.posterCta}>{t('li.posterCta')}</span><span className={s.posterAccent} aria-hidden="true"/></div>}
        <div className={s.captionCard}><span className={s.captionLabel}>{t('li.captionLabel')}</span><p>{caption}</p>{published && (preview?.jobUrl||jobUrl)?<a className={s.jobUrl} href={preview?.jobUrl||jobUrl!} target="_blank" rel="noopener noreferrer">{preview?.jobUrl||jobUrl}</a>:<span className={s.urlPending}>{jobId?t('li.draftLink'):t('li.linkAfterSave')}</span>}</div>
      </div>{preview&&<p className={s.notice}>{t('li.previewExact')}</p>}</div>}
      {preview && (published || retryTarget) && <><button type="button" className={s.primaryButton} disabled={busy||!published} onClick={()=>void share()}>{t(retryTarget?'li.retryApproved':'li.shareNow')}</button>{!published&&<p>{t('li.publishBeforeRetry')}</p>}</>}
    </>}
    {isAnonymous && <p className={s.privacyNote} role="note">{t('li.anonymousWarning')}</p>}
  </section>;
}
