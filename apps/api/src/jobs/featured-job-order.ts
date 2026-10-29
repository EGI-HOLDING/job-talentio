export type FeaturedJobCandidate = {
  id: string;
  companyId: string;
  packageCode: string;
  boostActive: boolean;
  publishedAt: Date | null;
};

const PACKAGE_TIERS = ['PREMIUM', 'STANDARD', 'FREE'] as const;

export type FeaturedBenefitWindow = {
  code: string;
  startsAt: Date | null;
  expiresAt: Date | null;
} | null;

export function isFeaturedBenefitActive(benefit: FeaturedBenefitWindow, now: Date) {
  return Boolean(benefit?.startsAt && benefit.startsAt <= now
    && (benefit.expiresAt === null || benefit.expiresAt > now));
}

export function effectiveFeaturedPackageCode(benefit: FeaturedBenefitWindow, now: Date) {
  if (!isFeaturedBenefitActive(benefit, now) || !PACKAGE_TIERS.includes(benefit!.code as (typeof PACKAGE_TIERS)[number])) {
    return 'FREE';
  }
  return benefit!.code;
}

function compareWithinTier(a: FeaturedJobCandidate, b: FeaturedJobCandidate) {
  if (a.boostActive !== b.boostActive) return a.boostActive ? -1 : 1;
  const publishedDelta = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  return publishedDelta || a.id.localeCompare(b.id);
}

/**
 * A higher active package is an absolute placement tier. Within a tier,
 * active boosts lead, then publication recency; company round-robin reduces
 * repetition without ever allowing a lower package to jump ahead.
 */
export function orderFeaturedJobs<T extends FeaturedJobCandidate>(jobs: readonly T[]): T[] {
  const result: T[] = [];

  for (const tier of PACKAGE_TIERS) {
    const tierJobs = jobs.filter((job) => job.packageCode === tier);
    for (const boostActive of [true, false]) {
      const ranked = tierJobs
        .filter((job) => job.boostActive === boostActive)
        .slice()
        .sort(compareWithinTier);
      result.push(...roundRobinCompanies(ranked));
    }
  }

  return result;
}

function roundRobinCompanies<T extends FeaturedJobCandidate>(ranked: readonly T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const job of ranked) {
    const queue = queues.get(job.companyId) ?? [];
    queue.push(job);
    queues.set(job.companyId, queue);
  }

  const companyIds = [...queues.keys()].sort((a, b) => {
    const firstA = queues.get(a)![0];
    const firstB = queues.get(b)![0];
    return compareWithinTier(firstA, firstB) || a.localeCompare(b);
  });
  const result: T[] = [];
  let remaining = ranked.length;
  while (remaining > 0) {
    for (const companyId of companyIds) {
      const next = queues.get(companyId)!.shift();
      if (!next) continue;
      result.push(next);
      remaining -= 1;
    }
  }
  return result;
}
