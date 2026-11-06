import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { liveJobWhere } from '../benefits/benefit-policy';
import type { CandidateCache } from '../common/candidate-cache';

export type BusinessIndustryGroupRow={id:string;code:string;version:string;name:string;nameId:string;nameUz:string;nameRu:string;industryId:string|null};
export async function businessIndustryGroupIndex(db:Prisma.TransactionClient,cache?:CandidateCache):Promise<BusinessIndustryGroupRow[]>{
  const load=()=>db.$queryRaw<BusinessIndustryGroupRow[]>(Prisma.sql`
    SELECT g.id,g.code,g.version,g.name,g."nameId",g."nameUz",g."nameRu",m."industryId" FROM "BusinessIndustryGroup" g
    JOIN "IndustryTaxonomy" t ON t.version=g.version AND t.active=true
    LEFT JOIN "IndustryGroupMapping" m ON m."groupId"=g.id WHERE g."archivedAt" IS NULL`);
  if(!cache)return load();
  return cache.memo('industry-group-index-v1:'+await cache.version('catalog'),600,load);
}

export const industryGroupSelect = {id:true,code:true,version:true,name:true,nameId:true,nameUz:true,nameRu:true,archivedAt:true} as const;
export const publicCompanyWhere = ():Prisma.CompanyWhereInput => ({isBanned:false,anonymizedAt:null,jobPosts:{some:{...liveJobWhere(),isAnonymous:false}}});

/** Direct classification wins; detail mapping is a fallback for legacy companies. */
export function industryGroupWhere(codes:string[]):Prisma.CompanyWhereInput {
  const group = {code:{in:codes},archivedAt:null,taxonomy:{active:true}};
  return {OR:[{industryGroups:{some:group}},{industryGroups:{none:{}},OR:[{industryGroup:group},{industryGroupId:null,industry:{businessMappings:{some:{group}}}}]}]};
}
export function industryGroupSql(code:string) {
  return Prisma.sql`AND EXISTS (SELECT 1 FROM "BusinessIndustryGroup" g JOIN "IndustryTaxonomy" t ON t.version=g.version AND t.active=true
    WHERE g.code=${code} AND g."archivedAt" IS NULL AND (EXISTS(SELECT 1 FROM "_CompanyIndustryGroups" x WHERE x."A"=g.id AND x."B"=c.id) OR (NOT EXISTS(SELECT 1 FROM "_CompanyIndustryGroups" x WHERE x."B"=c.id) AND (g.id=c."industryGroupId" OR (c."industryGroupId" IS NULL AND EXISTS
    (SELECT 1 FROM "IndustryGroupMapping" m WHERE m."industryId"=c."industryId" AND m."groupId"=g.id))))))`;
}

