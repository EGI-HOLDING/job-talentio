import { evidenceConflicts, type EvidenceOverride } from './employee-intent-evidence';
import { correctedHrFacts, emptyHrFacts, hrHash, legacyHrFacts, type HrCatalog, type HrFacts, type HrProfile } from './recruiter-ranking';
import { withCvFacts } from '../profiles/cv-evidence';
import { normalizeSkillKey } from '../common/skill-resolve';

export type HrSubmission = {
  schema:1; versionId:string|null; fileKey:string|null; checksum:string|null; submittedAt:string;
  evidenceRevision:number|null; corrections:EvidenceOverride[];
  facts:HrFacts|null; legacyCvFacts:unknown;
  languages:unknown[]; certifications:unknown[]; legacy:boolean;
};
export function freezeHrSubmission(version:{id:string;fileKey:string;checksum?:string|null;parseGeneration?:number;matchingData?:unknown;employeeEvidence?:{status:string;generation:number;revision:number;facts:unknown;overrides:unknown}|null}|null,
  supplements:{languages?:unknown[];certifications?:unknown[]},at:Date):HrSubmission {
  const e=version?.employeeEvidence;
  const valid=e?.status==='READY'&&e.generation===version?.parseGeneration;
  return {schema:1,versionId:version?.id??null,fileKey:version?.fileKey??null,checksum:version?.checksum??null,submittedAt:at.toISOString(),evidenceRevision:valid?e!.revision:null,
    corrections:valid&&Array.isArray(e!.overrides)?structuredClone(e!.overrides) as EvidenceOverride[]:[],facts:valid?structuredClone(e!.facts) as HrFacts:null,
    legacyCvFacts:version?.matchingData??null,languages:structuredClone(supplements.languages??[]),certifications:structuredClone(supplements.certifications??[]),legacy:false};
}
export function historicalHrSubmission(row:{createdAt:Date;resumeVersionId:string|null;resumeSnapshot:unknown;hrSubmissionSnapshot?:unknown;resumeVersion?:{id:string;fileKey:string;checksum:string|null}|null}):HrSubmission {
  if(row.hrSubmissionSnapshot)return row.hrSubmissionSnapshot as HrSubmission;
  const snap=(row.resumeSnapshot??{}) as {cvEvidence?:unknown;cvSupplement?:{languages?:unknown[];certifications?:unknown[]};resume?:{fileKey?:string}};
  return {schema:1,versionId:row.resumeVersionId,fileKey:snap.resume?.fileKey??row.resumeVersion?.fileKey??null,checksum:row.resumeVersion?.checksum??null,submittedAt:row.createdAt.toISOString(),evidenceRevision:null,corrections:[],facts:null,
    legacyCvFacts:snap.cvEvidence??null,languages:snap.cvSupplement?.languages??[],certifications:snap.cvSupplement?.certifications??[],legacy:true};
}
type Projection={status:string;generation:number;revision:number;facts:unknown;checksum:string|null}|null|undefined;
export function hrApplicationProfile(profile:{id:string},submission:HrSubmission,version:{id:string;fileKey:string;parseGeneration:number}|null|undefined,projection:Projection,catalog:HrCatalog):HrProfile {
  let state:import('@job-talentio/shared').HrRankingState='READY';
  let facts=emptyHrFacts();
  if(!submission.fileKey)state='CV_REQUIRED';
  else if(!version||(submission.versionId!==null&&version.id!==submission.versionId)||version.fileKey!==submission.fileKey)state='CV_UNAVAILABLE';
  else if(!projection||projection.generation!==version.parseGeneration||['PENDING','PROCESSING'].includes(projection.status))state='CV_PROCESSING';
  else if(projection.status==='UNAVAILABLE')state='CV_UNAVAILABLE';
  else if(projection.status==='FAILED')state='CV_FAILED';
  else if(projection.status!=='READY')state='EVIDENCE_REVIEW_REQUIRED';
  else if(submission.checksum&&projection.checksum!==submission.checksum)state='CV_UNAVAILABLE';
  else {const raw=projection.facts as HrFacts;facts=correctedHrFacts(raw,submission.corrections);if(evidenceConflicts({roles:raw.roles,skills:raw.skills,experiences:raw.experiences,languages:raw.languages},submission.corrections).length)state='EVIDENCE_REVIEW_REQUIRED';}
  // Supplement provenance is frozen at submission. Legacy unconfirmed language rows stay UNKNOWN.
  const languages=submission.languages as Array<{level?:string;levelSource?:string;language?:{code?:string}}>;
  for(const row of languages){if(!row.language?.code||!row.level)continue;const existing=facts.languages.find(l=>l.code===row.language!.code);
    if(!existing)facts.languages.push({key:'submitted-language:'+row.language.code,code:row.language.code,level:row.level,source:'USER',confirmed:row.levelSource==='USER_CONFIRMED'});}
  facts.certifications=submission.certifications as HrFacts['certifications'];
  const base=withCvFacts(profile,submission.legacyCvFacts?{id:submission.versionId??'submitted',parseStatus:'READY',matchingData:submission.legacyCvFacts}:null);
  return {...base,cvSource:{versionId:submission.versionId,status:state==='READY'||state==='EVIDENCE_REVIEW_REQUIRED'?'READY':state==='CV_REQUIRED'?'NONE':state==='CV_PROCESSING'?'PROCESSING':'FAILED'},headline:facts.roles[0]?.title??base.headline,skills:facts.skills.flatMap(s=>{const skill=catalog.skills.find(v=>v.id===s.skillId);return skill?[{id:s.key,skillId:s.skillId,level:s.level??'',levelSource:s.confirmed?'USER_CONFIRMED':'CV_UNCONFIRMED',skill:{...skill,aliases:skill.aliases.map(a=>({aliasKey:normalizeSkillKey(a.alias)}))}}]:[]}),languages:[],hr:{facts,state,asOf:submission.submittedAt,source:'APPLICATION',revision:hrHash([submission,projection?.revision,projection?.status,projection?.generation,catalog.revision])}} as HrProfile;
}
