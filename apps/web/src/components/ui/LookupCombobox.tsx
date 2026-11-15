'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { benefitIconLabel } from '@/lib/icons';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useI18n } from '@/lib/i18n';
import { floatingPanelPosition, type FloatingPanelPosition } from './floatingPanelPosition';

export type LookupSuggestion = {
  id: string;
  name: string;
  slug: string;
  code?: string;
  aliases?: string[];
  usageCount?: number;
  icon?: string | null;
  provinceLabel?: string;
};

type LookupKind = 'benefits' | 'languages' | 'cities';

type LookupComboboxProps = {
  focusSuggestions?: boolean;
  kind: LookupKind;
  onPick: (item: {
    slug: string;
    name: string;
    code?: string;
    isNew?: boolean;
    level?: string;
  }) => void | Promise<void>;
  /** Extra field (skill/language level) */
  levelOptions?: Array<{ value: string; label: string }>;
  levelName?: string;
  defaultLevel?: string;
  allowCreate?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  placeholder?: string;
  excludedCodes?: readonly string[];
  keepOpenOnPick?: boolean;
};

const SUGGEST_PATH: Record<LookupKind, string> = {
  benefits: '/meta/benefits/suggest',
  languages: '/meta/languages/suggest',
  cities: '/meta/cities/suggest',
};

const KIND_LABEL_KEY: Record<LookupKind, string> = {
  benefits: 'benefits',
  languages: 'languages',
  cities: 'city',
};

const KIND_SINGULAR_KEY: Record<LookupKind, string> = {
  benefits: 'lookupKindBenefit',
  languages: 'lookupKindLanguage',
  cities: 'lookupKindCity',
};

