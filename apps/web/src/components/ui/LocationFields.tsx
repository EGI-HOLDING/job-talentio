'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LabelText } from './Field';
import s from './LocationFields.module.css';

type Country = { id: string; name: string; iso2: string; currencyCode?: string | null };
export type LocationCity = { slug: string; name: string; aliases?: { alias: string }[]; province?: { name: string; country?: { id?: string; iso2?: string; name?: string } } };
type Props = {
  countryId: string; citySlug: string;
  onChange: (value: { countryId: string; citySlug: string; currencyCode?: string; label?: string }) => void;
  initialCity?: LocationCity | null;
  countryError?: string; cityError?: string;
  required?: boolean; cityRequired?: boolean; allowGlobal?: boolean;
};
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f‘’'`ʻʼ]/g, '').toLocaleLowerCase();

/** Shared country-first picker. All selectable locations come from the API. */
export function LocationFields({ countryId, citySlug, onChange, initialCity, countryError, cityError, required, cityRequired, allowGlobal }: Props) {
  const { t, locale } = useI18n();
  const id = useId();
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<LocationCity[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const control = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const global = countryId === '__WORLDWIDE__';
  const selected = cities.find(city => city.slug === citySlug) || (initialCity?.slug === citySlug ? initialCity : null);
  const options = cities.filter(city => normalize([city.name, city.province?.name, ...(city.aliases || []).map(a => a.alias)].join(' ')).includes(normalize(text)));
  const country = countries.find(item => item.id === countryId);
  const label = country?.iso2 === 'ID' ? t('geo.cityRegency') : t('city');

  useEffect(() => {
    const abort = new AbortController();
    setFailure('');
    api<Country[]>('/meta/countries', { auth: false, signal: abort.signal }).then(setCountries).catch(reason => { if (!abort.signal.aborted) setFailure(reason.message); });
    return () => abort.abort();
  }, [locale, reload]);
  useEffect(() => {
    setCities([]); setOpen(false); setText(''); setFailure('');
    if (!countryId || global) { setLoading(false); return; }
    const abort = new AbortController();
    setLoading(true);
    api<LocationCity[]>('/meta/cities?country=' + encodeURIComponent(countryId), { auth: false, signal: abort.signal })
      .then(setCities).catch(reason => { if (!abort.signal.aborted) setFailure(reason.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [countryId, global, locale, reload]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = control.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const flip = below < 240 && rect.top > below;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), width: Math.min(rect.width, window.innerWidth - 16), maxHeight: Math.max(120, Math.min(320, (flip ? rect.top : below) - 16)), ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!control.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { setOpen(false); setText(''); } };
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, id]);
  function choose(city: LocationCity) { onChange({ countryId, citySlug: city.slug, label: [city.name,country?.name].filter(Boolean).join(', ') }); setText(''); setOpen(false); control.current?.focus(); }
  return <div className={s.fields}>
    <div className={s.field}>
      <label htmlFor={`${id}-country`}><LabelText required={required} optional={false}>{t('geo.country')}</LabelText></label>
      <select id={`${id}-country`} name="countryId" value={countryId} aria-invalid={Boolean(countryError)} aria-describedby={countryError ? `${id}-country-error` : undefined} onChange={event => { onChange({ countryId: event.target.value, citySlug: '', label: countries.find(item => item.id === event.target.value)?.name || '', currencyCode: countries.find(item => item.id === event.target.value)?.currencyCode || undefined }); setText(''); setOpen(false); }}>
        <option value="">{t('geo.selectCountry')}</option>
        {countries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {allowGlobal && <option value="__WORLDWIDE__">{t('geo.worldwide')}</option>}
      </select>
      {countryError && <span id={`${id}-country-error`} className={s.error} role="alert">{countryError}</span>}
    </div>
    <div className={s.field}>
      <label htmlFor={`${id}-city`}><LabelText required={cityRequired} optional={false}>{label}</LabelText></label>
      <input ref={control} id={`${id}-city`} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined} aria-invalid={Boolean(cityError)} aria-describedby={cityError ? `${id}-city-error` : undefined} disabled={!countryId || global || loading} placeholder={loading ? t('loading') : !countryId ? t('geo.chooseCountryFirst') : global ? t('geo.cityNotRequired') : t('geo.searchCity')} value={open ? text : selected ? `${selected.name}${selected.province?.name ? ' - ' + selected.province.name : ''}` : text} onFocus={() => { setText(''); setActive(0); setOpen(true); }} onChange={event => { setText(event.target.value); setActive(0); setOpen(true); if (citySlug) onChange({ countryId, citySlug: '', label: country?.name || '' }); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
        else if (event.key === 'Enter' && open) { event.preventDefault(); if (options[active]) choose(options[active]); }
        else if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); setText(''); }
      }} />
      <input type="hidden" name="citySlug" value={citySlug} />
      {citySlug && <button type="button" className={s.clear} onClick={() => { onChange({ countryId, citySlug: '', label: country?.name || '' }); setText(''); }}>{t('geo.clearCity')}</button>}
      {cityError && <span id={`${id}-city-error`} className={s.error} role="alert">{cityError}</span>}
    </div>
    {failure && <div className={s.failure} role="alert">{t('geo.loadFailed')} <button type="button" onClick={() => setReload(value => value + 1)}>{t('workspace.retry')}</button></div>}
    {open && position && createPortal(<div ref={panel} id={`${id}-options`} role="listbox" aria-label={label} className={s.options} style={position}>
      {options.map((city, index) => <div key={city.slug} id={`${id}-option-${index}`} role="option" aria-selected={citySlug === city.slug} className={s.option} data-active={active === index} onMouseDown={event => event.preventDefault()} onPointerMove={event => { if (event.pointerType === 'mouse') setActive(index); }} onClick={() => choose(city)}><strong>{city.name}</strong><span>{city.province?.name}</span></div>)}
      {!options.length && <p className={s.empty}>{t('geo.noCities')}</p>}
    </div>, control.current?.closest('dialog') || document.body)}
  </div>;
}
