import { createHash } from 'node:crypto';
import { languageLevelRank, type HrRankingMetadata, type MatchEvidence, type RequirementStatus } from '@job-talentio/shared';
import { EmployeeOccupationIndex, type IntentRole } from './employee-occupation';
import { parseEmployeeEvidence, applyEmployeeOverrides, type EvidenceOverride, type IntentFacts, type IntentSkill } from './employee-intent-evidence';
import { parseCvText } from '../profiles/cv-parser';
import type { RecruiterBreakdown, RecruiterJob, RecruiterProfile } from './recruiter-matching';

export const HR_VERSION = 'hr-evidence-v2';
export const HR_PARSER = 'hr-cv-v2.0';
export const HR_CONFIG = { version: 'hr-weights-v2.0', presence:35, level:15, experience:25, language:15, seniority:10 } as const;
export const hrEnabled = () => process.env.HR_RANKING_V2_MODE === 'enabled';
export const hrHash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type HrFacts = IntentFacts & {
  experienceComplete?: boolean;
  educations?: Array<{degree?:string;school?:string}>;
  certifications?: Array<{name:string;issuer?:string}>;
  refs?: Record<string,{line:number;text:string}>;
};
export type HrProfile = RecruiterProfile & { hr?: {
  facts:HrFacts; state:HrRankingMetadata['state']; asOf:string; source:'APPLICATION'|'DATABASE_CV'; revision:string;
} };
export type HrBreakdown = RecruiterBreakdown & HrRankingMetadata & { roleFit:number; complementary:number; warnings:string[]; sources:Array<{ref:string;line:number;text:string;confirmed:boolean}> };
export type HrCatalog = { roles:IntentRole[]; skills:IntentSkill[]; languages:Array<{code:string;name:string;aliases:Array<{alias:string;aliasKey:string}>}>; revision:string; index:EmployeeOccupationIndex };
const empty = ():HrFacts => ({roles:[],skills:[],experiences:[],languages:[],educations:[],certifications:[],refs:{}});
export const emptyHrFacts = empty;

/** Full file, full catalog, without treating contact tokens or negated aspirations as competencies. */
export function parseHrEvidence(text:string,catalog:HrCatalog,identity?:{fullName?:string|null}):HrFacts {
  const normalizedName=identity?.fullName?.normalize('NFKC').trim().toLowerCase();
  const lines=text.split(/\r?\n/);
  const sanitized=lines.map((line,i)=>i<8&&normalizedName&&line.normalize('NFKC').trim().toLowerCase()===normalizedName?'':line);
  const negative=/(?:\b(?:no|not|without|never|lack|lacking|belum|tidak|tanpa|ingin|berencana|learning|learn|aspiring|interested|seeking|desired)\b|\b(?:want|plan|hope)\s+to\b)/iu;
  const safeSkills=sanitized.map(line=>negative.test(line)?'':line.replace(/\S+@\S+|https?:\/\/\S+/giu,' '));
  const facts=parseEmployeeEvidence(sanitized.join('\n'),catalog.index,[],catalog.languages) as HrFacts;
  const all=parseEmployeeEvidence(safeSkills.join('\n'),catalog.index,catalog.skills,[]);
  facts.skills=all.skills;
  facts.refs={};
  for(const row of facts.skills){
    const skill=catalog.skills.find(s=>s.id===row.skillId)!;
    const labels=[skill.name,skill.nameId,skill.nameUz,skill.nameRu,...skill.aliases.map(a=>a.alias)].filter(Boolean) as string[];
    const line=safeSkills.findIndex(value=>labels.some(label=>value.toLocaleLowerCase().includes(label.toLocaleLowerCase())));
    facts.refs[row.key]={line:line+1,text:(lines[line]||'').trim().slice(0,240)};
  }
  // Role history is evidence regardless of whether it is the current headline.
  for(const row of facts.experiences){const line=sanitized.findIndex(v=>v.includes(row.title));facts.refs[row.key]={line:line+1,text:(lines[line]||row.title).trim().slice(0,240)};}
  const parsed=parseCvText(sanitized.join('\n'),[],catalog.languages);
  facts.educations=parsed.educations;
  return facts;
}

export function correctedHrFacts(facts:HrFacts,overrides:EvidenceOverride[]):HrFacts {
  return {...facts,...applyEmployeeOverrides(facts,overrides)};
}

