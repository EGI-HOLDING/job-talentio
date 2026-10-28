// Applies only the additive Kanban migration to the named local review DB.
// No seed, reset, external connection, unrelated migration or data deletion.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),req=createRequire(path.join(repo,'apps/api/package.json'));
const dotenv=createRequire(req.resolve('@nestjs/config'))('dotenv');
const settings=dotenv.parse(fs.readFileSync(path.join(repo,'.env'),'utf8'));
const url=new URL(settings.DATABASE_URL);
if(!process.argv.includes('--apply-local')||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/job_talentio')throw Error('Explicit --apply-local and the local review database are required');
const {PrismaClient}=req('@prisma/client'),db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const name='20261026120000_application_kanban';
async function fingerprint(client){return (await client.$queryRawUnsafe(`SELECT COUNT(*)::int count, md5(COALESCE(string_agg((to_jsonb(a)-'kanbanEnteredAt')::text,'' ORDER BY id),'')) digest FROM "Application" a`))[0];}
async function main(){
  try{
    const migrationRoot=path.join(repo,'apps/api/prisma/migrations');
    const applied=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const names=new Set(applied.map(row=>row.migration_name));
    if(names.has(name)){console.log('Local Kanban migration already applied.');return;}
    const previous=fs.readdirSync(migrationRoot).filter(value=>/^\d+_/.test(value)&&value!==name);
    if(previous.some(value=>!names.has(value)))throw Error('Unrelated migrations are pending; no database changes made');
    const sql=fs.readFileSync(path.join(migrationRoot,name,'migration.sql'),'utf8');
    const statements=sql.replace(/--[^\n]*/g,'').split(';').map(value=>value.trim()).filter(Boolean);
    if(statements.length!==3||!statements[0].startsWith('ALTER TABLE "Application" ADD COLUMN "kanbanEnteredAt"')||!statements[1].startsWith('UPDATE "Application"')||!statements[2].startsWith('CREATE INDEX "Application_jobPostId_kanbanEnteredAt_status_idx"'))throw Error('Unexpected migration content');
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe('LOCK TABLE "Application" IN ACCESS EXCLUSIVE MODE');
      const before=await fingerprint(tx);
      for(const statement of statements)await tx.$executeRawUnsafe(statement);
      const after=await fingerprint(tx);
      if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Existing application data changed; rolling back');
      await tx.$executeRawUnsafe('INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ($1,$2,NOW(),$3,NOW(),1)',crypto.randomUUID(),crypto.createHash('sha256').update(sql).digest('hex'),name);
      console.log('Local Kanban migration applied; all '+after.count+' applications and their existing fields preserved.');
    },{timeout:30000});
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message.replaceAll(settings.DATABASE_URL,'[local database]'));process.exitCode=1;});
