'use client';
import { useEffect, useRef } from 'react';
import { api } from './api';
import { useSessionIdentity } from './useSessionIdentity';
import { useI18n } from './i18n';

/** One serialized status-only poller, visible tabs only; never re-ranks unchanged evidence. */
export function useMatchingStatus(processing: boolean, changed: () => void) {
  const callback=useRef(changed); callback.current=changed;
  const identity=useSessionIdentity(),{locale}=useI18n();
  useEffect(()=>{
    if(!processing||!identity)return;
    let disposed=false,running=false,timer:ReturnType<typeof setTimeout>|undefined,last:string|undefined;
    const started=Date.now(),controller=new AbortController();
    const arm=()=>{if(!disposed)timer=setTimeout(run,Date.now()-started<60_000?5000:15000);};
    const run=async()=>{
      if(disposed||running)return;
      if(document.visibilityState==='hidden'){arm();return;}
      running=true;
      try{
        const status=await api<{state:string;revision:string}>('/profiles/me/matching-status',{signal:controller.signal,cacheMode:'no-store'});
        if(!disposed&&status.revision!==last){
          const initial=last===undefined;last=status.revision;
          if(!initial||status.state!=='CV_PROCESSING')callback.current();
        }
      }catch{}finally{running=false;arm();}
    };
    const visible=()=>{if(document.visibilityState==='visible'&&!running){if(timer)clearTimeout(timer);void run();}};
    arm();document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;if(timer)clearTimeout(timer);controller.abort();document.removeEventListener('visibilitychange',visible);};
  },[processing,identity,locale]);
}
