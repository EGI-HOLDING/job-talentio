'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import s from './HeroLocationPicker.module.css';

type City = { slug: string; name: string; country?: string; countrySlug?: string };
type Choice = { value: string; label: string; detail?: string; kind: 'all' | 'country' | 'city' };
type Position = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

function LocationIcon({ globe = false }: { globe?: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {globe ? <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></> : <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.4" /></>}
  </svg>;
}

export function HeroLocationPicker({ cities, value: controlledValue, onChange }: { cities: City[]; value?: string; onChange?: (value: string) => void }) {
  const { t, locale } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [internalValue, setValue] = useState('');
  const value = controlledValue ?? internalValue;
  const [open, setOpen] = useState(false);
  const [catalogCountries, setCatalogCountries] = useState<Array<{slug:string;name:string}>>([]);
  useEffect(() => { const abort = new AbortController(); api<Array<{slug:string;name:string}>>('/meta/countries',{auth:false,signal:abort.signal}).then(setCatalogCountries).catch(()=>undefined); return ()=>abort.abort(); },[locale]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);

  const choices = useMemo<Choice[]>(() => {
    const countries = new Map<string, string>(catalogCountries.map(country => [country.slug,country.name]));
    for (const city of cities) {
      if (city.countrySlug && city.country) countries.set(city.countrySlug, city.country);
    }
    return [
      { value: '', label: t('landing.allLocations'), kind: 'all' },
      ...Array.from(countries, ([slug, name]): Choice => ({ value: `country:${slug}`, label: name, detail: t('landing.allCities'), kind: 'country' })),
      ...cities.map((city): Choice => ({ value: city.slug, label: city.name, detail: city.country, kind: 'city' })),
    ];
  }, [cities, catalogCountries, t]);
  const filtered = choices.filter((choice) =>
    `${choice.label} ${choice.detail || ''}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
  );
  const selected = choices.find((choice) => choice.value === value) || (value ? {
    value, label: value.includes(',') ? t('workspace.locationCount').replace('{n}', String(value.split(',').filter(Boolean).length)) : value,
  } : choices[0]);
  const activeIndex = Math.min(active, filtered.length - 1);

  useEffect(() => { setOpen(false); setQuery(''); }, [locale]);

  useLayoutEffect(() => {
    if (!open) return;
    function placePanel() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportTop = window.visualViewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (window.visualViewport?.height || window.innerHeight);
      const below = viewportBottom - rect.bottom;
      const above = rect.top - viewportTop;
      const flip = below < 300 && above > below;
      const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 32);
      const maxHeight = Math.min(440, Math.max(150, (flip ? above : below) - 24));
      setPosition({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        width,
        maxHeight,
        ...(flip ? { bottom: window.innerHeight - rect.top + 12 } : { top: rect.bottom + 12 }),
      });
    }
    placePanel();
    const frame = requestAnimationFrame(() => input.current?.focus());
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    window.visualViewport?.addEventListener('resize', placePanel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
      window.visualViewport?.removeEventListener('resize', placePanel);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, id, open, query]);

  function show() {
    setQuery('');
    setActive(Math.max(0, choices.findIndex((choice) => choice.value === value)));
    setOpen(true);
  }

  function choose(choice: Choice) {
    setValue(choice.value);
    onChange?.(choice.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive((previous) => Math.max(0, Math.min(filtered.length - 1, previous + direction)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      setOpen(false);
      if (event.shiftKey) trigger.current?.focus();
      else trigger.current?.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }

  return <>
    <input type="hidden" name="location" value={value} />
    <button
      ref={trigger}
      type="button"
      className={s.trigger}
      aria-label={`${t('landing.locationLabel')}: ${selected.label}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? `${id}-panel` : undefined}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}
    >
      <LocationIcon />
      <span className={s.triggerCopy}><span>{t('landing.locationLabel')}</span><strong>{selected.label}</strong></span>
      <svg className={s.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && position && createPortal(
      <div ref={panel} id={`${id}-panel`} className={s.panel} role="dialog" aria-label={t('landing.chooseLocation')} style={position}>
        <div className={s.panelHeading}>{t('landing.chooseLocation')}</div>
        <div className={s.searchField}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input
            ref={input}
            role="combobox"
            aria-label={t('landing.searchLocation')}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${id}-list`}
            aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
            autoComplete="off"
            placeholder={t('landing.searchLocation')}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onInputKeyDown}
          />
        </div>
        <div id={`${id}-list`} role="listbox" aria-label={t('landing.locations')} className={s.options}>
          {(['all', 'country', 'city'] as const).map((kind) => {
            const group = filtered.filter((choice) => choice.kind === kind);
            if (!group.length) return null;
            return <div key={kind} role="group" aria-label={t(kind === 'all' ? 'landing.allLocations' : kind === 'country' ? 'landing.countries' : 'landing.cities')}>
              {kind !== 'all' && <div className={s.groupHeading} aria-hidden="true">{t(kind === 'country' ? 'landing.countries' : 'landing.cities')}</div>}
              {group.map((choice) => {
                const index = filtered.indexOf(choice);
                return <div
                  key={choice.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={value === choice.value}
                  className={`${s.option} ${activeIndex === index ? s.active : ''} ${value === choice.value ? s.selected : ''}`}
                  onPointerMove={(event) => { if (event.pointerType === 'mouse') setActive(index); }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(choice)}
                >
                  <span className={s.optionIcon}><LocationIcon globe={kind !== 'city'} /></span>
                  <span className={s.optionCopy}><strong>{choice.label}</strong>{choice.detail && <span>{choice.detail}</span>}</span>
                  {value === choice.value && <svg className={s.check} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
                </div>;
              })}
            </div>;
          })}
        </div>
        {!filtered.length && <p className={s.empty} role="status">{t('landing.noLocations')}</p>}
      </div>, document.body,
    )}
  </>;
}
