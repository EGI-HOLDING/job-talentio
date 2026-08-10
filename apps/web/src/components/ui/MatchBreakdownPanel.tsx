import type { CSSProperties } from 'react';

export type MatchBreakdownData = {
  skills?: number;
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
  ['Skills', 'skills'],
  ['Experience', 'experience'],
  ['Location', 'location'],
  ['Education', 'education'],
  ['Language', 'language'],
] as const;

export function MatchBreakdownPanel({
  breakdown,
  className = '',
  style,
  showSkillChips = true,
}: Props) {
  const details = breakdown.details;
  const matchedLang = details?.matchedLanguages || [];
  const missingLang = details?.missingRequiredLanguages || [];
  const matchedSkills = details?.matchedSkills || [];
  const missingSkills = details?.missingRequiredSkills || [];

  return (
    <div className={`match-breakdown ${className}`.trim()} style={style}>
      {ROWS.map(([label, key]) => {
        const value = Math.round(Number(breakdown[key]) || 0);
        return (
          <div key={key} className="match-breakdown-row">
            <span className="muted">{label}</span>
            <div className="match-breakdown-track">
              <i style={{ width: `${value}%` }} />
            </div>
            <span>{value}</span>
          </div>
        );
      })}
      {(matchedLang.length > 0 || missingLang.length > 0) && (
        <p className="muted" style={{ fontSize: '0.75rem', margin: '0.4rem 0 0' }}>
          {matchedLang.length ? `OK: ${matchedLang.join(', ')}` : ''}
          {missingLang.length
            ? `${matchedLang.length ? ' | ' : ''}Missing: ${missingLang.join(', ')}`
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
          Missing required: {missingSkills.join(', ')}
        </p>
      )}
    </div>
  );
}
