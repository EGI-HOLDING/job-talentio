import { Prisma, type JobPackageCode } from '@prisma/client';

// Publication takes the shared lock before any company lock. Rollout/flag
// activation takes the exclusive lock, so no posting can fall between backfill
// and activation (or start an unlimited period while rollout is staged).
export const HR_PUBLICATION_LOCK = 742159733;
export async function initializePublicationPeriods(db: Prisma.TransactionClient, rolloutAt: Date) {
  const policy = await db.packagePolicy.findFirstOrThrow({
    where: { code: 'FREE' },
    orderBy: { version: 'desc' },
  });
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "JobBenefit" (id,"jobId","companyId",code,"highestCode","policyVersion","policySnapshot","startsAt","expiresAt","candidateGranted","boostGrantedSeconds","featuredGrantedSeconds","createdAt","updatedAt")
    SELECT 'legacy:' || j.id,j.id,j."companyId",'FREE','FREE',${policy.version},${JSON.stringify(policy.settings)}::jsonb,
      GREATEST(COALESCE(j."publishedAt",${rolloutAt}),${rolloutAt}),
      GREATEST(COALESCE(j."publishedAt",${rolloutAt}),${rolloutAt}) + INTERVAL '30 days',0,0,0,NOW(),NOW()
    FROM "JobPost" j WHERE j.status IN ('PUBLISHED','PAUSED')
    ON CONFLICT ("jobId") DO NOTHING`);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "JobPublicationPeriod" (id,"jobId","companyId",cycle,code,"startsAt","expiresAt","policySnapshot","updatedAt")
    SELECT 'period:' || "jobId" || ':' || "publicationCycle","jobId","companyId","publicationCycle","highestCode","startsAt","expiresAt","policySnapshot",NOW()
    FROM "JobBenefit" WHERE "startsAt" IS NOT NULL AND "expiresAt" IS NOT NULL
    ON CONFLICT ("jobId",cycle) DO NOTHING`);
}

export const DAY_MS = 86_400_000;
export type ExposurePolicy = {
  version: number;
  halfLifeDays: number;
  cap: number;
  boostAmplitude: number;
};
export const INITIAL_EXPOSURE: ExposurePolicy = {
  version: 1,
  halfLifeDays: 7,
  cap: 1.8,
  boostAmplitude: 0.4,
};
export async function loadExposurePolicy(db: {
  featureFlag: { findUnique: Function };
}): Promise<ExposurePolicy> {
  const row = await db.featureFlag.findUnique({ where: { key: 'hr_exposure_policy' } });
  const value = row?.payload as ExposurePolicy | undefined;
  return value && value.halfLifeDays > 0 && value.cap >= 1 && value.boostAmplitude >= 0
    ? value
    : INITIAL_EXPOSURE;
}
export type BenefitPolicy = {
  durationDays: number;
  boostDays: number;
  featuredDays: number;
  visibility: number;
  conversions: boolean;
  reports: boolean;
  prioritySupport: boolean;
};
/** Old policy JSON remains in history; retired candidate quotas are never
 * returned as an effective capability or copied into a new grant. */
export function packageSettings(value: unknown): BenefitPolicy {
  const settings = value as BenefitPolicy;
  return {
    durationDays: settings.durationDays,
    boostDays: settings.boostDays,
    featuredDays: settings.featuredDays,
    visibility: settings.visibility,
    conversions: settings.conversions,
    reports: settings.reports,
    prioritySupport: settings.prioritySupport,
  };
}
export const PACKAGE_ORDER: JobPackageCode[] = ['FREE', 'STANDARD', 'PREMIUM'];
// Technical defaults mirrored by the first persisted policy version.
export const INITIAL_POLICIES: Record<JobPackageCode, BenefitPolicy> = {
  FREE: {
    durationDays: 30,
    boostDays: 0,
    featuredDays: 0,
    visibility: 1,
    conversions: false,
    reports: false,
    prioritySupport: false,
  },
  STANDARD: {
    durationDays: 30,
    boostDays: 3,
    featuredDays: 7,
    visibility: 1.15,
    conversions: true,
    reports: false,
    prioritySupport: false,
  },
  PREMIUM: {
    durationDays: 30,
    boostDays: 7,
    featuredDays: 30,
    visibility: 1.3,
    conversions: true,
    reports: true,
    prioritySupport: true,
  },
};

export function exposureLog(
  input: {
    publishedAt: Date | null;
    visibility: number;
    boost?: { startsAt: Date; endsAt: Date } | null;
  },
  now = new Date(),
  policy: ExposurePolicy = INITIAL_EXPOSURE,
): number {
  const origin = input.publishedAt?.getTime() ?? now.getTime();
  const episode = input.boost;
  const progress =
    episode && episode.startsAt <= now && episode.endsAt > now
      ? Math.max(
          0,
          Math.min(
            1,
            1 -
              (now.getTime() - episode.startsAt.getTime()) /
                (episode.endsAt.getTime() - episode.startsAt.getTime()),
          ),
        )
      : 0;
  // Common -now term can be omitted: ordering is identical and non-boosted
  // documents never need a freshness-only rewrite.
  return (
    (origin / (policy.halfLifeDays * DAY_MS)) * Math.LN2 +
    Math.log(Math.min(policy.cap, input.visibility * (1 + policy.boostAmplitude * progress)))
  );
}

export function liveJobWhere(now = new Date()) {
  return {
    status: 'PUBLISHED' as const,
    company: { isBanned: false, anonymizedAt: null },
    OR: [
      { benefit: { is: null } },
      { benefit: { expiresAt: null } },
      { benefit: { expiresAt: { gt: now } } },
    ],
  };
}
