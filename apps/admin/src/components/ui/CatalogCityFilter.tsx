'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type City = { slug: string; name: string; province?: { name: string; country?: { slug: string; name: string } } };
export function CatalogCityFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [cities,setCities]=useState<City[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(false),[version,setVersion]=useState(0);
  useEffect(()=>{const abort=new AbortController();setError(false);api<City[]>('/meta/cities',{auth:false,signal:abort.signal}).then(setCities).catch(()=>{if(!abort.signal.aborted)setError(true);});return()=>abort.abort();},[version]);
  const filtered=cities.filter(city=>`${city.name} ${city.province?.name || ''} ${city.province?.country?.name || ''}`.toLowerCase().includes(query.toLowerCase()));
  const options=value&&!filtered.some(city=>city.slug===value)?[...filtered,...cities.filter(city=>city.slug===value)]:filtered;
  return <label>City / country<input type="search" placeholder="Search city or country" value={query} onChange={event=>setQuery(event.target.value)} /><select value={value} onChange={event=>onChange(event.target.value)}><option value="">All locations</option>{value&&!cities.some(city=>city.slug===value)&&<option value={value}>{value} (existing filter)</option>}{options.map(city=><option key={city.slug} value={city.slug}>{city.name} - {city.province?.name}, {city.province?.country?.name}</option>)}</select>{error&&<button type="button" onClick={()=>setVersion(value=>value+1)}>Retry catalog</button>}</label>;
}
