/** Pure helpers behind recruiter analytics; kept free of Prisma so they can be smoke-tested. */

export const FUNNEL_STAGES = ['IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED'] as const;

/** Stages that count as "reached at least X" for a funnel bar. */
const STAGE_RANK: Record<string, number> = {
  NEW: 0,
  IN_REVIEW: 1,
  INTERVIEW: 2,
  OFFER: 3,
  HIRED: 4,
  REJECTED: -1,
  WITHDRAWN: -1,
};

export type FunnelCounts = {
  views: number;
  applications: number;
  inReview: number;
  interview: number;
  offer: number;
  hired: number;
  rejected: number;
};

/** Applications that reached a stage also count for every earlier stage. */
export function buildFunnel(views: number, statusCounts: Record<string, number>): FunnelCounts {
  const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  const reached = (minRank: number) =>
    Object.entries(statusCounts).reduce(
      (sum, [status, n]) => sum + ((STAGE_RANK[status] ?? 0) >= minRank ? n : 0),
      0,
    );
  return {
    views,
    applications: total,
    inReview: reached(1),
    interview: reached(2),
    offer: reached(3),
    hired: reached(4),
    rejected: statusCounts.REJECTED ?? 0,
  };
}

export type SourceCount = { source: string; count: number };

/** Null/empty sources are direct visits; anything else is reported as stored. */
export function groupSources(rows: Array<{ source: string | null; count: number }>): SourceCount[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const key = row.source?.trim() || 'direct';
    merged.set(key, (merged.get(key) ?? 0) + row.count);
  }
  return [...merged.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

export type ResponseTimeInput = {
  createdAt: Date;
  status: string;
  /** Earliest pipeline event that moved the application out of NEW, if any. */
  firstResponseAt: Date | null;
};

export type ResponseTimeSummary = {
  /** Median hours from application to first recruiter action; null when nothing was answered yet. */
  medianHours: number | null;
  answered: number;
  /** Still NEW and older than the SLA window. */
  waitingOverSla: number;
};

export function summarizeResponseTimes(
  rows: ResponseTimeInput[],
  now: Date = new Date(),
  slaHours = 48,
): ResponseTimeSummary {
  const hours = rows
    .filter((r) => r.firstResponseAt)
    .map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const median =
    hours.length === 0
      ? null
      : hours.length % 2
        ? hours[(hours.length - 1) / 2]
        : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2;
  const slaCutoff = now.getTime() - slaHours * 3_600_000;
  const waitingOverSla = rows.filter(
    (r) => r.status === 'NEW' && !r.firstResponseAt && r.createdAt.getTime() < slaCutoff,
  ).length;
  return {
    medianHours: median === null ? null : Math.round(median * 10) / 10,
    answered: hours.length,
    waitingOverSla,
  };
}

export type DailyPoint = { day: string; count: number };

/** Counts per calendar day (UTC) for the last `days` days, oldest first, zero-filled. */
export function bucketByDay(dates: Date[], days: number, now: Date = new Date()): DailyPoint[] {
  const points: DailyPoint[] = [];
  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    index.set(key, points.length);
    points.push({ day: key, count: 0 });
  }
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    const at = index.get(key);
    if (at !== undefined) points[at].count += 1;
  }
  return points;
}

/** Percentage of `part` over `whole`, 0 when the base is empty. */
export function conversion(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
