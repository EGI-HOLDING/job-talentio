import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  DEMO_COMPANY_LOGO_SLUGS,
  demoCompanyLogoKey,
  legacyStaticCompanyLogoPath,
} from './company-logo-map';

type Db = Pick<PrismaClient, 'company'>;

export type DemoLogoUploader = {
  putObject: (
    key: string,
    buffer: Buffer,
    contentType: string,
  ) => Promise<{ key: string; url: string }>;
  publicUrlForKey: (key: string) => string;
};

/** Resolve apps/api/assets/company-logos whether running from src/ or dist/. */
export function demoCompanyLogosAssetsDir(): string {
  const candidates = [
    path.join(__dirname, '../assets/company-logos'), // dist/common → dist/assets (nest assets)
    path.join(__dirname, '../../assets/company-logos'), // src/common → apps/api/assets
    path.join(process.cwd(), 'assets/company-logos'),
    path.join(process.cwd(), 'apps/api/assets/company-logos'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function expectedDemoLogoUrl(uploader: DemoLogoUploader, slug: string): string {
  return uploader.publicUrlForKey(demoCompanyLogoKey(slug));
}

export async function needsCompanyLogoBackfill(
  db: Db,
  uploader: DemoLogoUploader,
): Promise<boolean> {
  const slugs = [...DEMO_COMPANY_LOGO_SLUGS];
  const rows = await db.company.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, logoUrl: true },
  });
  if (!rows.length) return false;
  if (rows.length < slugs.length) return true;
  return rows.some((r) => {
    const expected = expectedDemoLogoUrl(uploader, r.slug);
    const legacy = legacyStaticCompanyLogoPath(r.slug);
    return !r.logoUrl || r.logoUrl === legacy || r.logoUrl !== expected;
  });
}

/**
 * Upload bundled demo PNGs to MinIO/S3 (deterministic keys) and point companies at public URLs.
 * Idempotent.
 */
export async function backfillCompanyLogos(
  db: Db,
  uploader: DemoLogoUploader,
  opts?: { log?: (msg: string) => void; assetsDir?: string },
): Promise<{ updated: number; uploaded: number }> {
  const log = opts?.log ?? (() => undefined);
  const assetsDir = opts?.assetsDir ?? demoCompanyLogosAssetsDir();
  let updated = 0;
  let uploaded = 0;

  for (const slug of DEMO_COMPANY_LOGO_SLUGS) {
    const filePath = path.join(assetsDir, `${slug}.png`);
    if (!existsSync(filePath)) {
      log(`Demo logo missing on disk: ${filePath}`);
      continue;
    }

    const key = demoCompanyLogoKey(slug);
    const buffer = readFileSync(filePath);
    const { url } = await uploader.putObject(key, buffer, 'image/png');
    uploaded += 1;

    const result = await db.company.updateMany({
      where: {
        slug,
        OR: [{ logoUrl: null }, { logoUrl: { not: url } }],
      },
      data: { logoUrl: url },
    });
    updated += result.count;
  }

  log(`Company logos uploaded=${uploaded} dbUpdated=${updated}`);
  return { updated, uploaded };
}
