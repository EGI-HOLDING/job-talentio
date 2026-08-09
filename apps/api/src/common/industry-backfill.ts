import { PrismaClient } from '@prisma/client';
import {
  COMPANY_INDUSTRY_OVERRIDES,
  INDUSTRY_GROUPS,
  LEGACY_INDUSTRY_SLUG_MAP,
  allIndustrySlugs,
  retiredLegacySlugs,
} from './industry-catalog';

type Db = Pick<PrismaClient, 'industryGroup' | 'industry' | 'company'>;

export type IndustryBackfillResult = {
  groupsUpserted: number;
  industriesUpserted: number;
  companiesRemapped: number;
  industriesRetired: number;
};

export async function needsIndustryBackfill(db: Db): Promise<boolean> {
  const [groupCount, industryCount, retiredOnCompanies] = await Promise.all([
    db.industryGroup.count(),
    db.industry.count({ where: { slug: { in: allIndustrySlugs() } } }),
    db.company.count({
      where: { industry: { slug: { in: retiredLegacySlugs() } } },
    }),
  ]);
  if (groupCount < INDUSTRY_GROUPS.length) return true;
  if (industryCount < allIndustrySlugs().length) return true;
  if (retiredOnCompanies > 0) return true;

  const overrideEntries = Object.entries(COMPANY_INDUSTRY_OVERRIDES);
  if (overrideEntries.length) {
    const mismatched = await db.company.count({
      where: {
        OR: overrideEntries.map(([companySlug, industrySlug]) => ({
          slug: companySlug,
          NOT: { industry: { slug: industrySlug } },
        })),
      },
    });
    if (mismatched > 0) return true;
  }
  return false;
}

/** Idempotent: upsert catalog, remap companies, delete empty legacy industries. */
export async function backfillIndustries(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<IndustryBackfillResult> {
  const log = opts?.log ?? (() => undefined);
  let groupsUpserted = 0;
  let industriesUpserted = 0;
  let companiesRemapped = 0;

  const groupIdBySlug = new Map<string, string>();

  for (const g of INDUSTRY_GROUPS) {
    const row = await db.industryGroup.upsert({
      where: { slug: g.slug },
      update: { name: g.name, sortOrder: g.sortOrder },
      create: { name: g.name, slug: g.slug, sortOrder: g.sortOrder },
    });
    groupIdBySlug.set(g.slug, row.id);
    groupsUpserted += 1;
  }

  const industryIdBySlug = new Map<string, string>();
  for (const g of INDUSTRY_GROUPS) {
    const groupId = groupIdBySlug.get(g.slug)!;
    for (const ind of g.industries) {
      const row = await db.industry.upsert({
        where: { slug: ind.slug },
        update: { name: ind.name, sortOrder: ind.sortOrder, groupId },
        create: {
          name: ind.name,
          slug: ind.slug,
          sortOrder: ind.sortOrder,
          groupId,
        },
      });
      industryIdBySlug.set(ind.slug, row.id);
      industriesUpserted += 1;
    }
  }

  // Company-slug overrides first (demo corrections)
  for (const [companySlug, industrySlug] of Object.entries(COMPANY_INDUSTRY_OVERRIDES)) {
    const industryId = industryIdBySlug.get(industrySlug);
    if (!industryId) continue;
    const updated = await db.company.updateMany({
      where: { slug: companySlug, NOT: { industryId } },
      data: { industryId },
    });
    companiesRemapped += updated.count;
  }

  // Legacy industry slug remap for remaining companies
  for (const [fromSlug, toSlug] of Object.entries(LEGACY_INDUSTRY_SLUG_MAP)) {
    if (fromSlug === toSlug) continue;
    const from = await db.industry.findUnique({ where: { slug: fromSlug } });
    const toId = industryIdBySlug.get(toSlug);
    if (!from || !toId) continue;
    const updated = await db.company.updateMany({
      where: { industryId: from.id },
      data: { industryId: toId },
    });
    companiesRemapped += updated.count;
  }

  // Retire empty legacy industries (not in catalog)
  const canonical = new Set(allIndustrySlugs());
  const obsolete = await db.industry.findMany({
    where: { slug: { notIn: [...canonical] } },
    select: { id: true, slug: true, _count: { select: { companies: true } } },
  });
  let industriesRetired = 0;
  for (const row of obsolete) {
    if (row._count.companies > 0) {
      log(`Industry ${row.slug} still has ${row._count.companies} companies - skip delete`);
      continue;
    }
    await db.industry.delete({ where: { id: row.id } });
    industriesRetired += 1;
  }

  log(
    `Industries: groups=${groupsUpserted} industries=${industriesUpserted} remapped=${companiesRemapped} retired=${industriesRetired}`,
  );

  return { groupsUpserted, industriesUpserted, companiesRemapped, industriesRetired };
}
