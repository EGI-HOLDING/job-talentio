export type JobBenefitSummary = {
  packagesEnabled: boolean;
  code: 'FREE' | 'STANDARD' | 'PREMIUM';
  selected: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  boostEnabled: boolean;
  boostRemainingSeconds: number;
  boostEffectiveSeconds: number;
  activeBoost: { startsAt: string; endsAt: string } | null;
};

export type RowJobState = { status: string; publishedAt?: string | null };
export type PackageAction = 'choose' | 'upgrade' | 'renew' | 'view';

export function jobRowPolicy(job: RowJobState, benefit: JobBenefitSummary | null, companyOpen = true, now = Date.now()) {
  const periodExpired = Boolean(benefit?.expiresAt && Date.parse(benefit.expiresAt) <= now);
  const expired = job.status === 'EXPIRED' || periodExpired;
  const status = periodExpired && ['PUBLISHED', 'PAUSED'].includes(job.status) ? 'EXPIRED' : job.status;
  const activeBoost = benefit?.activeBoost && Date.parse(benefit.activeBoost.endsAt) > now ? benefit.activeBoost : null;
  const publicationReady = Boolean(benefit && (!benefit.packagesEnabled || benefit.selected));
  const packageAction: PackageAction | null = !benefit?.packagesEnabled ? null : expired ? 'renew' : !benefit.selected ? 'choose' : benefit.code === 'PREMIUM' ? 'view' : 'upgrade';
  const canBoost = Boolean(benefit?.boostEnabled && companyOpen && status === 'PUBLISHED' && !expired && !activeBoost && benefit.expiresAt && benefit.boostRemainingSeconds > 0 && benefit.boostEffectiveSeconds > 0);
  return {
    status, expired, activeBoost, packageAction, canBoost,
    publicVisible: Boolean(benefit && status === 'PUBLISHED' && !expired && companyOpen),
    boostDetails: Boolean(activeBoost || (benefit?.boostEnabled && benefit.selected && (benefit.boostRemainingSeconds > 0 || benefit.code !== 'FREE'))),
    canReview: companyOpen && !expired && (status === 'DRAFT' || (status === 'CLOSED' && !job.publishedAt)),
    canResume: companyOpen && publicationReady && !expired && status === 'PAUSED',
    canReopen: companyOpen && publicationReady && !expired && status === 'CLOSED' && Boolean(job.publishedAt),
    canPause: companyOpen && status === 'PUBLISHED' && !expired,
    canDuplicate: companyOpen && (['CLOSED', 'EXPIRED'].includes(status) || periodExpired),
    canClose: status !== 'CLOSED',
  };
}

export type JobRowPolicy = ReturnType<typeof jobRowPolicy>;
