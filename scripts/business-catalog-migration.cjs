const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const {api,url,name,fingerprint}=require('./business-catalog-local.cjs');
const migration='20261105120000_business_catalogs';
const dir=path.resolve('apps/api/prisma/migrations',migration);
function statements(sql){
 let quote=false,dollar=false,line=false,start=0;const result=[];
 for(let i=0;i<sql.length;i++){
  if(line){if(sql[i]==='\n')line=false;else continue;}
  if(!quote&&!dollar&&sql.slice(i,i+2)==='--'){line=true;i++;continue;}
  if(!quote&&sql.slice(i,i+2)==='$$'){dollar=!dollar;i++;continue;}
  if(!dollar&&sql[i]==="'"){if(quote&&sql[i+1]==="'"){i++;continue;}quote=!quote;}
  if(!quote&&!dollar&&sql[i]===';'){const s=sql.slice(start,i).trim();if(s)result.push(s);start=i+1;}
 }
 const tail=sql.slice(start).trim();if(tail)result.push(tail);return result;
}
async function main(){
 if(process.argv.includes('--generate')){
  const old=path.resolve('output/business-catalog/schema-before.prisma');
  fs.mkdirSync(path.dirname(old),{recursive:true});
  fs.writeFileSync(old,execFileSync('git',['show','HEAD:apps/api/prisma/schema.prisma'],{encoding:'utf8'}));
  const sql=execFileSync(process.execPath,[api.resolve('prisma/build/index.js'),'migrate','diff','--from-schema-datamodel',old,'--to-schema-datamodel','apps/api/prisma/schema.prisma','--script'],{encoding:'utf8',windowsHide:true});
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'migration.sql'),sql);
  console.log('Additive migration generated');return;
 }
 url.pathname='/'+name;
 const {PrismaClient}=api('@prisma/client');const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  const before=await fingerprint(db);
  const sql=fs.readFileSync(path.join(dir,'migration.sql'),'utf8');
  const checksum=crypto.createHash('sha256').update(sql).digest('hex');
  await db.$transaction(async tx=>{
   const exists=await tx.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',migration);
   if(exists.length){if(exists[0].checksum!==checksum)throw Error('Applied migration checksum differs');return;}
   if(process.argv.includes('--dry-run')){
    // SQL is run and rolled back, so constraints and DDL are checked on real data.
    for(const statement of statements(sql))await tx.$executeRawUnsafe(statement);throw new Error('DRY_RUN_ROLLBACK');
   }
   for(const statement of statements(sql))await tx.$executeRawUnsafe(statement);
   await tx.$executeRawUnsafe('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ($1,$2,$3,NOW(),NOW(),1)',crypto.randomUUID(),checksum,migration);
  },{timeout:60000}).catch(error=>{if(error.message!=='DRY_RUN_ROLLBACK')throw error;});
  const after=await fingerprint(db);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical data changed');
  fs.writeFileSync('output/business-catalog/migration-'+(process.argv.includes('--dry-run')?'dry-run':'applied')+'.json',JSON.stringify({migration,database:name,preserved:true,before,after},null,2));
  console.log(JSON.stringify({migration,database:name,preserved:true,dryRun:process.argv.includes('--dry-run')}));
 }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
