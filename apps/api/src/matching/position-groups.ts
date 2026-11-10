import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
import {professionDigest,professionCatalogRevision,type ProfessionSource} from './occupation-relations';
import {catalogTitleIdentityKey as key} from '../common/title-resolve';

export const POSITION_GROUP_ALGORITHM='position-groups-v1';
export const groupDigest=(value:unknown):string=>{const stable=(input:unknown):unknown=>Array.isArray(input)?input.map(stable):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):input;return professionDigest(stable(value));};
export const positionRoleRevision=(role:IntentRole)=>{const {relatedRoles,...metadata}=(role.matchingMetadata??{}) as Record<string,unknown>;return professionDigest([role.id,role.name,role.familyId,role.canonicalRoleId,role.matchingApproved,role.archivedAt,metadata,[...role.aliases].sort((a,b)=>a.alias.localeCompare(b.alias))]);};
export type GroupDefinition={id:string;code:string;nameEn:string;definition:string;scope:string;source:unknown;sourceRoleId:string|null;seeds:string[];candidate:string|null;exclude:string|null;task:string|null};
type SourceProfile=ProfessionSource['occupations'][number]&{code?:string};
export function buildPositionGroups(roles:IntentRole[],source:ProfessionSource,heads:GroupDefinition[],englishLabels:Record<string,string>={},corrections:Array<{groupId:string;jobTitleId:string;enabled:boolean;reason:string;source:unknown}>=[]) {
  if(heads.length!==99||new Set(heads.map(h=>h.id)).size!==99)throw new Error('The approved manifest must contain 99 unique groups');
  const index=new EmployeeOccupationIndex(roles),profiles=source.occupations as SourceProfile[];
  const byUri=new Map(profiles.map(p=>[p.uri,p]));
  const preferred=new Map(profiles.map(p=>[key(p.label),p]));
  const aliases=new Map<string,Set<string>>();
  for(const profile of profiles)for(const label of [profile.label,...profile.aliases]){const ids=aliases.get(key(label))??new Set<string>();ids.add(profile.uri);aliases.set(key(label),ids);}
  const local=new Map((source.localDefinitions??[]).flatMap(d=>d.titles.map(title=>[key(title),d] as const)));
  const resolve=(role:IntentRole)=>{
    const definition=local.get(key(role.name));
    if(definition){const profile=preferred.get(key(definition.referenceOccupation));return profile?{profile,description:definition.taskScope,reference:definition.evidence,local:true}:null;}
    const metadata=role.matchingMetadata as {professionSourceUri?:string;sources?:Array<{uri:string}>}|null;
    const uris=new Set([...(metadata?.sources??[]).map(s=>s.uri),metadata?.professionSourceUri].filter((uri):uri is string=>!!uri&&byUri.has(uri)));
    if(!uris.size)for(const label of [role.name,role.nameId,...role.aliases.filter(a=>a.matchingApproved).map(a=>a.alias)])for(const uri of aliases.get(key(label??''))??[])uris.add(uri);
    if(uris.size!==1)return null;
    const profile=byUri.get([...uris][0])!;
    return {profile,description:profile.description,reference:profile.uri,local:false};
  };
  const skillInfo=new Map(source.skills.map(s=>[s.uri,s]));
  const workTasks=(p:SourceProfile)=>p.essential.filter(s=>skillInfo.get(s.uri)?.type==='skill'&&['occupation-specific','sector-specific','cross-sector'].includes(skillInfo.get(s.uri)?.reuse??''));
  const roots=roles.filter(r=>index.identity(r.id)?.canonicalRoleId===r.id).sort((a,b)=>a.id.localeCompare(b.id));
  const mapped=new Map(roots.map(role=>[role.id,resolve(role)]));
  const memberships:Array<{groupId:string;jobTitleId:string;basis:Record<string,unknown>}>=[];
  const labels:Array<{jobTitleId:string;nameEn:string;source:Record<string,unknown>}>=[];
  const unknownLabels:Array<{id:string;name:string}>=[];
  const rootLabels=new Map<string,string>();
  for(const role of roots){
    const resolved=mapped.get(role.id),official=profiles.find(p=>key(p.label)===key(role.name));
    const nameEn=englishLabels[role.id]??englishLabels[role.name]??englishLabels[key(role.name)]??(official?role.name:undefined);
    if(nameEn){rootLabels.set(role.id,nameEn);labels.push({jobTitleId:role.id,nameEn,source:{method:official?'OFFICIAL_ENGLISH_TITLE':'CURATED_ENGLISH_PROJECTION',reference:resolved?.reference??'Talentio catalog label'}});}
    else unknownLabels.push({id:role.id,name:role.name});
  }
  const decisions=new Map<string,{groupId:string;accepted:boolean;reason:string}[]>();
  for(const head of heads){
    const seeds=head.seeds.map(name=>preferred.get(key(name))).filter((p):p is SourceProfile=>!!p);
    const headIdentity=head.sourceRoleId?index.identity(head.sourceRoleId):null;
    const exclude=head.exclude?new RegExp(head.exclude,'i'):null;
    const candidate=head.candidate?new RegExp(head.candidate,'i'):null;
    const task=head.task?new RegExp(head.task,'i'):null;
    for(const role of roots){
      const resolved=mapped.get(role.id),roleLabel=rootLabels.get(role.id)??role.name;
      let basis:Record<string,unknown>|undefined;
      const forbidden=exclude?.test(roleLabel)||exclude?.test(role.name);
      if(!forbidden&&headIdentity?.canonicalRoleId===role.id)basis={method:'EXISTING_HEAD_IDENTITY',source:head.source};
      if(!basis&&resolved&&!forbidden){
        const p=resolved.profile,tasks=workTasks(p),taskIds=new Set(tasks.map(t=>t.uri));
        for(const seed of seeds){
          const same=p.uri===seed.uri;
          const narrower=!!p.code&&!!seed.code&&p.code.startsWith(seed.code+'.');
          const shared=workTasks(seed).filter(s=>taskIds.has(s.uri));
          const scoped=!task||task.test(resolved.description);
          const specificShared=shared.some(s=>['occupation-specific','sector-specific'].includes(skillInfo.get(s.uri)?.reuse??''));
          if((same||narrower)&&(same||specificShared)&&scoped&&resolved.description.trim()){
            basis={method:same?'SOURCED_OCCUPATION_SCOPE':'OCCUPATION_SCOPE_AND_SHARED_TASKS',sourceUri:p.uri,headSourceUri:seed.uri,sourceVersion:source.sourceVersion,description:resolved.description,reference:resolved.reference,sharedTasks:shared};break;
          }
        }
        // Synthetic generic roles require both a profession label and occupational task evidence.
        if(!basis&&candidate&&(candidate.test(p.label)||candidate.test(roleLabel))&&task?.test(resolved.description)&&tasks.some(t=>task.test(t.label))){
          basis={method:'GENERIC_ROLE_WITH_TASK_EVIDENCE',sourceUri:p.uri,sourceVersion:source.sourceVersion,description:resolved.description,tasks:tasks.slice(0,8),reference:resolved.reference};
        }
      }
      if(basis)memberships.push({groupId:head.id,jobTitleId:role.id,basis});
      const entries=decisions.get(role.id)??[];entries.push({groupId:head.id,accepted:!!basis,reason:basis?String(basis.method):forbidden?'INCOMPATIBLE_WORK_SCOPE':resolved?'NO_DIRECT_SCOPE_EVIDENCE':'SOURCE_NOT_AVAILABLE'});decisions.set(role.id,entries);
    }
  }
  // Corrections are direct edges and have their own audit provenance.
  for(const correction of corrections){
    if(!heads.some(h=>h.id===correction.groupId)||index.identity(correction.jobTitleId)?.canonicalRoleId!==correction.jobTitleId)throw new Error('Invalid group correction target');
    const at=memberships.findIndex(m=>m.groupId===correction.groupId&&m.jobTitleId===correction.jobTitleId);
    if(at>=0)memberships.splice(at,1);
    if(correction.enabled)memberships.push({groupId:correction.groupId,jobTitleId:correction.jobTitleId,basis:{method:'CATALOG_CORRECTION',reason:correction.reason,source:correction.source}});
    const decision=decisions.get(correction.jobTitleId)?.find(row=>row.groupId===correction.groupId);
    if(decision){decision.accepted=correction.enabled;decision.reason='CATALOG_CORRECTION: '+correction.reason;}
  }
  const rolesById=new Map(roles.map(role=>[role.id,role]));
  for(const member of memberships)member.basis.roleRevision=positionRoleRevision(rolesById.get(member.jobTitleId)!);
  memberships.sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.jobTitleId.localeCompare(b.jobTitleId));
  const dispositions=roles.map(role=>{const identity=index.identity(role.id);const edges=memberships.filter(m=>m.jobTitleId===identity?.canonicalRoleId);return {id:role.id,name:role.name,canonicalRoleId:identity?.canonicalRoleId??null,status:!identity?'NOT_SELECTABLE':identity.canonicalRoleId!==role.id?'CANONICAL_ALIAS':edges.length?'MAPPED':mapped.get(role.id)?'NO_SUPPORTED_GROUP':'SOURCE_NOT_AVAILABLE',groups:edges.map(m=>m.groupId),decisions:decisions.get(role.id)??[]};});
  const catalogRevision=professionCatalogRevision(roles),checksum=groupDigest([heads,memberships,labels]),id=groupDigest([POSITION_GROUP_ALGORITHM,catalogRevision,checksum]);
  const report={positionsProcessed:roles.length,canonicalPositions:roots.length,groups:heads.length,memberships:memberships.length,mappedPositions:new Set(memberships.map(m=>m.jobTitleId)).size,unknownLabels,coverage:heads.map(h=>({id:h.id,name:h.nameEn,count:memberships.filter(m=>m.groupId===h.id).length})),dispositions};
  return {id,catalogRevision,checksum,algorithmVersion:POSITION_GROUP_ALGORITHM,heads,memberships,labels,report};
}
