'use client';

import { useI18n } from '@/lib/i18n';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  score: number | null | undefined;
  size?: Size;
  className?: string;
  label?: string;
};

const SIZE_PX: Record<Size, number> = { sm: 44, md: 56, lg: 72 };
const STROKE_PX: Record<Size, number> = { sm: 4, md: 5, lg: 6 };

function clampScore(score: number | null | undefined): number {
  if (score == null || Number.isNaN(Number(score))) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(score))));
}

function toneFor(score: number): 'high' | 'mid' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

/** Circular match score with a filled arc and centered percentage label. */
export function MatchRing({ score, size = 'md', className = '', label }: Props) {
  const { t } = useI18n();
  const value = clampScore(score);
  const tone = toneFor(value);
  const title = label ? `${label}: ${value}%` : `${t('match')} ${value}%`;
  const dim = SIZE_PX[size];
  const stroke = STROKE_PX[size];
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - value / 100);
  const center = dim / 2;

  return (
    <div
      className={`match-ring match-ring--${size} match-ring--${tone} ${className}`.trim()}
      role="img"
      aria-label={title}
      title={title}
    >
      <svg
        className="match-ring-svg"
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        aria-hidden
      >
        <circle
          className="match-ring-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="match-ring-progress"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="match-ring-label">
        <span className="match-ring-value">{value}</span>
        <span className="match-ring-unit">%</span>
      </span>
    </div>
  );
}
