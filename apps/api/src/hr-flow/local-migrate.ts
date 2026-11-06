import { PrismaClient } from '@prisma/client';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const url=new URL(process.env.DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/talentio_business_catalog_20261105')throw Error('Isolated local clone only');
const db=new PrismaClient();
const recovery=process.argv.includes('--recovery');
const sql=readFileSync('apps/api/prisma/migrations/'+(recovery?'20261106010000_hr_flow_recovery':'20261105160000_hr_creation_flow')+'/migration.sql','utf8');
const rollback=Symbol('rollback');
async function run(){
 const exists=recovery?await db.$queryRaw<Array<{present:boolean}>>`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='JobPurchaseOrder' AND column_name='nextReconcileAt') AS present`:await db.$queryRaw<Array<{present:boolean}>>`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='JobCreationSession') AS present`;
 if(exists[0].present){console.log('HR schema already present; no changes');return;}
 const apply=process.argv.includes('--apply');
 try{await db.$transaction(async tx=>{for(const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(v=>v.trim()))await tx.$executeRawUnsafe(statement);if(!apply)throw rollback;},{timeout:60000});}catch(error){if(error!==rollback)throw error;}
 mkdirSync('output/hr-flow',{recursive:true});writeFileSync('output/hr-flow/migration-'+(recovery?'recovery-':'')+(apply?'applied':'dry-run')+'.json',JSON.stringify({database:url.pathname,sha256:createHash('sha256').update(sql).digest('hex'),applied:apply,success:true},null,2));
 console.log(apply?'HR migration applied to isolated clone':'HR migration dry run passed and rolled back');
}
run().finally(()=>db.$disconnect()).catch(error=>{console.error(error.message);process.exitCode=1;});
