'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  phoneCountryOptions,
  type PhoneDraft,
} from '@job-talentio/shared';
import { useI18n } from '@/lib/i18n';
import { useOnboardingText } from '@/lib/i18n/onboarding';
import s from './PhoneNumberField.module.css';

type Props = {
  value: PhoneDraft;
  onChange: (value: PhoneDraft) => void;
  label: string;
  hint: string;
  error?: string;
  errorCode?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
};

export function phoneErrorText(
  message: string,
  translate: (key: 'phoneRequired' | 'phoneInvalid' | 'phoneCountryCodeRepeated' | 'phoneCountryCodeMismatch' | 'phoneNationalPrefix' | 'phoneDuplicate') => string,
  code?: string,
  dialCode?: string,
): string {
  const value = code || message;
  const keys: Record<string, Parameters<typeof translate>[0]> = {
    PHONE_REQUIRED: 'phoneRequired',
    PHONE_INVALID: 'phoneInvalid',
    PHONE_COUNTRY_CODE_REPEATED: 'phoneCountryCodeRepeated',
    PHONE_COUNTRY_CODE_MISMATCH: 'phoneCountryCodeMismatch',
    PHONE_NATIONAL_PREFIX: 'phoneNationalPrefix',
    PHONE_DUPLICATE: 'phoneDuplicate',
  };
  const key = keys[value];
  if (!key) return message;
  return translate(key).replaceAll('{code}', dialCode || '');
}

export function PhoneNumberField({
  value,
  onChange,
  label,
  hint,
  error,
  errorCode,
  required = false,
  disabled = false,
  autoComplete = 'tel-national',
}: Props) {
  const { locale } = useI18n();
  const text = useOnboardingText();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const countries = useMemo(() => phoneCountryOptions(locale), [locale]);
  const selected =
    countries.find((option) => option.country === value.country) || countries[0];
  const shownError = errorCode
    ? phoneErrorText(errorCode, (key) => text(key), errorCode, selected.dialCode)
    : error;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return countries;
    return countries.filter((option) =>
      `${option.name} ${option.country} ${option.dialCode}`
        .toLocaleLowerCase(locale)
        .includes(needle),
    );
  }, [countries, locale, query]);
  const describedBy = shownError ? `${id}-hint ${id}-error` : `${id}-hint`;

  useEffect(() => {
    if (!open) return;
    queryRef.current?.focus();
    const measure = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (bounds) setMenuAbove(window.innerHeight - bounds.bottom < 310 && bounds.top > 310);
    };
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !filtered[activeIndex]) return;
    document.getElementById(`${id}-country-${filtered[activeIndex].country}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filtered, id, open]);

  function choose(country: string) {
    onChange({ ...value, country });
    setOpen(false);
    setQuery('');
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown' && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
    } else if (event.key === 'ArrowUp' && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].country);
    }
  }

  return (
    <div className={s.field} ref={root}>
      <label className={s.label} htmlFor={`${id}-number`}>
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      <div className={`${s.control} ${shownError ? s.invalid : ''}`}>
        <button
          type="button"
          className={s.countryButton}
          aria-label={`${text('phoneCountry')}: ${selected.name} ${selected.dialCode}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-countries`}
          disabled={disabled}
          onClick={() => {
            setQuery('');
            setActiveIndex(0);
            setOpen((current) => !current);
          }}
        >
          <span className={s.countryName}>{selected.name}</span>
          <strong>{selected.dialCode}</strong>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
        </button>
        <input
          id={`${id}-number`}
          className={s.numberInput}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          value={value.nationalNumber}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(shownError)}
          aria-describedby={describedBy}
          placeholder={text('phoneNumberPlaceholder')}
          onChange={(event) => onChange({ ...value, nationalNumber: event.target.value })}
        />
      </div>
      <p id={`${id}-hint`} className={s.hint}>{value.country === 'ID' ? text('phoneHintIndonesia') : hint}</p>
      {shownError && <p id={`${id}-error`} className={s.error} role="alert">{shownError}</p>}
      {open && (
        <div className={`${s.menu} ${menuAbove ? s.menuAbove : ''}`}>
          <label className={s.srOnly} htmlFor={`${id}-search`}>{text('phoneSearchCountry')}</label>
          <input
            ref={queryRef}
            id={`${id}-search`}
            className={s.search}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-countries`}
            aria-activedescendant={filtered[activeIndex] ? `${id}-country-${filtered[activeIndex].country}` : undefined}
            value={query}
            placeholder={text('phoneSearchCountry')}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleSearchKeyDown}
          />
          <div id={`${id}-countries`} className={s.options} role="listbox" aria-label={text('phoneCountry')}>
            {filtered.map((option, index) => (
              <button
                id={`${id}-country-${option.country}`}
                key={option.country}
                type="button"
                role="option"
                aria-selected={option.country === value.country}
                className={`${s.option} ${index === activeIndex ? s.active : ''}`}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(option.country)}
              >
                <span>{option.name}</span><strong>{option.dialCode}</strong>
              </button>
            ))}
            {!filtered.length && <p className={s.noResults}>{text('phoneNoCountry')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
