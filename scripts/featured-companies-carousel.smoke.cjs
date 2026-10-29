const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const home = read('apps/web/src/components/home/SeekerHome.tsx');
const hero = read('apps/web/src/components/home/SeekerHero.tsx');
const carousel = read('apps/web/src/components/home/FeaturedCompaniesCarousel.tsx');
const css = read('apps/web/src/components/home/FeaturedCompaniesCarousel.module.css');
const manifest = read('apps/api/src/scripts/featured-company-carousel-manifest.ts');

assert.match(home, /\/companies\?sort=featured&limit=48/);
assert.match(hero, /<FeaturedCompaniesCarousel companies=\{companies\} \/>/);
assert.doesNotMatch(hero, /home\.hiringCompanies|explore\/companies/);
assert.match(carousel, /i \+= 12/);
assert.match(carousel, /href=\{`\/companies\/\$\{encodeURIComponent\(company\.slug\)\}`\}/);
assert.match(carousel, /aria-roledescription="carousel"/);
assert.match(carousel, /ArrowLeft/);
assert.match(carousel, /ArrowRight/);
assert.match(carousel, /onPointerDown/);
assert.match(carousel, /onPointerUp/);
assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.equal((manifest.match(/^    slug: '/gm) || []).length, 21);
const logos = fs.readdirSync(path.join(root, 'apps/web/public/images/featured-companies')).filter((file) => file.endsWith('.svg'));
assert.equal(logos.length, 21);
console.log('featured company carousel: smoke ok');
