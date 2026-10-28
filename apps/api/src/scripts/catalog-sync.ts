import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { applySnapshot, assertStaging, inspectPlan, readSnapshot, Snapshot, validateSnapshot } from '../catalog-sync/catalog-sync';
import { catalogMaintenance, databaseCatalogs } from '../catalog-sync/runtime';

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--file', '--report', '--expected-plan', '--backup-receipt'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid catalog-sync arguments');
    if (options.has(args[i])) throw new Error('Duplicate catalog-sync argument');
    options.set(args[i], args[i + 1]);
  }
  if (!['export', 'dry-run', 'apply'].includes(operation) || !options.has('--file')) throw new Error('Usage: catalog-sync export|dry-run|apply --file snapshot.json [--report report.json]');
  const file = resolve(options.get('--file')!);
  let url = process.env.DATABASE_URL || '';
  if (operation === 'export') {
    const parsed = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '5434') throw new Error('Export requires the approved local Postgres');
    parsed.pathname = '/talentio_hr_demo'; url = parsed.toString();
  } else assertStaging();
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (operation === 'export') {
      const snapshot = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return readSnapshot(tx, 'talentio_hr_demo');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 });
      validateSnapshot(snapshot);
      writeFileSync(file, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ operation, sha256: snapshot.sha256, counts: Object.fromEntries(Object.entries(snapshot.tables).map(([t, v]) => [t, v.rows.length])) }));
      return;
    }
    const snapshot: Snapshot = JSON.parse(readFileSync(file, 'utf8')); validateSnapshot(snapshot);
    const before = await inspectPlan(db, snapshot);
    if (operation === 'dry-run') {
      if (!options.has('--report')) throw new Error('--report is required');
      writeFileSync(resolve(options.get('--report')!), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ operation, planHash: before.planHash, targetHash: before.targetHash, tables: before.tableChanges, changes: before.changes, detached: before.detached, conflicts: before.conflicts }));
      return;
    }
    if (!catalogMaintenance() || !databaseCatalogs()) throw new Error('Apply requires maintenance and database-owned catalogs');
    if (!options.has('--expected-plan') || !options.has('--backup-receipt') || !options.has('--report')) throw new Error('Apply requires --expected-plan, --backup-receipt, and --report');
    const receipt = JSON.parse(readFileSync(resolve(options.get('--backup-receipt')!), 'utf8'));
    if (receipt.project !== process.env.RAILWAY_PROJECT_ID || receipt.environment !== process.env.RAILWAY_ENVIRONMENT_ID || receipt.targetHash !== before.targetHash || receipt.verifiedRestore !== true) throw new Error('Missing matching backup restore verification');
    const bytes = readFileSync(receipt.file);
    if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw new Error('Backup checksum mismatch');
    if (Date.now() - Date.parse(receipt.createdAt) > 86400000 || !Number.isFinite(Date.parse(receipt.createdAt))) throw new Error('Backup receipt expired');
    const report = resolve(options.get('--report')!);
    // Check output permissions/uniqueness before the database transaction commits.
    writeFileSync(report, JSON.stringify({ status: 'prepared', planHash: before.planHash }), { flag: 'wx', mode: 0o600 });
    const result = await applySnapshot(db, snapshot, options.get('--expected-plan')!);
    writeFileSync(report, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ operation, applied: result.applied, verified: result.verified, snapshotHash: result.snapshotHash, planHash: result.planHash }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError
    ? 'Database operation failed (' + (('code' in error ? error.code : error.errorCode) || error.name) + ')'
    : error instanceof Error ? error.message : 'Catalog synchronization failed');
  process.exitCode = 1;
});
