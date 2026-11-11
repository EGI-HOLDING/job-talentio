import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { HR_PARSER, HR_VERSION, evaluateHr, compareHr, hrHash, hrYears, type HrCatalog, type HrProfile, type HrBreakdown } from './recruiter-ranking';
import { historicalHrSubmission, hrApplicationProfile } from './recruiter-evidence';
import { recruiterJobInclude } from './recruiter-matching.service';
import type { ApplicantFilters } from '../applications/applicant-filter';
import { parseLanguagesCsv, languageLevelRank } from '@job-talentio/shared';
import { withRecruiterGroupScope } from './job-group-scope';

let epoch=0;
let catalogEpoch=0;
const catalogs=new WeakMap<object,{expires:number;epoch:number;promise:Promise<HrCatalog>}>();
export function invalidateHrRanking(catalogChanged=false){epoch++;if(catalogChanged)catalogEpoch++;}
export async function loadHrCatalog(db:Prisma.TransactionClient):Promise<HrCatalog>{
  const cached=catalogs.get(db);if(cached&&cached.epoch===catalogEpoch&&cached.expires>Date.now())return cached.promise;
  const promise=(async()=>{
    const [roles,skills,languages]=await Promise.all([db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}}),db.skill.findMany({where:{archivedAt:null},include:{aliases:true},orderBy:{id:'asc'}}),db.language.findMany({where:{archivedAt:null},include:{aliases:true},orderBy:{code:'asc'}})]);
    const revision=hrHash([roles.map(r=>[r.id,r.name,r.nameId,r.nameUz,r.nameRu,r.familyId,r.canonicalRoleId,r.matchingApproved,r.archivedAt,r.family?.archivedAt,r.aliases]),skills.map(s=>[s.id,s.name,s.nameId,s.nameUz,s.nameRu,s.matchingKind,s.aliases]),languages.map(l=>[l.code,l.name,l.aliases])]);
    return {roles,skills,languages,revision,index:new EmployeeOccupationIndex(roles)};
  })();catalogs.set(db,{expires:Date.now()+10000,epoch:catalogEpoch,promise});try{return await promise;}catch(e){catalogs.delete(db);throw e;}
}
export type HrWindow={ids:string[];scores:Map<string,HrBreakdown>;profiles:Map<string,HrProfile>;total:number;page:number;totalPages:number;rankingVersion:string;rankingRevision:string;state:string};
type Options=ApplicantFilters&{sort?:'match'|'newest';minMatch?:number;page?:number;limit?:number;kanbanOnly?:boolean};
type PoolRow=Prisma.ApplicationGetPayload<{include:{resumeVersion:true;profile:{include:{user:{select:{fullName:true}};city:{include:{province:{include:{country:true}}}};residenceCountry:true}}}}>;
const csv=(v?:string)=>(v??'').split(',').map(s=>s.trim()).filter(Boolean);
function passes(row:PoolRow,p:HrProfile,input:Options,c:HrCatalog){
  const f=p.hr!.facts;
  if(input.q?.trim()){
    const text=[row.profile.user.fullName,...f.roles.map(r=>r.title),...f.experiences.map(e=>e.title),...f.skills.map(s=>c.skills.find(v=>v.id===s.skillId)?.name??''),...(f.educations??[]).flatMap(e=>[e.school,e.degree])].join(' ').toLocaleLowerCase();
    if(!text.includes(input.q.trim().toLocaleLowerCase()))return false;
  }
  if(csv(input.city).length&&!csv(input.city).includes(row.profile.city?.slug??''))return false;
  if(csv(input.country).length&&!csv(input.country).includes(row.profile.residenceCountry?.slug??row.profile.city?.province.country?.slug??''))return false;
  const skills=csv(input.skills);if(skills.length){const found=skills.map(slug=>c.skills.find(s=>s.slug===slug)?.id);const yes=(id:string|undefined)=>!!id&&f.skills.some(s=>s.skillId===id);if(input.skillMode==='AND'?!found.every(yes):!found.some(yes))return false;}
  if(input.degree&&!f.educations?.some(e=>e.degree===input.degree))return false;
  if(input.hasCertification&&!f.certifications?.length)return false;
  const langs=parseLanguagesCsv(input.languages);if(langs.length&&!langs.some(token=>f.languages.some(l=>l.code===token.code&&l.level&&languageLevelRank(l.level as never)>=languageLevelRank(token.minLevel))))return false;
  if(input.experienceYearsMin!==undefined||input.experienceYearsMax!==undefined){
    const first=c.roles.find(r=>c.index.identity(r.id));const all={...f,experiences:f.experiences.map(e=>({...e,jobTitleId:first?.id??null}))};
    const id=first?c.index.identity(first.id)?.canonicalRoleId??null:null;
    const years=hrYears(all,id,c.index,new Date(p.hr!.asOf));
    if(!years.intervals.length||input.experienceYearsMin!==undefined&&years.years<input.experienceYearsMin||input.experienceYearsMax!==undefined&&years.years>input.experienceYearsMax)return false;
  }
  return true;
}

