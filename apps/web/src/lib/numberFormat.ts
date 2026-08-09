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
