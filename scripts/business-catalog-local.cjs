// Local-only audit/migration harness; never reads or connects to VPS.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
const dotenv = createRequire(api.resolve('@nestjs/config'))('dotenv');
const env = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../.env')));
const url = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5434') throw Error('Local PostgreSQL only');
const name = 'talentio_business_catalog_20261105';
const { PrismaClient } = api('@prisma/client');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fingerprint(db) {
  const names = ['IndustryGroup', 'Industry', 'Company', 'JobPost', 'JobTitle', 'JobFamily', 'Application', 'ResumeVersion', 'ApplicationRecruiterEvaluation'];
  const result = {};
  for (const name of names) {
    const exists = await db.$queryRawUnsafe('SELECT to_regclass($1)::text AS name', '"'+name+'"');
    if (!exists[0].name) continue;
    // Remove only the additive columns; changing existing fields is a regression.
    const rows = await db.$queryRawUnsafe(`SELECT (to_jsonb(t) - 'industryGroupId' - 'seniorityLevelCode' - 'seniorityVersion' - 'seniorityYearsMin' - 'seniorityYearsMax') AS row FROM "${name}" t ORDER BY id`);
    result[name] = { count: rows.length, sha256: digest(rows) };
  }
  return result;
}
async function main() {
  if (process.argv.includes('--clone')) {
    const info = JSON.parse(execFileSync('docker', ['inspect', 'jt-postgres'], {encoding:'utf8',windowsHide:true}))[0];
    const username = info.Config.Env.find(v=>v.startsWith('POSTGRES_USER=')).slice(14);
    const sql = `SELECT datname FROM pg_database WHERE datname='${name}'`;
    const exists = execFileSync('docker',['exec','jt-postgres','psql','-U',username,'-d','postgres','-Atc',sql],{encoding:'utf8',windowsHide:true}).trim();
    if (!exists) execFileSync('docker',['exec','jt-postgres','psql','-U',username,'-d','postgres','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE "${name}" TEMPLATE "talentio_mapping_local_20261103"`],{stdio:'pipe',windowsHide:true});
  }
  url.pathname = '/'+name;
  const db = new PrismaClient({datasources:{db:{url:url.toString()}}});
  try {
    const baseline = await fingerprint(db);
    fs.mkdirSync('output/business-catalog', {recursive:true});
    const filename = 'output/business-catalog/'+(process.argv.includes('--after')?'after':'baseline')+'.json';
    if (!fs.existsSync(filename) || process.argv.includes('--after')) fs.writeFileSync(filename,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),database:name,tables:baseline},null,2));
    console.log(JSON.stringify({database:name,tables:baseline}));
  } finally { await db.$disconnect(); }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={api,env,url,name,fingerprint};
