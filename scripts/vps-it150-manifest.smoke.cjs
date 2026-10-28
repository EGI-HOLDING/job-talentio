const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
process.env.VPS_SEED_SOURCE='true';process.env.TSX_TSCONFIG_PATH=path.resolve('apps/api/tsconfig.json');
const {validateManifest,guardTarget}=require('./vps-it150-seed.cjs');
const manifest=JSON.parse(fs.readFileSync('apps/api/prisma/data/indonesia-it150.v1.json','utf8'));
validateManifest(manifest);
assert.ok(!/"password(?:Hash)?"\s*:/i.test(JSON.stringify(manifest)));
const target={DATABASE_URL:'postgres://app:unused@host.docker.internal:5432/talentio',DEPLOYMENT_TARGET:'indonesia-vps',CATALOG_SOURCE_MODE:'database'};
guardTarget(target);
for(const env of [{...target,DEPLOYMENT_TARGET:'railway'},{...target,CATALOG_SOURCE_MODE:'legacy'},{...target,DATABASE_URL:'postgres://app:unused@host.docker.internal:5432/other'},{...target,DATABASE_URL:'postgres://app:unused@unapproved-host:5432/talentio'}])assert.throws(()=>guardTarget(env));
for(const mutate of [m=>m.jobs.pop(),m=>m.jobs[0].package='PREMIUM',m=>m.jobs[0].description='Isi terlalu pendek.',m=>m.jobs[0].countryIso2='UZ',m=>m.jobs[0].description=m.jobs[1].description,m=>m.companies[0].logoSvg='<svg onload="bad()"/>']){
 const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>validateManifest(copy));
}
console.log('PASS Indonesia VPS manifest: 3 companies, 150 unique IT postings, exact package/level/mode/city distributions, Indonesian editorial sections, word counts, seed target guards and no embedded passwords.');
