/* Loopback-only package review with a separate database and Redis instance. */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repo = path.resolve(__dirname, '..');
const api = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(api.resolve('@nestjs/config'))('dotenv');
const rootEnv = process.env.HR_PACKAGE_PREVIEW_ENV || (fs.existsSync(path.join(repo,'.env'))
  ? path.join(repo,'.env') : path.resolve(repo,'../..','.env'));
const source = dotenv.parse(fs.readFileSync(rootEnv));
const database = 'talentio_hr_package_preview';
const redis = 'jt-hr-package-preview-redis';
const bucket = 'talentio-hr-package-preview';
const report = path.join(repo, 'output/hr-package-preview');
const accountFile = path.join(report, 'account.json');
const action = process.argv[2] || 'accounts';

function docker(...args) {
  return execFileSync('docker', args, {encoding:'utf8', windowsHide:true}).trim();
}
function container(name) {
  const [info] = JSON.parse(docker('inspect',name));
  const settings = Object.fromEntries(info.Config.Env.map(line => {
    const split = line.indexOf('=');
    return [line.slice(0,split),line.slice(split+1)];
  }));
  const port = target => info.NetworkSettings.Ports[target+'/tcp']?.[0]?.HostPort;
  return {settings, port};
}
function run(command, args, env, cwd=repo) {
  const result = spawnSync(command, args, {env,cwd,stdio:'inherit',windowsHide:true});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, args[0] + ' failed');
}
function node(args, env, cwd) { run(process.execPath,args,env,cwd); }
function account() {
  fs.mkdirSync(report,{recursive:true});
  if(!fs.existsSync(accountFile)) fs.writeFileSync(accountFile, JSON.stringify({
    email:'hr@packages-preview.talentio.test', password:'Preview-'+randomBytes(12).toString('hex')+'!',
    jwt:randomBytes(48).toString('hex'), linkedin:randomBytes(32).toString('base64'),
  },null,2));
  return JSON.parse(fs.readFileSync(accountFile));
}
function configure() {
  const pg = container('jt-postgres');
  const storage = container('jt-hr-flow-minio');
  assert.equal(pg.port(5432),'5434');
  assert.equal(storage.port(9000),'9100');
  const local = account();
  const databaseUrl = new URL('postgresql://127.0.0.1:5434/'+database);
  databaseUrl.username = pg.settings.POSTGRES_USER;
  databaseUrl.password = pg.settings.POSTGRES_PASSWORD;
  const webUrl = 'http://127.0.0.1:3096';
  const apiUrl = 'http://127.0.0.1:4096';
  if (!/^SB-/i.test(source.MIDTRANS_SERVER_KEY || '')) {
    throw Error('A Midtrans sandbox Server Key is required');
  }
  return {
    pgUser:pg.settings.POSTGRES_USER,
    env:{
      ...process.env, ...Object.fromEntries(Object.keys(source).map(key => [key,''])),
      NODE_ENV:'development', APP_ENV:'local', HR_DEMO_MODE:'true', PORT:'4096', API_PORT:'4096',
      WEB_URL:webUrl, API_URL:apiUrl, ADMIN_URL:'http://127.0.0.1:3097',
      NEXT_PUBLIC_API_URL:apiUrl, NEXT_PUBLIC_ADMIN_URL:'http://127.0.0.1:3097', NEXT_PUBLIC_SITE_URL:webUrl,
      NEXT_PUBLIC_SAME_ORIGIN_API:'false', NEXT_PUBLIC_DEFAULT_LOCALE:'id', NEXT_PUBLIC_PRIVACY_MARKET:'id',
      NEXT_PUBLIC_HR_CREATION_V2:'true', NEXT_TELEMETRY_DISABLED:'1',
      DATABASE_URL:databaseUrl.href, JWT_SECRET:local.jwt, JWT_EXPIRES_IN:'15m', JWT_REFRESH_EXPIRES_IN:'30d',
      HR_FLOW_MARKET:'id', HR_CREATION_V2_ENABLED:'true', HR_PACKAGE_CATALOG_V2:'true',
      MIDTRANS_ENV:'sandbox', MIDTRANS_SERVER_KEY:source.MIDTRANS_SERVER_KEY,
      MIDTRANS_MERCHANT_ID:source.MIDTRANS_MERCHANT_ID || '', MIDTRANS_CHECKOUT_ENABLED:'true', CHECKOUT_TEST_MODE:'false',
      REDIS_URL:'redis://127.0.0.1:16396/0',
      S3_ENDPOINT:'http://127.0.0.1:9100', S3_PUBLIC_URL:'http://127.0.0.1:9100/'+bucket,
      S3_BUCKET:bucket, S3_REGION:'us-east-1', S3_FORCE_PATH_STYLE:'true',
      S3_ACCESS_KEY:storage.settings.MINIO_ROOT_USER, S3_SECRET_KEY:storage.settings.MINIO_ROOT_PASSWORD,
      CV_PARSE_PROVIDER:'local', OPENAI_API_KEY:'', RESEND_API_KEY:'', SMTP_HOST:'127.0.0.1', SMTP_PORT:'1025', SMTP_SECURE:'false',
      TELEGRAM_BOT_TOKEN:'', LINKEDIN_COMPANY_SIMULATION:'true', LINKEDIN_ENABLED:'false',
      LINKEDIN_TOKEN_KEYS:JSON.stringify({v1:local.linkedin}), LINKEDIN_TOKEN_KEY_VERSION:'v1',
      HR_PACKAGE_PREVIEW_ACCOUNT_FILE:accountFile,
    },
  };
}
async function setup(env, pgUser) {
  const names = docker('ps','-a','--filter','name=^'+redis+'$','--format','{{.Names}}').split(/\r?\n/);
  if(!names.includes(redis)) docker('run','-d','--name',redis,'--label','talentio.runtime=hr-package-preview','-p','127.0.0.1:16396:6379','redis:7-alpine');
  else {
    assert.equal(docker('inspect','--format','{{index .Config.Labels "talentio.runtime"}}',redis),'hr-package-preview');
    if(docker('inspect','--format','{{.State.Running}}',redis)!=='true') docker('start',redis);
  }
  const exists = docker('exec','jt-postgres','psql','-U',pgUser,'-d','postgres','-tAc',
    "SELECT 1 FROM pg_database WHERE datname='"+database+"'");
  if (!exists) docker('exec','jt-postgres','createdb','-U',pgUser,database);
  node([api.resolve('prisma/build/index.js'),'migrate','deploy','--schema','apps/api/prisma/schema.prisma'],env);
  const {S3Client,HeadBucketCommand,CreateBucketCommand} = api('@aws-sdk/client-s3');
  const storage = new S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,
    credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
  try {
    try { await storage.send(new HeadBucketCommand({Bucket:bucket})); }
    catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await storage.send(new CreateBucketCommand({Bucket:bucket}));
    }
  } finally { storage.destroy(); }
  node([api.resolve('tsx/cli'),'--tsconfig','apps/api/tsconfig.json','apps/api/src/scripts/hr-package-preview.ts'],env);
}
async function main() {
  if (action==='accounts') {
    console.log('Demo login http://127.0.0.1:3096/id/login?role=RECRUITER');
    const local = account();
    console.log('Demo email', local.email, '| Demo password', local.password);
    return;
  }
  const {env,pgUser} = configure();
  const {NEXT_BUILD_DIR: _otherBuild, ...webEnv} = {...env,NODE_ENV:'production'};
  const next = name => createRequire(path.join(repo,'apps',name,'package.json')).resolve('next/dist/bin/next');
  if(action==='setup') await setup(env,pgUser);
  else if(action==='build') {
    node(['packages/shared/node_modules/typescript/bin/tsc','-p','packages/shared/tsconfig.json'],env);
    node([api.resolve('@nestjs/cli/bin/nest.js'),'build'],env,path.join(repo,'apps/api'));
    for(const name of ['web','admin']) node([next(name),'build'],webEnv,path.join(repo,'apps',name));
  } else if(action==='build-api') {
    node([api.resolve('@nestjs/cli/bin/nest.js'),'build'],env,path.join(repo,'apps/api'));
  } else if(action==='build-web' || action==='build-admin') {
    const name = action.slice('build-'.length);
    node([next(name),'build'],webEnv,path.join(repo,'apps',name));
  } else if(action==='api') node(['apps/api/dist/main.js'],env);
  else if(action==='web' || action==='admin') {
    node([next(action),'start','-H','127.0.0.1','-p',action==='web'?'3096':'3097'],webEnv,path.join(repo,'apps',action));
  } else if (action==='verify') {
    node([api.resolve('tsx/cli'),'--tsconfig','apps/api/tsconfig.json','apps/api/src/scripts/hr-package-preview.integration.ts',...process.argv.slice(3)],env);
  } else throw Error('Use setup, build, build-api, build-web, build-admin, accounts, api, web, admin or verify');
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
