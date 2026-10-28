'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { activeLinkedInPost, linkedInActionError, type LinkedInPost } from '@/lib/linkedin';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { Link } from '@/lib/navigation';
import { employerJobHref } from '@/lib/accountNavigation';
import s from './LinkedInSharePreview.module.css';

export function LinkedInJobSummary({jobId,companyId}:{jobId:string;companyId:string}) {
  const {posts}=useLinkedInPosts(jobId),{t}=useI18n();
  if(!posts.length)return null;
  return <div className={s.summary}><span>{t('li.myStatus')}: <strong role="status">{t('li.post.'+posts[0].status)}</strong></span><Link href={employerJobHref(jobId,'details',companyId)+'#linkedin-share-title'}>{t('li.manage')}</Link></div>;
}

export function useLinkedInPosts(jobId?:string) {
  const {locale,t}=useI18n();
  const [value,setValue]=useState<{jobId?:string;posts:LinkedInPost[]}>({posts:[]});
  const [error,setError]=useState(''),[revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    if(!jobId)return;
    let alive=true,timer:ReturnType<typeof setTimeout> | undefined;setError('');
    const load=async()=>{
      try{const posts=await api<LinkedInPost[]>('/jobs/'+encodeURIComponent(jobId)+'/social-posts');if(!alive)return;setValue({jobId,posts});setError('');
        if(posts.some(post=>activeLinkedInPost(post) || (post.status==='UNKNOWN' && post.reviewAfter && new Date(post.reviewAfter).getTime()>Date.now())))timer=setTimeout(()=>void load(),5000);
      }catch{if(alive)setError(t('li.loadFailed'));}
    };void load();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[jobId,revision,locale,t]);
  return {posts:value.jobId===jobId?value.posts:[],error,reload};
}

export function LinkedInPostStatus({post,onReload,onRetry}:{post:LinkedInPost;onReload:()=>void;onRetry:(id:string)=>void}) {
  const {t,locale}=useI18n(),confirm=useConfirm();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState(false),[urn,setUrn]=useState('');
  const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  async function action(kind:'cancel'|'reconcile',outcome?:'PUBLISHED'|'NOT_PUBLISHED') {
    if(busy)return;
    if(kind==='cancel' && !await confirm({title:t('li.cancelShare'),confirmLabel:t('li.cancelShare')}))return;
    if(outcome==='NOT_PUBLISHED' && !await confirm({title:t('li.confirmNotPublished'),message:t('li.notPublishedWarning'),confirmLabel:t('li.confirmNotPublished'),tone:'danger'}))return;
    setBusy(true);setError('');
    try {await api('/social-posts/'+encodeURIComponent(post.id)+'/'+kind,{method:'POST',body:JSON.stringify(kind==='reconcile'?{outcome,feedChecked:checked,...(outcome==='PUBLISHED'&&urn.trim()?{postUrn:urn.trim()}:{})}:{})});setChecked(false);onReload();}
    catch(reason){setError(linkedInActionError(reason,t));}finally{setBusy(false);}
  }
  const waiting=Boolean(post.reviewAfter && new Date(post.reviewAfter).getTime()>Date.now());
  const key='li.error.'+post.errorCode,translated=t(key),errorText=translated===key?t('li.error.GENERIC'):translated;
  return <div className={s.postStatus} data-status={post.status} aria-busy={busy}>
    <strong role="status">{t('li.post.'+post.status)}</strong>
    {post.publishedAt && <p>{date(post.publishedAt)}</p>}
    {post.providerPostUrn && <code>{post.providerPostUrn}</code>}
    {activeLinkedInPost(post) && <p>{t('li.queuedHint')}</p>}
    {post.status==='PENDING' && new Date(post.nextAttemptAt).getTime()>Date.now() && <p>{t('li.retryAt')}: {date(post.nextAttemptAt)}</p>}
    {post.status==='FAILED' && <p>{errorText}</p>}
    {post.status==='PUBLISHED' && <p>{t('li.oncePerJob')}</p>}
    {['PENDING','RENDERING','UPLOADING'].includes(post.status) && <button type="button" className={s.secondaryButton} disabled={busy} onClick={()=>void action('cancel')}>{t('li.cancelShare')}</button>}
    {['FAILED','CANCELLED'].includes(post.status) && post.retrySafe && <button type="button" className={s.secondaryButton} disabled={busy} onClick={()=>onRetry(post.id)}>{t('li.retryReview')}</button>}
    {['UNKNOWN','PUBLISHED'].includes(post.status) && <a className={s.feedLink} href="https://www.linkedin.com/feed/" target="_blank" rel="noopener noreferrer">{t('li.feed')}</a>}
    {post.status==='UNKNOWN' && <div className={s.reconcile}>
      <p>{t('li.unknownHint')}</p>
      {waiting && <p>{t('li.reviewAfter')}: {date(post.reviewAfter!)}</p>}
      <label className={s.checkLabel}><input type="checkbox" checked={checked} disabled={busy||waiting} onChange={event=>setChecked(event.target.checked)}/>{t('li.feedChecked')}</label>
      <label>{t('li.postUrn')} ({t('optional')})<input value={urn} onChange={event=>setUrn(event.target.value)} placeholder="urn:li:share:…" maxLength={100} disabled={busy||waiting}/><small>{t('li.postUrnHint')}</small></label>
      <div className={s.actionRow}><button type="button" className={s.secondaryButton} disabled={busy||waiting||!checked||Boolean(urn.trim()&&!/^urn:li:(share|ugcPost):\d{1,30}$/.test(urn.trim()))} onClick={()=>void action('reconcile','PUBLISHED')}>{t('li.confirmPublished')}</button><button type="button" className={s.secondaryButton} disabled={busy||waiting||!checked} onClick={()=>void action('reconcile','NOT_PUBLISHED')}>{t('li.confirmNotPublished')}</button></div>
    </div>}
    {error && <p role="alert" className={s.error}>{error}</p>}
  </div>;
}
