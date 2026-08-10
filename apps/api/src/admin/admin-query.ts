/**
 * Shared pieces of the admin list queries. Every table filters, sorts and pages
 * the same way, so the translation from query string to Prisma lives here once.
 */

export type ListEnvelope<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/** Multi-value filters travel as `a,b,c`; blank entries are dropped. */
export function splitCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Keeps only values the enum actually defines, so an unknown filter narrows to
 * nothing instead of throwing a Prisma error on a hand-edited URL.
 */
export function enumFilter<T extends string>(value: string | undefined, allowed: readonly T[]): T[] {
  const wanted = splitCsv(value);
  if (!wanted.length) return [];
  const set = new Set<string>(allowed);
  return wanted.filter((v): v is T => set.has(v));
}

/** `{ in: [...] }` when something was selected, otherwise no constraint. */
export function inFilter<T extends string>(values: T[]): { in: T[] } | undefined {
  return values.length ? { in: values } : undefined;
}

function parseDate(value?: string): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * A bare `2026-08-12` end date means "through that whole day", which is what an
 * admin picking a date range expects.
 */
export function dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const gte = parseDate(from);
  const rawTo = parseDate(to);
  let lte = rawTo;
  if (rawTo && /^\d{4}-\d{2}-\d{2}$/.test((to ?? '').trim())) {
    lte = new Date(rawTo.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function sinceWindow(window?: string): Date | undefined {
  const ms = window ? WINDOW_MS[window] : undefined;
  return ms ? new Date(Date.now() - ms) : undefined;
}

/** Drops undefined keys so Prisma never sees `field: undefined` in an AND list. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

export function envelope<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): ListEnvelope<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}
