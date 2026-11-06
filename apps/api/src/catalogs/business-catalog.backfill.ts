import { Prisma,PrismaClient } from '@prisma/client';
import { INDUSTRY_GROUPS,INDUSTRY_TAXONOMY_VERSION,SENIORITY_LEVELS,SENIORITY_CATALOG_VERSION,legacyIndustryGroupCode } from './business-catalog.data';

export async function businessCatalogReport(db:Prisma.TransactionClient){
 const industries=await db.industry.findMany({include:{_count:{select:{companies:true}},group:true},orderBy:{slug:'asc'}});
 return {industryVersion:INDUSTRY_TAXONOMY_VERSION,seniorityVersion:SENIORITY_CATALOG_VERSION,
  industries:industries.map(row=>({id:row.id,slug:row.slug,legacyGroup:row.group.slug,companies:row._count.companies,groupCode:legacyIndustryGroupCode(row.slug),
   state:row.archivedAt||row.group.archivedAt?'ARCHIVED':legacyIndustryGroupCode(row.slug)?'MAPPED':'REVIEW_REQUIRED',
   reason:legacyIndustryGroupCode(row.slug)?'Explicit existing activity label':'Composite, broad, unknown or context-dependent label; no inferred assignment'})),
  // Six legacy enum values do not uniquely identify one of the new fourteen levels.
  seniorityBackfill:{mapped:0,reason:'No dedicated historical seniority catalog; legacy enum and years are insufficient for a unique mapping'},
 };
}

/** Explicit operation only: no application-startup seed and no other catalog writes. */
export async function installBusinessCatalog(db:PrismaClient,dryRun=true){
 const report=await businessCatalogReport(db);
 if(dryRun)return {...report,dryRun:true};
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('talentio-business-catalog'))::text`;
  const oldIndustry=await tx.industryTaxonomy.findFirst({where:{active:true}});
  const oldSeniority=await tx.seniorityCatalog.findFirst({where:{active:true}});
  if(oldIndustry&&oldIndustry.version!==INDUSTRY_TAXONOMY_VERSION||oldSeniority&&oldSeniority.version!==SENIORITY_CATALOG_VERSION)
   throw new Error('A different version is active; explicit release/rollback is required');
  await tx.industryTaxonomy.upsert({where:{version:INDUSTRY_TAXONOMY_VERSION},create:{version:INDUSTRY_TAXONOMY_VERSION,active:true},update:{}});
  for(const row of INDUSTRY_GROUPS) {
   const existing=await tx.businessIndustryGroup.findUnique({where:{id:row.id}});
   if(existing&&Object.entries(row).some(([key,value])=>existing[key as keyof typeof existing]!==value))throw Error('Industry version already exists with different content');
   await tx.businessIndustryGroup.upsert({where:{id:row.id},create:row,update:{}});
  }
  await tx.seniorityCatalog.upsert({where:{version:SENIORITY_CATALOG_VERSION},create:{version:SENIORITY_CATALOG_VERSION,active:true},update:{}});
  for(const row of SENIORITY_LEVELS){
   const existing=await tx.seniorityLevel.findUnique({where:{code_version:{code:row.code,version:row.version}}});
   if(existing&&Object.entries(row).some(([key,value])=>existing[key as keyof typeof existing]!==value))throw Error('Seniority version already exists with different content');
   await tx.seniorityLevel.upsert({where:{code_version:{code:row.code,version:row.version}},create:row,update:{}});
  }
  for(const row of report.industries.filter(row=>row.state==='MAPPED')) {
   const groupId=`${INDUSTRY_TAXONOMY_VERSION}:${row.groupCode}`;
   const key={industryId:row.id,version:INDUSTRY_TAXONOMY_VERSION};
   const existing=await tx.industryGroupMapping.findUnique({where:{industryId_version:key}});
   if(existing&&existing.groupId!==groupId)throw Error('Mapping conflict: existing mapping must be reviewed explicitly');
   await tx.industryGroupMapping.upsert({where:{industryId_version:key},create:{...key,groupId,source:'talentio-curated-legacy-v1',reason:row.reason},update:{}});
   // Only additive data changes; avoid advancing Company.updatedAt or invoking matching invalidation.
   await tx.$executeRaw`UPDATE "Company" SET "industryGroupId"=${groupId} WHERE "industryId"=${row.id} AND "industryGroupId" IS NULL`;
  }
 },{timeout:60000});
 return {...report,dryRun:false,groups:INDUSTRY_GROUPS.length,seniorityLevels:SENIORITY_LEVELS.length};
}
