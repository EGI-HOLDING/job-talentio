'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type Parent = { id:string; name:string; slug:string; country?:{name:string} };
export function CatalogParentSelect({ type, label, value, onChange, required=false }: { type:string;label:string;value:string;onChange:(value:string)=>void;required?:boolean }) {
  const [rows,setRows]=useState<Parent[]>([]),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{const abort=new AbortController();setRows([]);setError(false);(async()=>{
    const result:Parent[]=[];let page=1,total=1;
    do {const data=await api<{items:Parent[];total:number}>(`/admin/catalog/type/${type}?limit=100&page=${page}`,{signal:abort.signal});if (!data.items.length) break;result.push(...data.items);total=data.total;page++;}while(result.length<total);
    if(!abort.signal.aborted)setRows(result);
  })().catch(()=>{if(!abort.signal.aborted)setError(true);});return()=>abort.abort();},[type,retry]);
  return <label>{label}<select value={value} required={required} onChange={event=>onChange(event.target.value)}><option value="">{required?'Select '+label:'All'}</option>{value&&!rows.some(row=>row.id===value)&&<option value={value}>{rows.find(row=>row.slug===value)?.name || value}</option>}{rows.map(row=><option key={row.id} value={row.id}>{row.name}{row.country?' - '+row.country.name:''}</option>)}</select>{error&&<button type="button" onClick={()=>setRetry(value=>value+1)}>Retry catalog</button>}</label>;
}
