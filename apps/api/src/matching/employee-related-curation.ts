import {EmployeeOccupationIndex,reviewedRelatedRoles,type IntentRole} from './employee-occupation';

/** Explicit development curation; independent human relevance acceptance is separate. */
export const culinaryRelatedPositions = [
 'Sous Chef Dapur Panas','Chef Pastry Restoran','Chef Pengembangan Menu Lokal','Kepala Dapur Dingin','Supervisor Produksi Dapur',
] as const;
export const relatedCurationVersion='culinary-related-20261103-v1';
export function planReviewedRelations(roles:IntentRole[]){
 const index=new EmployeeOccupationIndex(roles,true);
 const decisions=[{from:'Chef',targets:[...culinaryRelatedPositions],reason:'Professional culinary preparation, kitchen organisation and menu development; specialty and seniority requirements remain separate.'},
  {from:'Pastry Chef',targets:['Chef Pastry Restoran'],reason:'Pastry preparation in professional restaurant kitchens.'},
  {from:'Head Chef',targets:['Kepala Dapur Dingin','Sous Chef Dapur Panas','Supervisor Produksi Dapur'],reason:'Leadership and supervision of professional culinary production; level assessed separately.'}];
 const updates:Array<{id:string;name:string;metadata:any;before:unknown}>=[],pending:Array<{from:string;target:string;reason:string}>=[];
 for(const decision of decisions){
  const from=index.resolve(decision.from);
  for(const name of decision.targets){
   const to=index.resolve(name);
   if(!from||!to){pending.push({from:decision.from,target:name,reason:'Reviewed identity not present'});continue;}
   if(from===to)continue;
   const source=index.roles.get(from)!;
   let row=updates.find(u=>u.id===from);
   if(!row){const original=(source.matchingMetadata??{sources:[],relatedRoles:[]}) as any;row={id:from,name:source.name,before:source.matchingMetadata??null,metadata:structuredClone({...original,sources:original.sources??[],relatedRoles:original.relatedRoles??[]})};updates.push(row);}
   const reference=`curation:${relatedCurationVersion}:${decision.reason}`;
   const existing=row.metadata.relatedRoles.find((r:any)=>r.id===to);
   if(!existing)row.metadata.relatedRoles.push({id:to,kind:'RELATED',approved:true,reference});
  }
 }
 return {version:relatedCurationVersion,updates:updates.filter(u=>JSON.stringify(u.metadata)!==JSON.stringify(u.before)),pending};
}
export function recommendationCoverage(roles:IntentRole[],jobs:Array<{jobTitleId:string|null}>,selected:string[]){
 const index=new EmployeeOccupationIndex(roles,true),liveRoots=new Set(jobs.flatMap(j=>{const root=j.jobTitleId&&index.identity(j.jobTitleId);return root?[root.canonicalRoleId]:[]}));
 const scope=new Set([...liveRoots,...selected.flatMap(id=>{const root=index.identity(id);return root?[root.canonicalRoleId]:[];})]);
 return [...scope].sort().map(id=>{const role=index.roles.get(id)!;const related=reviewedRelatedRoles(role).filter(r=>index.identity(r.id)?.canonicalRoleId===r.id);
  return {roleId:id,name:role.name,exactActive:liveRoots.has(id),relatedActive:related.filter(r=>liveRoots.has(r.id)).map(r=>r.id),decision:related.length?'DIRECT_RELATIONS_CONFIGURED':'NO_SUPPORTED_RELATION_IN_CURATED_DATA',humanReview:'PENDING' as const};});
}
