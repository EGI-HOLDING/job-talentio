'use client';

type VipBadgeProps = {
  label?: string;
  className?: string;
};

/** Compact, understated mark for VIP employers. */
export function VipBadge({ label = 'VIP', className }: VipBadgeProps) {
  return (
    <span className={`vip-badge${className ? ` ${className}` : ''}`} title={label}>
      {label}
    </span>
  );
}
