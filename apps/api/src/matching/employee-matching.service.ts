import { currentRoleSelect,currentRoleIdentity } from './employee-occupation';
import { liveJobWhere } from '../benefits/benefit-policy';
import { Injectable,Optional,Logger } from '@nestjs/common';
import { EmployeeIntentService,employeeIntentMode,employeeIntentSelected } from './employee-intent.service';
import { employeeRecommendationV32Enabled } from './employee-recommendation-policy';
import { compareIntent,type IntentEvaluation } from './employee-intent';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeEvaluation, EmployeeMatchJob, EmployeeMatchProfile, OccupationIndex, evaluateEmployee, rankEmployeeJobs, EMPLOYEE_MATCH_VERSION,candidateManualPositionScope } from './employee-matching';
import { MatchingService } from './matching.service';
import { loadJobPromotions, publicJobPromotion } from '../benefits/job-promotion';
import { placeEmployeeBoosts } from './employee-boost-placement';
import { withCvFacts,cvVersionSelect } from '../profiles/cv-evidence';
import { CandidateCache } from '../common/candidate-cache';
import {candidateExperienceSelect,employeeExperienceRevision} from './employee-experience-policy';
type IntentContext=Awaited<ReturnType<EmployeeIntentService['context']>>;

export const employeeJobFeatures = {
  id:true, title:true, jobTitleId:true, companyId:true, publishedAt:true, countryId:true, cityId:true,
  workMode:true, experienceYearsMin:true,experienceLevel:true,positionEntryMode:true,...candidateExperienceSelect,
  city:{select:{provinceId:true,province:{select:{countryId:true}}}},
  jobSkills:{include:{skill:{include:{aliases:{select:{aliasKey:true}}}}}},
  jobLanguages:{include:{language:true}},
  jobTitle:{select:currentRoleSelect},
} satisfies Prisma.JobPostSelect;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class EmployeeMatchingService {
  private cache = new Map<string, EmployeeEvaluation>();
  constructor(private prisma: PrismaService,private legacy:MatchingService = new MatchingService(prisma),@Optional() private intent?:EmployeeIntentService,@Optional() private performanceCache?:CandidateCache) {}
  usesIntent(profileId:string){return employeeRecommendationV32Enabled()||employeeIntentMode()==='unavailable'||employeeIntentMode()==='enabled'&&employeeIntentSelected(profileId);}
  async warmCatalog(){if(this.intent?.catalog&&this.performanceCache){const catalog=await this.intent.catalog();await this.performanceCache.memo('legacy-occupation:'+catalog.revision,600,async()=>new OccupationIndex(catalog.roles.filter(r=>!r.archivedAt)));}}
  async intentSearchScope(profileId:string){if(!this.usesIntent(profileId)&&employeeIntentMode()!=='shadow')return null;if(!this.intent)throw new Error('Employee intent service unavailable');return this.intent.context(profileId);}
  async intentExplanation(profileId:string,jobId:string){if(!this.usesIntent(profileId))return null;if(!this.intent)throw new Error('Employee intent service unavailable');return this.intent.explain(profileId,jobId);}
  compare(a:unknown,b:unknown){return a&&b&&'tier' in (a as object)&&'tier' in (b as object)?compareIntent(a as IntentEvaluation,b as IntentEvaluation):((b as EmployeeEvaluation)?.score??0)-((a as EmployeeEvaluation)?.score??0);}

  private enabled(profileId:string) {
    const percent = Number(process.env.EMPLOYEE_MATCHING_V2_PERCENT ?? 100);
    const bucket = parseInt(digest(profileId).slice(0,8),16) % 100;
    return bucket < (Number.isFinite(percent) ? Math.max(0,Math.min(100,percent)) : 100);
  }

  private async context(profileId: string,provided?:IntentContext) {
    const catalog=this.intent?.catalog?await this.intent.catalog():null;
    const [stored, roles] = await Promise.all([
      provided?Promise.resolve(provided.profile):this.prisma.employeeProfile.findUniqueOrThrow({where:{id:profileId}, include:{
        resumes:{where:{isPrimary:true,deletedAt:null,fileKey:{not:null}},take:1,include:{currentVersion:{select:cvVersionSelect}}},
        languages:{include:{language:true}}, preferredCountries:{select:{id:true}},
        city:{include:{province:{select:{countryId:true}}}},
      }}),
      catalog?Promise.resolve(catalog.roles.filter(r=>!r.archivedAt)):this.prisma.jobTitle.findMany({where:{archivedAt:null},select:{id:true,name:true,nameId:true,nameUz:true,nameRu:true,
        normalizedKey:true,matchingMetadata:true,aliases:{select:{alias:true,aliasKey:true}}}}),
    ]);
    const profile=withCvFacts(stored,stored.resumes[0]?.currentVersion);
    const makeIndex=async()=>new OccupationIndex(roles);
    const index=this.performanceCache&&catalog?await this.performanceCache.memo('legacy-occupation:'+catalog.revision,600,makeIndex):await makeIndex();
    return { profile, index, fingerprint:digest([EMPLOYEE_MATCH_VERSION,employeeExperienceRevision(),profile,catalog?.revision||roles,new Date().toISOString().slice(0,10)]) };
  }

  private evaluate(context: {profile:EmployeeMatchProfile;index:OccupationIndex;fingerprint:string}, job:EmployeeMatchJob) {
    const key = digest([context.fingerprint,job]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = evaluateEmployee(context.profile,job,context.index);
    if (this.cache.size >= 5000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key,result);
    return result;
  }

  async scoreJobsForProfile(profileId: string, ids: string[],provided?:IntentContext|null) {
    if(this.usesIntent(profileId)){if(!this.intent)throw new Error('Employee intent service unavailable');return this.intent.scoreJobsForProfile(profileId,ids,provided||undefined);}
    if (!ids.length) return new Map<string, EmployeeEvaluation>();
    const shadowScope=provided||(employeeIntentMode()==='shadow'&&this.intent?await this.intent.context(profileId):null);
    if(shadowScope&&(shadowScope.state!=='READY'||!shadowScope.allowedIds.length))return new Map<string,EmployeeEvaluation>();
    const allowedIds=shadowScope?new Set(shadowScope.allowedIds):null;
    const [context,jobs] = await Promise.all([this.context(profileId,shadowScope||undefined),this.prisma.jobPost.findMany({where:{id:{in:ids},...candidateManualPositionScope,...(allowedIds?{jobTitleId:{in:[...allowedIds]}}:{})},select:employeeJobFeatures})]);
    if(context.profile.cvSource.status!=='READY')return new Map<string,EmployeeEvaluation>();
    const old = this.enabled(profileId) ? null : await this.legacy.scoreJobsForProfile(profileId,ids);
    return new Map(jobs.filter(job=>{
      if(!shadowScope)return true;
      const current=currentRoleIdentity(job.jobTitle);
      return current&&shadowScope.preferences.selectedIds.some(id=>{const selected=shadowScope.index.identity(id);return selected?.canonicalRoleId===current.canonicalRoleId&&selected.familyId===current.familyId;});
    }).map(job => { const evaluation=this.evaluate(context,job);return [job.id,old ? {...evaluation,score:old.get(job.id)?.total ?? 0,positiveCore:true} : evaluation]; }));
  }

  async forJob(profileId: string, jobId: string) {
    return (await this.scoreJobsForProfile(profileId,[jobId])).get(jobId) ?? null;
  }

  async recommend(profileId: string, page = 1, limit = 24, feed:'recommendations'|'exploration'|'salary-unverified'='recommendations') {
    if(feed==='exploration'){
      if(!this.intent)throw new Error('Employee intent service unavailable');
      return this.intent.explore(profileId,page,limit);
    }
    if(this.usesIntent(profileId)||feed==='salary-unverified'){if(!this.intent)throw new Error('Employee intent service unavailable');return this.intent.recommend(profileId,page,limit,undefined,feed);}
    const shadowScope=employeeIntentMode()==='shadow'&&this.intent?await this.intent.context(profileId):null;
    if(shadowScope?.state==='READY'&&this.performanceCache&&this.intent)this.performanceCache.shadow(shadowScope.fingerprint,()=>this.intent!.recommend(profileId,page,limit,shadowScope));
    if(shadowScope&&(shadowScope.state!=='READY'||!shadowScope.allowedIds.length))return {items:[],page:1,limit,total:0,totalPages:1,mode:'UNAVAILABLE' as const,version:EMPLOYEE_MATCH_VERSION,rankingRevision:shadowScope.fingerprint,cvSource:shadowScope.cvSource,state:shadowScope.state==='READY'?'NO_ELIGIBLE_JOBS':shadowScope.state};
    const now = new Date();
    const context = await this.context(profileId,shadowScope||undefined);
    const ready=context.profile.cvSource.status==='READY';
    const compute=async()=>{
    // Retrieve lightweight evidence only. Full posting content is fetched for one page.
    const features = await this.prisma.jobPost.findMany({where:{...liveJobWhere(now),...candidateManualPositionScope,
      applications:{none:{profileId}},...(shadowScope?{jobTitleId:{in:shadowScope.allowedIds}}:{})},select:employeeJobFeatures});
    const old = this.enabled(profileId) ? null : await this.legacy.scoreJobsForProfile(profileId,features.map(job=>job.id));
    const scored = features.map(job => {const evaluation=this.evaluate(context,job);return {job,evaluation:old ? {...evaluation,score:old.get(job.id)?.total ?? 0,positiveCore:true} : evaluation};});
    if(!ready)for(const row of scored){row.evaluation={...row.evaluation,score:0,positiveCore:false,insights:{...row.evaluation.insights,mode:'LATEST',evidence:[]}};}
    const personal = scored.filter(row => row.evaluation.positiveCore);
    const selected = personal.length ? personal : scored;
    const organic = rankEmployeeJobs(selected);
    if(!ready){
      const countries=new Set(context.profile.preferredCountries?.map(country=>country.id));
      const wanted=new Set([context.profile.desiredPosition,...(context.profile.desiredPositions??[])].filter((text):text is string=>Boolean(text)).flatMap(text=>[...context.index.resolve(text)]));
      const country=(job:EmployeeMatchJob)=>Number(countries.has(job.countryId??job.city?.province?.countryId??''));
      const role=(job:EmployeeMatchJob)=>Number(job.jobTitleId?wanted.has(job.jobTitleId):[...context.index.resolve(job.title)].some(id=>wanted.has(id)));
      organic.sort((a,b)=>country(b.job)-country(a.job)||role(b.job)-role(a.job)||(b.job.publishedAt?.getTime()??0)-(a.job.publishedAt?.getTime()??0)||a.job.id.localeCompare(b.job.id));
    }
    return {personal:personal.length>0,organic:organic.map(row=>({...row,job:{id:row.job.id,title:row.job.title,jobTitleId:row.job.jobTitleId,companyId:row.job.companyId,publishedAt:row.job.publishedAt}}))};
    };
    const result=this.performanceCache?await this.performanceCache.ranked(['employee-ranking',profileId,context.fingerprint,shadowScope?.fingerprint,employeeIntentMode(),process.env.EMPLOYEE_MATCHING_V2_PERCENT],compute):await compute();
    let organic=[...result.organic];
    if(this.performanceCache){
      const live=await this.prisma.jobPost.findMany({where:{...liveJobWhere(now),...candidateManualPositionScope,id:{in:organic.map(row=>row.job.id)},applications:{none:{profileId}},...(shadowScope?{jobTitleId:{in:shadowScope.allowedIds}}:{})},select:{id:true,jobTitleId:true,jobTitle:{select:currentRoleSelect}}});
      const allowed=new Set(live.filter(job=>{if(!shadowScope)return true;const current=currentRoleIdentity(job.jobTitle);return current&&shadowScope.preferences.selectedIds.some(id=>{const selected=shadowScope.index.identity(id);return selected?.canonicalRoleId===current.canonicalRoleId&&selected.familyId===current.familyId;});}).map(job=>job.id));
      organic=organic.filter(row=>allowed.has(row.job.id));
    }
    const promotions = await loadJobPromotions(this.prisma, organic.map(row => row.job.id), now);
    const placementEnabled = process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED === 'true' && this.enabled(profileId)
      && result.personal && promotions.available && promotions.enabled;
    const activeBoosts = new Set(placementEnabled ? [...promotions.rows].filter(([, state]) => state.publicState.boostActive).map(([id]) => id) : []);
    const ranked = placeEmployeeBoosts(organic, activeBoosts);
    const rankingRevision = digest([context.fingerprint, placementEnabled, promotions.available,
      ranked.map(row => [row.job.id, row.placement, promotions.rows.get(row.job.id)?.publicState])]);
    const total = ranked.length;
    const totalPages = Math.max(1,Math.ceil(total/limit));
    page = Math.min(page,totalPages);
    const rows = ranked.slice((page-1)*limit,page*limit);
    const jobs = await this.prisma.jobPost.findMany({where:{id:{in:rows.map(row => row.job.id)},...liveJobWhere(now),...candidateManualPositionScope,applications:{none:{profileId}},...(shadowScope?{jobTitleId:{in:shadowScope.allowedIds}}:{})},
      select:{id:true,title:true,companyId:true,isAnonymous:true,locale:true,createdAt:true,publishedAt:true,
        employmentType:true,workMode:true,salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true,
        city:{include:{province:true}},country:true,category:true,
        company:{select:{id:true,name:true,slug:true,logoUrl:true}}}});
    const byId = new Map(jobs.map(job => [job.id,job]));
    return { items:rows.flatMap(row => {
      const job = byId.get(row.job.id);
      return job ? [{job:{...job,...publicJobPromotion(promotions,job.id),placement:row.placement},matchScore:ready?row.evaluation.score:null,matchInsights:ready?row.evaluation.insights:null}] : [];
    }), ...(shadowScope?{state:total?'READY':'NO_ELIGIBLE_JOBS',version:'employee-intent-v3'}:{}),page,limit,total,totalPages,mode:result.personal ? 'PERSONALIZED' as const : 'LATEST' as const,version:shadowScope?'employee-intent-v3':EMPLOYEE_MATCH_VERSION,rankingRevision,cvSource:context.profile.cvSource };
  }
}
