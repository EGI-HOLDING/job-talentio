/**
 * Canonical company industry taxonomy (UZ-adapted, Work.ua-style groups).
 * Single source of truth for seed + deploy backfill.
 */

export type IndustryGroupDef = {
  slug: string;
  name: string;
  sortOrder: number;
  industries: Array<{ slug: string; name: string; sortOrder: number }>;
};

export const INDUSTRY_GROUPS: IndustryGroupDef[] = [
  {
    slug: 'services-non-manufacturing',
    name: 'Services and non-manufacturing',
    sortOrder: 0,
    industries: [
      { slug: 'auto-business', name: 'Auto business and auto service', sortOrder: 0 },
      { slug: 'beauty-fitness-sports', name: 'Beauty, fitness, sports', sortOrder: 1 },
      {
        slug: 'construction-architecture-design',
        name: 'Construction, architecture, interior design',
        sortOrder: 2,
      },
      {
        slug: 'consulting-accounting-audit',
        name: 'Consulting, accounting and auditing',
        sortOrder: 3,
      },
      { slug: 'design', name: 'Design', sortOrder: 4 },
      { slug: 'education-science', name: 'Education and science', sortOrder: 5 },
      {
        slug: 'finance-banking-insurance',
        name: 'Finance, banking, and insurance',
        sortOrder: 6,
      },
      { slug: 'hospitality-restaurants', name: 'Hotel and restaurant industry', sortOrder: 7 },
      { slug: 'it', name: 'IT', sortOrder: 8 },
      { slug: 'legal', name: 'Legal', sortOrder: 9 },
      { slug: 'marketing-advertising-pr', name: 'Marketing, advertising, and PR', sortOrder: 10 },
      { slug: 'media', name: 'Media', sortOrder: 11 },
      { slug: 'medicine-pharmacy', name: 'Medicine, pharmacy', sortOrder: 12 },
      { slug: 'public-business-services', name: 'Public and business services', sortOrder: 13 },
      { slug: 'publishing-printing', name: 'Publishing house, printing', sortOrder: 14 },
      { slug: 'recruiting-hr', name: 'Recruiting and HR', sortOrder: 15 },
      { slug: 'security', name: 'Security, guarding', sortOrder: 16 },
      { slug: 'arts-entertainment', name: 'Show business, art and entertainment', sortOrder: 17 },
      { slug: 'telecom-networking', name: 'Telecommunications and networking', sortOrder: 18 },
      { slug: 'tourism', name: 'Tourism', sortOrder: 19 },
      { slug: 'transportation-logistics', name: 'Transportation and logistics', sortOrder: 20 },
    ],
  },
  {
    slug: 'sales-trade',
    name: 'Sales and trade',
    sortOrder: 1,
    industries: [
      { slug: 'real-estate', name: 'Real estate', sortOrder: 0 },
      { slug: 'retail', name: 'Retail', sortOrder: 1 },
      {
        slug: 'wholesale-distribution',
        name: 'Wholesale, distribution, imports, and exports',
        sortOrder: 2,
      },
    ],
  },
  {
    slug: 'manufacturing-industry',
    name: 'Manufacturing and industry',
    sortOrder: 2,
    industries: [
      { slug: 'agriculture-agribusiness', name: 'Agriculture, agribusiness', sortOrder: 0 },
      {
        slug: 'chemicals-pharma-manufacturing',
        name: 'Chemical industry, pharmaceuticals',
        sortOrder: 1,
      },
      {
        slug: 'construction-materials-woodworking',
        name: 'Construction industry and woodworking',
        sortOrder: 2,
      },
      { slug: 'food-industry', name: 'Food industry', sortOrder: 3 },
      { slug: 'light-industry', name: 'Light industry', sortOrder: 4 },
      { slug: 'mechanical-engineering', name: 'Mechanical engineering', sortOrder: 5 },
      { slug: 'metals-metalworking', name: 'Metallurgical industry, metalworking', sortOrder: 6 },
      { slug: 'mining', name: 'Mining industry', sortOrder: 7 },
      { slug: 'power-energy', name: 'Power industry', sortOrder: 8 },
      { slug: 'manufacturing-general', name: 'Manufacturing (general)', sortOrder: 9 },
    ],
  },
  {
    slug: 'other',
    name: 'Other',
    sortOrder: 3,
    industries: [
      { slug: 'government-public-sector', name: 'Government organizations', sortOrder: 0 },
      { slug: 'non-profit', name: 'Non-profit and charitable organizations', sortOrder: 1 },
      { slug: 'other', name: 'Other', sortOrder: 2 },
    ],
  },
];

/** Legacy Industry.slug → canonical slug (company.industry remap). */
export const LEGACY_INDUSTRY_SLUG_MAP: Record<string, string> = {
  it: 'it',
  fintech: 'finance-banking-insurance',
  ecommerce: 'retail',
  telecom: 'telecom-networking',
  banking: 'finance-banking-insurance',
  education: 'education-science',
  healthcare: 'medicine-pharmacy',
  manufacturing: 'manufacturing-general',
  logistics: 'transportation-logistics',
  media: 'media',
};

/** Demo / staging company.slug → industry slug (corrects mislabels). */
export const COMPANY_INDUSTRY_OVERRIDES: Record<string, string> = {
  'demo-tech-tashkent': 'it',
  'tashkent-soft-labs': 'it',
  'nukus-smart-city': 'it',
  'uzpay-fintech': 'finance-banking-insurance',
  'clickpay-solutions': 'finance-banking-insurance',
  'orient-bank': 'finance-banking-insurance',
  'tashkent-legal': 'legal',
  'silk-road-commerce': 'retail',
  'caravan-marketplace': 'retail',
  'fergana-logistics': 'transportation-logistics',
  'edunest-uz': 'education-science',
  'medicare-it': 'it',
  'chirchiq-pharma': 'medicine-pharmacy',
  'navoi-engineering': 'mechanical-engineering',
  'andijan-agrotech': 'agriculture-agribusiness',
  'namangan-textile': 'light-industry',
  'khorezm-green': 'power-energy',
  'uztelecom-digital': 'telecom-networking',
  'samarkand-digital': 'media',
  'bukhara-heritage': 'hospitality-restaurants',
  'hadith-hotel': 'hospitality-restaurants',
  'kampoeng-indonesia': 'hospitality-restaurants',
  '7oz-espresso': 'hospitality-restaurants',
  'saji-nusantara': 'hospitality-restaurants',
};

export function allIndustrySlugs(): string[] {
  return INDUSTRY_GROUPS.flatMap((g) => g.industries.map((i) => i.slug));
}

export function retiredLegacySlugs(): string[] {
  const canonical = new Set(allIndustrySlugs());
  return Object.keys(LEGACY_INDUSTRY_SLUG_MAP).filter((s) => !canonical.has(s));
}
