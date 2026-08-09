import { PrismaClient } from '@prisma/client';
import { COMPANY_LOGO_BY_SLUG } from './company-logo-map';

type Db = Pick<PrismaClient, 'company'>;

export async function needsCompanyLogoBackfill(db: Db): Promise<boolean> {
  const slugs = Object.keys(COMPANY_LOGO_BY_SLUG);
  const rows = await db.company.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, logoUrl: true },
  });
  if (!rows.length) return false;
  return rows.some((r) => {
    const expected = COMPANY_LOGO_BY_SLUG[r.slug];
    return !!expected && r.logoUrl !== expected;
  });
}

/** Idempotent: point demo companies at static /company-logos/<slug>.png paths. */
export async function backfillCompanyLogos(
  db: Db,
  opts?: { log?: (msg: string) => void },
): Promise<{ updated: number }> {
  const log = opts?.log ?? (() => undefined);
  let updated = 0;
  for (const [slug, logoUrl] of Object.entries(COMPANY_LOGO_BY_SLUG)) {
    const result = await db.company.updateMany({
      where: {
        slug,
        OR: [{ logoUrl: null }, { logoUrl: { not: logoUrl } }],
      },
      data: { logoUrl },
    });
    updated += result.count;
  }
  log(`Company logos updated: ${updated}`);
  return { updated };
}