type IndustryInput={industrySlug?:string|null;industryGroupCode?:string|null;industryGroupCodes?:string[]};
type ExistingIndustry={id?:string;industryId:string|null;industryGroupId:string|null};
/** Caller must hold the Company lock and perform the write in this transaction. */
export async function resolveCompanyIndustry(db:Prisma.TransactionClient,input:IndustryInput,existing?:ExistingIndustry) {
  if(input.industryGroupCodes!==undefined){
    await db.$queryRaw`SELECT version FROM "IndustryTaxonomy" WHERE active=true FOR SHARE`;
    const codes=input.industryGroupCodes;
    if(!codes.length||codes.length>29||new Set(codes).size!==codes.length)throw new BadRequestException('INVALID_INDUSTRY_GROUPS');
    const groups=await db.businessIndustryGroup.findMany({where:{code:{in:codes},archivedAt:null,taxonomy:{active:true}}});
    if(groups.length!==codes.length)throw new BadRequestException('INDUSTRY_GROUP_UNAVAILABLE');
    if(input.industryGroupCode!==undefined&&input.industryGroupCode!==null&&!codes.includes(input.industryGroupCode))throw new BadRequestException('INDUSTRY_GROUP_CONFLICT');
    const industry=input.industrySlug?await db.industry.findFirst({where:{slug:input.industrySlug,archivedAt:null,group:{archivedAt:null}}}):null;
    if(input.industrySlug&&!industry)throw new BadRequestException('INDUSTRY_UNAVAILABLE');
    const industryId=input.industrySlug===undefined?existing?.industryId??null:industry?.id??null;
    if(industryId&&!await db.industryGroupMapping.findFirst({where:{industryId,groupId:{in:groups.map(g=>g.id)}}}))throw new BadRequestException('INDUSTRY_GROUP_CONFLICT: Explicitly clear or replace the detail');
    const ids=groups.map(g=>({id:g.id}));
    return {industryId,industryGroupId:groups.length===1?groups[0].id:null,industryGroups:{set:existing?ids:undefined,connect:existing?undefined:ids}};
  }
  if(existing?.id){
    const groups=await db.company.findUnique({where:{id:existing.id},select:{industryGroups:{select:{id:true,code:true}}}});
    if((groups?.industryGroups.length??0)>1){
      if(input.industryGroupCode!==undefined||input.industrySlug!==undefined){
        const detail=input.industrySlug?await db.industry.findUnique({where:{slug:input.industrySlug}}):null;
        if(input.industryGroupCode!==undefined||detail?.id!==existing.industryId)throw new BadRequestException('MULTIPLE_INDUSTRIES_REQUIRE_GROUP_CODES');
      }
      return {};
    }
  }
  if(input.industrySlug===undefined&&input.industryGroupCode===undefined)return {};
  await db.$queryRaw`SELECT version FROM "IndustryTaxonomy" WHERE active=true FOR SHARE`;
  const taxonomy=await db.industryTaxonomy.findFirst({where:{active:true}});
  const industry=input.industrySlug ? await db.industry.findFirst({where:{slug:input.industrySlug,archivedAt:null,group:{archivedAt:null}}}) : null;
  if(input.industrySlug&&!industry)throw new BadRequestException('INDUSTRY_UNAVAILABLE');
  const industryId=input.industrySlug===undefined?existing?.industryId??null:industry?.id??null;
  const mapping=industryId&&taxonomy?await db.industryGroupMapping.findUnique({where:{industryId_version:{industryId,version:taxonomy.version}},include:{group:true}}):null;
  let industryGroupId=existing?.industryGroupId??null;
  if(input.industryGroupCode!==undefined) {
    if(!input.industryGroupCode)industryGroupId=null;
    else {
      const group=taxonomy?await db.businessIndustryGroup.findUnique({where:{code_version:{code:input.industryGroupCode,version:taxonomy.version}}}):null;
      if(!group||group.archivedAt)throw new BadRequestException('INDUSTRY_GROUP_UNAVAILABLE');
      industryGroupId=group.id;
    }
  } else if(input.industrySlug) {
    industryGroupId=mapping&&!mapping.group.archivedAt?mapping.groupId:null;
  }
  if(industryId&&industryGroupId&&(!mapping||mapping.groupId!==industryGroupId||mapping.group.archivedAt))
    throw new BadRequestException('INDUSTRY_GROUP_CONFLICT: Replace or explicitly clear the detail');
  if(input.industryGroupCode===null&&industryId)throw new BadRequestException('INDUSTRY_GROUP_CONFLICT: Clear the detail as well');
  return {industryId,industryGroupId};
}

const snapshotFields=['seniorityVersion','seniorityYearsMin','seniorityYearsMax','seniorityLevelId'];
export async function resolveSeniority(db:Prisma.TransactionClient,input:Record<string,unknown>,existing?:{seniorityLevelCode:string|null},frozenVersion?:string) {
  if(snapshotFields.some(key=>input[key]!==undefined))throw new BadRequestException('SENIORITY_SNAPSHOT_READ_ONLY');
  if(input.seniorityLevelCode===undefined) {
    if(existing?.seniorityLevelCode&&input.experienceYearsMin!==undefined)throw new BadRequestException('SENIORITY_EXPERIENCE_AUTOMATIC');
    return {};
  }
  if(input.seniorityLevelCode===null)return {seniorityLevelCode:null,seniorityVersion:null,seniorityYearsMin:null,seniorityYearsMax:null};
  if(input.experienceYearsMin!==undefined)throw new BadRequestException('SENIORITY_EXPERIENCE_AUTOMATIC');
  await db.$queryRaw`SELECT version FROM "SeniorityCatalog" WHERE active=true FOR SHARE`;
  const catalog=frozenVersion?await db.seniorityCatalog.findUnique({where:{version:frozenVersion}}):await db.seniorityCatalog.findFirst({where:{active:true}});
  const level=catalog?await db.seniorityLevel.findUnique({where:{code_version:{code:String(input.seniorityLevelCode),version:catalog.version}}}):null;
  if(!level||level.archivedAt)throw new BadRequestException('SENIORITY_UNAVAILABLE');
  return {seniorityLevelCode:level.code,seniorityVersion:level.version,seniorityYearsMin:level.yearsMin,seniorityYearsMax:level.yearsMax};
}
