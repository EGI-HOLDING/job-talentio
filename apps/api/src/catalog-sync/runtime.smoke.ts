import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { catalogMaintenance, databaseCatalogs } from './runtime';
import { assertStaging } from './catalog-sync';

async function main() {
  assert.equal(catalogMaintenance({}), false);
  assert.equal(databaseCatalogs({}), false);
  assert.equal(databaseCatalogs({ CATALOG_SOURCE_MODE: 'database' }), true);
  assert.throws(() => databaseCatalogs({ CATALOG_SOURCE_MODE: 'typo' }), /Invalid/);
  assert.throws(() => assertStaging({ RAILWAY_ENVIRONMENT_NAME: 'production' }), /approved/);
  const reservation = createServer();
  await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const child = spawn(process.execPath, ['--require', require.resolve('tsx/cjs'), resolve(__dirname, '../main.ts')], {
    env: { ...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../../tsconfig.json'), NODE_ENV: 'test', CATALOG_SYNC_MAINTENANCE: 'true', HR_DEMO_MODE: 'true', PORT: String(port),
      DATABASE_URL: 'postgresql://unavailable:unavailable@127.0.0.1:1/unavailable', REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'catalog-maintenance-fixture-secret-with-more-than-32-chars' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  try {
    let healthy = false;
    for (let i = 0; i < 150; i++) {
      try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { /* wait for listener */ }
      if (healthy) break;
      if (child.exitCode !== null) throw new Error('Maintenance process exited: ' + log.slice(-2000));
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(healthy, 'Maintenance must start with unavailable PostgreSQL and Redis: ' + log.slice(-2000));
    for (const [path, method] of [['/api/meta/countries', 'GET'], ['/api/auth/login', 'POST'], ['/socket.io/?EIO=4&transport=polling', 'GET']]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60');
      assert.equal((await response.json() as { code: string }).code, 'CATALOG_MAINTENANCE');
    }
    assert.doesNotMatch(log, /worker started|PrismaModule dependencies initialized|backfill done/);
    console.log('PASS catalog runtime: strict environment guards; maintenance health, HTTP and socket blocking; no application database or worker startup.');
  } finally { child.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
