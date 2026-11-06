const fs=require('node:fs'),crypto=require('node:crypto');
const {api,url,name}=require('./business-catalog-local.cjs');
const {PrismaClient}=api('@prisma/client');
async function snapshot(database){
 const target=new URL(url);target.pathname='/'+database;
 const db=new PrismaClient({datasources:{db:{url:target.toString()}}});
 try{return await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const tables=await tx.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const selected=tables.map(row=>row.tablename).filter(table=>/^(?:EmployeeProfile|Resume|ProfileSkill|ProfileLanguage|WorkExperience|EmployeeDesired|_Employee|JobTitleAlias|OccupationRelation|OccupationTask)/.test(table));
  const result={};
  for(const table of selected){
   if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(table))throw Error('Unexpected table identifier');
   const rows=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`);
   result[table]={count:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return result;
 },{timeout:60000});}finally{await db.$disconnect();}
}
async function main(){
 const source=await snapshot('talentio_mapping_local_20261103'),current=await snapshot(name);
 const preserved=JSON.stringify(source)===JSON.stringify(current);
 fs.writeFileSync('output/business-catalog/evidence-preservation.json',JSON.stringify({reference:'Original local source clone',preserved,source,current},null,2));
 console.log(JSON.stringify({preserved,tables:Object.keys(current).length,tableNames:Object.keys(current)}));
 if(!preserved)throw Error('CV/profile/catalog evidence differs from the original local source clone');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
