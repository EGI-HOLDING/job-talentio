import { PlanCode } from '@prisma/client';

export type SubscriptionLike = {
  plan?: PlanCode | string | null;
  status?: string | null;
  endsAt?: Date | string | null;
};

export const subscriptionPlanSelect = {
  plan: true,
  status: true,
  endsAt: true,
} as const;

/** Paid entitlements stop when the row is not ACTIVE or `endsAt` is in the past. */
export function effectivePlan(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date(),
): PlanCode {
  if (!sub?.plan) return PlanCode.FREE;
  if (sub.status && sub.status !== 'ACTIVE') return PlanCode.FREE;
  if (sub.endsAt) {
    const ends = sub.endsAt instanceof Date ? sub.endsAt : new Date(sub.endsAt);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime()) {
      return PlanCode.FREE;
    }
  }
  return sub.plan as PlanCode;
}
