import type { CSSProperties } from 'react';

type Direction = 'left' | 'right' | 'up' | 'down';

type Props = {
  direction: Direction;
  variant?: 'chevron' | 'double';
  size?: number;
  className?: string;
  style?: CSSProperties;
};

export function DirectionalIcon({ direction, variant = 'chevron', size = 18, className, style }: Props) {
  return (
    <svg
      className={className ? `direction-icon ${className}` : 'direction-icon'}
      data-direction={direction}
      data-variant={variant}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <rect width="24" height="24" fill="currentColor" stroke="none" />
    </svg>
  );
}
