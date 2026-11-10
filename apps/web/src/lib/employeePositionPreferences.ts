import type {DesiredSelection} from '@job-talentio/shared';
export const employeePositionPreferencesEnabled = true;
export const positionGroupsUiEnabled=process.env.NEXT_PUBLIC_POSITION_GROUPS_ENABLED==='true';
export type NamedPositionSelection=DesiredSelection&{name:string};
export function positionPreferenceSelections(profile:{desiredSelections?:NamedPositionSelection[];desiredRoles?:Array<{jobTitleId:string;jobTitle:{name:string}}> ;desiredGroups?:Array<{groupId:string;group:{nameEn:string}}>}) :NamedPositionSelection[]{
  return profile.desiredSelections??[...(profile.desiredRoles??[]).map(r=>({kind:'ROLE' as const,id:r.jobTitleId,name:r.jobTitle.name})),...(profile.desiredGroups??[]).map(r=>({kind:'GROUP' as const,id:r.groupId,name:r.group.nameEn}))];
}

export function positionPreferenceNames(profile: {
  desiredSelections?:NamedPositionSelection[];
  desiredRoles?: Array<{ jobTitle: { name: string } }>;
  desiredPositions?: string[];
  desiredPosition?: string | null;
  matchingPreferencesReviewed?: boolean;
}) {
  const selected = profile.desiredSelections?.map(s=>s.name)??profile.desiredRoles?.map(role => role.jobTitle.name)??[];
  const legacy = profile.desiredPositions?.length ? profile.desiredPositions : profile.desiredPosition ? [profile.desiredPosition] : [];
  if (profile.matchingPreferencesReviewed === false) return [...selected,...legacy.filter(name=>!selected.includes(name))];
  return selected.length ? selected : legacy;
}
