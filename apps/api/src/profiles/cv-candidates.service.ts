import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LanguageLevel, Prisma } from '@prisma/client';
import { levelsAtOrAbove, parseLanguagesCsv } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { CompaniesService } from '../companies/companies.service';
import { PresenceService } from '../presence/presence.service';
import { CandidateAccessService } from './candidate-access.service';
import { cvSourceInclude, cvSourceWhere, discoveryVersion, withCvFacts } from './cv-evidence';
import { applicationCvProfile } from './cv-source';
import { submittedResume } from '../applications/application-payload';
import { hrEnabled, type HrProfile } from '../matching/recruiter-ranking';
import { rankHrApplications } from '../matching/recruiter-ranking.service';
import { compareRecruiterMatches, type RecruiterBreakdown } from '../matching/recruiter-matching';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { normalizeJobTitleKey } from '../common/title-resolve';
import type { AuthUser } from '../common/auth.decorators';
import type { ProfilesService } from './profiles.service';

const include={...cvSourceInclude,user:{select:{id:true,fullName:true,avatarUrl:true}},city:{include:{province:{include:{country:true}}}},residenceCountry:true,preferredCountries:true,languages:{include:{language:true}},certifications:true} satisfies Prisma.EmployeeProfileInclude;
type Candidate=Prisma.EmployeeProfileGetPayload<{include:typeof include}>;
const project=(row:Candidate)=>({...withCvFacts(row,discoveryVersion(row)),experienceYears:(discoveryVersion(row) as {experienceYears?:number|null}|null)?.experienceYears??null,matchScore:null as number|null,matchBreakdown:null as RecruiterBreakdown|null});

/** Query CV projections; never serialize a database profile or a storage key. */
export class CvCandidatesService {
  constructor(private db:PrismaService,private matching:MatchingService,private companies:CompaniesService,private presence:PresenceService,private access:CandidateAccessService) {}

