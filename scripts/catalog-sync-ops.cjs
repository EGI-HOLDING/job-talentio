const fs = require('node:fs');
const path = require('node:path');
const { remote, privateWrite } = require('./catalog-sync-railway.cjs');
const [operation, directory] = process.argv.slice(2);
if (!directory) throw Error('A private artifact directory is required');
const privateRoot = path.resolve('.catalog-sync-private');
const output = path.resolve(directory);
if (!output.startsWith(privateRoot + path.sep)) throw Error('Artifacts must stay in the private catalog-sync cache');
const preamble = `const fs=require('node:fs'),crypto=require('node:crypto');const {PrismaClient}=require('@prisma/client');const engine=require('./dist/catalog-sync/catalog-sync');engine.assertStaging();const p=new PrismaClient();const directory='/tmp/talentio-catalog-sync';`;

if (operation === 'backup') {
  const stamp = Date.now();
  const code = preamble + `
  if(process.env.CATALOG_SYNC_MAINTENANCE!=='true')throw Error('Backup requires maintenance');
  process.umask(0o077);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  (async()=>{try{
    const before=await engine.databaseDigest(p);
    const url=new URL(process.env.DATABASE_URL);for(const key of [...url.searchParams.keys()])if(!['sslmode','sslrootcert','sslcert','sslkey','connect_timeout','application_name','channel_binding'].includes(key))url.searchParams.delete(key);
    const file=directory+'/staging-${stamp}.dump';
    require('node:child_process').execFileSync('pg_dump',[url.toString(),'--format=custom','--no-owner','--no-acl','--file',file],{maxBuffer:1024*1024});
    const after=await engine.databaseDigest(p);if(after.sha256!==before.sha256)throw Error('Database changed during backup');
    const snapshot=JSON.parse(fs.readFileSync(directory+'/local.snapshot.json','utf8'));const plan=await engine.inspectPlan(p,snapshot);
    const receipt={project:process.env.RAILWAY_PROJECT_ID,environment:process.env.RAILWAY_ENVIRONMENT_ID,file,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),databaseDigest:before,targetHash:plan.targetHash,verifiedRestore:false};
    fs.writeFileSync(directory+'/backup-${stamp}.json',JSON.stringify(receipt),{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
  }finally{await p.$disconnect()}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});`;
  const receipt = JSON.parse(remote(code).trim());
  const encoded = remote(`console.log(require('node:fs').readFileSync(${JSON.stringify(receipt.file)}).toString('base64'));`).trim();
  const bytes = Buffer.from(encoded, 'base64');
  const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if (digest !== receipt.sha256) throw Error('Downloaded backup checksum mismatch');
  privateWrite(path.join(output, 'staging-before.dump'), bytes);
  privateWrite(path.join(output, 'backup.receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ operation, bytes: bytes.length, sha256: receipt.sha256, targetHash: receipt.targetHash, databaseDigest: receipt.databaseDigest.sha256 }));
} else if (operation === 'verify') {
  const result = remote(preamble + `(async()=>{try{const s=JSON.parse(fs.readFileSync(directory+'/local.snapshot.json'));const plan=await engine.inspectPlan(p,s);const equal=Object.values(plan.tableChanges).every(t=>t.equal)&&!Object.keys(plan.changes).length&&!plan.conflicts.length;console.log(JSON.stringify({equal,snapshotHash:s.sha256,planHash:plan.planHash,targetHash:plan.targetHash,tables:plan.tableChanges,changes:plan.changes,conflicts:plan.conflicts}));if(!equal)process.exitCode=1;}finally{await p.$disconnect()}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});`);
  privateWrite(path.join(output, 'verification-' + Date.now() + '.json'), result);
  console.log(result.trim());
} else if (operation === 'reindex') {
  console.log(remote(preamble + `(async()=>{try{const indexed=await require('./dist/search/jobs-index.sync').rebuildJobsIndex({prisma:p,host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY,index:process.env.MEILI_JOBS_INDEX||'jobs'});console.log(JSON.stringify({indexed}));}finally{await p.$disconnect()}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});`).trim());
} else throw Error('Usage: catalog-sync-ops backup|verify|reindex [private-artifact-directory]');
