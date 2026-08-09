'use client';

type VipBadgeProps = {
  label?: string;
  className?: string;
};

/** Compact premium mark for VIP employers. */
export function VipBadge({ label = 'VIP', className }: VipBadgeProps) {
  return (
    <span className={`vip-badge${className ? ` ${className}` : ''}`} title={label}>
      <span className="vip-badge__gem" aria-hidden />
      <span className="vip-badge__label">{label}</span>
    </span>
  );
}
