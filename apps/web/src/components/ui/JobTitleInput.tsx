'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import s from './JobTitleInput.module.css';

type Suggestion = { id: string; name: string; label: string; slug: string; usageCount?: number };
type JobTitleCatalog = {
  items: Array<{ id: string; name: string; canonicalName?: string; slug: string; count?: number }>;
  totalPages: number;
};

const PAGE_SIZE = 24;

type JobTitleInputProps = {
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  id?: string;
  focusSuggestions?: boolean;
  name?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  /** Controlled value (when set, overrides internal state). */
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** Prefill experience level when seniority words are typed and level is empty */
  onInferredLevel?: (level: string) => void;
  onPick?: (value: string) => void;
  normalizeSeniority?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmitValue?: (value: string) => void;
};

const SENIORITY_TOKEN_RE =
  /\b(?:junior|senior|mid(?:dle)?(?:[-\s]?level)?|entry(?:[-\s]?level)?|principal|staff|intern(?:ship)?|jr\.?|sr\.?)(?=\s|[|/(),-]|$)/gi;

const LEVEL_MAP: Record<string, string> = {
  intern: 'INTERN',
  internship: 'INTERN',
  junior: 'JUNIOR',
  jr: 'JUNIOR',
  entry: 'JUNIOR',
  entrylevel: 'JUNIOR',
  mid: 'MIDDLE',
  middle: 'MIDDLE',
  midlevel: 'MIDDLE',
  senior: 'SENIOR',
  sr: 'SENIOR',
  principal: 'SENIOR',
  staff: 'SENIOR',
};

/** Soft UX: strip seniority from display title + infer level (matches API title-resolve). */
export function softNormalizeJobTitle(raw: string): { roleTitle: string; inferredLevel: string | null } {
  let s = raw.trim().replace(/[\u2013\u2014/]/g, '-').replace(/\s+/g, ' ');
  let inferred: string | null = null;

  const takeLevel = (token: string) => {
    const key = token
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[-\s]/g, '');
    if (!inferred && LEVEL_MAP[key]) inferred = LEVEL_MAP[key];
  };

  // Drop parentheses that only contain seniority: "(Senior)", "(Jr.)"
  s = s.replace(/\(\s*([^)]+?)\s*\)/g, (_m, inner: string) => {
    const innerText = String(inner).trim();
    SENIORITY_TOKEN_RE.lastIndex = 0;
    const without = innerText
      .replace(SENIORITY_TOKEN_RE, (token) => {
        takeLevel(token);
        return ' ';
      })
      .replace(/\s+/g, ' ')
      .trim();
    return without ? ` (${without}) ` : ' ';
  });

  SENIORITY_TOKEN_RE.lastIndex = 0;
  s = s.replace(SENIORITY_TOKEN_RE, (token) => {
    takeLevel(token);
    return ' ';
  });
  s = s
    .replace(/\(\s*\)/g, '')
    .replace(/^\.+\s*|\s*\.+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-,|/]+|[\s\-,|/]+$/g, '')
    .trim();

  return { roleTitle: s || raw.trim(), inferredLevel: inferred };
}

