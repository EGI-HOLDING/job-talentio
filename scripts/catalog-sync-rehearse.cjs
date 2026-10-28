// Restore the full staging backup into a disposable PostgreSQL 18 container,
// then exercise the exact transaction before any live catalog changes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { privateWrite } = require('./catalog-sync-railway.cjs');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
process.env.TSX_TSCONFIG_PATH = path.resolve('apps/api/tsconfig.json');
apiRequire('tsx/cjs');
const engine = apiRequire(path.resolve('apps/api/src/catalog-sync/catalog-sync.ts'));
if (!process.argv[2]) throw Error('A private artifact directory is required');
const directory = path.resolve(process.argv[2]);
if (!directory.startsWith(path.resolve('.catalog-sync-private') + path.sep)) throw Error('Invalid private artifact directory');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }).trim();

(async () => {
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'backup.receipt.json')));
  const backup = fs.readFileSync(path.join(directory, 'staging-before.dump'));
  if (crypto.createHash('sha256').update(backup).digest('hex') !== receipt.sha256) throw Error('Backup checksum mismatch');
  const snapshot = JSON.parse(fs.readFileSync(path.join(directory, 'local.snapshot.json'))); engine.validateSnapshot(snapshot);
  const password = crypto.randomBytes(24).toString('hex');
  const name = 'jt-catalog-sync-restore-' + Date.now();
  const id = docker(['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_USER=talentio', '-e', 'POSTGRES_PASSWORD=' + password,
    '-e', 'POSTGRES_DB=catalog_restore', '-p', '127.0.0.1::5432', 'postgres:18-alpine']);
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Unexpected isolated container ID');
  let db;
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { docker(['exec', id, 'pg_isready', '-U', 'talentio', '-d', 'catalog_restore']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ready) throw Error('Isolated Postgres did not become ready');
    const info = JSON.parse(docker(['inspect', id]))[0];
    const port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
    db = new PrismaClient({ datasources: { db: { url: `postgresql://talentio:${password}@127.0.0.1:${port}/catalog_restore` } } });
    execFileSync('docker', ['exec', '-i', id, 'pg_restore', '-U', 'talentio', '-d', 'catalog_restore', '--no-owner', '--no-acl', '--exit-on-error'],
      { input: backup, windowsHide: true, maxBuffer: 1024 * 1024 });
    const restored = await engine.databaseDigest(db);
    if (restored.sha256 !== receipt.databaseDigest.sha256) throw Error('Full database restore fingerprint mismatch');
    const plan = await engine.inspectPlan(db, snapshot);
    if (plan.targetHash !== receipt.targetHash) throw Error('Restored target state differs from the staging backup receipt');
    if (plan.conflicts.length) throw Error('Rehearsal conflicts: ' + plan.conflicts.join('; '));
    try { await engine.applySnapshot(db, snapshot, plan.planHash, 'after-delete'); throw Error('Fault injection did not fail'); }
    catch (e) { if (!e.message.includes('Injected rollback exercise')) throw e; }
    if ((await engine.databaseDigest(db)).sha256 !== restored.sha256) throw Error('Rollback failed to preserve the full database');
    const applied = await engine.applySnapshot(db, snapshot, plan.planHash);
    const again = await engine.inspectPlan(db, snapshot);
    if (!applied.verified || Object.values(again.tableChanges).some(t => !t.equal) || Object.keys(again.changes).length || again.conflicts.length) throw Error('Rehearsal did not produce an exact, stable catalog copy');
    if ((await engine.applySnapshot(db, snapshot, again.planHash)).applied) throw Error('Second apply was not a no-op');
    const verified = { ...receipt, verifiedRestore: true, rehearsal: { restoredDatabaseDigest: restored.sha256, snapshotHash: snapshot.sha256,
      rollbackVerified: true, exactCatalogsVerified: true, idempotencyVerified: true, protectedIdentity: applied.protectedIdentity } };
    privateWrite(path.join(directory, 'backup.verified.json'), JSON.stringify(verified, null, 2));
    privateWrite(path.join(directory, 'rehearsal.plan.json'), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ verifiedRestore: true, rollbackVerified: true, exactCatalogsVerified: true, idempotencyVerified: true, snapshotHash: snapshot.sha256, detached: plan.detached, conflicts: plan.conflicts }));
  } finally { if (db) await db.$disconnect(); docker(['rm', '-f', id]); }
})().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
