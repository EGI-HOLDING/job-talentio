'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Suggestion = { id: string; name: string; slug: string; usageCount?: number };

type JobTitleInputProps = {
  name?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  placeholder?: string;
  /** Prefill experience level when seniority words are typed and level is empty */
  onInferredLevel?: (level: string) => void;
};

const PREFIX_SENIORITY =
  /^(junior|jr\.?|senior|sr\.?|mid(?:dle)?(?:[-\s]?level)?|entry(?:[-\s]?level)?|principal|staff|intern(?:ship)?)\s+/i;

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

function inferLevel(raw: string): string | null {
  const m = raw.trim().match(PREFIX_SENIORITY) || raw.trim().match(/\s+(intern(?:ship)?)$/i);
  if (!m) return null;
  const key = (m[1] || 'intern').toLowerCase().replace(/\./g, '').replace(/[-\s]/g, '');
  return LEVEL_MAP[key] || null;
}

export function JobTitleInput({
  name = 'title',
  required,
  minLength = 3,
  defaultValue = '',
  placeholder,
  onInferredLevel,
}: JobTitleInputProps) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const q = value.trim();
      api<Suggestion[]>(
        `/meta/job-titles/suggest?take=8${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { auth: false },
      )
        .then((rows) => {
          setSuggestions(rows || []);
          setHighlight(-1);
        })
        .catch(() => setSuggestions([]));
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  function pick(s: Suggestion) {
    setValue(s.name);
    setSuggestions([]);
  }

  function onChange(next: string) {
    setValue(next);
    const level = inferLevel(next);
    if (level) onInferredLevel?.(level);
  }

  return (
    <div className="job-title-input">
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
            e.preventDefault();
            pick(suggestions[highlight]);
          } else if (e.key === 'Escape') {
            setSuggestions([]);
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" className="skill-suggest-list">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={highlight === i}
                className={`skill-suggest-item ${highlight === i ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                {s.name}
                {typeof s.usageCount === 'number' ? (
                  <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                    {s.usageCount}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
