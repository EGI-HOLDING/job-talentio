import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  CATALOG_IMPORT_ACTION, CatalogSnapshot, catalogImportPlanHash,
  parseCatalogDataset, planJobTitleCatalogImport, sha256,
} from '../common/job-title-catalog-import';

function options() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--apply', '--accept-draft-labels', '--dry-run'].includes(arg)) flags.add(arg);
    else if (['--file', '--report', '--expected-plan', '--expected-database'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${arg}`);
      values.set(arg, args[++i]);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!values.has('--file') || !values.has('--report')) throw new Error('--file and --report are required');
  if (flags.has('--apply') && flags.has('--dry-run')) throw new Error('Choose --apply or --dry-run');
  if (flags.has('--apply') && (!flags.has('--accept-draft-labels') || !values.has('--expected-plan') || !values.has('--expected-database'))) {
    throw new Error('Apply requires --accept-draft-labels, --expected-plan, and --expected-database');
  }
  return { values, apply: flags.has('--apply') };
}

async function snapshot(db: Prisma.TransactionClient): Promise<CatalogSnapshot> {
  const [titles, aliases, audits] = await Promise.all([
    db.jobTitle.findMany({ orderBy: { id: 'asc' } }),
    db.jobTitleAlias.findMany({ orderBy: { id: 'asc' } }),
    db.auditLog.findMany({ where: { action: CATALOG_IMPORT_ACTION }, select: { id: true, entityId: true }, orderBy: { id: 'asc' } }),
  ]);
  return { titles, aliases, audits };
}

async function main() {
  const opts = options();
  const raw = await readFile(resolve(opts.values.get('--file')!), 'utf8');
  const dataset = parseCatalogDataset(JSON.parse(raw));
  const datasetHash = sha256(raw);
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw new Error('This importer only writes to a local database');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (opts.apply && database !== opts.values.get('--expected-database')) throw new Error('Database target does not match the expected database');
  const reportPath = resolve(opts.values.get('--report')!);
  await mkdir(dirname(reportPath), { recursive: true });
  // Reserve the report path before connecting; never overwrite a prior receipt.
  await writeFile(reportPath, JSON.stringify({ status: 'started', mode: opts.apply ? 'apply' : 'dry-run' }), { flag: 'wx' });
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      if (opts.apply) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('talentio-job-title-catalog-import'))`;
      const before = await snapshot(tx);
      const plan = planJobTitleCatalogImport(dataset, before, datasetHash);
      const planHash = catalogImportPlanHash(plan);
      const base = {
        datasetId: dataset.datasetId, datasetVersion: dataset.version, datasetSha256: datasetHash,
        target: { host: url.hostname, port: url.port || '5432', database },
        summary: plan.summary, planSha256: planHash, aliasConflicts: plan.aliasConflicts,
        mapping: plan.entries.map(e => ({ sourceKey: e.source.key, jobTitleId: e.targetId,
          action: e.create ? 'create' : e.patch ? 'fill_missing_translations' : 'reuse' })),
      };
      if (!opts.apply) return { ...base, status: 'dry_run', plan };
      if (planHash !== opts.values.get('--expected-plan')) throw new Error('Import plan changed; run dry-run again before applying');
      if (plan.aliasConflicts.length) throw new Error('Alias ownership conflicts require review before applying');
      await writeFile(`${reportPath}.before.json`, JSON.stringify(before, null, 2), { flag: 'wx' });
      const countsBefore = { titles: before.titles.length, aliases: before.aliases.length,
        jobs: await tx.jobPost.count(), applications: await tx.application.count() };
      const creates = plan.entries.flatMap(e => e.create ? [e.create] : []);
      if (creates.length) await tx.jobTitle.createMany({ data: creates });
      for (const entry of plan.entries) {
        if (entry.patch) await tx.jobTitle.update({ where: { id: entry.targetId }, data: entry.patch });
      }
      if (plan.aliases.length) await tx.jobTitleAlias.createMany({ data: plan.aliases });
      const auditRows: Prisma.AuditLogCreateManyInput[] = plan.entries.filter(e => e.createAudit).map(e => ({
        id: e.auditId, actorId: null, action: CATALOG_IMPORT_ACTION, entityType: 'JobTitle', entityId: e.targetId,
        metadata: JSON.parse(JSON.stringify({
          datasetId: dataset.datasetId, datasetVersion: dataset.version, datasetSha256: datasetHash,
          ownerAuthorizedDraftImport: true, source: e.source,
          changedFields: e.create ? Object.keys(e.create) : Object.keys(e.patch || {}),
        })) as Prisma.InputJsonValue,
      }));
      if (auditRows.length) await tx.auditLog.createMany({ data: auditRows });
      const after = await snapshot(tx);
      // A second plan in the same transaction must be a no-op before committing.
      const rerun = planJobTitleCatalogImport(dataset, after, datasetHash);
      if (rerun.summary.createdTitles || rerun.summary.titlesWithMissingTranslationsFilled ||
        rerun.summary.createdAliases || rerun.summary.createdAuditRecords || rerun.aliasConflicts.length) {
        throw new Error('Import did not pass the idempotency check; transaction rolled back');
      }
      for (const old of before.titles) {
        const current = after.titles.find(t => t.id === old.id);
        if (!current) throw new Error('An existing title is missing');
        const allowed = new Set(Object.keys(plan.entries.find(e => e.targetId === old.id)?.patch || {}));
        for (const field of ['name', 'nameId', 'nameUz', 'nameRu', 'slug', 'normalizedKey', 'archivedAt',
          'curatedAt', 'nameIdIsMachine', 'nameUzIsMachine', 'nameRuIsMachine', 'i18nStatus'] as const) {
          if (!allowed.has(field) && JSON.stringify(current[field]) !== JSON.stringify(old[field])) throw new Error(`Existing field unexpectedly changed: ${field}`);
        }
      }
      for (const old of before.aliases) {
        const current = after.aliases.find(a => a.id === old.id);
        if (!current || current.jobTitleId !== old.jobTitleId || current.alias !== old.alias || current.aliasKey !== old.aliasKey) throw new Error('Existing alias unexpectedly changed');
      }
      const countsAfter = { titles: after.titles.length, aliases: after.aliases.length,
        jobs: await tx.jobPost.count(), applications: await tx.application.count() };
      return { ...base, status: 'applied', appliedAt: new Date().toISOString(), countsBefore, countsAfter,
        verification: { existingTitlesPreserved: true, existingAliasesPreserved: true, secondImportWouldBeNoOp: true,
          sourceRowsMapped: plan.entries.length, translationsRemainDraft: true } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 120000 });
    await writeFile(reportPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, target: result.target, summary: result.summary,
      planSha256: result.planSha256, report: reportPath }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  // Avoid logging connection strings, credentials, raw Prisma queries or records.
  const message = error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientInitializationError
    ? `Database operation failed (${('code' in error ? error.code : error.errorCode) || error.name})`
    : error instanceof Error ? error.message : 'Import failed';
  console.error(message);
  process.exitCode = 1;
});
