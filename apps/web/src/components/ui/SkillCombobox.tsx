'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export type SkillSuggestion = {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  usageCount?: number;
};

type SkillComboboxProps = {
  onPick: (skill: {
    slug: string;
    name: string;
    isNew?: boolean;
    level?: string;
  }) => void | Promise<void>;
  levelSelect?: boolean;
  levelName?: string;
  defaultLevel?: string;
  disabled?: boolean;
  submitLabel?: string;
};

export function SkillCombobox({
  onPick,
  levelSelect = true,
  levelName = 'level',
  defaultLevel = 'INTERMEDIATE',
  disabled,
  submitLabel,
}: SkillComboboxProps) {
  const { t } = useI18n();
  const listId = useId();
  const statusId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const q = query.trim();
      api<SkillSuggestion[]>(
        `/meta/skills/suggest?take=10${q ? `&q=${encodeURIComponent(q)}` : ''}`,
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
  }, [query]);

  function currentLevel() {
    if (!levelSelect || !formRef.current) return defaultLevel;
    const fd = new FormData(formRef.current);
    return String(fd.get(levelName) || defaultLevel);
  }

  const exact = suggestions.find(
    (s) =>
      s.name.toLowerCase() === query.trim().toLowerCase() ||
      s.slug === query.trim().toLowerCase() ||
      (s.aliases || []).some((a) => a.toLowerCase() === query.trim().toLowerCase()),
  );
  const canCreate = query.trim().length >= 2 && !exact && !loading;

  async function choose(skill: SkillSuggestion) {
    setStatus(t('skillMatched').replace('{name}', skill.name));
    setQuery('');
    await onPick({
      slug: skill.slug,
      name: skill.name,
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
    if (!window.confirm(t('confirmAddSkill').replace('{name}', name))) {
      return;
    }
    setStatus(t('skillCreating').replace('{name}', name));
    setQuery('');
    await onPick({ slug: '', name, isNew: true, level });
  }

  return (
    <form ref={formRef} className="form-stack skill-combobox" onSubmit={onSubmit}>
      <label>
        <span className="sr-only">{t('skills')}</span>
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
          placeholder={t('skillSearchPlaceholder')}
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
                <span>{s.name}</span>
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
      {levelSelect && (
        <label>
          <span className="sr-only">Level</span>
          <select name={levelName} defaultValue={defaultLevel} disabled={disabled}>
            <option value="BEGINNER">Beginner</option>
            <option value="INTERMEDIATE">Intermediate</option>
            <option value="ADVANCED">Advanced</option>
            <option value="EXPERT">Expert</option>
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
