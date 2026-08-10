'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { benefitIconLabel } from '@/lib/icons';
import { useI18n } from '@/lib/i18n';

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

export function LookupCombobox({
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
  const listId = useId();
  const statusId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LookupSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const q = query.trim();
      api<LookupSuggestion[]>(
        `${SUGGEST_PATH[kind]}?take=10${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { auth: false },
      )
        .then((rows) => {
          setSuggestions(rows || []);
          setHighlight(-1);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, kind]);

  function currentLevel() {
    if (!levelOptions?.length || !formRef.current) return defaultLevel;
    const fd = new FormData(formRef.current);
    return String(fd.get(levelName) || defaultLevel || '');
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
    if (!window.confirm(t('confirmAddLookup').replace('{name}', name).replace('{kind}', kind))) {
      return;
    }
    setStatus(t('skillCreating').replace('{name}', name));
    setQuery('');
    await onPick({ slug: '', name, isNew: true, level });
  }

  return (
    <form ref={formRef} className="form-stack skill-combobox" onSubmit={onSubmit}>
      <label>
        <span className="sr-only">{t(KIND_LABEL_KEY[kind])}</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
          autoComplete="off"
          value={query}
          disabled={disabled}
          placeholder={placeholder || t('skillSearchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Escape') {
              setSuggestions([]);
              setHighlight(-1);
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
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" className="skill-suggest-list">
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <button
                type="button"
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={highlight === i}
                className={`skill-suggest-item ${highlight === i ? 'active' : ''}`}
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
        </ul>
      )}
      {canCreate && (
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          {t('skillNoMatchAdd').replace('{name}', query.trim())}
        </p>
      )}
      {levelOptions && levelOptions.length > 0 && (
        <label>
          <span className="sr-only">{t('ui.level')}</span>
          <select name={levelName} defaultValue={defaultLevel} disabled={disabled}>
            {levelOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={disabled || (!query.trim() && highlight < 0)}>
        {submitLabel || t('addSkill')}
      </button>
      <p id={statusId} className="sr-only" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
