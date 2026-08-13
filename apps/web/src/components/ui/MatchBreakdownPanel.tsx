'use client';

import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';

export type MatchBreakdownData = {
  skills?: number;
  title?: number;
  experience?: number;
  location?: number;
  education?: number;
  language?: number;
  total?: number;
  details?: {
    matchedSkills?: string[];
    missingRequiredSkills?: string[];
    matchedLanguages?: string[];
    missingRequiredLanguages?: string[];
  } | null;
};

type Props = {
  breakdown: MatchBreakdownData;
  className?: string;
  style?: CSSProperties;
  /** Show matched/missing skill chips (candidate-style). Default true. */
  showSkillChips?: boolean;
};

const ROWS = [
  ['skills', 'skills'],
  ['ui.matchRole', 'title'],
  ['experience', 'experience'],
  ['ui.location', 'location'],
  ['education', 'education'],
  ['language', 'language'],
] as const;

export function MatchBreakdownPanel({
  breakdown,
  className = '',
  style,
  showSkillChips = true,
}: Props) {
  const { t } = useI18n();
  const details = breakdown.details;
  const matchedLang = details?.matchedLanguages || [];
  const missingLang = details?.missingRequiredLanguages || [];
  const matchedSkills = details?.matchedSkills || [];
  const missingSkills = details?.missingRequiredSkills || [];

  return (
    <div className={`match-breakdown ${className}`.trim()} style={style}>
      {ROWS.map(([labelKey, key]) => {
        const value = Math.round(Number(breakdown[key]) || 0);
        return (
          <div key={key} className="match-breakdown-row">
            <span className="muted">{t(labelKey)}</span>
            <div className="match-breakdown-track">
              <i style={{ width: `${value}%` }} />
            </div>
            <span>{value}</span>
          </div>
        );
      })}
      {(matchedLang.length > 0 || missingLang.length > 0) && (
        <p className="muted" style={{ fontSize: '0.75rem', margin: '0.4rem 0 0' }}>
          {matchedLang.length ? `${t('ui.matchOk')}: ${matchedLang.join(', ')}` : ''}
          {missingLang.length
            ? `${matchedLang.length ? ' | ' : ''}${t('ui.matchMissing')}: ${missingLang.join(', ')}`
            : ''}
        </p>
      )}
      {showSkillChips && matchedSkills.length > 0 && (
        <div className="chips" style={{ marginTop: '0.65rem' }}>
          {matchedSkills.map((s) => (
            <span key={s} className="badge skill">
              {s}
            </span>
          ))}
        </div>
      )}
      {showSkillChips && missingSkills.length > 0 && (
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          {t('ui.matchMissingRequired')}: {missingSkills.join(', ')}
        </p>
      )}
    </div>
  );
}
