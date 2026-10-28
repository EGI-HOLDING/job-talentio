import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, ProvinceType } from '@prisma/client';
import { geoAliasKey } from '../common/geo-selection';

type GeoName = { name: string; nameUz?: string; nameRu?: string; nameId?: string };
type Dataset = {
  version: string;
  countries: Array<GeoName & { slug: string; iso2: string; iso3: string; phoneCode: string; currencyCode: string }>;
  provinces: Array<GeoName & { country: string; sourceCode: string; slug: string; type: ProvinceType }>;
  cities: Array<GeoName & { country: string; provinceCode: string; sourceCode: string; slug: string; kind: string; legacySlug?: string | null; aliases: string[] }>;
};

async function main() {
  const target = new URL(process.env.DATABASE_URL || '');
  // This initial import is specifically approved for the local development DB.
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5434' || target.pathname !== '/job_talentio') {
    throw new Error('Geo import requires the approved local database on port 5434');
  }
  const repo = resolve(__dirname, '../../../..');
  const dataDir = resolve(repo, 'apps/api/prisma/data/geo');
  const data: Dataset = JSON.parse(readFileSync(resolve(dataDir, 'id-uz.json'), 'utf8'));
  const sources = JSON.parse(readFileSync(resolve(dataDir, 'sources.json'), 'utf8'));
  if (data.countries.length !== 2 || data.cities.filter(c => c.country === 'ID').length !== 514 || data.cities.filter(c => c.country === 'UZ').length !== 120) throw new Error('Unexpected dataset coverage');
  const db = new PrismaClient();
  try {
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({ dryRun: true, version: data.version, countries: data.countries.length, provinces: data.provinces.length, cities: data.cities.length, sources }, null, 2));
      return;
    }
    const output = resolve(repo, 'output/catalog-import/geo-2026-10-23');
    mkdirSync(output, { recursive: true });
    const before = { countries: await db.country.findMany(), provinces: await db.province.findMany(), cities: await db.city.findMany() };
    const stamp = Date.now();
    writeFileSync(resolve(output, `before-${stamp}.json`), JSON.stringify(before, null, 2));
    const result = await db.$transaction(async tx => {
      const countries = new Map<string, string>();
      const provinces = new Map<string, string>();
      let createdCities = 0;
      let reusedCities = 0;
      for (const item of data.countries) {
        const existing = await tx.country.findUnique({ where: { iso2: item.iso2 } });
        const row = existing
          ? await tx.country.update({ where: { id: existing.id }, data: existing.curatedAt ? {} : item })
          : await tx.country.create({ data: item });
        countries.set(item.iso2, row.id);
      }
      for (const { country, ...item } of data.provinces) {
        const countryId = countries.get(country)!;
        const existing = await tx.province.findFirst({ where: { OR: [{ sourceCode: item.sourceCode }, { countryId, slug: item.slug }] } });
        const row = existing
          ? await tx.province.update({ where: { id: existing.id }, data: existing.curatedAt ? { sourceCode: item.sourceCode } : item })
          : await tx.province.create({ data: { ...item, countryId } });
        provinces.set(item.sourceCode, row.id);
      }
      const importedIds: string[] = [];
      for (const { country, provinceCode, aliases, legacySlug, ...item } of data.cities) {
        const provinceId = provinces.get(provinceCode)!;
        const existing = await tx.city.findFirst({ where: { OR: [{ sourceCode: item.sourceCode }, { slug: legacySlug || item.slug }] } });
        if (existing && existing.provinceId !== provinceId) throw new Error('City belongs to a different province: ' + item.name);
        const row = existing
          ? await tx.city.update({ where: { id: existing.id }, data: existing.curatedAt ? { sourceCode: item.sourceCode } : { ...item, nameId: existing.nameId || item.nameId, provinceId } })
          : await tx.city.create({ data: { ...item, provinceId } });
        existing ? reusedCities++ : createdCities++;
        importedIds.push(row.id);
        const names = existing?.curatedAt ? [] : [...aliases, row.name, row.nameId, row.nameUz, row.nameRu, row.slug].filter((s): s is string => Boolean(s));
        await tx.cityAlias.createMany({ data: names.map(alias => ({ cityId: row.id, alias, aliasKey: geoAliasKey(alias) })).filter(a => a.aliasKey), skipDuplicates: true });
      }
      // Keep old IDs and every relation; only remove unreviewed legacy entries
      // from new selections. Curated Admin entries are never touched.
      const legacy = await tx.city.findMany({ where: { province: { countryId: countries.get('UZ') }, sourceCode: null, curatedAt: null, archivedAt: null, id: { notIn: importedIds } } });
      for (const row of legacy) {
        await tx.city.update({ where: { id: row.id }, data: { archivedAt: new Date(), kind: 'LEGACY' } });
        await tx.auditLog.create({ data: { action: 'ARCHIVE_UNVERIFIED_LEGACY_GEO', entityType: 'City', entityId: row.id, metadata: { before: JSON.parse(JSON.stringify(row)), reason: 'Not classified as a city in the reviewed SOATO snapshot; existing relationships retained' } } });
      }
      const summary = { countries: countries.size, provinces: provinces.size, createdCities, reusedCities, archivedLegacy: legacy.length, importedCityIds: importedIds };
      await tx.auditLog.create({ data: { action: 'IMPORT_GEO_CATALOG', entityType: 'GeoCatalog', entityId: data.version, metadata: { ...summary, sources } } });
      return summary;
    }, { timeout: 120_000 });
    writeFileSync(resolve(output, `applied-${stamp}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, importedCityIds: undefined }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
