// Only creates and removes its own disposable Docker container, never a VPS DB.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {randomBytes} = require('node:crypto');
const req = createRequire(path.resolve('apps/api/package.json'));
const {PrismaClient} = req('@prisma/client');
req('tsx/cjs');
const engine = req(path.resolve('apps/api/src/catalog-sync/catalog-sync.ts'));
const file = path.resolve(process.argv[2] || '');
const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); engine.validateSnapshot(snapshot);
const docker = args => execFileSync('docker', args, {encoding:'utf8', windowsHide:true}).trim();
const password = randomBytes(24).toString('hex');
const id = docker(['run','--rm','-d','--name','talentio-vps-import-test-'+Date.now(),'-e','POSTGRES_DB=talentio','-e','POSTGRES_PASSWORD='+password,'-p','127.0.0.1::5432','postgres:16-alpine']);
assert.match(id,/^[a-f0-9]{64}$/);
(async()=>{
 let db;
 try {
  for(let i=0;i<100;i++){try{docker(['exec',id,'pg_isready','-U','postgres']);break;}catch{await new Promise(r=>setTimeout(r,200));}}
  const info=JSON.parse(docker(['inspect',id]))[0],port=info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  const env={...process.env,DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/talentio?schema=public`,DEPLOYMENT_TARGET:'indonesia-vps',CATALOG_SOURCE_MODE:'database'};
  const run=(script,args=[],overrides={})=>spawnSync(process.execPath,[req.resolve('tsx/cli'),'--tsconfig',path.resolve('apps/api/tsconfig.json'),script,...args],{env:{...env,...overrides},encoding:'utf8',windowsHide:true});
  execFileSync(process.execPath,[req.resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.resolve('apps/api/prisma/schema.prisma')],{env,stdio:'pipe',windowsHide:true});
  db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  const baselineHash=(await engine.readSnapshot(db,'migration-baseline')).sha256;
  const importer=path.resolve('apps/api/src/scripts/initialize-vps-catalogs.ts');
  const wrong=run(importer,[file,snapshot.sha256,'--apply'],{DEPLOYMENT_TARGET:'railway'});
  assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/dedicated Indonesia/);
  const badHash=run(importer,[file,'a'.repeat(64),'--apply']);assert.notEqual(badHash.status,0);
  assert.equal((await engine.readSnapshot(db,'migration-baseline')).sha256,baselineHash);
  const user=await db.user.create({data:{fullName:'Disposable fixture',role:'EMPLOYEE'}});
  const protectedRun=run(importer,[file,snapshot.sha256,'--apply']);assert.notEqual(protectedRun.status,0);assert.match(protectedRun.stderr,/empty table: User/);
  await db.user.delete({where:{id:user.id}});
  const preview=run(importer,[file,snapshot.sha256,'--dry-run']);assert.equal(preview.status,0,preview.stderr);assert.equal((await engine.readSnapshot(db,'migration-baseline')).sha256,baselineHash);
  const invalid=structuredClone(snapshot);
  const referencedProvince=invalid.tables.City.rows.find(row=>row.provinceId).provinceId;
  invalid.tables.Province.rows=invalid.tables.Province.rows.filter(row=>row.id!==referencedProvince);
  invalid.hashes.Province=engine.sha256(invalid.tables.Province);invalid.sha256=engine.sha256(invalid.hashes);
  engine.validateSnapshot(invalid);
  const invalidFile=path.join(path.dirname(file),'invalid-vps-import-'+Date.now()+'.json');
  fs.writeFileSync(invalidFile,JSON.stringify(invalid),{flag:'wx',mode:0o600});
  try{const failed=run(importer,[invalidFile,invalid.sha256,'--apply']);assert.notEqual(failed.status,0);assert.match(failed.stderr,/foreign key/i);}
  finally{fs.unlinkSync(invalidFile);}
  assert.equal((await engine.readSnapshot(db,'migration-baseline')).sha256,baselineHash,'Failure mid-import must restore every migration placeholder');
  assert.equal(await db.featureFlag.findUnique({where:{key:'talentio_catalog_initialized'}}),null);
  const imported=run(importer,[file,snapshot.sha256,'--apply']);assert.equal(imported.status,0,imported.stderr);
  assert.equal((await engine.readSnapshot(db,'talentio_hr_demo')).sha256,snapshot.sha256);
  assert.equal(await db.user.count(),0);assert.equal(await db.company.count(),0);assert.equal(await db.jobPost.count(),0);
  assert.equal((await db.featureFlag.findUniqueOrThrow({where:{key:'hr_packages'}})).enabled,true);
  const repeat=run(importer,[file,snapshot.sha256,'--apply']);assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/already initialized/);
  assert.equal((await engine.readSnapshot(db,'talentio_hr_demo')).sha256,snapshot.sha256);
  console.log('PASS VPS catalog initialization: target guard, checksum, empty-only guard, read-only preview, mid-import rollback, exact catalogs, zero users/business data, package flags and repeat refusal.');
 }finally{await db?.$disconnect();docker(['rm','-f',id]);}
})().catch(e=>{console.error(e);process.exitCode=1;});
