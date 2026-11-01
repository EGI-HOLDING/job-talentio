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

type LookupKind = 'skills' | 'benefits' | 'languages' | 'cities';

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
};

const SUGGEST_PATH: Record<LookupKind, string> = {
  skills: '/meta/skills/suggest',
  benefits: '/meta/benefits/suggest',
  languages: '/meta/languages/suggest',
  cities: '/meta/cities/suggest',
};

const KIND_LABEL_KEY: Record<LookupKind, string> = {
  skills: 'skills',
  benefits: 'benefits',
  languages: 'languages',
  cities: 'city',
};

const KIND_SINGULAR_KEY: Record<LookupKind, string> = {
  skills: 'lookupKindSkill',
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
}: LookupComboboxProps) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const listId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const levelRef = useRef<HTMLSelectElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LookupSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<FloatingPanelPosition | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (focusSuggestions && !isOpen) { setLoading(false); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const q = query.trim();
      api<LookupSuggestion[]>(
        `${SUGGEST_PATH[kind]}?take=10${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { auth: false },
      )
        .then((rows) => {
          if (!active) return;
          setSuggestions(rows || []);
          setHighlight(-1);
        })
        .catch(() => { if (active) setSuggestions([]); })
        .finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => {
      active = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, kind, focusSuggestions, isOpen]);

  const showSuggestions = suggestions.length > 0 && (!focusSuggestions || isOpen);
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
  const canCreate = allowCreate && query.trim().length >= 2 && !exact && !loading;

  async function choose(item: LookupSuggestion) {
    if (focusSuggestions) { setIsOpen(false); setSuggestions([]); }
    setStatus(t('skillMatched').replace('{name}', item.name));
    setQuery('');
    await onPick({
      slug: item.slug,
      name: item.name,
      code: item.code || (kind === 'languages' ? item.slug : undefined),
      isNew: false,
      level: currentLevel(),
    });
  }

  async function submitPick() {
    if (disabled) return;
    const level = currentLevel();

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
          aria-expanded={suggestions.length > 0 && (!focusSuggestions || isOpen)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
          autoComplete="off"
          value={query}
          disabled={disabled}
          placeholder={placeholder || t('skillSearchPlaceholder')}
          onChange={(e) => { setQuery(e.target.value); if (focusSuggestions) setIsOpen(true); }}
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
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Escape') {
              if (focusSuggestions) { e.preventDefault(); e.stopPropagation(); setIsOpen(false); }
              setSuggestions([]);
              setHighlight(-1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              void submitPick();
            }
          }}
        />
      </label>
      {loading && suggestions.length === 0 && (
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
                {s.usageCount !== undefined && (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {s.usageCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>,
        inputRef.current?.closest('dialog') || document.body,
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
      <button
        type="button"
        disabled={disabled || (!query.trim() && highlight < 0)}
        onClick={() => void submitPick()}
      >
        {submitLabel || t('addSkill')}
      </button>
      <p id={statusId} className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
