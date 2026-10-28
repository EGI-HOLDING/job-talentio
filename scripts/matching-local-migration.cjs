// Safe local schema rollout. Never seeds, resets, deletes data, or connects to staging.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {createRequire}=require('node:module');const {execFileSync}=require('node:child_process');
const apiRequire=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
const {PrismaClient}=apiRequire('@prisma/client');const dotenv=createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const root=dotenv.parse(fs.readFileSync(path.resolve(__dirname,'../.env'),'utf8'));
const url=new URL(root.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Only the approved local database is allowed');
const name='job_talentio_matching_audit_20261024';
async function main(){
  const applyMain=process.argv.includes('--apply-main');
  if(!applyMain){
    const info=JSON.parse(execFileSync('docker',['inspect','jt-postgres'],{encoding:'utf8',windowsHide:true}))[0];
    const username=info.Config.Env.find(v=>v.startsWith('POSTGRES_USER=')).slice('POSTGRES_USER='.length);
    // TEMPLATE copies data inside PostgreSQL; no credential or business data is printed.
    execFileSync('docker',['exec','jt-postgres','psql','-U',username,'-d','postgres','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE "${name}" TEMPLATE "job_talentio";`],{stdio:'pipe',windowsHide:true});
  }
  const target=new URL(url);if(!applyMain)target.pathname='/'+name;
  const db=new PrismaClient({datasources:{db:{url:target.toString()}}});
  try{
    const before=await Promise.all([db.jobPost.count(),db.application.count(),db.employeeProfile.count(),db.jobTitle.count(),db.jobPostLanguage.count()]);
    const migrationName='20261024200000_employee_matching_evidence';
    const sql=fs.readFileSync(path.resolve(__dirname,`../apps/api/prisma/migrations/${migrationName}/migration.sql`),'utf8');
    const statements=sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
    if(statements.length!==4||statements.some(s=>!/^ALTER TABLE "(?:JobTitle|JobPostLanguage|JobPostSkill|ProfileSkill)" ADD COLUMN /u.test(s)))throw Error('Unexpected migration content');
    await db.$transaction(async tx=>{
      const done=await tx.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name"=$1 AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL',migrationName);
      if(done.length) return;
      for(const statement of statements)await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe('INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","started_at","applied_steps_count") VALUES ($1,$2,NOW(),$3,NOW(),1)',crypto.randomUUID(),crypto.createHash('sha256').update(sql).digest('hex'),migrationName);
    });
    const after=await Promise.all([db.jobPost.count(),db.application.count(),db.employeeProfile.count(),db.jobTitle.count(),db.jobPostLanguage.count()]);
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Business data counts changed');
    console.log(JSON.stringify({database:target.pathname.slice(1),migration:migrationName,preservedCounts:{jobs:after[0],applications:after[1],profiles:after[2],titles:after[3],languages:after[4]}}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
