import {createHash} from 'node:crypto';
import {catalogTitleIdentityKey as key} from '../common/title-resolve';
import {EmployeeOccupationIndex,type IntentRole} from './employee-occupation';
import {buildTaskDictionary,hasSpecificTaskOutput,independentTaskIds,taskKind,type TaskSkill,TASK_CONCEPT_VERSION} from './task-concepts';

export const PROFESSION_RELATION_ALGORITHM='talentio-core-tasks-v1@'+TASK_CONCEPT_VERSION;
const MIN_SHARED_CORE_TASKS=2;
const MIN_NARROWER_CORE_COVERAGE=0.25;
const MIN_BROADER_CORE_COVERAGE=0.08;
export const professionDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type LocalProfessionDefinition = {
  titles: readonly string[];
  referenceOccupation: string;
  taskScope: string;
  evidence: string;
  coreTasks?: readonly { id: string; label: string }[];
};
export type ProfessionWorkScope = {
  dimension: string;
  outputs: readonly string[];
  titles: readonly string[];
};
export type ProfessionSource={source:string;sourceVersion:string;sourceUrl:string;taskVocabularyDigest?:string;occupations:Array<{uri:string;label:string;aliases:string[];description:string;scopeNote:string;essential:Array<{uri:string;label:string}>;optional:Array<{uri:string;label:string}>}>;skills:TaskSkill[];localDefinitions?:readonly LocalProfessionDefinition[];workScopes?:readonly ProfessionWorkScope[]};
export function professionCatalogRevision(roles:IntentRole[]){return professionDigest([...roles].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>[r.id,r.name,r.nameId,r.nameUz,r.nameRu,r.canonicalRoleId,r.familyId,r.matchingApproved,!!r.archivedAt,!!r.family?.archivedAt,r.matchingMetadata,r.aliases.map(a=>[a.alias,a.matchingApproved]).sort()]));}

