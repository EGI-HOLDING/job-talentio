/** Static web paths for demo company logos (served from apps/web/public). */
export const COMPANY_LOGO_BY_SLUG: Record<string, string> = {
  'demo-tech-tashkent': '/company-logos/demo-tech-tashkent.png',
  'uzpay-fintech': '/company-logos/uzpay-fintech.png',
  'silk-road-commerce': '/company-logos/silk-road-commerce.png',
  'tashkent-soft-labs': '/company-logos/tashkent-soft-labs.png',
  'samarkand-digital': '/company-logos/samarkand-digital.png',
  'orient-bank': '/company-logos/orient-bank.png',
  'fergana-logistics': '/company-logos/fergana-logistics.png',
  'edunest-uz': '/company-logos/edunest-uz.png',
  'medicare-it': '/company-logos/medicare-it.png',
  'navoi-engineering': '/company-logos/navoi-engineering.png',
  'andijan-agrotech': '/company-logos/andijan-agrotech.png',
  'bukhara-heritage': '/company-logos/bukhara-heritage.png',
  'clickpay-solutions': '/company-logos/clickpay-solutions.png',
  'namangan-textile': '/company-logos/namangan-textile.png',
  'uztelecom-digital': '/company-logos/uztelecom-digital.png',
  'khorezm-green': '/company-logos/khorezm-green.png',
  'tashkent-legal': '/company-logos/tashkent-legal.png',
  'caravan-marketplace': '/company-logos/caravan-marketplace.png',
  'nukus-smart-city': '/company-logos/nukus-smart-city.png',
  'chirchiq-pharma': '/company-logos/chirchiq-pharma.png',
};

export function companyLogoUrl(slug: string): string | undefined {
  return COMPANY_LOGO_BY_SLUG[slug];
}