export function JobTitleInput({
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  id,
  focusSuggestions = true,
  name = 'title',
  required,
  minLength = 3,
  defaultValue = '',
  value: controlledValue,
  onValueChange,
  placeholder,
  onInferredLevel,
  onPick,
  normalizeSeniority = true,
  autoFocus,
  disabled,
  onSubmitValue,
}: JobTitleInputProps) {
  const { t, locale } = useI18n();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{left:number;top?:number;bottom?:number;width:number;maxHeight:number} | null>(null);
  const [inner, setInner] = useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : inner;
  const setValue = (next: string) => {
    if (controlledValue === undefined) setInner(next);
    onValueChange?.(next);
  };
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  useLayoutEffect(() => {
    if (!suggestions.length || (focusSuggestions && !isOpen)) { setPosition(null); return; }
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom, flip = below < 220 && rect.top > below;
      setPosition({left:Math.max(8,rect.left),width:Math.min(rect.width,window.innerWidth-16),maxHeight:Math.max(120,Math.min(300,(flip?rect.top:below)-16)),...(flip?{bottom:window.innerHeight-rect.top+6}:{top:rect.bottom+6})});
    };
    place(); window.addEventListener('scroll',place,true); window.addEventListener('resize',place);
    return () => {window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};
  }, [suggestions.length, isOpen, focusSuggestions]);
  useEffect(() => { if (highlight >= 0) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({block:'nearest'}); }, [highlight,listId]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (disabled || (focusSuggestions && !isOpen)) {
      setSuggestions([]);
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      return;
    }
    setSuggestions([]);
    setHighlight(-1);
    setPage(1);
    setTotalPages(1);
    setLoading(true);
    setLoadFailed(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    debounceRef.current = setTimeout(() => {
      const q = value.trim();
      api<JobTitleCatalog>(
        `/meta/job-titles?limit=${PAGE_SIZE}&page=1${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { auth: false },
      )
        .then((result) => {
          if (requestId !== requestIdRef.current) return;
          setSuggestions((result?.items || []).map((item) => ({
            id: item.id,
            name: item.canonicalName || item.name,
            label: item.name,
            slug: item.slug,
            usageCount: item.count,
          })));
          setTotalPages(result?.totalPages || 1);
          setHighlight(-1);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setSuggestions([]);
            setLoadFailed(true);
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 220);
    return () => {
      requestIdRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, focusSuggestions, isOpen, locale, disabled]);

  async function loadNextPage() {
    if (loadingMoreRef.current || loading || page >= totalPages) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    const requestId = requestIdRef.current;
    const q = value.trim();
    try {
      const result = await api<JobTitleCatalog>(
        `/meta/job-titles?limit=${PAGE_SIZE}&page=${nextPage}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { auth: false },
      );
      if (requestId !== requestIdRef.current) return;
      setSuggestions((current) => [
        ...current,
        ...(result?.items || []).map((item) => ({
          id: item.id,
          name: item.canonicalName || item.name,
          label: item.name,
          slug: item.slug,
          usageCount: item.count,
        })),
      ]);
      setPage(nextPage);
      setTotalPages(result?.totalPages || 1);
    } catch {
      // Keep the loaded catalog visible; a later scroll can retry the next page.
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  function pick(s: Suggestion) {
    setValue(s.name);
    onPick?.(s.name);
    setSuggestions([]);
    if (focusSuggestions) setIsOpen(false);
  }

  function onChange(next: string) {
    requestIdRef.current += 1;
    loadingMoreRef.current = false;
    setSuggestions([]);
    setLoadingMore(false);
    if (focusSuggestions) setIsOpen(true);
    setValue(next);
    const { inferredLevel } = normalizeSeniority ? softNormalizeJobTitle(next) : { inferredLevel: null };
    if (inferredLevel) onInferredLevel?.(inferredLevel);
  }

  function onBlur() {
    if (focusSuggestions) {
      requestIdRef.current += 1;
      loadingMoreRef.current = false;
      setIsOpen(false);
      setSuggestions([]);
      setLoading(false);
      setLoadingMore(false);
    }
    const { roleTitle, inferredLevel } = normalizeSeniority ? softNormalizeJobTitle(value) : { roleTitle: value, inferredLevel: null };
    if (roleTitle !== value.trim()) setValue(roleTitle);
    if (inferredLevel) onInferredLevel?.(inferredLevel);
  }

  return (
    <div className="job-title-input">
      <input
        ref={inputRef}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        id={id}
        autoFocus={autoFocus}
        disabled={disabled}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onFocus={() => { if (focusSuggestions) setIsOpen(true); }}
        required={required}
        minLength={minLength}
        maxLength={focusSuggestions ? 160 : undefined}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={(suggestions.length > 0 || loading) && (!focusSuggestions || isOpen)}
        aria-controls={listId}
        aria-activedescendant={suggestions[highlight] ? `${listId}-${highlight}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            if (focusSuggestions) setIsOpen(true);
            e.preventDefault();
            const next = Math.min(highlight + 1, suggestions.length - 1);
            setHighlight(next);
            if (next === suggestions.length - 1 && page < totalPages) void loadNextPage();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
            e.preventDefault();
            pick(suggestions[highlight]);
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && onSubmitValue) {
            e.preventDefault();
            onSubmitValue(value);
          } else if (e.key === 'Escape') {
            if (focusSuggestions) { e.preventDefault(); e.stopPropagation(); setIsOpen(false); }
            setSuggestions([]);
          }
        }}
      />
      {loading && suggestions.length === 0 && (!focusSuggestions || isOpen) && (
        <div className="lookup-suggest-skel" role="status" aria-live="polite">
          {t('jobTitleLoading')}
        </div>
      )}
      {loadFailed && (!focusSuggestions || isOpen) && (
        <div className="lookup-suggest-skel" role="alert">{t('jobTitleLoadError')}</div>
      )}
      {!loading && !loadFailed && value.trim() && suggestions.length === 0 && (!focusSuggestions || isOpen) && (
        <div className="lookup-suggest-skel" role="status">{t('jobTitleNoMatches')}</div>
      )}
      {suggestions.length > 0 && position && createPortal(
        <ul
          id={listId}
          role="listbox"
          className={s.panel}
          style={{...position,position:'fixed',zIndex:10050,margin:0,overflowY:'auto'}}
          onScroll={(event) => {
            const list = event.currentTarget;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - 32) void loadNextPage();
          }}
        >
          {suggestions.map((suggestion, i) => (
            <li key={suggestion.id}>
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={highlight === i}
                className={s.option}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(suggestion)}
              >
                <span className={s.label}>{suggestion.label}
                {suggestion.label !== suggestion.name && <small className={s.canonical}>{suggestion.name}</small>}</span>
                {typeof suggestion.usageCount === 'number' ? (
                  <span className={s.count}>
                    {suggestion.usageCount}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {loadingMore && (
            <li role="presentation" className="muted" style={{ padding: '0.6rem', textAlign: 'center' }}>
              {t('jobTitleLoadingMore')}
            </li>
          )}
        </ul>, inputRef.current?.closest('dialog') || document.body
      )}
    </div>
  );
}
