'use client';

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

  return (
    <span className="lang-chip">
      <span className="lang-chip-name">{name}</span>
      {onLevelChange ? (
        <select
          className={`lang-chip-level ${tone}`}
          value={level}
          aria-label={t('emp.levelFor').replace('{name}', name)}
          onChange={(e) => onLevelChange(e.target.value)}
        >
          {levelOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <span className={`cefr ${tone}`}>{level}</span>
      )}
      {optional ? <span className="lang-chip-optional">{t('optional')}</span> : null}
      {onRemove ? (
        <button
          type="button"
          className="lang-chip-remove"
          onClick={onRemove}
          aria-label={t('ui.removeLanguage').replace('{name}', name)}
        >
          x
        </button>
      ) : null}
    </span>
  );
}
