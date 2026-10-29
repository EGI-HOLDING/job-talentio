import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compareFeaturedCompanies } from './featured-company-order';

const newer = new Date('2026-10-28T12:00:00.000Z');
const older = new Date('2026-10-27T12:00:00.000Z');
const rows = [
  { slug: 'free-newer', tier: 1, latestPublishedAt: newer },
  { slug: 'standard-old', tier: 2, latestPublishedAt: older },
  { slug: 'premium-old', tier: 3, latestPublishedAt: older },
  { slug: 'premium-newer', tier: 3, latestPublishedAt: newer },
  { slug: 'premium-alpha', tier: 3, latestPublishedAt: older },
  { slug: 'premium-zeta', tier: 3, latestPublishedAt: older },
];

rows.sort(compareFeaturedCompanies);
assert.deepEqual(rows.map((row) => row.slug), [
  'premium-newer',
  'premium-alpha',
  'premium-old',
  'premium-zeta',
  'standard-old',
  'free-newer',
]);

const serviceSource = fs.readFileSync(path.join(__dirname, 'companies.service.ts'), 'utf8');
assert.match(serviceSource, /c\."isBanned" = false/);
assert.match(serviceSource, /AND c\."anonymizedAt" IS NULL/);
assert.match(serviceSource, /AND j\."status" = 'PUBLISHED'/);
assert.match(serviceSource, /AND j\."isAnonymous" = false/);
assert.match(serviceSource, /b\."expiresAt" IS NULL OR b\."expiresAt" >/);
assert.match(serviceSource, /WHEN 'PREMIUM' THEN 3[\s\S]*WHEN 'STANDARD' THEN 2/);
assert.match(serviceSource, /MAX\(j\."publishedAt"\) AS "latestPublishedAt"/);
console.log('featured company ordering: smoke ok');