  async search(user:AuthUser,query:Parameters<ProfilesService['searchCandidates']>[1]) {
    const company=await this.access.context(user,query.companyId||undefined);
    if(query.matchJobId){const job=await this.db.jobPost.findUnique({where:{id:query.matchJobId}});if(!job)throw new NotFoundException('Job unavailable');if(job.companyId!==company)throw new ForbiddenException('Job and company context differ');if(!job.publishedAt||job.status==='DRAFT')throw new BadRequestException('Publish this job before ranking candidates');}
    const csv=(v?:string)=>(v||'').split(',').map(s=>s.trim()).filter(Boolean);
    const and:Prisma.EmployeeProfileWhereInput[]=[{visibility:{in:['PUBLIC','TO_REGISTERED_RECRUITERS']}},{user:{isBanned:false,anonymizedAt:null}}];
    if(query.excludeApplied&&query.matchJobId)and.push({applications:{none:{jobPostId:query.matchJobId}}});
    if(csv(query.city).length)and.push({city:{slug:{in:csv(query.city)}}});
    if(csv(query.country).length)and.push({OR:[{residenceCountry:{slug:{in:csv(query.country)}}},{residenceCountryId:null,city:{province:{country:{slug:{in:csv(query.country)}}}}}]});
    if(query.q?.trim())and.push({OR:[{user:{fullName:{contains:query.q.trim(),mode:'insensitive'}}},cvSourceWhere({searchText:{contains:query.q.trim(),mode:'insensitive'}})]});
    const slugs=csv(query.skills);
    if(slugs.length){const skills=await this.db.skill.findMany({where:{slug:{in:slugs}},select:{id:true}});const ids=skills.map(s=>s.id);and.push(cvSourceWhere({parseStatus:'READY',skillIds:query.skillMode==='AND'?{hasEvery:ids}:{hasSome:ids}}));if(ids.length!==slugs.length&&query.skillMode==='AND')and.push({id:'__missing_skill__'});}
    if(query.degree)and.push(cvSourceWhere({parseStatus:'READY',degreeLevels:{has:query.degree}}));
    if(query.hasCertification)and.push({certifications:{some:{}}});
    const languages=parseLanguagesCsv(query.languages);
    if(languages.length)and.push({OR:languages.map(token=>({languages:{some:{language:{code:token.code},level:{in:levelsAtOrAbove(token.minLevel) as LanguageLevel[]}}}}))});
    if(query.experienceYearsMin!==undefined||query.experienceYearsMax!==undefined)and.push(cvSourceWhere({parseStatus:'READY',experienceYears:{gte:query.experienceYearsMin,lte:query.experienceYearsMax}}));
    const titleSlugs=csv(query.jobTitle);
    if(titleSlugs.length){const titles=await this.db.jobTitle.findMany({where:{slug:{in:titleSlugs},...ACTIVE_CATALOG},include:{aliases:true}});const keys=titles.flatMap(t=>[t.name,t.nameId,t.nameUz,t.nameRu,t.normalizedKey,...t.aliases.map(a=>a.alias)].filter((s):s is string=>Boolean(s)).map(normalizeJobTitleKey));and.push(cvSourceWhere({parseStatus:'READY',roleKeys:{hasSome:keys}}));}
    const where:Prisma.EmployeeProfileWhereInput={AND:and};
    const total=await this.db.employeeProfile.count({where});const limit=query.limit??12;const page=Math.min(query.page??1,Math.max(1,Math.ceil(total/limit)));
    let items:ReturnType<typeof project>[]=[];
    if(query.sort==='match'&&query.matchJobId){let cursor:string|undefined;while(true){const rows=await this.db.employeeProfile.findMany({where,include,take:100,orderBy:{id:'asc'},...(cursor?{cursor:{id:cursor},skip:1}:{})});items.push(...rows.map(project));if(rows.length<100)break;cursor=rows[rows.length-1].id;}
      const scores=await this.matching.scoreProfilesAgainstJob(items,query.matchJobId);items=items.map((row,i)=>({...row,matchScore:scores[i].assessable?scores[i].total:null,matchBreakdown:scores[i]}));items.sort((a,b)=>compareRecruiterMatches(a.matchBreakdown!,b.matchBreakdown!)||a.id.localeCompare(b.id));items=items.slice((page-1)*limit,page*limit);
    }else{items=(await this.db.employeeProfile.findMany({where,include,orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(page-1)*limit,take:limit})).map(project);if(query.matchJobId){const scores=await this.matching.scoreProfilesAgainstJob(items,query.matchJobId);items=items.map((row,i)=>({...row,matchScore:scores[i].assessable?scores[i].total:null,matchBreakdown:scores[i]}));}}
    const sample=(await this.db.employeeProfile.findMany({where,include,take:1000,orderBy:{id:'asc'}})).map(project);
    type Facet={slug:string;name:string;nameId?:string|null;nameUz?:string|null;nameRu?:string|null;count:number};
    const cities=new Map<string,Facet>(),skills=new Map<string,Facet>(),titles=new Map<string,Facet>();
    const add=(map:Map<string,Facet>,term:{slug:string;name:string;nameId?:string|null;nameUz?:string|null;nameRu?:string|null;archivedAt?:Date|null}|null)=>{if(term&&!term.archivedAt){const old=map.get(term.slug);map.set(term.slug,{slug:term.slug,name:term.name,nameId:term.nameId,nameUz:term.nameUz,nameRu:term.nameRu,count:(old?.count??0)+1});}};
    const catalog=await this.db.jobTitle.findMany({where:ACTIVE_CATALOG,include:{aliases:true}});
    for(const row of sample){add(cities,row.city);for(const s of row.skills)add(skills,s.skill);const keys=new Set([row.headline,...row.cvRoleTitles,...row.experiences.map(e=>e.title)].filter((s):s is string=>Boolean(s)).map(normalizeJobTitleKey));for(const t of catalog)if([t.normalizedKey,t.name,t.nameId,t.nameUz,t.nameRu,...t.aliases.map(a=>a.alias)].some(label=>label&&keys.has(normalizeJobTitleKey(label))))add(titles,t);}
    const presence=await this.presence.getPresence(items.map(p=>p.user.id));
    return {items:items.map(p=>({id:p.id,user:p.user,headline:p.headline,city:p.city,residenceCountry:p.residenceCountry,desiredPositions:p.desiredPositions,desiredPosition:p.desiredPosition,desiredSalaryMin:p.desiredSalaryMin,desiredSalaryCurrency:p.desiredSalaryCurrency,skills:p.skills.map(s=>({id:s.id,skillId:s.skillId,skill:s.skill})),experienceYears:p.experienceYears,languages:p.languages,certifications:p.certifications,cvSource:p.cvSource,matchScore:p.matchScore,matchBreakdown:p.matchBreakdown,contactsBlurred:false,canReadCv:Boolean(p.databaseCvEnabled&&p.databaseResume?.fileKey&&!p.databaseResume.deletedAt),presence:presence[p.user.id]??null})),total,matchedTotal:total,truncated:false,page,limit,totalPages:Math.max(1,Math.ceil(total/limit)),limited:false,facets:{cities:[...cities.values()].slice(0,80),skills:[...skills.values()].slice(0,80),jobTitles:[...titles.values()].slice(0,80)}};
  }

