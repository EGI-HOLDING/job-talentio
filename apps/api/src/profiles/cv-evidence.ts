import type { Prisma } from '@prisma/client';
import type { ParsedCvData } from './cv-parser';
import { normalizeSkillKey } from '../common/skill-resolve';
import { normalizeJobTitleKey } from '../common/title-resolve';
import type { EmployeeMatchProfile } from '../matching/employee-matching';

export const CV_EVIDENCE_VERSION = 'cv-evidence-v1';
export type CvFacts = {
  headline: string | null;
  roleTitles?:string[];
  skills: EmployeeMatchProfile['skills'];
  experiences: Array<{id:string;title:string;companyName:string;startDate:string;endDate:string|null;isCurrent:boolean}>;
  educations: ParsedCvData['educations'];
};

export function cvExperienceYears(experiences:CvFacts['experiences'],now=new Date()):number|null {
  const intervals=experiences.map(e=>[+new Date(e.startDate),e.isCurrent?+now:+new Date(e.endDate!)]).filter(([start,end])=>Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=+now).sort((a,b)=>a[0]-b[0]);
  if(!intervals.length)return null;
  let duration=0,last=-Infinity;
  for(const [start,end] of intervals){duration+=Math.max(0,end-Math.max(start,last));last=Math.max(last,end);}
  return duration/31557600000;
}

export function cvFacts(parsed: ParsedCvData, catalog: Array<{id:string;name:string;slug:string;normalizedKey:string|null;aliases:Array<{aliasKey:string}>}>, versionId:string, now=new Date()) {
  const skills = catalog.filter(skill => parsed.skillNames.some(name => {
    const key=normalizeSkillKey(name);
    return [skill.name,skill.slug,skill.normalizedKey,...skill.aliases.map(a=>a.aliasKey)].some(label=>Boolean(label)&&normalizeSkillKey(label!)===key);
  })).map(skill=>({id:`${versionId}:${skill.id}`,skillId:skill.id,level:'INTERMEDIATE',levelSource:'CV_UNCONFIRMED',skill}));
  const experiences: CvFacts['experiences'] = [];
  for(const [i,row] of parsed.experiences.entries()) {
    const start=row.startDate ? new Date(row.startDate) : null;
    const end=row.isCurrent ? now : row.endDate ? new Date(row.endDate) : null;
    // Missing dates are not fabricated into a duration or a claim of no experience.
    if(!start || !end || !Number.isFinite(+start) || !Number.isFinite(+end) || +start>+end || +start>+now || +end>+now)continue;
    experiences.push({id:`${versionId}:experience:${i}`,title:row.title,companyName:row.companyName,startDate:start.toISOString(),endDate:row.isCurrent?null:end.toISOString(),isCurrent:Boolean(row.isCurrent)});
  }
  const facts:CvFacts={headline:parsed.headline?.trim()||null,roleTitles:parsed.experiences.map(row=>row.title).filter(Boolean),skills,experiences,educations:parsed.educations};
  return { matchingData:facts as unknown as Prisma.InputJsonValue,skillIds:skills.map(s=>s.skillId),
    roleKeys:[...new Set([parsed.headline,...parsed.experiences.map(e=>e.title)].filter((s):s is string=>Boolean(s)).map(normalizeJobTitleKey))],
    degreeLevels:[...new Set(parsed.educations.flatMap(e=>e.degree?[e.degree]:[]))],
    // Discovery must not become an unaudited email/phone lookup over raw CV text.
    searchText:[parsed.headline,...parsed.skillNames,...parsed.experiences.flatMap(e=>[e.title,e.companyName]),...parsed.educations.flatMap(e=>[e.school,e.degree,e.field])].filter(Boolean).join(' ').replace(/\S+@\S+/g,'').replace(/\+?\d[\d ()\t.-]{6,}\d/g,''),
    experienceYears:cvExperienceYears(experiences,now) };
}

export function withCvFacts<T extends {id:string}>(profile:T, version:{id:string;parseStatus:string;matchingData:unknown}|null|undefined) {
  const ready=version?.parseStatus==='READY' && Boolean(version.matchingData);
  const facts=ready?version!.matchingData as CvFacts:null;
  return {...profile,headline:facts?.headline??null,summary:null,noExperience:false,
    cvRoleTitles:facts?.roleTitles??[],
    skills:facts?.skills??[],educations:facts?.educations??[],
    experiences:(facts?.experiences??[]).map(e=>({...e,startDate:new Date(e.startDate),endDate:e.endDate?new Date(e.endDate):null})),
    cvSource:{versionId:version?.id??null,status:version?.parseStatus==='READY'&&!version.matchingData?'FAILED':version?.parseStatus??'NONE'}};
}

export const cvVersionSelect = {id:true,parseStatus:true,matchingData:true,experienceYears:true} satisfies Prisma.ResumeVersionSelect;
export const cvSourceInclude = {
  resumes:{where:{isPrimary:true,deletedAt:null,fileKey:{not:null}},include:{currentVersion:{select:cvVersionSelect}}},
} satisfies Prisma.EmployeeProfileInclude;

export function discoveryVersion(profile:{resumes?:Array<{isPrimary?:boolean;currentVersion?:unknown}>}) {
  return profile.resumes?.find(resume=>resume.isPrimary)?.currentVersion as {id:string;parseStatus:string;matchingData:unknown}|null|undefined;
}

export function cvSourceWhere(condition:Prisma.ResumeVersionWhereInput):Prisma.EmployeeProfileWhereInput {
  return {resumes:{some:{isPrimary:true,deletedAt:null,fileKey:{not:null},currentVersion:{is:condition}}}};
}

export async function registerCvVersion(db:Prisma.TransactionClient,resumeId:string,fileKey:string,checksum?:string) {
  const resume=await db.resume.findUniqueOrThrow({where:{id:resumeId},select:{parseGeneration:true}});
  const version=await db.resumeVersion.upsert({where:{resumeId_fileKey:{resumeId,fileKey}},
    create:{resumeId,fileKey,checksum,parseStatus:'PENDING',parseGeneration:resume.parseGeneration},update:checksum?{checksum}:{}});
  await db.resume.updateMany({where:{id:resumeId,fileKey},data:{currentVersionId:version.id,parseStatus:version.parseStatus}});
  return version;
}
