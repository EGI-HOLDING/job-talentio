import { Prisma, PrismaClient } from '@prisma/client';
import { assertStaging } from '../catalog-sync/catalog-sync';
import { HR_PUBLICATION_LOCK, initializePublicationPeriods, PACKAGE_ORDER } from '../benefits/benefit-policy';

/** An explicit staging operation, never a startup hook or a production default. */
export async function enableStagingJobPackages(db: PrismaClient, apply = false, env = process.env) {
  assertStaging(env);
  return db.$transaction(async tx => {
    if (apply) await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(${HR_PUBLICATION_LOCK}::bigint)`);
    else await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    // All three policies must be installed before any configuration changes.
    for (const code of PACKAGE_ORDER) await tx.packagePolicy.findFirstOrThrow({where: {code}, orderBy: {version: 'desc'}});
    const before = await tx.featureFlag.findMany({where: {key: {in: ['hr_rollout', 'hr_packages']}}});
    const rollout = before.find(row => row.key === 'hr_rollout');
    const packages = before.find(row => row.key === 'hr_packages');
    const startsAt = rollout?.enabled ? new Date((rollout.payload as {startsAt: string})?.startsAt) : new Date();
    if (!Number.isFinite(startsAt.getTime())) throw new Error('Invalid existing HR rollout period');
    if (packages?.enabled && !rollout?.enabled) throw new Error('Packages are enabled without an initialized rollout');
    const legacyJobs = await tx.jobPost.count({where: {status: {in: ['PUBLISHED', 'PAUSED']}, benefit: {is: null}}});
    const changes = !rollout?.enabled || !packages?.enabled || legacyJobs > 0;
    const result = {applied: apply && changes, changes, startsAt: startsAt.toISOString(), legacyJobs,
      before: before.map(({key, enabled}) => ({key, enabled})), enabled: apply ? true : Boolean(packages?.enabled)};
    if (!apply || !changes) return result;
    await initializePublicationPeriods(tx, startsAt);
    await tx.featureFlag.upsert({where: {key: 'hr_rollout'}, create: {key: 'hr_rollout', enabled: true, payload: {startsAt: startsAt.toISOString()}},
      update: {enabled: true, payload: {startsAt: startsAt.toISOString()}}});
    await tx.featureFlag.upsert({where: {key: 'hr_packages'}, create: {key: 'hr_packages', enabled: true}, update: {enabled: true}});
    await tx.auditLog.create({data: {action: 'STAGING_JOB_PACKAGES_ENABLED', entityType: 'FeatureFlag',
      metadata: {...result, source: 'enable-staging-job-packages', reason: 'Restore recruiter onboarding package selection on staging'}}});
    return result;
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000});
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) throw new Error('Usage: enable-staging-job-packages --dry-run|--apply');
  assertStaging();
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await enableStagingJobPackages(db, args[0] === '--apply'))); }
  finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