  async get(user:AuthUser,profileId:string,jobId?:string,companyId?:string) {
    const job=jobId?await this.db.jobPost.findUnique({where:{id:jobId},include:{jobSkills:{include:{skill:{include:{aliases:true}}}},jobLanguages:{include:{language:true}},city:{include:{province:true}}}}):null;
    if(jobId&&!job)throw new NotFoundException('Job unavailable');
    const company=await this.access.context(user,companyId||job?.companyId);
    if(job&&job.companyId!==company)throw new ForbiddenException('Job and company context differ');
    const {applicant}=await this.access.candidate(user,company,profileId);
    const profile=await this.db.employeeProfile.findUniqueOrThrow({where:{id:profileId},include});
    let source=project(profile) as ReturnType<typeof project>&HrProfile;let match:RecruiterBreakdown|null=null;
    let applicationForJob:{id:string;resumeTitle:string|null;hasResumeFile:boolean;status:string;kanbanEnteredAt:Date|null;canAddToKanban:boolean}|null=null;
    let cv:{title:string|null;hasFile:boolean;format?:string;downloadPath:string;application:boolean}|null=null;
    if(job){const application=await this.db.application.findUnique({where:{jobPostId_profileId:{jobPostId:job.id,profileId}}});if(application){if(!hrEnabled())source={...source,...await applicationCvProfile(this.db,application,profile)};const submitted=submittedResume(application.resumeSnapshot);applicationForJob={id:application.id,resumeTitle:submitted.title,hasResumeFile:Boolean(submitted.fileKey),status:application.status,kanbanEnteredAt:application.kanbanEnteredAt,canAddToKanban:!application.kanbanEnteredAt&&!['WITHDRAWN','REJECTED','HIRED'].includes(application.status)};cv={title:submitted.title,hasFile:Boolean(submitted.fileKey),format:submitted.fileKey?.split('.').pop()?.toLowerCase(),downloadPath:'/applications/'+application.id+'/resume-download',application:true};}if(!hrEnabled()&&source.cvSource.status==='READY')match=await this.matching.scoreInputs(source,job);}
    if(!applicationForJob&&profile.databaseCvEnabled&&profile.databaseResume?.fileKey&&!profile.databaseResume.deletedAt)cv={title:profile.databaseResume.title,hasFile:true,format:profile.databaseResume.fileKey.split('.').pop()?.toLowerCase(),downloadPath:'/profiles/candidates/'+profileId+'/database-cv?companyId='+company,application:false};
    if(hrEnabled()&&job){
      if(applicationForJob){const window=await rankHrApplications(this.db,{jobPostId:job.id},job.id);const p=window.profiles.get(applicationForJob.id);if(p)source={...source,...p} as typeof source;match=window.scores.get(applicationForJob.id)??null;}
      else {source={...source,...(await this.matching.hrDatabaseInputs([source]))[0],city:source.city,preferredCountries:source.preferredCountries,languages:source.languages,experiences:source.experiences};match=await this.matching.scoreInputs(source,job);}
    }
    return {id:profile.id,user:profile.user,headline:source.headline,city:profile.city,residenceCountry:profile.residenceCountry,skills:source.skills.map(s=>({id:s.id,skill:s.skill})).slice(0,8),languages:hrEnabled()&&source.hr?source.hr.facts.languages.map(l=>({id:l.key,language:{name:l.code,code:l.code},level:l.level})):source.languages,certifications:hrEnabled()&&source.hr?source.hr.facts.certifications??[]:source.certifications,cvSource:source.cvSource,cv,match,applicationForJob,contactsBlurred:false,appliedToMyCompany:applicant,presence:await this.presence.getOne(profile.user.id)};
  }
}
