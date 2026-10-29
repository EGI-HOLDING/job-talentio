import fs from 'node:fs';
import path from 'node:path';
import { FEATURED_COMPANIES, FEATURED_COMPANY_CAROUSEL_VERSION } from './featured-company-carousel-manifest';

const assetDirectory = path.resolve(__dirname, '../../../../apps/web/public/images/featured-companies');
fs.mkdirSync(assetDirectory, { recursive: true });
for (const company of FEATURED_COMPANIES) {
  const color = company.color.replace(/[^#a-fA-F0-9]/g, '');
  const initials = company.initials.replace(/[^A-Z0-9]/gi, '').slice(0, 3);
  const asset = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72" viewBox="0 0 128 72" role="img" aria-label="${company.name.replace(/[&<>"']/g, '')}"><rect x="28" y="4" width="72" height="64" rx="20" fill="${color}"/><path d="M42 50 64 16l22 34H42Z" fill="#fff" fill-opacity=".13"/><text x="64" y="44" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#fff">${initials}</text></svg>\n`;
  fs.writeFileSync(path.join(assetDirectory, `${company.slug}.svg`), asset, 'utf8');
}
process.stdout.write(`Generated ${FEATURED_COMPANIES.length} local company logo SVGs for showcase manifest v${FEATURED_COMPANY_CAROUSEL_VERSION}.\n`);
