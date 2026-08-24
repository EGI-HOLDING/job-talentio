import { createHash } from 'crypto';

/** Lowercase + trim; strips Gmail-style dots/plus for common providers when checking dupes. */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return trimmed;

  const aliases = new Set(['gmail.com', 'googlemail.com']);
  if (aliases.has(domain)) {
    const withoutPlus = local.split('+')[0] ?? local;
    const withoutDots = withoutPlus.replace(/\./g, '');
    return `${withoutDots}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('998') && !digits.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('8') && digits.length >= 10) return `+998${digits.slice(1)}`;
  return digits;
}

/** Collapse punctuation/spacing so "Senior React Dev!" ≈ "senior react dev". */
export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёўғқҳ\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яёўғқҳ\s]+/gi, ' ')
    .replace(/\b(llc|ltd|inc|ooo|мчж|мчж\.|ООО)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTextContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function jobFingerprint(input: {
  title: string;
  workMode: string;
  cityId?: string | null;
}): string {
  return sha256(
    `${normalizeJobTitle(input.title)}|${input.workMode}|${input.cityId ?? 'none'}`,
  );
}

export function contentHash(description: string): string {
  return sha256(normalizeTextContent(description));
}

export function titlesNearlyIdentical(a: string, b: string): boolean {
  const na = normalizeJobTitle(a);
  const nb = normalizeJobTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Containment for near-dupes like "Senior React Developer" vs "Senior React Developer (Tashkent)"
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter >= 12 && shorter / longer >= 0.85;
  }
  return false;
}

/** Statuses that the unique fingerprint index treats as one live opening. */
export const ACTIVE_JOB_DUPLICATE_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED'] as const;

const FORGED_FINGERPRINT_RE = /^([a-f0-9]{64})(?::[a-z0-9]{1,16})?$/i;

/**
 * Strip a backfill-forged `:idSlice` suffix. Returns the 64-hex prefix when the
 * stored value looks like a SHA-256 (optionally suffixed); otherwise the trimmed
 * original (or null).
 */
export function canonicalStoredFingerprint(
  fingerprint: string | null | undefined,
): string | null {
  if (!fingerprint) return null;
  const trimmed = fingerprint.trim();
  if (!trimmed) return null;
  const match = trimmed.match(FORGED_FINGERPRINT_RE);
  return match ? match[1].toLowerCase() : trimmed;
}

const STATUS_RANK: Record<string, number> = {
  PUBLISHED: 0,
  PAUSED: 1,
  DRAFT: 2,
};

export type ActiveJobDedupeSnapshot = {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  title: string;
  workMode: string;
  cityId: string | null;
  cityName: string | null;
  status: string;
  fingerprint: string | null;
  contentHash: string | null;
  createdAt: Date;
  applicationCount: number;
};

export type DuplicateClass = 'A' | 'B' | 'C' | 'D';

export type DuplicateGroup = {
  class: DuplicateClass;
  key: string;
  winnerId: string;
  jobs: ActiveJobDedupeSnapshot[];
};

export type DuplicateInventory = {
  groups: DuplicateGroup[];
  counts: Record<DuplicateClass, number>;
  /** Unique loser ids across classes A/B/C (D is report-only). */
  jobsToClose: number;
};

export function pickActiveDuplicateWinner<
  T extends {
    id: string;
    status: string;
    applicationCount: number;
    createdAt: Date;
  },
>(rows: T[]): T {
  if (rows.length === 0) {
    throw new Error('pickActiveDuplicateWinner: empty group');
  }
  return [...rows].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 9;
    const rankB = STATUS_RANK[b.status] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    if (b.applicationCount !== a.applicationCount) {
      return b.applicationCount - a.applicationCount;
    }
    const created = b.createdAt.getTime() - a.createdAt.getTime();
    if (created !== 0) return created;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}

function pushBucket(
  map: Map<string, ActiveJobDedupeSnapshot[]>,
  key: string,
  job: ActiveJobDedupeSnapshot,
) {
  const list = map.get(key);
  if (list) list.push(job);
  else map.set(key, [job]);
}

function groupsFromBuckets(
  duplicateClass: DuplicateClass,
  buckets: Map<string, ActiveJobDedupeSnapshot[]>,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const [key, jobs] of buckets) {
    if (jobs.length < 2) continue;
    groups.push({
      class: duplicateClass,
      key,
      winnerId: pickActiveDuplicateWinner(jobs).id,
      jobs,
    });
  }
  return groups;
}

function sameJobIds(a: ActiveJobDedupeSnapshot[], b: ActiveJobDedupeSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((job) => job.id));
  return b.every((job) => ids.has(job.id));
}

function nearTitleComponents(jobs: ActiveJobDedupeSnapshot[]): ActiveJobDedupeSnapshot[][] {
  const n = jobs.length;
  const parent = jobs.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (titlesNearlyIdentical(jobs[i]!.title, jobs[j]!.title)) union(i, j);
    }
  }
  const components = new Map<number, ActiveJobDedupeSnapshot[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = components.get(root);
    if (list) list.push(jobs[i]!);
    else components.set(root, [jobs[i]!]);
  }
  return [...components.values()].filter((group) => group.length > 1);
}

/** Classify every active row. Classes A/B/C are closable; D is report-only. */
export function inventoryActiveJobDuplicates(
  jobs: ActiveJobDedupeSnapshot[],
): DuplicateInventory {
  const liveFp = new Map<string, ActiveJobDedupeSnapshot[]>();
  const storedFp = new Map<string, ActiveJobDedupeSnapshot[]>();
  const exactTitle = new Map<string, ActiveJobDedupeSnapshot[]>();
  const content = new Map<string, ActiveJobDedupeSnapshot[]>();
  const nearBuckets = new Map<string, ActiveJobDedupeSnapshot[]>();

  for (const job of jobs) {
    const cityKey = job.cityId ?? 'none';
    pushBucket(
      liveFp,
      `${job.companyId}|${jobFingerprint({
        title: job.title,
        workMode: job.workMode,
        cityId: job.cityId,
      })}`,
      job,
    );
    const stored = canonicalStoredFingerprint(job.fingerprint);
    if (stored && /^[a-f0-9]{64}$/.test(stored)) {
      pushBucket(storedFp, `${job.companyId}|stored:${stored}`, job);
    }
    pushBucket(
      exactTitle,
      `${job.companyId}|${normalizeJobTitle(job.title)}|${job.workMode}|${cityKey}`,
      job,
    );
    if (job.contentHash) {
      pushBucket(content, `${job.companyId}|${job.contentHash}`, job);
    }
    pushBucket(nearBuckets, `${job.companyId}|${job.workMode}|${cityKey}`, job);
  }

  const liveA = groupsFromBuckets('A', liveFp);
  const storedA = groupsFromBuckets('A', storedFp).filter(
    (stored) => !liveA.some((live) => sameJobIds(live.jobs, stored.jobs)),
  );
  const groups: DuplicateGroup[] = [...liveA, ...storedA, ...groupsFromBuckets('B', exactTitle)];

  for (const [key, bucket] of nearBuckets) {
    if (bucket.length < 2) continue;
    let part = 0;
    for (const component of nearTitleComponents(bucket)) {
      groups.push({
        class: 'C',
        key: `${key}|near:${part}`,
        winnerId: pickActiveDuplicateWinner(component).id,
        jobs: component,
      });
      part += 1;
    }
  }

  groups.push(...groupsFromBuckets('D', content));

  const counts: Record<DuplicateClass, number> = { A: 0, B: 0, C: 0, D: 0 };
  const losers = new Set<string>();
  for (const group of groups) {
    counts[group.class] += 1;
    if (group.class === 'D') continue;
    for (const job of group.jobs) {
      if (job.id !== group.winnerId) losers.add(job.id);
    }
  }

  return { groups, counts, jobsToClose: losers.size };
}

export function formatDuplicateGroup(group: DuplicateGroup): string {
  const winner = group.jobs.find((j) => j.id === group.winnerId) ?? group.jobs[0]!;
  const losers = group.jobs.filter((j) => j.id !== group.winnerId);
  const statuses = group.jobs.map((j) => `${j.id}:${j.status}:apps=${j.applicationCount}`).join(',');
  return (
    `[${group.class}] ${winner.companySlug} "${winner.title}" ${winner.workMode} ` +
    `${winner.cityName ?? 'none'} winner=${winner.id} losers=${losers.map((j) => j.id).join(',')} ` +
    statuses
  );
}
