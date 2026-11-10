import type { EmployeeEligibility } from '@job-talentio/shared';
import { EmployeeOccupationIndex, reviewedRelatedRoles, type IntentRole } from './employee-occupation';

export type GroupChoice = {id:string;nameEn:string;members:readonly string[];evidence?:Record<string,{method:string;sourceUri?:string;tasks:string[]}>};
/** Direct memberships only. Group IDs and occupational identities never share a namespace. */
export class PositionGroupOccupationIndex extends EmployeeOccupationIndex {
  readonly explicitRoleIds:Set<string>;
  readonly expandedIds:string[];
  private readonly origins=new Map<string,GroupChoice[]>();
  private readonly related=new Map<string,{source:string;reference:string;score?:number}>();
  constructor(roles:IntentRole[], explicitIds:string[], readonly groups:GroupChoice[], readonly release:string) {
    super(roles,true);
    this.explicitRoleIds=new Set(explicitIds.flatMap(id=>this.identity(id)?.canonicalRoleId??[]));
    for(const group of [...groups].sort((a,b)=>a.id.localeCompare(b.id))) {
      for(const member of group.members) {
        const identity=this.identity(member);
        if(!identity||identity.canonicalRoleId!==member)continue;
        const origins=this.origins.get(member)??[];
        origins.push(group);this.origins.set(member,origins);
      }
    }
    this.expandedIds=[...new Set([...this.explicitRoleIds,...this.origins.keys()])].sort();
    for(const source of this.expandedIds)for(const relation of reviewedRelatedRoles(this.roles.get(source)!)){
      if(relation.id===source||this.identity(relation.id)?.canonicalRoleId!==relation.id)continue;
      const previous=this.related.get(relation.id);
      if(!previous||(relation.score??0)>(previous.score??0)||(relation.score??0)===(previous.score??0)&&source.localeCompare(previous.source)<0)this.related.set(relation.id,{source,reference:relation.reference,score:relation.score});
    }
  }
  override eligibility(selectedIds:string[],jobTitleId:string|null|undefined):EmployeeEligibility {
    const target=jobTitleId?this.identity(jobTitleId):null;
    let decision:EmployeeEligibility;
    if(selectedIds===this.expandedIds&&target){
      const id=target.canonicalRoleId;
      if(this.explicitRoleIds.has(id)||this.origins.has(id))decision={eligible:true,reason:'MATCH',...target,matchType:'EXACT',selectedRoleId:id,selectedRoleName:this.roles.get(id)!.name};
      else {const related=this.related.get(id);decision=related?{eligible:true,reason:'MATCH',...target,matchType:'RELATED',selectedRoleId:related.source,selectedRoleName:this.roles.get(related.source)!.name,relationReference:related.reference,relationScore:related.score}:{eligible:false,reason:'POSITION_MISMATCH',...target};}
    }else decision=super.eligibility(selectedIds,jobTitleId);
    if(!decision.eligible)return decision;
    const source=decision.selectedRoleId;
    const group=source?this.origins.get(source)?.[0]:undefined;
    const basis=decision.matchType==='EXACT'&&!this.explicitRoleIds.has(source!)?'GROUP':decision.matchType!;
    return {...decision,matchType:basis,selectionBasis:basis,groupReleaseVersion:this.release,
      ...(group&&!this.explicitRoleIds.has(source!)?{selectedGroupId:group.id,selectedGroupName:group.nameEn,groupMembership:{reference:`position-group:${this.release}:${group.id}:${source}`,method:group.evidence?.[source!]?.method??'VERIFIED_MEMBERSHIP',sourceUri:group.evidence?.[source!]?.sourceUri,tasks:group.evidence?.[source!]?.tasks??[]},...(basis==='GROUP'?{relationReference:`position-group:${this.release}:${group.id}:${source}`}:{})}:{}),
    };
  }
}
