'use client';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  score: number | null | undefined;
  size?: Size;
  className?: string;
  label?: string;
};

function clampScore(score: number | null | undefined): number {
  if (score == null || Number.isNaN(Number(score))) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(score))));
}

function toneFor(score: number): 'high' | 'mid' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

/** Circular match score with a filled arc proportional to the percentage. */
export function MatchRing({ score, size = 'md', className = '', label }: Props) {
  const value = clampScore(score);
  const tone = toneFor(value);
  const title = label ? `${label}: ${value}%` : `Match ${value}%`;

  return (
    <div
      className={`match-ring match-ring--${size} match-ring--${tone} ${className}`.trim()}
      style={{ ['--score' as string]: value }}
      role="img"
      aria-label={title}
      title={title}
    >
      <span className="match-ring-inner">
        <span className="match-ring-value">{value}</span>
        <span className="match-ring-unit">%</span>
      </span>
    </div>
  );
}
