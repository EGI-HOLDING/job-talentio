'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/ConfirmProvider';

type ContextGuard = CustomEvent<{ guards: Promise<boolean>[] }>;
export async function allowEmployerContextChange() {
  const event = new CustomEvent('talentio:employer-context', { detail: { guards: [] as Promise<boolean>[] } });
  document.dispatchEvent(event);
  return (await Promise.all(event.detail.guards)).every(Boolean);
}

/** Protect in-progress employer forms when navigating through the shared header. */
export function useEmployerUnsaved(dirty:boolean, busy=false) {
  const {t}=useI18n(); const confirm=useConfirm(); const router=useRouter();
  const pending=useRef(false), allowed=useRef(false);
  useEffect(()=>{allowed.current=false;},[dirty]);
  useEffect(()=>{
    function context(event: Event) {
      if (!dirty && !busy) return;
      const request = event as ContextGuard;
      if (busy || pending.current) { request.detail.guards.push(Promise.resolve(false)); return; }
      pending.current = true;
      request.detail.guards.push(confirm({ title: t('rw.discard'), message: t('rw.discardHint'), confirmLabel: t('discardChanges'), cancelLabel: t('rw.keepEditing'), tone: 'danger' }).finally(() => { pending.current = false; }));
    }
    function unload(event:BeforeUnloadEvent){if(dirty&&!allowed.current){event.preventDefault();event.returnValue='';}}
    function navigate(event:MouseEvent){
      if((!dirty&&!busy)||allowed.current||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download'))return;
      const url=new URL(anchor.href,window.location.href);
      if(url.origin!==window.location.origin||url.href===window.location.href)return;
      event.preventDefault();event.stopPropagation();
      if(busy||pending.current)return;pending.current=true;
      void confirm({title:t('rw.discard'),message:t('rw.discardHint'),confirmLabel:t('discardChanges'),cancelLabel:t('rw.keepEditing'),tone:'danger'}).then((ok)=>{if(ok){allowed.current=true;router.push(url.pathname+url.search+url.hash);}}).finally(()=>{pending.current=false;});
    }
    window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);document.addEventListener('talentio:employer-context', context);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);document.removeEventListener('talentio:employer-context', context);};
  },[dirty,busy,t,confirm,router]);
  return () => { allowed.current = true; };
}
