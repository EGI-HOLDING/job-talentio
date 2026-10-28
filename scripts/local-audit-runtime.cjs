// Start the audit against local infrastructure. Root .env secrets stay untouched.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const repo = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const directory = path.join(repo, 'node_modules/.cache/local-audit');
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7);
if (only && !['api', 'web', 'admin'].includes(only)) throw new Error('Unknown local server');
fs.mkdirSync(directory, { recursive: true });

function container(name) {
  return JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0];
}
function environment(info) {
  return Object.fromEntries(info.Config.Env.map((value) => {
    const split = value.indexOf('=');
    return [value.slice(0, split), value.slice(split + 1)];
  }));
}
function port(info, internal) {
  const binding = info.NetworkSettings.Ports[`${internal}/tcp`]?.[0];
  if (!binding) throw new Error(`Container port ${internal} is not published`);
  return binding.HostPort;
}
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function main() {
  const root = dotenv.parse(fs.readFileSync(path.join(repo, '.env')));
  const database = new URL(root.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Audit runtime refuses a non-local database');
  }
  const minio = container('jt-minio');
  const redis = container('jt-redis');
  const meili = container('jt-meilisearch');
  const minioEnv = environment(minio);
  const minioUrl = `http://localhost:${port(minio, 9000)}`;
  const env = {
    ...process.env, ...root,
    NODE_ENV: 'development', PORT: '4000', API_PORT: '4000',
    CV_PARSE_PROVIDER: 'local',
    WEB_URL: 'http://localhost:3000', ADMIN_URL: 'http://localhost:3001', API_URL: '',
    DATABASE_URL: root.DATABASE_URL,
    REDIS_URL: `redis://127.0.0.1:${port(redis, 6379)}`,
    MEILI_HOST: `http://127.0.0.1:${port(meili, 7700)}`,
    MEILI_MASTER_KEY: environment(meili).MEILI_MASTER_KEY,
    S3_ENDPOINT: minioUrl, S3_PUBLIC_URL: `${minioUrl}/job-talentio`,
    S3_BUCKET: 'job-talentio', S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY: minioEnv.MINIO_ROOT_USER, S3_SECRET_KEY: minioEnv.MINIO_ROOT_PASSWORD,
    RESEND_API_KEY: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_SECURE: 'false',
    SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'Job Talentio Local <audit@example.test>',
    TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHANNEL_ID: '', TELEGRAM_WEBHOOK_SECRET: '',
    SUPERADMIN_PASSWORD: '', DEV_AUTH_ENABLED: 'false',
  };
  const processFile = path.join(directory, 'processes.json');
  const previous = fs.existsSync(processFile) ? JSON.parse(fs.readFileSync(processFile, 'utf8')) : [];
  const processes = only ? previous.filter(item => item.name !== only) : [];
  for (const [name, appPort, args, cwd] of [
    ['api', 4000, [path.join(repo, 'apps/api/dist/main.js')], path.join(repo, 'apps/api')],
    ['web', 3000, [createRequire(path.join(repo, 'apps/web/package.json')).resolve('next/dist/bin/next'), 'start', '-p', '3000'], path.join(repo, 'apps/web')],
    ['admin', 3001, [createRequire(path.join(repo, 'apps/admin/package.json')).resolve('next/dist/bin/next'), 'start', '-p', '3001'], path.join(repo, 'apps/admin')],
  ]) {
    if (only && only !== name) continue;
    if (await listening(appPort)) {
      const prior = previous.find((item) => item.name === name);
      if (prior) processes.push(prior);
      console.log(`${name}: port ${appPort} already active; no duplicate process started`);
      continue;
    }
    const output = fs.openSync(path.join(directory, `${name}.log`), 'a');
    const child = spawn(process.execPath, args, {
      cwd, env: name === 'api' ? env : { ...env, NODE_ENV: 'production' },
      detached: true, windowsHide: true, stdio: ['ignore', output, output],
    });
    child.unref();
    fs.closeSync(output);
    processes.push({ name, pid: child.pid, port: appPort });
    console.log(`${name}: started on port ${appPort} (pid ${child.pid})`);
  }
  fs.writeFileSync(processFile, JSON.stringify(processes, null, 2));
  for (const [name, url] of [
    ['api', 'http://localhost:4000/api/health'],
    ['web', 'http://localhost:3000/en/login'],
    ['admin', 'http://localhost:3001'],
  ]) {
    if (only && only !== name) continue;
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { ready = (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`${name} did not become ready; inspect its local audit log`);
    console.log(`${name}: HTTP ready`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
