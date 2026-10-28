// Only creates/migrates/drops its own disposable local database. No root .env is loaded.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'apps/api/package.json'));
const info = JSON.parse(
  execFileSync('docker', ['inspect', 'jt-postgres'], { encoding: 'utf8', windowsHide: true }),
)[0];
const settings = Object.fromEntries(
  info.Config.Env.map((value) => {
    const i = value.indexOf('=');
    return [value.slice(0, i), value.slice(i + 1)];
  }),
);
const name = 'talentio_hr_it_' + Date.now();
if (!/^talentio_hr_it_\d+$/.test(name)) throw Error('Unsafe test database name');
const user = settings.POSTGRES_USER || 'postgres';
const port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(settings.POSTGRES_PASSWORD)}@127.0.0.1:${port}/${name}`;
const meili = JSON.parse(
  execFileSync('docker', ['inspect', 'jt-meilisearch'], { encoding: 'utf8', windowsHide: true }),
)[0];
const meiliEnv = Object.fromEntries(
  meili.Config.Env.map((value) => {
    const i = value.indexOf('=');
    return [value.slice(0, i), value.slice(i + 1)];
  }),
);
const env = {
  ...process.env,
  HR_TEST_MEILI_HOST: 'http://127.0.0.1:' + meili.NetworkSettings.Ports['7700/tcp'][0].HostPort,
  HR_TEST_MEILI_KEY: meiliEnv.MEILI_MASTER_KEY,
  HR_TEST_MEILI_INDEX: name,
  NODE_ENV: 'test',
  DATABASE_URL: url,
  HR_TEST_DATABASE_URL: url,
  MEILI_HOST: '',
  TELEGRAM_BOT_TOKEN: '',
  RESEND_API_KEY: '',
  SMTP_HOST: '127.0.0.1',
  CV_PARSE_PROVIDER: 'local',
};
if (process.argv.includes('--linkedin')) {
  // Disposable DB, dedicated demo storage bucket, and Redis DB 13. Never uses the running API queue.
  const demo = require('./lib/hr-demo-env.cjs').config();
  Object.assign(env, demo.env, {DATABASE_URL:url, HR_TEST_DATABASE_URL:url, NODE_ENV:'test',
    REDIS_URL:demo.env.REDIS_URL.replace(/\/14$/, '/13'), MEILI_HOST:'', HR_TEST_MEILI_HOST:env.HR_TEST_MEILI_HOST,
    HR_TEST_MEILI_KEY:env.HR_TEST_MEILI_KEY, HR_TEST_MEILI_INDEX:name});
}
function sql(command) {
  return execFileSync(
    'docker',
    [
      'exec',
      'jt-postgres',
      'psql',
      '-U',
      user,
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      command,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}
function run(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240000,
  });
  if (result.status !== 0) {
    process.stdout.write((result.stdout || '').replaceAll(url, '[isolated database]'));
    process.stderr.write((result.stderr || '').replaceAll(url, '[isolated database]'));
    throw Error('Isolated command failed');
  }
  return result.stdout;
}
let created = false;
try {
  sql(`CREATE DATABASE "${name}"`);
  created = true;
  run(process.execPath, [
    req.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    path.join(root, 'apps/api/prisma/schema.prisma'),
  ]);
  console.log('All migrations applied to disposable PostgreSQL database.');
  console.log(
    run(process.execPath, [
      req.resolve('tsx/cli'),
      '--tsconfig',
      path.join(root, 'apps/api/tsconfig.json'),
      path.join(root, process.argv.includes('--onboarding') ? 'apps/api/src/auth/recruiter-signin.integration.smoke.ts' : process.argv.includes('--linkedin') ? 'apps/api/src/linkedin/linkedin.integration.smoke.ts' : 'apps/api/src/benefits/' + (process.argv.includes('--commerce') ? 'job-commerce.integration.smoke.ts' : 'benefits.integration.smoke.ts')),
    ]),
  );
} finally {
  try {
    run(process.execPath, [
      '-e',
      "fetch(process.env.HR_TEST_MEILI_HOST+'/indexes/'+process.env.HR_TEST_MEILI_INDEX,{method:'DELETE',headers:{Authorization:'Bearer '+process.env.HR_TEST_MEILI_KEY}}).then(r=>{if(!r.ok&&r.status!==404)process.exitCode=1})",
    ]);
  } finally {
    if (created) {
      sql(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log('Disposable database and search index removed.');
    }
  }
}
