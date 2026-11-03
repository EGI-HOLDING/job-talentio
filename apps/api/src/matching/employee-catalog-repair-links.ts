import { EmployeeOccupationIndex } from './employee-occupation';
import { catalogDigest } from './employee-catalog-repair';

export function planJobOccupationLinks(jobs:Array<{id:string;title:string;jobTitleId:string|null;status?:string}>,index:EmployeeOccupationIndex){
 const updates:Array<{id:string;expectedTitle:string;expectedJobTitleId:string|null;jobTitleId:string}>=[],unresolved:Array<{id:string;title:string;reason:string}>=[];
 for(const job of jobs){
   // A currently valid stored identity remains authoritative. Historical or
   // branded display titles must not silently replace the employer's role.
   if(job.jobTitleId&&index.identity(job.jobTitleId))continue;
   const id=index.resolve(job.title);
   if(id)updates.push({id:job.id,expectedTitle:job.title,expectedJobTitleId:job.jobTitleId,jobTitleId:id});
   else unresolved.push({id:job.id,title:job.title,reason:'No unique approved occupation label or alias'});
 }
 return {updates,unresolved};
}
export function planCandidatePreferences(profiles:Array<{id:string;desiredPositions:string[];desiredPosition:string|null;matchingPreferencesReviewed:boolean;desiredRoles:Array<{jobTitleId:string}>;phone?:string|null;onboardingStatus?:string}>,index:EmployeeOccupationIndex){
 const updates:Array<{id:string;ids:string[];names:string[];expectedRevision:string;requiresContactReview:boolean}>=[],unresolved:Array<{id:string;positions:string[];reason:string}>=[];
 for(const p of profiles){
   if(p.matchingPreferencesReviewed&&p.desiredRoles.length&&p.desiredRoles.every(r=>index.identity(r.jobTitleId)))continue;
   const texts=p.desiredPositions.length?p.desiredPositions:p.desiredPosition?[p.desiredPosition]:[];
   if(!texts.length&&!p.desiredRoles.length)continue;
   const resolved=texts.length?texts.map(t=>index.resolve(t)):p.desiredRoles.map(r=>index.identity(r.jobTitleId)?.canonicalRoleId||null);
   if(!resolved.length||resolved.some(r=>!r)||new Set(resolved).size>10){unresolved.push({id:p.id,positions:texts,reason:'At least one choice needs review; all existing choices retained'});continue;}
   const ids=[...new Set([...(resolved as string[]),...p.desiredRoles.flatMap(r=>{const id=index.identity(r.jobTitleId)?.canonicalRoleId;return id?[id]:[];})])];
   if(ids.length>10){unresolved.push({id:p.id,positions:texts,reason:'More than ten distinct choices; existing selections retained for review'});continue;}
   updates.push({id:p.id,ids,names:ids.map(id=>index.roles.get(id)!.name),requiresContactReview:p.onboardingStatus==='COMPLETED'&&!p.phone?.trim(),expectedRevision:catalogDigest([p.desiredPositions,p.desiredPosition,p.matchingPreferencesReviewed,p.desiredRoles.map(r=>r.jobTitleId).sort(),p.phone||null,p.onboardingStatus||null])});
 }
 return {updates,unresolved};
}