/** No candidate, CV, employer or live-job data is an input to this graph. */
export function buildProfessionGraph(roles:IntentRole[],source:ProfessionSource){
 const index=new EmployeeOccupationIndex(roles),byUri=new Map(source.occupations.map(p=>[p.uri,p]));
 const byLabel=new Map<string,Set<string>>();
 for(const p of source.occupations)for(const label of [p.label,...(Array.isArray(p.aliases)?p.aliases:[])]){const k=key(label),ids=byLabel.get(k)||new Set<string>();ids.add(p.uri);byLabel.set(k,ids);}
 const localProfiles = new Map<string,{profile:ProfessionSource['occupations'][number];definition:LocalProfessionDefinition}>();
 const preferredLabels = new Map<string,Set<string>>();
 const scopes = new Map<string,Map<string,Set<string>>>();
 for (const scope of source.workScopes ?? []) {
   for (const title of scope.titles) {
     const label = key(title);
     const dimensions = scopes.get(label) ?? new Map<string,Set<string>>();
     if (dimensions.has(scope.dimension)) throw new Error('Duplicate occupational work scope: ' + title);
     dimensions.set(scope.dimension, new Set(scope.outputs));
     scopes.set(label, dimensions);
   }
 }
 for (const profile of source.occupations) {
   const label = key(profile.label);
   const matches = preferredLabels.get(label) ?? new Set<string>();
   matches.add(profile.uri);
   preferredLabels.set(label, matches);
 }
 for (const definition of source.localDefinitions ?? []) {
   const references = preferredLabels.get(key(definition.referenceOccupation));
   if (references?.size !== 1) throw new Error('Unresolved profession reference: ' + definition.referenceOccupation);
   if (!definition.taskScope.trim() || !definition.evidence.trim()) throw new Error('Missing local task evidence');
   const profile = byUri.get([...references][0])!;
   for (const title of definition.titles) {
     const label = key(title);
     if (localProfiles.has(label)) throw new Error('Duplicate local task profile: ' + title);
     localProfiles.set(label, {profile,definition});
   }
 }
 const resolve=(r:IntentRole):{profile:ProfessionSource['occupations'][number];method:string;definition?:LocalProfessionDefinition}|null=>{
  const metadata=r.matchingMetadata as {
    sources?:Array<{uri?:string}>;
    professionSourceUri?:string;
    professionTaskProfile?:{scope:string;evidence:string;skillUris:string[]};
  }|null;
  if(metadata?.professionSourceUri){
    const reference=byUri.get(metadata.professionSourceUri);
    if(!reference)return null;
    const scoped=metadata.professionTaskProfile;
    if(!scoped)return {profile:reference,method:'ADMIN_SOURCE_URI'};
    const referenceSkills=new Map([...reference.optional,...reference.essential].map(skill=>[skill.uri,skill]));
    const essential=[...new Set(scoped.skillUris)].map(uri=>referenceSkills.get(uri));
    if(!essential.length||essential.some(skill=>!skill))return null;
    return {
      profile:{...reference,essential:essential.filter(skill=>skill!==undefined),optional:[]},
      method:'ADMIN_TASK_PROFILE',
      definition:{titles:[r.name],referenceOccupation:reference.label,taskScope:scoped.scope,evidence:scoped.evidence},
    };
  }
  const uris=(metadata?.sources||[]).map(s=>s.uri).filter((uri):uri is string=>!!uri&&byUri.has(uri));
  if(new Set(uris).size===1)return {profile:byUri.get(uris[0])!,method:'SOURCE_URI'};
  if(uris.length)return null;
  const labels=[r.name,r.nameId,r.nameUz,r.nameRu,...r.aliases.filter(a=>a.matchingApproved).map(a=>a.alias)].filter((s):s is string=>!!s);
  const matches=new Set(labels.flatMap(label=>[...(byLabel.get(key(label))||[])]));
  const local = localProfiles.get(key(r.name));
  if (local) return {...local,method:'LOCAL_TASK_REFERENCE'};
  return matches.size===1?{profile:byUri.get([...matches][0])!,method:'OFFICIAL_LABEL_OR_ALIAS'}:null;
 };
 const profiles=roles.map(r=>{
   const identity=index.identity(r.id),root=identity?index.roles.get(identity.canonicalRoleId)!:null,mapped=root?resolve(root):null;
   return {
     jobTitleId:r.id,
     sourceUri:mapped?.profile.uri||null,
     mappingMethod:!identity?'NOT_SELECTABLE':mapped?mapped.method:'SOURCE_NOT_AVAILABLE',
     description:mapped?.definition?.taskScope??(mapped?[mapped.profile.description,mapped.profile.scopeNote].filter(Boolean).join('\n'):''),
     facts:{
       essential:mapped?.definition?.coreTasks?.map(task=>({uri:'urn:talentio:occupation-task:'+task.id,label:task.label}))??mapped?.profile.essential??[],
       optional:mapped?.definition?.coreTasks?[]:mapped?.profile.optional??[],
       evidence:mapped?.definition?.evidence??null,
       primaryTaskIds:[] as string[],
     },
   };
 });
 const roots=roles.filter(r=>index.identity(r.id)?.canonicalRoleId===r.id);
 const scopesById=new Map(roots.map(role=>{
   const reference=resolve(role);
   const inherited=scopes.get(key(reference?.profile.label??''));
   return [role.id,new Map([...inherited??[],...scopes.get(key(role.name))??[]])] as const;
 }));
 const overlapsWorkScope=(fromId:string,toId:string)=>{
   const from=scopesById.get(fromId),to=scopesById.get(toId);
   if(!from||!to)return true;
   for(const [dimension,outputs] of from){
     const target=to.get(dimension);
     if(target&&![...outputs].some(output=>target.has(output)))return false;
   }
   return true;
 };
 const mapped=new Map(profiles.filter(p=>p.sourceUri).map(p=>[p.jobTitleId,p]));
 const skillInfo=new Map(source.skills.map(s=>[s.uri,s]));
 for(const definition of source.localDefinitions??[]) {
   for(const task of definition.coreTasks??[]) {
     const uri='urn:talentio:occupation-task:'+task.id;
     const existing=skillInfo.get(uri);
     if(existing&&existing.label!==task.label) throw new Error('Conflicting local task label: '+task.id);
     skillInfo.set(uri,{uri,label:task.label,type:'skill',reuse:'occupation-specific'});
   }
 }
 const df=new Map<string,number>();
 // Count unique source professions, so local aliases never change skill rarity.
 for(const p of source.occupations)for(const uri of new Set(p.essential.map(s=>s.uri)))df.set(uri,(df.get(uri)||0)+1);
 const weight=(uri:string)=>1+Math.log((source.occupations.length+1)/((df.get(uri)||0)+1));
 // A shared tool, knowledge topic, or general soft skill is not evidence of shared work.
 const specific=(uri:string)=>{const skill=skillInfo.get(uri);return !!skill&&taskKind(skill)==='TASK';};
 const anchors=new Map<string,Set<string>>(),postings=new Map<string,string[]>();
 for(const r of roots){const p=mapped.get(r.id);if(!p)continue;const ids=new Set(p.facts.essential.filter(s=>specific(s.uri)).map(s=>s.uri));anchors.set(r.id,ids);for(const uri of ids){const ids=postings.get(uri)||[];ids.push(r.id);postings.set(uri,ids);}}
 const norms=new Map([...anchors].map(([id,set])=>[id,[...set].reduce((sum,uri)=>sum+weight(uri),0)]));
 const outputFrequencyLimit=Math.max(10,Math.ceil(source.occupations.length*.02));
 const withOutput=new Set([...skillInfo.values()].filter(skill=>hasSpecificTaskOutput(skill)&&(df.get(skill.uri)||0)<=outputFrequencyLimit).map(skill=>skill.uri));
 const dictionary=buildTaskDictionary([...skillInfo.values()]);
 const primaryTasks=new Map([...anchors].map(([id,set])=>[id,dictionary.match(mapped.get(id)!.description,set)]));
 for(const [id,tasks] of primaryTasks)mapped.get(id)!.facts.primaryTaskIds=[...tasks].sort();
 const relations:Array<{fromRoleId:string;toRoleId:string;score:number;basis:{method:string;kind:'RELATED'|'CAREER_PATH';sourceVersion:string;sharedEssentialSkills:Array<{uri:string;label:string}>;sharedEssentialSkillCount:number;targetEssentialCoverage:number;similarity:number;evidenceMode:'DIRECTIONAL_TASK_COVERAGE'|'SYMMETRIC_ESSENTIAL_TASK_OVERLAP';reciprocalTaskCount?:number;reciprocalSimilarityThreshold?:number}}>=[];
 for(const r of roots){const from=mapped.get(r.id),anchor=anchors.get(r.id);if(!from||!anchor?.size)continue;
  const workTasks=anchor;
  const candidates=new Set([...workTasks].flatMap(uri=>postings.get(uri)||[]));candidates.delete(r.id);
  for(const toRoleId of [...candidates].sort()){const shared=independentTaskIds([...workTasks].filter(uri=>anchors.get(toRoleId)?.has(uri)),skillInfo);if(shared.length<MIN_SHARED_CORE_TASKS||!shared.some(uri=>withOutput.has(uri)))continue;
   const covered=shared.reduce((n,uri)=>n+weight(uri),0),denominator=norms.get(toRoleId)!;
   const similarity=2*covered/(norms.get(r.id)!+denominator);
   const score=denominator?covered/denominator:0;
   const reverseCoverage=covered/norms.get(r.id)!;
   const sameWorkScope=overlapsWorkScope(r.id,toRoleId);
   // A common primary output can be independently documented in both role
   // descriptions even when one role also has several other core outputs.
   const primaryOverlap=shared.filter(uri=>withOutput.has(uri)&&primaryTasks.get(r.id)?.has(uri)&&primaryTasks.get(toRoleId)?.has(uri));
   const sufficientCoverage=Math.max(score,reverseCoverage)>=MIN_NARROWER_CORE_COVERAGE&&Math.min(score,reverseCoverage)>=MIN_BROADER_CORE_COVERAGE;
   const kind=sameWorkScope&&(sufficientCoverage||primaryOverlap.length>0)?'RELATED':'CAREER_PATH';
   // Keep the two stable explanation tasks; the complete overlap already contributes
   // to selection and scoring, while retaining every repeated label per edge made
   // the production graph exceed the bounded API worker heap.
   const orderedShared=shared.sort((a,b)=>Number(primaryOverlap.includes(b))-Number(primaryOverlap.includes(a))||weight(b)-weight(a)||a.localeCompare(b));
   relations.push({fromRoleId:r.id,toRoleId,score,basis:{method:'Talentio direct essential work-task overlap; not ESCO equivalence',kind,sourceVersion:source.sourceVersion,sharedEssentialSkills:orderedShared.slice(0,2).map(uri=>({uri,label:skillInfo.get(uri)?.label||uri})),sharedEssentialSkillCount:orderedShared.length,targetEssentialCoverage:score,similarity,evidenceMode:'SYMMETRIC_ESSENTIAL_TASK_OVERLAP',reciprocalTaskCount:shared.length}});
  }
 }
 // Each direction was evaluated directly. Optional skills never enter a
 // denominator and no pre-existing edge is required to recover its reverse.
 relations.sort((a,b)=>a.fromRoleId.localeCompare(b.fromRoleId)||a.toRoleId.localeCompare(b.toRoleId));
 const catalogRevision=professionCatalogRevision(roles),sourceDigest=professionDigest(source),id=professionDigest([PROFESSION_RELATION_ALGORITHM,catalogRevision,sourceDigest]);
 const related=relations.filter(r=>r.basis.kind==='RELATED');
 const crossFamily=related.filter(r=>index.identity(r.fromRoleId)!.familyId!==index.identity(r.toRoleId)!.familyId).length;
 const reciprocalRelations=related.filter(r=>r.basis.evidenceMode==='SYMMETRIC_ESSENTIAL_TASK_OVERLAP').length;
 const report={positionsProcessed:roles.length,selectableCanonicalPositions:roots.length,profilesAvailable:profiles.filter(p=>p.sourceUri).length,localTaskProfiles:profiles.filter(p=>p.mappingMethod==='LOCAL_TASK_REFERENCE').length,sourceMissing:profiles.filter(p=>p.mappingMethod==='SOURCE_NOT_AVAILABLE').map(p=>({id:p.jobTitleId,name:index.roles.get(p.jobTitleId)!.name})),notSelectable:profiles.filter(p=>p.mappingMethod==='NOT_SELECTABLE').length,relations:relations.length,related:related.length,careerPaths:relations.length-related.length,reciprocalRelations,reciprocalPairs:reciprocalRelations/2,positionsWithRelations:new Set(related.map(r=>r.fromRoleId)).size,withinFamily:related.length-crossFamily,crossFamily};
 return {id,algorithmVersion:PROFESSION_RELATION_ALGORITHM,sourceVersion:source.sourceVersion,sourceDigest,catalogRevision,profiles,relations,report};
}
