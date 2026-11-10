import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {desiredSelectionsSchema,type DesiredSelection} from '@job-talentio/shared';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { canonicalRoleNames } from '../common/title-resolve';
type Db = Pick<Prisma.TransactionClient, 'jobTitle'>;
export const desiredRolesInclude = { include: { jobTitle: { include: { family: true,positionGroupLabels:{where:{release:{states:{some:{id:"indonesia"}}}},select:{nameEn:true},take:1} } } } } as const;
export const desiredGroupsInclude = {include:{group:true}} as const;
export function desiredSelectionView(profile:{desiredRoles?:Array<{jobTitleId:string;jobTitle?:{name:string;positionGroupLabels?:Array<{nameEn:string}>}}> ;desiredGroups?:Array<{groupId:string;group?:{nameEn:string}}>}) {
  return [...(profile.desiredRoles??[]).map(row=>({kind:'ROLE' as const,id:row.jobTitleId,name:row.jobTitle?.positionGroupLabels?.[0]?.nameEn??row.jobTitle?.name??row.jobTitleId})),...(profile.desiredGroups??[]).map(row=>({kind:'GROUP' as const,id:row.groupId,name:row.group?.nameEn??row.groupId}))];
}
export async function employeePreferenceUpdate(db: Db, input: {
    desiredSelections?:DesiredSelection[];
    preferencesRevision?:number;
    desiredJobTitleIds?: string[];
    desiredPositions?: string[];
    desiredPosition?: string;
},profileId?:string) {
    if (input.desiredSelections === undefined && input.desiredJobTitleIds === undefined && input.desiredPositions === undefined && input.desiredPosition === undefined)
        return {};
    const tx=db as Prisma.TransactionClient;
    const before=profileId?await tx.employeeProfile.findUniqueOrThrow({where:{id:profileId},select:{preferencesRevision:true,desiredGroups:{select:{groupId:true}}}}):null;
    if(input.desiredSelections===undefined&&before?.desiredGroups.length)throw new ConflictException('POSITION_PREFERENCES_CLIENT_OUTDATED');
    if(input.desiredSelections!==undefined&&(!before||input.preferencesRevision!==before.preferencesRevision))throw new ConflictException('POSITION_PREFERENCES_CHANGED');
    const rows = await db.jobTitle.findMany({ include: intentRoleInclude });
    const index = new EmployeeOccupationIndex(rows);
    if(input.desiredSelections!==undefined){
      const selections=desiredSelectionsSchema.parse(input.desiredSelections);
      if(input.desiredJobTitleIds!==undefined)throw new BadRequestException('Use typed position selections or legacy IDs, not both');
      const roles=selections.filter(s=>s.kind==='ROLE').map(s=>index.identity(s.id)?.canonicalRoleId);
      if(roles.some(id=>!id))throw new BadRequestException('Select active positions from the catalog');
      const roleIds=[...new Set(roles as string[])];
      const groupIds=selections.filter(s=>s.kind==='GROUP').map(s=>s.id);
      if(groupIds.length&&process.env.POSITION_GROUPS_ENABLED!=='true')throw new BadRequestException('Position groups are not available');
      const state=await tx.positionGroupState.findUnique({where:{id:'indonesia'}});
      const groups=groupIds.length&&state?.activeReleaseId?await tx.positionGroup.findMany({where:{id:{in:groupIds},archivedAt:null}}):[];
      if(groups.length!==groupIds.length)throw new BadRequestException('Select groups from the active catalog');
      const labels=new Map(groups.map(g=>[g.id,g.nameEn]));
      const roleLabels=state?.activeReleaseId?await tx.positionGroupRoleLabel.findMany({where:{releaseId:state.activeReleaseId,jobTitleId:{in:roleIds}}}):[];
      const english=new Map(roleLabels.map(r=>[r.jobTitleId,r.nameEn]));
      const normalized=selections.map(s=>s.kind==='ROLE'?{...s,id:index.identity(s.id)!.canonicalRoleId}:s).filter((s,i,all)=>all.findIndex(other=>other.kind===s.kind&&other.id===s.id)===i);
      const names=normalized.map(s=>s.kind==='GROUP'?labels.get(s.id)!:english.get(s.id)??index.roles.get(s.id)!.name);
      return {preferencesRevision:{increment:1},matchingPreferencesReviewed:normalized.length>0,desiredPositions:names,desiredPosition:names[0]??null,
        desiredRoles:{deleteMany:{},create:roleIds.map(jobTitleId=>({jobTitle:{connect:{id:jobTitleId}}}))},
        desiredGroups:{deleteMany:{},create:groupIds.map(groupId=>({group:{connect:{id:groupId}}}))}};
    }
    const strict = input.desiredJobTitleIds !== undefined;
    const texts = input.desiredPositions ?? (input.desiredPosition ? [input.desiredPosition] : []);
    const resolved = strict ? input.desiredJobTitleIds! : texts.map(text => index.resolve(text));
    const ids = [...new Set(resolved.filter((id): id is string => Boolean(id)))];
    if (ids.length > 10 || strict && input.desiredJobTitleIds!.some(id => !index.identity(id)))
        throw new BadRequestException('Select reviewed positions from the catalog');
    const canonical = [...new Set(ids.map(id => index.identity(id)?.canonicalRoleId).filter((id): id is string => Boolean(id)))];
    const unresolved=texts.filter(text=>!index.resolve(text));
    if(canonical.length+unresolved.length>10)throw new BadRequestException('Select at most ten positions including choices awaiting review');
    const reviewed = resolved.length > 0 && resolved.every(id => id && index.identity(id)) && !unresolved.length;
    const names = strict || reviewed ? [...canonical.map(id => index.roles.get(id)!.name),...unresolved] : await canonicalRoleNames(db, texts);
    return { ...(before?{preferencesRevision:{increment:1}}:{}),matchingPreferencesReviewed: Boolean(reviewed), desiredPositions: names, desiredPosition: names[0] ?? null,
        desiredRoles: { deleteMany: {}, create: canonical.map(jobTitleId => ({ jobTitle: { connect: { id: jobTitleId } } })) } };
}