/** Legacy input adapter is intentionally CV-only; mutable profile levels/languages are not imported. */
export function legacyHrFacts(profile:RecruiterProfile,index:EmployeeOccupationIndex):HrFacts {
  const facts=empty();
  for(const title of [profile.headline,...(profile.cvRoleTitles??[])].filter(Boolean) as string[]){const id=index.resolveEvidence(title);if(id)facts.roles.push({key:'role:'+id,jobTitleId:id,title,source:'CV',confirmed:false});}
  facts.skills=profile.skills.map(s=>({key:'skill:'+s.skillId,skillId:s.skillId,level:s.levelSource==='USER_CONFIRMED'?s.level:null,source:'CV',confirmed:s.levelSource==='USER_CONFIRMED'}));
  facts.experiences=profile.experiences.map((e,i)=>({key:'experience:'+i,title:e.title,jobTitleId:index.resolveEvidence(e.title),startDate:e.startDate?new Date(e.startDate).toISOString():null,endDate:e.endDate?new Date(e.endDate).toISOString():null,isCurrent:e.isCurrent,seniority:null,source:'CV',confirmed:false}));
  return facts;
}

export function hrYears(facts:HrFacts,role:string|null,index:EmployeeOccupationIndex,asOf:Date,memberIds?:ReadonlySet<string>){
  const rows=facts.experiences.filter(e=>{
    const identity=e.jobTitleId&&index.identity(e.jobTitleId);
    return !!identity&&(memberIds?memberIds.has(identity.canonicalRoleId):identity.canonicalRoleId===role);
  });
  const intervals=rows.flatMap(e=>{const start=e.startDate?+new Date(e.startDate):NaN,end=e.isCurrent?+asOf:e.endDate?+new Date(e.endDate):NaN;
    return Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=+asOf?[[start,end]]:[];}).sort((a,b)=>a[0]-b[0]);
  let duration=0,last=-Infinity;for(const [start,end]of intervals){duration+=Math.max(0,end-Math.max(start,last));last=Math.max(last,end);}
  return {years:duration/31557600000,rows,intervals};
}

