const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const req = createRequire(path.join(repo, 'apps/api/package.json'));
const dotenv = createRequire(req.resolve('@nestjs/config'))('dotenv');
const directory = path.join(repo, 'node_modules/.cache/hr-demo');
const databaseName = 'talentio_hr_demo';
function inspect(name) { return JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0]; }
function settings(info) { return Object.fromEntries(info.Config.Env.map(v => { const i=v.indexOf('='); return [v.slice(0,i),v.slice(i+1)]; })); }
function port(info, p) { return info.NetworkSettings.Ports[p+'/tcp'][0].HostPort; }
function config({realAuth=false}={}) {
  fs.mkdirSync(directory, { recursive:true });
  const pg=inspect('jt-postgres'), pgEnv=settings(pg), minio=inspect('jt-minio'), meili=inspect('jt-meilisearch'), redis=inspect('jt-redis'), mail=inspect('jt-mailpit');
  const root=dotenv.parse(fs.readFileSync(path.join(repo,'.env')));
  const source=new URL(root.DATABASE_URL);
  if(!['localhost','127.0.0.1'].includes(source.hostname) || source.pathname==='/'+databaseName) throw Error('Catalog source must be a separate local database');
  const privateFile=path.join(directory,'credentials.json');
  if(!fs.existsSync(privateFile)) fs.writeFileSync(privateFile, JSON.stringify({
    password:'Demo-'+crypto.randomBytes(9).toString('base64url')+'!',
    jwtSecret:crypto.randomBytes(48).toString('hex'),
    accounts:{hr:'hr@demo.talentio.test',admin:'admin@demo.talentio.test',employee:'employee@demo.talentio.test',secondHr:'hr.team@demo.talentio.test',outsider:'hr.other@demo.talentio.test'},
  },null,2));
  const credentials=JSON.parse(fs.readFileSync(privateFile,'utf8'));
  const databaseUrl=`postgresql://${encodeURIComponent(pgEnv.POSTGRES_USER)}:${encodeURIComponent(pgEnv.POSTGRES_PASSWORD)}@127.0.0.1:${port(pg,5432)}/${databaseName}`;
  const s3=`http://localhost:${port(minio,9000)}`;
  // Explicit empty overrides prevent ConfigModule from loading private staging
  // integrations from root .env. Only the catalog-source URL is read separately.
  const env={...process.env,...Object.fromEntries(Object.keys(root).map(k=>[k,''])),
    NODE_ENV:'development', HR_DEMO_MODE:'true', CHECKOUT_TEST_MODE:'true', PORT:'4000', API_PORT:'4000', DATABASE_URL:databaseUrl,
    HR_DEMO_DATABASE_URL:databaseUrl, HR_DEMO_SOURCE_URL:source.toString(), HR_DEMO_DIRECTORY:directory,
    JWT_SECRET:credentials.jwtSecret, JWT_EXPIRES_IN:'15m', JWT_REFRESH_EXPIRES_IN:'30d', DEV_AUTH_ENABLED:'false', SUPERADMIN_PASSWORD:'',
    WEB_URL:'http://localhost:3000', ADMIN_URL:'http://localhost:3001', API_URL:'http://localhost:4000',
    NEXT_PUBLIC_API_URL:'http://localhost:4000', NEXT_PUBLIC_ADMIN_URL:'http://localhost:3001', NEXT_PUBLIC_APP_NAME:'Job Talentio',
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:'', NEXT_PUBLIC_TELEGRAM_BOT_USERNAME:'',
    NEXT_BUILD_DIR:'.next-demo',
    REDIS_URL:`redis://127.0.0.1:${port(redis,6379)}/14`, MEILI_HOST:`http://127.0.0.1:${port(meili,7700)}`,
    MEILI_MASTER_KEY:settings(meili).MEILI_MASTER_KEY, MEILI_JOBS_INDEX:'talentio_hr_demo_jobs',
    S3_ENDPOINT:s3,S3_PUBLIC_URL:s3+'/talentio-hr-demo',S3_BUCKET:'talentio-hr-demo',S3_REGION:'us-east-1',S3_FORCE_PATH_STYLE:'true',
    S3_ACCESS_KEY:settings(minio).MINIO_ROOT_USER,S3_SECRET_KEY:settings(minio).MINIO_ROOT_PASSWORD,
    CV_PARSE_PROVIDER:'local',RESEND_API_KEY:'',SMTP_HOST:'127.0.0.1',SMTP_PORT:port(mail,1025),SMTP_SECURE:'false',SMTP_USER:'',SMTP_PASS:'',SMTP_FROM:'Talentio Demo <demo@talentio.test>',
    TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHANNEL_ID:'',TELEGRAM_WEBHOOK_SECRET:'',
    LINKEDIN_ENABLED:'false',LINKEDIN_ACCESS_VERIFIED:'false',LINKEDIN_CLIENT_ID:'',LINKEDIN_CLIENT_SECRET:'',LINKEDIN_TOKEN_KEYS:'',
  };
  if(realAuth){
    for(const key of ['GOOGLE_CLIENT_ID','TELEGRAM_BOT_TOKEN','TELEGRAM_BOT_USERNAME','TELEGRAM_WEBHOOK_SECRET'])env[key]=root[key]||'';
    env.TELEGRAM_DEV_POLLING='true';
    // Local bot polling does not register a webhook or publish channel announcements.
    env.API_URL='';
  }
  return {env,credentials,pgUser:pgEnv.POSTGRES_USER,databaseUrl};
}
function assertDemoUrl(value) { const u=new URL(value);if(u.hostname!=='127.0.0.1'||u.pathname!=='/'+databaseName) throw Error('Refusing a non-demo database'); }
module.exports={repo,req,directory,databaseName,config,inspect,assertDemoUrl};
