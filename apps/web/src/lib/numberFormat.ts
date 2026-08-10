/** Thousand separator for money/integers - always "." (e.g. 1.299.000). */

export function formatThousands(
  value: number | string | null | undefined,
  sep = '.',
): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseThousands(String(value));
  if (n === null || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const digits = Math.trunc(Math.abs(n)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return neg ? `-${grouped}` : grouped;
}

/** Strip formatting; return integer or null if empty/invalid. */
export function parseThousands(raw: string): number | null {
  if (!raw || !String(raw).trim()) return null;
  const cleaned = String(raw).replace(/[^\d-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '--') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function formatUzs(n: number | null | undefined, suffix = ' UZS'): string {
  if (n == null || !Number.isFinite(n)) return '';
  return `${formatThousands(n)}${suffix}`;
}

export function formatSalaryRange(
  min?: number | null,
  max?: number | null,
  currency = 'UZS',
): string {
  if (min == null && max == null) return '';
  if (min != null && max != null) {
    return `${formatThousands(min)} - ${formatThousands(max)} ${currency}`;
  }
  if (min != null) return `from ${formatThousands(min)} ${currency}`;
  return `up to ${formatThousands(max!)} ${currency}`;
}

/**
 * Compact homepage / marketing counters so large volumes stay short in the UI
 * (e.g. 1284 → "1.2K+", 1500000 → "1.5M+"). Exact under 1,000.
 */
export function formatCompactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '0';
  const n = Math.floor(value);
  if (n < 1000) return String(n);
  if (n < 10_000) {
    const tenths = Math.floor(n / 100) / 10;
    const label = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
    return `${label}K+`;
  }
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K+`;
  if (n < 10_000_000) {
    const tenths = Math.floor(n / 100_000) / 10;
    const label = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
    return `${label}M+`;
  }
  if (n < 1_000_000_000) return `${Math.floor(n / 1_000_000)}M+`;
  return `${Math.floor(n / 1_000_000_000)}B+`;
}
