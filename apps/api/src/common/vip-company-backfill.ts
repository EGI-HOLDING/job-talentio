import { PlanCode, PrismaClient } from '@prisma/client';
import { VIP_DEMO_COMPANY_SLUGS } from '@job-talentio/shared';

type Db = Pick<PrismaClient, 'company' | 'subscription'>;

export async function needsVipDemoBackfill(db: Db): Promise<boolean> {
  const rows = await db.company.findMany({
    where: { slug: { in: [...VIP_DEMO_COMPANY_SLUGS] } },
    select: { slug: true, subscription: { select: { plan: true } } },
  });
  if (rows.length < VIP_DEMO_COMPANY_SLUGS.length) return true;
  return rows.some((r) => r.subscription?.plan !== PlanCode.VIP);
}

/** Idempotent: promote showcase demo companies to VIP plan. */
export async function backfillVipDemoCompanies(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<{ promoted: number }> {
  const log = opts?.log ?? (() => undefined);
  let promoted = 0;
  for (const slug of VIP_DEMO_COMPANY_SLUGS) {
    const company = await db.company.findUnique({
      where: { slug },
      select: { id: true, subscription: { select: { plan: true } } },
    });
    if (!company) {
      log(`VIP demo company missing: ${slug}`);
      continue;
    }
    if (company.subscription?.plan === PlanCode.VIP) continue;
    await db.subscription.upsert({
      where: { companyId: company.id },
      update: { plan: PlanCode.VIP, status: 'ACTIVE' },
      create: {
        companyId: company.id,
        plan: PlanCode.VIP,
        status: 'ACTIVE',
      },
    });
    promoted += 1;
  }
  log(`VIP demo companies promoted: ${promoted}`);
  return { promoted };
}