const poolCache=new WeakMap<object,Map<string,{expires:number;promise:Promise<{scores:Map<string,HrBreakdown>;profiles:Map<string,HrProfile>}>}>>();
export async function rankHrApplications(db:PrismaService,where:Prisma.ApplicationWhereInput,jobId:string,options:Options={}):Promise<HrWindow>{
  const authorizedWhere={AND:[where,{jobPostId:jobId}]};
  const [job,catalog,rows]=await Promise.all([db.jobPost.findUniqueOrThrow({where:{id:jobId},include:recruiterJobInclude}).then(job=>withRecruiterGroupScope(db,job)),loadHrCatalog(db),db.application.findMany({where:authorizedWhere,include:{resumeVersion:true,profile:{include:{user:{select:{fullName:true}},city:{include:{province:{include:{country:true}}}},residenceCountry:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}]})]);
  const versionIds=[...new Set(rows.flatMap(r=>r.resumeVersionId?[r.resumeVersionId]:[]))];
  const projections=versionIds.length?await db.resumeRecruiterEvidence.findMany({where:{versionId:{in:versionIds},parserVersion:HR_PARSER,catalogRevision:catalog.revision}}):[];
  const byVersion=new Map(projections.map(p=>[p.versionId,p]));
  const revision=hrHash([epoch,job,catalog.revision,rows.map(r=>[r.id,r.createdAt,r.hrSubmissionSnapshot,r.resumeSnapshot,r.resumeVersionId,r.resumeVersion?.parseGeneration]),projections.map(p=>[p.versionId,p.revision,p.status,p.generation]),HR_VERSION]);
  let cache=poolCache.get(db);if(!cache){cache=new Map();poolCache.set(db,cache);}
  let cached=cache.get(revision);
  if(!cached||cached.expires<Date.now()){
    const promise=(async()=>{
      const profiles=new Map<string,HrProfile>(),scores=new Map<string,HrBreakdown>();
      for(const row of rows){const submission=historicalHrSubmission(row),profile=hrApplicationProfile(row.profile,submission,row.resumeVersion,byVersion.get(row.resumeVersionId??''),catalog);profiles.set(row.id,profile);scores.set(row.id,evaluateHr(profile,job,catalog));}
      const records=rows.map(r=>({id:randomUUID(),applicationId:r.id,inputHash:scores.get(r.id)!.rankingRevision,rankingVersion:HR_VERSION,result:JSON.parse(JSON.stringify(scores.get(r.id)!)) as Prisma.InputJsonValue}));
      for(let n=0;n<records.length;n+=500)await db.applicationRecruiterEvaluation.createMany({data:records.slice(n,n+500),skipDuplicates:true});
      return {profiles,scores};
    })();cached={expires:Date.now()+30000,promise};cache.set(revision,cached);while(cache.size>32)cache.delete(cache.keys().next().value!);
    promise.catch(()=>cache!.delete(revision));
  }
  const {scores,profiles}=await cached.promise;
  let ranked=rows.filter(r=>passes(r,profiles.get(r.id)!,options,catalog)&&(options.minMatch===undefined||scores.get(r.id)!.assessable&&scores.get(r.id)!.total>=options.minMatch));
  const noRequirements=!job.jobSkills.length&&!(job.experienceYearsMin&&job.experienceYearsMin>0)&&!job.experienceLevel&&!job.jobLanguages.some(l=>l.isRequired&&l.provenance==='EMPLOYER_CONFIRMED');
  if(options.sort!=='newest'&&!options.kanbanOnly&&!noRequirements)ranked.sort((a,b)=>compareHr(scores.get(a.id)!,scores.get(b.id)!)||a.id.localeCompare(b.id));
  const output=new Map<string,HrBreakdown>();let previous:HrBreakdown|undefined,rank=0;
  ranked.forEach((row,i)=>{const score=scores.get(row.id)!;if(!previous||compareHr(previous,score)!==0)rank=i+1;output.set(row.id,{...score,rank:options.sort==='newest'||options.kanbanOnly||noRequirements||!score.assessable?null:rank});previous=score;});
  const limit=options.limit??12,total=ranked.length,totalPages=Math.max(1,Math.ceil(total/limit)),page=Math.min(options.page??1,totalPages);
  if(options.page)ranked=ranked.slice((page-1)*limit,page*limit);
  return {ids:ranked.map(r=>r.id),scores:output,profiles,total,page,totalPages,rankingVersion:HR_VERSION,rankingRevision:revision,state:noRequirements?'JOB_REQUIREMENTS_REQUIRED':'READY'};
}