export function LookupCombobox({
  focusSuggestions = false,
  kind,
  onPick,
  levelOptions,
  levelName = 'level',
  defaultLevel,
  allowCreate = true,
  disabled,
  submitLabel,
  placeholder,
  excludedCodes = [],
  keepOpenOnPick = false,
}: LookupComboboxProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const listId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const levelRef = useRef<HTMLSelectElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ term: string; items: LookupSuggestion[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<FloatingPanelPosition | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const languagePicker = kind === 'languages';
  const term = query.trim();
  const suggestions = results?.term === term
    ? results.items.filter(row => !excludedCodes.includes(row.code || row.slug))
    : [];

  useEffect(() => {
    const abort = new AbortController();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (focusSuggestions && !isOpen) { setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    debounceRef.current = setTimeout(() => {
      api<LookupSuggestion[]>(
        `${SUGGEST_PATH[kind]}?take=${languagePicker ? 250 : 10}${term ? `&q=${encodeURIComponent(term)}` : ''}`,
        { auth: false, signal: abort.signal },
      )
        .then((rows) => {
          if (abort.signal.aborted) return;
          setResults({ term, items: rows || [] });
          setHighlight(-1);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          setResults(null);
          setFailed(true);
        })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 220);
    return () => {
      abort.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, kind, languagePicker, focusSuggestions, isOpen]);

  const showSuggestions = !loading && suggestions.length > 0 && (!focusSuggestions || isOpen);
  useLayoutEffect(() => {
    if (!showSuggestions) { setPosition(null); return; }
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setPosition(floatingPanelPosition(rect, 240));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [showSuggestions]);
  useLayoutEffect(() => {
    if (showSuggestions && highlight >= 0) {
      panelRef.current?.querySelectorAll('[role=option]')[highlight]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, showSuggestions]);

  useEffect(() => {
    if (!focusSuggestions || !isOpen) return;
    const closeWhenOutside = (event: Event) => {
      const target = event.target as Node;
      if (!inputRef.current?.contains(target) && !panelRef.current?.contains(target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('focusin', closeWhenOutside);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('focusin', closeWhenOutside);
    };
  }, [focusSuggestions, isOpen]);

  function currentLevel() {
    if (!levelOptions?.length) return defaultLevel;
    return String(levelRef.current?.value || defaultLevel || '');
  }

  const exact = suggestions.find(
    (s) =>
      s.name.toLowerCase() === query.trim().toLowerCase() ||
      s.slug === query.trim().toLowerCase() ||
      s.code?.toLowerCase() === query.trim().toLowerCase() ||
      (s.aliases || []).some((a) => a.toLowerCase() === query.trim().toLowerCase()),
  );
  const canCreate = allowCreate && !languagePicker && term.length >= 2 && !exact && !loading && results?.term === term;

  async function choose(item: LookupSuggestion) {
    if (disabled || loading) return;
    if (focusSuggestions && !keepOpenOnPick) {
      setIsOpen(false);
      setResults(null);
    }
    setHighlight(-1);
    setStatus(languagePicker ? item.name : t('skillMatched').replace('{name}', item.name));
    setQuery('');
    await onPick({
      slug: item.slug,
      name: item.name,
      code: item.code || (kind === 'languages' ? item.slug : undefined),
      isNew: false,
      level: currentLevel(),
    });
    if (keepOpenOnPick) requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submitPick() {
    if (disabled || loading) return;
    const level = currentLevel();
    if (languagePicker) {
      const selected = suggestions[highlight] ?? exact ?? (term && suggestions.length === 1 ? suggestions[0] : null);
      if (selected) await choose(selected);
      return;
    }

    if (exact) {
      await choose(exact);
      return;
    }
    if (highlight >= 0 && suggestions[highlight]) {
      await choose(suggestions[highlight]);
      return;
    }
    if (!canCreate) {
      setStatus(t('skillPickOrType'));
      return;
    }
    const name = query.trim();
    const kindLabel = t(KIND_SINGULAR_KEY[kind]);
    const ok = await confirm({
      title: t('confirmAddLookupTitle').replace('{kind}', kindLabel),
      message: t('confirmAddLookup'),
      highlight: name,
      tone: 'create',
      confirmLabel: submitLabel || t('addSkill'),
    });
    if (!ok) return;
    setStatus(t('skillCreating').replace('{name}', name));
    setQuery('');
    await onPick({ slug: '', name, isNew: true, level });
  }

  return (
    <div className="form-stack skill-combobox">
      <label>
        <span className="sr-only">{t(KIND_LABEL_KEY[kind])}</span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls={showSuggestions ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showSuggestions && suggestions[highlight] ? `${listId}-opt-${highlight}` : undefined}
          autoComplete="off"
          value={query}
          disabled={disabled}
          placeholder={placeholder || t(languagePicker ? 'languageSearchPlaceholder' : 'skillSearchPlaceholder')}
          onChange={(e) => { setQuery(e.target.value); setHighlight(-1); if (focusSuggestions) setIsOpen(true); }}
          onFocus={() => { if (focusSuggestions) setIsOpen(true); }}
          onClick={() => { if (focusSuggestions) setIsOpen(true); }}
          onBlur={() => {
            if (!focusSuggestions) return;
            window.setTimeout(() => {
              const active = document.activeElement;
              if (!inputRef.current?.contains(active) && !panelRef.current?.contains(active)) setIsOpen(false);
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIsOpen(true);
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Escape') {
              if (focusSuggestions && isOpen) { e.preventDefault(); e.stopPropagation(); setIsOpen(false); }
              setResults(null);
              setHighlight(-1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              void submitPick();
            }
          }}
        />
      </label>
      {!languagePicker && loading && suggestions.length === 0 && (
        <div className="lookup-suggest-skel" aria-hidden>
          <span className="skel skel-line" />
          <span className="skel skel-line short" />
        </div>
      )}
      {showSuggestions && position && createPortal(
        <ul
          ref={panelRef}
          id={listId}
          role="listbox"
          className="skill-suggest-list"
          style={{
            ...position,
            position: 'fixed',
            zIndex: 10050,
            boxSizing: 'border-box',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            background: '#fff',
            boxShadow: '0 12px 32px #17213a26',
            borderRadius: 8,
            padding: 5,
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <button
                type="button"
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={highlight === i}
                className={`skill-suggest-item ${highlight === i ? 'active' : ''}`}
                onMouseDown={(event) => { if (focusSuggestions) event.preventDefault(); }}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(s)}
              >
                <span>
                  {kind === 'benefits' ? benefitIconLabel(s.slug, s.icon) : ''}
                  {s.name}
                  {kind === 'cities' && s.provinceLabel ? (
                    <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                      {s.provinceLabel}
                    </span>
                  ) : null}
                </span>
                {!languagePicker && s.usageCount !== undefined && (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {s.usageCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>,
        inputRef.current?.closest('dialog,[role=dialog]') || document.body,
      )}
      {languagePicker && isOpen && (failed || (!loading && results?.term === term && !suggestions.length)) && (
        <p className="muted" role="status">{t(failed ? 'ew.loadFailed' : 'languageNoResults')}</p>
      )}
      {canCreate && (
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          {t('skillNoMatchAdd').replace('{name}', query.trim())}
        </p>
      )}
      {levelOptions && levelOptions.length > 0 && (
        <label>
          <span className="sr-only">{t('ui.level')}</span>
          <select ref={levelRef} name={levelName} defaultValue={defaultLevel} disabled={disabled}>
            {levelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!languagePicker && <button
        type="button"
        disabled={disabled || (!query.trim() && highlight < 0)}
        onClick={() => void submitPick()}
      >
        {submitLabel || t('addSkill')}
      </button>}
      <p id={statusId} className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
