'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { BrowsePage, DirectoryStatus } from '@/components/public/BrowsePage';
import s from '@/components/public/PublicPages.module.css';
import { ExploreCityCard } from '@/components/explore/ExploreCityCard';
type City = { name: string; slug: string; province?: { name: string; slug: string; country?: { name: string; slug: string } } };
export default function ExploreCitiesPage() {
  const { t, locale } = useI18n();
  const [cities, setCities] = useState<City[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'country' | 'province' | 'alpha'>('country');
  const [onlyHiring, setOnlyHiring] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    Promise.all([api<City[]>('/meta/cities', { auth:false, signal:controller.signal }), api<{facets?:{cities?:Array<{slug:string;count:number}>}}>('/jobs?limit=1&sort=newest', {auth:false,signal:controller.signal})])
      .then(([items,response]) => { if (!controller.signal.aborted) { setCities(items); setCounts(Object.fromEntries((response.facets?.cities || []).map((item) => [item.slug,item.count]))); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[locale,retry]);
  const sections = useMemo(() => {
    const groups = new Map<string,{title:string; cities:City[]}>();
    const term = query.trim().toLocaleLowerCase();
    const filtered = cities.filter((city) => (!onlyHiring || (counts[city.slug] || 0) > 0) && (!term || [city.name,city.province?.name,city.province?.country?.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(term)));
    filtered.sort((a,b) => mode === 'alpha' ? a.name.localeCompare(b.name,locale) : (counts[b.slug] || 0) - (counts[a.slug] || 0) || a.name.localeCompare(b.name,locale));
    for (const city of filtered) {
      const province = city.province;
      const key = mode === 'country' ? province?.country?.slug || 'other' : mode === 'alpha' ? city.name.charAt(0).toLocaleUpperCase() : [province?.country?.slug,province?.slug || 'other'].filter(Boolean).join(':');
      const title = mode === 'country' ? province?.country?.name || t('landing.allLocations') : mode === 'alpha' ? key : [province?.country?.name,province?.name || t('exploreCitiesOtherProvince')].filter(Boolean).join(' / ');
      if (!groups.has(key)) groups.set(key,{title,cities:[]});
      groups.get(key)!.cities.push(city);
    }
    return [...groups.values()];
  },[cities,counts,query,onlyHiring,mode,locale,t]);
  return <BrowsePage title={t('exploreCitiesTitle')}>
    <div className={s.controls}><label className={s.search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('public.searchCities')} aria-label={t('public.searchCities')} /></label><label className={s.check}><input type="checkbox" checked={onlyHiring} onChange={(event) => setOnlyHiring(event.target.checked)} />{t('public.onlyHiring')}</label></div>
    <div className={s.toggle}><button type="button" aria-pressed={mode === 'country'} onClick={() => setMode('country')}>{t('public.byCountry')}</button><button type="button" aria-pressed={mode === 'province'} onClick={() => setMode('province')}>{t('exploreCitiesByProvince')}</button><button type="button" aria-pressed={mode === 'alpha'} onClick={() => setMode('alpha')}>{t('exploreCitiesAlphabetical')}</button></div>
    {loading || error || !sections.length ? <DirectoryStatus onReset={() => { setQuery(''); setOnlyHiring(true); setMode('country'); }} loading={loading} error={error} onRetry={() => setRetry((v) => v + 1)} /> : sections.map((section) => <section className={s.group} key={section.title}><h2>{section.title}</h2><div className={s.grid}>{section.cities.map((city) => <ExploreCityCard key={city.slug} name={city.name} slug={city.slug} count={counts[city.slug] || 0} countLabel={t('openRolesCount').replace('{n}',String(counts[city.slug] || 0))} />)}</div></section>)}
  </BrowsePage>;
}
