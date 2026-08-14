import { PlanCode } from '@prisma/client';
import { effectivePlan } from './effective-plan';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function missingOrFreeStaysFree() {
  assert(effectivePlan(null) === PlanCode.FREE, 'no subscription is FREE');
  assert(effectivePlan({ plan: PlanCode.FREE, status: 'ACTIVE' }) === PlanCode.FREE, 'FREE stays FREE');
}

function expiredOrInactiveFallsBack() {
  const now = new Date('2026-08-14T00:00:00.000Z');
  assert(
    effectivePlan({ plan: PlanCode.VIP, status: 'ACTIVE', endsAt: new Date('2026-07-01') }, now) ===
      PlanCode.FREE,
    'past endsAt must not keep VIP limits',
  );
  assert(
    effectivePlan({ plan: PlanCode.PREMIUM, status: 'EXPIRED', endsAt: new Date('2026-12-01') }, now) ===
      PlanCode.FREE,
    'non-ACTIVE status must not keep paid limits',
  );
  assert(
    effectivePlan({ plan: PlanCode.STANDARD, status: 'ACTIVE', endsAt: new Date('2026-09-01') }, now) ===
      PlanCode.STANDARD,
    'future endsAt keeps the paid plan',
  );
  assert(
    effectivePlan({ plan: PlanCode.VIP, status: 'ACTIVE', endsAt: null }, now) === PlanCode.VIP,
    'admin-granted plan with no end date stays paid',
  );
}

missingOrFreeStaysFree();
expiredOrInactiveFallsBack();
console.log('api: effective-plan smoke ok');
