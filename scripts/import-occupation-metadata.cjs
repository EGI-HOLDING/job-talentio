// Explicit local import; never called by startup or seed. Default: dry run.
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const apiRequire=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
const {PrismaClient,Prisma}=apiRequire('@prisma/client');
const dotenv=createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const {occupationMatchingMetadataSchema}=apiRequire('@job-talentio/shared');
async function main(){
  const root=dotenv.parse(fs.readFileSync(path.resolve(__dirname,'../.env'),'utf8'));
  const databaseUrl=process.env.DATABASE_URL || root.DATABASE_URL;
  const url=new URL(databaseUrl);
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||!/^\/job_talentio(?:_matching_audit_[a-z0-9_]+)?$/.test(url.pathname))throw Error('Only the local Talentio database or isolated matching audit databases are allowed');
  const db=new PrismaClient({datasources:{db:{url:databaseUrl}}});
  try{
    const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../apps/api/prisma/data/job-titles/audit-2026-10-24.json'),'utf8'));
    const existing=await db.jobTitle.findMany({select:{id:true,matchingMetadata:true}});
    const targets=new Map(existing.map(row=>[row.id,row]));let planned=0,missing=0,preserved=0;
    const apply=process.argv.includes('--apply');
    await db.$transaction(async tx=>{
      for(const row of data.rows){
        const target=targets.get(row.targetId);if(!target){missing++;continue;}if(target.matchingMetadata){preserved++;continue;}
        const source=row.source || {};
        const metadata=occupationMatchingMetadataSchema.parse({sources:[{provider:source.provider || 'Talentio catalog audit',version:source.version || data.datasetId,
          ...(source.uri ? {uri:source.uri} : {}),...(source.code ? {code:source.code} : {})}],
          ...(source.isco08 ? {isco08:source.isco08} : {}),labelReview:{id:'UNREVIEWED',uz:'UNREVIEWED'},relatedRoles:[]});
        planned++;
        if(apply)await tx.jobTitle.updateMany({where:{id:target.id,matchingMetadata:{equals:Prisma.DbNull}},data:{matchingMetadata:metadata}});
      }
    },{timeout:120000});
    console.log(JSON.stringify({mode:apply?'apply':'dry-run',planned,missing,preserved,dataset:data.datasetId}));
  }finally{await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
