import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { quote, readSnapshot, TABLES, validateSnapshot } from '../catalog-sync/catalog-sync';

const migrationProvinces = ['tashkent_city', 'tashkent_region', 'karakalpakstan', 'andijan', 'bukhara', 'fergana', 'jizzakh', 'kashkadarya', 'khorezm', 'namangan', 'navoi', 'samarkand', 'sirdarya', 'surkhandarya', 'other_uz'];
function migrationPlaceholder(table: string, row: Record<string, unknown>): boolean {
  if (row.archivedAt || row.curatedAt || row.nameId || row.nameUz || row.nameRu) return false;
  if (table === 'Country') return row.id === 'clgeo_country_uz' && row.iso2 === 'UZ' && row.iso3 === 'UZB' && row.name === 'Uzbekistan' && row.slug === 'uzbekistan';
  if (table === 'Province') return migrationProvinces.some(key => row.id === 'clgeo_prov_' + key) && row.countryId === 'clgeo_country_uz';
  return table === 'IndustryGroup' && row.id === 'mig_industry_other' && row.name === 'Other' && row.slug === 'other' && row.sortOrder === 3;
}

/** Initial import only: only the known migration-created placeholders are allowed. */
async function main() {
  const [file, expectedHash, mode] = process.argv.slice(2);
  const target = new URL(process.env.DATABASE_URL || '');
  if (process.env.DEPLOYMENT_TARGET !== 'indonesia-vps' || target.pathname !== '/talentio'
    || !['host.docker.internal', '127.0.0.1', 'localhost'].includes(target.hostname)
    || process.env.CATALOG_SOURCE_MODE !== 'database') throw new Error('Only the dedicated Indonesia talentio database is allowed');
  if (!file || !/^[a-f0-9]{64}$/.test(expectedHash || '') || !['--dry-run', '--apply'].includes(mode))
    throw new Error('Usage: initialize-vps-catalogs <snapshot.json> <sha256> --dry-run|--apply');
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  validateSnapshot(snapshot);
  if (snapshot.sha256 !== expectedHash) throw new Error('Snapshot does not match the approved fingerprint');
  const db = new PrismaClient();
  try {
    const report = await db.$transaction(async tx => {
      if (mode === '--dry-run') await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const business = ['User', 'Company', 'JobPost', 'EmployeeProfile', 'Resume', 'Application', 'Conversation', 'Payment', 'JobPurchaseOrder'];
      if (mode === '--apply') await tx.$executeRawUnsafe(`LOCK TABLE ${[...TABLES, ...business, 'FeatureFlag'].map(t => 'public.' + quote(t)).join(',')} IN ACCESS EXCLUSIVE MODE`);
      if (await tx.featureFlag.findUnique({where: {key: 'talentio_catalog_initialized'}})) throw new Error('VPS catalog is already initialized');
      for (const name of business) {
        const rows = await tx.$queryRawUnsafe<Array<{count: number}>>(`SELECT COUNT(*)::int AS count FROM public.${quote(name)}`);
        if (rows[0].count) throw new Error('Initial import requires an empty table: ' + name);
      }
      const baseline = await readSnapshot(tx, 'migration-baseline');
      for (const name of TABLES) {
        if (baseline.tables[name].rows.some(row => !migrationPlaceholder(name, row)))
          throw new Error('Initial import requires an empty table or migration placeholders: ' + name);
      }
      if (mode === '--apply') {
        // No CASCADE: any unexpected references abort instead of deleting data.
        for (const name of [...TABLES].reverse()) await tx.$executeRawUnsafe(`DELETE FROM public.${quote(name)}`);
        for (const name of TABLES) {
          const columns = snapshot.tables[name].columns.map((c: {name: string}) => quote(c.name)).join(',');
          await tx.$executeRawUnsafe(`INSERT INTO public.${quote(name)} (${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::public.${quote(name)}, $1::json)`, JSON.stringify(snapshot.tables[name].rows));
        }
        const imported = await readSnapshot(tx, 'talentio_hr_demo');
        if (imported.sha256 !== expectedHash) throw new Error('Imported catalog verification failed');
        // Explicit deployment configuration; no users or demo records are seeded.
        const now = new Date();
        await tx.featureFlag.upsert({where: {key: 'hr_rollout'}, create: {key: 'hr_rollout', enabled: true, payload: {startsAt: now.toISOString()}}, update: {enabled: true, payload: {startsAt: now.toISOString()}}});
        await tx.featureFlag.updateMany({where: {key: {in: ['hr_packages', 'hr_promotions', 'hr_analytics', 'hr_support']}}, data: {enabled: true}});
        await tx.featureFlag.create({data: {key: 'talentio_catalog_initialized', enabled: true, payload: {sha256: expectedHash}}});
      }
      return {applied: mode === '--apply', sha256: expectedHash, counts: Object.fromEntries(TABLES.map(name => [name, snapshot.tables[name].rows.length])), users: 0};
    }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000});
    console.log(JSON.stringify(report));
  } finally { await db.$disconnect(); }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
