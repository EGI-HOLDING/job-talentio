/** Demo company slugs that have bundled logo PNGs under apps/api/assets/company-logos. */
export const DEMO_COMPANY_LOGO_SLUGS = [
  'demo-tech-tashkent',
  'uzpay-fintech',
  'silk-road-commerce',
  'tashkent-soft-labs',
  'samarkand-digital',
  'orient-bank',
  'fergana-logistics',
  'edunest-uz',
  'medicare-it',
  'navoi-engineering',
  'andijan-agrotech',
  'bukhara-heritage',
  'clickpay-solutions',
  'namangan-textile',
  'uztelecom-digital',
  'khorezm-green',
  'tashkent-legal',
  'caravan-marketplace',
  'nukus-smart-city',
  'chirchiq-pharma',
] as const;

export type DemoCompanyLogoSlug = (typeof DEMO_COMPANY_LOGO_SLUGS)[number];

/**
 * Deterministic MinIO/S3 object key for a demo company logo.
 * Under `public/` so anonymous GetObject works (local mc + Railway bucket policy).
 */
export function demoCompanyLogoKey(slug: string): string {
  return `public/logos/demo/${slug}.png`;
}

/** @deprecated Use demoCompanyLogoKey + storage public URL. Kept for old static-path detection. */
export function legacyStaticCompanyLogoPath(slug: string): string {
  return `/company-logos/${slug}.png`;
}

export function isDemoCompanyLogoSlug(slug: string): boolean {
  return (DEMO_COMPANY_LOGO_SLUGS as readonly string[]).includes(slug);
}