const levels=['BEGINNER','INTERMEDIATE','ADVANCED','EXPERT'];
const seniorities=['INTERN','JUNIOR','MIDDLE','SENIOR','LEAD','EXECUTIVE'];
const fraction=(status:RequirementStatus)=>status==='MET'?1:status==='UNKNOWN'?0.5:0;
export function evaluateHr(profile:HrProfile,job:RecruiterJob,catalog:HrCatalog,now=new Date()):HrBreakdown {
  const h=profile.hr;
  const facts=h?.facts??legacyHrFacts(profile,catalog.index);
  const asOf=h?new Date(h.asOf):now;
  const members=job.positionGroupId?new Set(job.effectivePositionMemberIds):undefined;
  const role=members?null:job.jobTitleId?catalog.index.identity(job.jobTitleId)?.canonicalRoleId??null:catalog.index.resolve(job.title);
  const evidence:MatchEvidence[]=[],warnings:string[]=[];
  const parts:Array<{key:string;maximum:number;earned:number}>=[];
  const required:RequirementStatus[]=[];
  const add=(kind:MatchEvidence['kind'],label:string,status:RequirementStatus,isRequired:boolean,refs:string[],code?:MatchEvidence['code'])=>{
    evidence.push({kind,label,status,required:isRequired,evidenceRefs:refs,code:code??(status==='MET'?(kind==='SKILL'?'SKILL_MATCH':kind==='LANGUAGE'?'LANGUAGE_MATCH':'EXPERIENCE_MATCH'):status==='UNMET'?'BELOW_REQUIREMENT':'NOT_LISTED')});
    if(isRequired)required.push(status);
  };
  const part=(key:string,weight:number,statuses:RequirementStatus[])=>{if(statuses.length)parts.push({key,maximum:weight,earned:weight*statuses.reduce((s,v)=>s+fraction(v),0)/statuses.length});};
  const roleEvidence=[...facts.roles,...facts.experiences].filter(row=>{
    const identity=row.jobTitleId&&catalog.index.identity(row.jobTitleId);
    return !!identity&&(members?members.has(identity.canonicalRoleId):identity.canonicalRoleId===role);
  });
  const roleFit=Number(roleEvidence.length>0);
  add('ROLE',job.title,roleFit?'MET':'UNKNOWN',false,roleEvidence.map(r=>'cvEvidence:'+r.key),roleFit?'ROLE_MATCH':'NOT_LISTED');
  if(members?!members.size:!role)warnings.push('ROLE_MAPPING_REQUIRED');
  const skillCounts={met:0,unknown:0,unmet:0,total:0};
  const presence:RequirementStatus[]=[],proficiency:RequirementStatus[]=[];
  let complementary=0,observed=false;
  const requirements=new Map<string,RecruiterJob['jobSkills'][number]>();
  for(const req of job.jobSkills){const old=requirements.get(req.skillId);if(!old)requirements.set(req.skillId,{...req});else{old.isRequired||=req.isRequired;old.weight=Math.max(old.weight,req.weight);if(levels.indexOf(req.minLevel??'')>levels.indexOf(old.minLevel??''))old.minLevel=req.minLevel;}}
  for(const req of requirements.values()){
    const found=facts.skills.find(s=>s.skillId===req.skillId),known=found?.confirmed&&levels.includes(found.level??'');
    const exists:RequirementStatus=found?'MET':'UNKNOWN';
    const status:RequirementStatus=req.minLevel?!known?'UNKNOWN':levels.indexOf(found!.level!)>=levels.indexOf(req.minLevel)?'MET':'UNMET':exists;
    add('SKILL',req.skill.name,status,req.isRequired,found?['cvEvidence:'+found.key]:[],status==='UNKNOWN'&&found?'LEVEL_UNCONFIRMED':undefined);
    const last=evidence[evidence.length-1];last.labels={en:req.skill.name,id:req.skill.nameId,uz:req.skill.nameUz,ru:req.skill.nameRu};if(req.minLevel)last.minimumLevel=req.minLevel;
    const classification=catalog.skills.find(s=>s.id===req.skillId)?.matchingKind??'UNREVIEWED';
    if(classification==='UNREVIEWED')warnings.push('SKILL_CLASSIFICATION_REQUIRED:'+req.skillId);
    if(req.isRequired){skillCounts.total++;skillCounts[status==='MET'?'met':status==='UNMET'?'unmet':'unknown']++;
      if(classification!=='GENERAL'){presence.push(exists);if(req.minLevel)proficiency.push(status);if(found)observed=true;}}
    else if(found){complementary+=Math.min(10,Math.max(0,req.weight||1))*(status==='MET'?1:0);if(classification!=='GENERAL')observed=true;}
  }
  part('skills',HR_CONFIG.presence,presence);part('skillLevel',HR_CONFIG.level,proficiency);
  const experience=hrYears(facts,role,catalog.index,asOf,members);
  if(experience.intervals.length)observed=true;
  const minimum=job.experienceYearsMin!=null&&job.experienceYearsMin>0?job.experienceYearsMin:null;
  if(minimum){const status:RequirementStatus=experience.years>=minimum?'MET':facts.experienceComplete&&(!members||members.size>0)?'UNMET':'UNKNOWN';
    add('EXPERIENCE',String(minimum),status,true,experience.rows.map(r=>'cvEvidence:'+r.key));part('experience',HR_CONFIG.experience,[status]);}
  if(job.experienceLevel){const target=seniorities.indexOf(job.experienceLevel),grades=experience.rows.filter(r=>r.confirmed&&r.seniority).map(r=>seniorities.indexOf(r.seniority!)).filter(n=>n>=0);
    const status:RequirementStatus=!grades.length||target<0?'UNKNOWN':Math.max(...grades)>=target?'MET':'UNMET';
    add('EXPERIENCE',job.experienceLevel,status,true,experience.rows.map(r=>'cvEvidence:'+r.key));part('seniority',HR_CONFIG.seniority,[status]);if(grades.length)observed=true;}
  const languageStatuses:RequirementStatus[]=[];
  for(const req of job.jobLanguages){const employer=req.provenance==='EMPLOYER_CONFIRMED',found=facts.languages.find(l=>l.code.toLowerCase()===req.language.code.toLowerCase());
    const known=employer&&found?.confirmed&&found.level;
    const status:RequirementStatus=!known?'UNKNOWN':languageLevelRank(found!.level as never)>=languageLevelRank(req.minLevel as never)?'MET':'UNMET';
    add('LANGUAGE',req.language.name,status,employer&&req.isRequired,found?['cvEvidence:'+found.key]:[],!employer?'UNVERIFIED_REQUIREMENT':undefined);
    if(employer&&req.isRequired){languageStatuses.push(status);if(known)observed=true;}else if(employer&&status==='MET')complementary++;}
  part('language',HR_CONFIG.language,languageStatuses);
  const measurable=parts.length>0||required.length>0||job.jobSkills.some(r=>!r.isRequired);
  let state=h?.state??(profile.cvSource?.status==='READY'||!profile.cvSource?'READY':profile.cvSource.status==='FAILED'?'CV_FAILED':profile.cvSource.status==='NONE'?'CV_REQUIRED':'CV_PROCESSING');
  if(state==='READY'&&!measurable)state='JOB_REQUIREMENTS_REQUIRED';
  if(state==='READY'&&!observed)state='EVIDENCE_REVIEW_REQUIRED';
  const assessable=state==='READY';
  const requirementGroup:HrRankingMetadata['requirementGroup']=!assessable?'UNASSESSABLE':required.includes('UNMET')?'UNMET':required.length>0&&required.every(s=>s==='MET')?'MET':'INCOMPLETE';
  const denominator=parts.reduce((s,p)=>s+p.maximum,0);
  const components=parts.map(p=>({key:p.key,maximum:denominator?p.maximum/denominator*100:0,earned:denominator?p.earned/denominator*100:0}));
  const component=(key:string)=>components.find(p=>p.key===key)?.earned??0;
  const total=assessable&&denominator?Math.round(components.reduce((s,p)=>s+p.earned,0)*1000)/1000:0;
  const matching=(kind:MatchEvidence['kind'],status:RequirementStatus,req=false)=>evidence.filter(e=>e.kind===kind&&e.status===status&&(!req||e.required)).map(e=>e.label);
  const reasons=[...evidence.filter(e=>e.required&&e.status==='UNMET'),...evidence.filter(e=>e.required&&e.status==='UNKNOWN'),...evidence.filter(e=>e.required&&e.status==='MET')].slice(0,2);
  const used=new Set(evidence.flatMap(e=>e.evidenceRefs));
  const entities=[...facts.roles,...facts.skills,...facts.experiences,...facts.languages];
  const sources=entities.filter(row=>used.has('cvEvidence:'+row.key)).map(row=>({ref:'cvEvidence:'+row.key,line:facts.refs?.[row.key]?.line??0,confirmed:row.confirmed,text:(facts.refs?.[row.key]?.text??'').replace(/\S+@\S+|https?:\/\/\S+|\+?\d[\d ()\t.-]{6,}\d/g,'[redacted]')}));
  return {version:HR_VERSION,rankingVersion:HR_VERSION,rankingRevision:hrHash([h?.revision,catalog.revision,job,HR_CONFIG,asOf.toISOString().slice(0,10)]),state,requirementGroup,rank:null,reasons,sources,source:h?.source??'DATABASE_CV',roleFit,complementary:Math.min(10,complementary),warnings:[...new Set(warnings)],
    evaluatedAt:now.toISOString(),total,assessable,positiveCore:assessable,optionalScore:Math.min(10,complementary),evidenceCoverage:required.length?Math.round(required.filter(s=>s!=='UNKNOWN').length/required.length*100):0,evidence,components,
    skills:component('skills')+component('skillLevel'),title:0,experience:component('experience')+component('seniority'),location:0,education:0,language:component('language'),
    details:{matchedSkills:matching('SKILL','MET'),missingRequiredSkills:matching('SKILL','UNMET',true),unknownRequiredSkills:matching('SKILL','UNKNOWN',true),matchedLanguages:matching('LANGUAGE','MET'),missingRequiredLanguages:matching('LANGUAGE','UNMET',true),unknownRequiredLanguages:matching('LANGUAGE','UNKNOWN',true),experienceYears:experience.years,requiredYears:minimum,relevantExperienceYears:experience.intervals.length?experience.years:null,requiredSkills:skillCounts,reviewExperienceIds:facts.experiences.filter(e=>!e.jobTitleId||!e.startDate||!e.isCurrent&&!e.endDate).map(e=>e.key),hasJobRequirements:measurable}};
}
const order=['MET','INCOMPLETE','UNMET','UNASSESSABLE'];
export function compareHr(a:HrBreakdown,b:HrBreakdown){return order.indexOf(a.requirementGroup)-order.indexOf(b.requirementGroup)||b.total-a.total||b.roleFit-a.roleFit||b.complementary-a.complementary;}
