'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Suggestion = { id: string; name: string; slug: string; usageCount?: number };

type JobTitleInputProps = {
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
  name = 'title',
  required,
  minLength = 3,
  defaultValue = '',
  value: controlledValue,
  onValueChange,
  placeholder,
  onInferredLevel,
}: JobTitleInputProps) {
  const listId = useId();
  const [inner, setInner] = useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : inner;
  const setValue = (next: string) => {
    if (controlledValue === undefined) setInner(next);
    onValueChange?.(next);
  };
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
    const { inferredLevel } = softNormalizeJobTitle(next);
    if (inferredLevel) onInferredLevel?.(inferredLevel);
  }

  function onBlur() {
    const { roleTitle, inferredLevel } = softNormalizeJobTitle(value);
    if (roleTitle !== value.trim()) setValue(roleTitle);
    if (inferredLevel) onInferredLevel?.(inferredLevel);
  }

  return (
    <div className="job-title-input">
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
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
