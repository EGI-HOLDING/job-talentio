import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { currentRoleIdentity, currentRoleSelect } from '../matching/employee-occupation';

/** The new path never creates or edits catalog entries, or strips occupation words. */
export async function resolveHrPosition(db: Prisma.TransactionClient, data: Record<string, unknown>) {
  const text=String(data.title??'').trim();
  if(data.positionEntryMode==='CATALOG') {
    const role=typeof data.jobTitleId==='string'?await db.jobTitle.findUnique({where:{id:data.jobTitleId},select:{...currentRoleSelect,name:true}}):null;
    if(!currentRoleIdentity(role))throw new BadRequestException('POSITION_UNAVAILABLE: Choose another position');
    return {title:role!.name,jobTitleId:role!.id,positionEntryMode:'CATALOG'};
  }
  if(text.length<3||text.length>200)throw new BadRequestException('INVALID_POSITION');
  const candidates=await db.jobTitle.findMany({where:{archivedAt:null,OR:[
    ...(['name','nameId','nameUz','nameRu'] as const).map(key=>({[key]:{equals:text,mode:'insensitive' as const}})),
    {aliases:{some:{aliasKey:catalogTitleIdentityKey(text),matchingApproved:true}}},
  ]},select:currentRoleSelect});
  const identities=candidates.map(r=>({id:r.id,identity:currentRoleIdentity(r)}));
  const unique=new Set(identities.map(r=>r.identity?.canonicalRoleId??'unresolved'));
  const id=identities.length&&unique.size===1&&identities[0].identity?identities[0].identity.canonicalRoleId:null;
  return {title:text,jobTitleId:id,positionEntryMode:'MANUAL'};
}

export function effectiveExperience(input:Record<string,unknown>,snapshot:{seniorityLevelCode?:string|null;seniorityYearsMin?:number|null;seniorityYearsMax?:number|null},existing?:{seniorityLevelCode:string|null;seniorityYearsMin?:number|null;seniorityYearsMax?:number|null;experienceRangeMin:number|null;experienceRangeMax:number|null;experienceRangeSource:string|null}) {
  const changed=input.seniorityLevelCode!==undefined;
  if(changed&&input.seniorityLevelCode===null){
    if(input.experienceRangeMin!=null||input.experienceRangeMax!=null)throw new BadRequestException('EXPERIENCE_REQUIRES_SENIORITY');
    return {experienceRangeMin:null,experienceRangeMax:null,experienceRangeSource:null};
  }
  const override=input.experienceRangeMin!==undefined||input.experienceRangeMax!==undefined;
  if(!changed&&!override)return {};
  if(!(snapshot.seniorityLevelCode??existing?.seniorityLevelCode))throw new BadRequestException('EXPERIENCE_REQUIRES_SENIORITY');
  const baseMin=changed?snapshot.seniorityYearsMin:existing?.experienceRangeMin??existing?.seniorityYearsMin;
  const baseMax=changed?snapshot.seniorityYearsMax:existing?.experienceRangeSource?existing.experienceRangeMax:existing?.seniorityYearsMax;
  const min=input.experienceRangeMin===undefined?baseMin:input.experienceRangeMin;
  const max=input.experienceRangeMax===undefined?baseMax:input.experienceRangeMax;
  if(typeof min!=='number'||!Number.isInteger(min)||min<0||min>50||max!==null&&(typeof max!=='number'||!Number.isInteger(max)||max<min||max>50))throw new BadRequestException('INVALID_EXPERIENCE_RANGE');
  const isDefault=min===(changed?snapshot.seniorityYearsMin:existing?.seniorityYearsMin)&&max===(changed?snapshot.seniorityYearsMax:existing?.seniorityYearsMax);
  return {experienceRangeMin:min,experienceRangeMax:max as number|null,experienceRangeSource:!override||isDefault?'CATALOG_DERIVED':'EMPLOYER_ADJUSTED'};
}

export const structuredJobFields=(data:Record<string,unknown>)=>({
  responsibilities:data.responsibilities as string[]|undefined,
  kpis:data.kpis as string[]|undefined,
  specificExpectations:data.specificExpectations as string|null|undefined,
});
