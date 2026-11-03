'use client';
import { useEffect, useState } from 'react';
import { useApiResource } from './useApiResource';

export type CatalogRole = { id:string;slug:string;name:string;canonicalName?:string;count?:number };
type Page = {items:CatalogRole[];totalPages:number;page:number};
export function useRoleCatalog(enabled=true,query='') {
  const [needle,setNeedle]=useState(query),[page,setPage]=useState(1),[rows,setRows]=useState<CatalogRole[]>([]);
  useEffect(()=>{if(query===needle)return;const timer=setTimeout(()=>{setNeedle(query);setPage(1);setRows([]);},220);return()=>clearTimeout(timer);},[query]);
  const resource=useApiResource<Page>(enabled?`/meta/job-titles?limit=100&page=${page}&q=${encodeURIComponent(needle)}`:null,{auth:false});
  useEffect(()=>{if(resource.data)setRows(current=>page===1?resource.data!.items:[...current,...resource.data!.items.filter(item=>!current.some(old=>old.id===item.id))]);},[resource.data,page]);
  return {roles:rows,loading:resource.loading,error:!!resource.error,retry:()=>{void resource.reload().catch(()=>{});},hasMore:page<(resource.data?.totalPages||1),loadMore:()=>setPage(value=>value+1)};
}
