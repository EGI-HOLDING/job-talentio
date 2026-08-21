'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE'] as const;

export function cefrToneClass(level?: string | null) {
  return `cefr-${String(level || 'B1').toLowerCase()}`;
}

type Props = {
  name: string;
  level: string;
  optional?: boolean;
  levelOptions?: readonly string[];
  onLevelChange?: (level: string) => void;
  onRemove?: () => void;
};

export function LanguageChip({
  name,
  level,
  optional,
  levelOptions = CEFR_LEVELS,
  onLevelChange,
  onRemove,
}: Props) {
  const { t } = useI18n();
  const tone = cefrToneClass(level);
  const menuId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="lang-chip">
      <span className="lang-chip-body">
        <span className="lang-chip-name">{name}</span>
        {optional ? <span className="lang-chip-optional">{t('optional')}</span> : null}
      </span>
      {onLevelChange ? (
        <span className="lang-chip-level-wrap">
          <button
            type="button"
            className={`cefr lang-chip-cefr ${tone}`}
            aria-label={t('emp.levelFor').replace('{name}', name)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            {level}
          </button>
          {open ? (
            <span id={menuId} className="lang-chip-menu" role="listbox" aria-label={t('minLevel')}>
              {levelOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={opt === level}
                  className={`cefr lang-chip-menu-opt ${cefrToneClass(opt)}${opt === level ? ' is-selected' : ''}`}
                  onClick={() => {
                    onLevelChange(opt);
                    setOpen(false);
                  }}
                >
                  {opt}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      ) : (
        <span className={`cefr ${tone}`}>{level}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          className="ghost lang-chip-remove"
          onClick={onRemove}
          aria-label={t('ui.removeLanguage').replace('{name}', name)}
        >
          x
        </button>
      ) : null}
    </span>
  );
}
