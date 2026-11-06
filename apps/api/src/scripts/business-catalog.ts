import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { installBusinessCatalog } from '../catalogs/business-catalog.backfill';
async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply');
 const url=new URL(process.env.DATABASE_URL||'');
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||url.pathname!=='/talentio_business_catalog_20261105')throw Error('Only the isolated local audit database is authorized');
 const db=new PrismaClient();
 try{
  const report=await installBusinessCatalog(db,!apply);
  const file=path.resolve('output/business-catalog',apply?'backfill-applied.json':'backfill-dry-run.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({file,groups:29,levels:14,mapped:report.industries.filter(row=>row.state==='MAPPED').length,review:report.industries.filter(row=>row.state==='REVIEW_REQUIRED').length,dryRun:!apply}));
 }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
