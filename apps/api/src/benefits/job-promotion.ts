import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { JobPromotion } from '@job-talentio/shared';

export type PromotionBenefit = {
  code?: string;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  policySnapshot?: unknown;
  boosts: ReadonlyArray<{ startsAt: Date; endsAt: Date }>;
};

/** All readers use the same effective window, including the search projection. */
export function resolveJobPromotion(status: string, benefit: PromotionBenefit | null | undefined, enabled: boolean, now: Date) {
  const future = [benefit?.startsAt, benefit?.expiresAt, ...(benefit?.boosts ?? []).flatMap(b => [b.startsAt, b.endsAt])]
    .filter((at): at is Date => Boolean(at && at > now));
  const windowActive = Boolean(enabled && status === 'PUBLISHED' && benefit?.startsAt && benefit.startsAt <= now
    && (!benefit.expiresAt || benefit.expiresAt > now));
  const packageCode = windowActive && ['STANDARD', 'PREMIUM'].includes(benefit?.code ?? '') ? benefit!.code! : 'FREE';
  const value = (benefit?.policySnapshot as { visibility?: number } | null)?.visibility;
  const visibility = windowActive && typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : 1;
  const boost = windowActive ? benefit?.boosts.find(b => b.startsAt <= now && b.endsAt > now) ?? null : null;
  const publicState: JobPromotion = {
    active: packageCode !== 'FREE' || visibility > 1 || Boolean(boost),
    boostActive: Boolean(boost),
    revalidateAt: enabled && status === 'PUBLISHED' && future.length ? new Date(Math.min(...future.map(at => at.getTime()))).toISOString() : null,
  };
  return { publicState, packageCode, visibility, boost };
}

export type PromotionBatch = {
  available: boolean;
  enabled: boolean;
  rows: Map<string, ReturnType<typeof resolveJobPromotion>>;
};
export async function loadJobPromotions(db: Pick<PrismaClient, 'featureFlag' | 'jobBenefit'>, ids: string[], now: Date): Promise<PromotionBatch> {
  const rows: PromotionBatch['rows'] = new Map();
  try {
    const flags = await db.featureFlag.findMany({ where: { key: { in: ['hr_packages', 'hr_promotions'] } }, select: { key: true, enabled: true } });
    const enabled = ['hr_packages', 'hr_promotions'].every(key => flags.some(flag => flag.key === key && flag.enabled));
    for (const id of ids) rows.set(id, resolveJobPromotion('PUBLISHED', null, enabled, now));
    if (enabled && ids.length) {
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const benefits = await db.jobBenefit.findMany({ where: { jobId: { in: ids.slice(offset, offset + 1000) } }, select: {
          jobId: true, code: true, startsAt: true, expiresAt: true, policySnapshot: true,
          job: { select: { status: true } },
          boosts: { where: { endsAt: { gt: now } }, orderBy: { startsAt: 'desc' }, select: { startsAt: true, endsAt: true } },
        } });
        for (const benefit of benefits) rows.set(benefit.jobId, resolveJobPromotion(benefit.job.status, benefit, enabled, now));
      }
    }
    return { available: true, enabled, rows };
  } catch (error) {
    new Logger('JobPromotion').warn('Promotion state unavailable; retaining organic ordering: ' + (error instanceof Error ? error.message : 'unknown error'));
    return { available: false, enabled: false, rows: new Map() };
  }
}

export function publicJobPromotion(batch: PromotionBatch, id: string) {
  const promotion = batch.available ? batch.rows.get(id)?.publicState ?? null : null;
  return { promotion, isPromoted: promotion?.active ?? false };
}
