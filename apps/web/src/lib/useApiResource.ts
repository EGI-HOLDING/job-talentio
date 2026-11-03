'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, apiResourceKey, peekApi, subscribeApi, type ApiOptions } from './api';
import { useSessionIdentity } from './useSessionIdentity';
import { useI18n } from './i18n';

export function useApiResource<T>(path: string | null, options: ApiOptions = {}) {
  const identity = useSessionIdentity(); const { locale } = useI18n();
  const key = path ? apiResourceKey(path, options) : '';
  const [snapshot, setSnapshot] = useState<{key:string;data?:T;error?:string}>(() => ({key, data:path?peekApi<T>(path,options):undefined}));
  const data = snapshot.key === key ? snapshot.data : path ? peekApi<T>(path,options) : undefined;
  const reload = useCallback(async (force = true) => {
    if (!path) return;
    const result = await api<T>(path, {...options,cacheMode:force?'reload':undefined});
    setSnapshot({key,data:result}); return result;
  }, [key]);
  useEffect(() => {
    if (!path) return;
    let active = true; const controller = new AbortController();
    const load = () => {
      if(key!==apiResourceKey(path,options))return;
      const cached = peekApi<T>(path,options);
      if (cached !== undefined) setSnapshot({key,data:cached});
      void api<T>(path,{...options,signal:controller.signal}).then(result=>{if(active)setSnapshot({key,data:result});}).catch(error=>{if(active&&error.name!=='AbortError')setSnapshot(current=>({...current,key,error:error.message}));});
    };
    const unsubscribe = subscribeApi(path,options,()=>{
      const cached=peekApi<T>(path,options);
      if(cached!==undefined) { if(active)setSnapshot({key,data:cached}); }
      else if(active)load();
    });
    load();
    let checked=Date.now();
    const focus=()=>{if(document.visibilityState==='visible'&&Date.now()-checked>=30_000){checked=Date.now();load();}};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{active=false;unsubscribe();controller.abort();window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  }, [key, identity, locale]);
  const setData=useCallback((next:T|((old:T)=>T))=>setSnapshot(current=>({key,data:typeof next==='function'?(next as (old:T)=>T)(current.data as T):next})),[key]);
  return {data,loading:!!path&&data===undefined&&!(snapshot.key===key&&snapshot.error),error:snapshot.key===key?snapshot.error||'':'',reload,setData};
}
