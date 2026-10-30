import { liveJobWhere } from '../benefits/benefit-policy';
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeEvaluation, EmployeeMatchJob, EmployeeMatchProfile, OccupationIndex, evaluateEmployee, rankEmployeeJobs, EMPLOYEE_MATCH_VERSION } from './employee-matching';
import { MatchingService } from './matching.service';
import { loadJobPromotions, publicJobPromotion } from '../benefits/job-promotion';
import { placeEmployeeBoosts } from './employee-boost-placement';

export const employeeJobFeatures = {
  id:true, title:true, jobTitleId:true, companyId:true, publishedAt:true, countryId:true, cityId:true,
  workMode:true, experienceYearsMin:true,experienceLevel:true,
  city:{select:{provinceId:true,province:{select:{countryId:true}}}},
  jobSkills:{include:{skill:{include:{aliases:{select:{aliasKey:true}}}}}},
  jobLanguages:{include:{language:true}},
} satisfies Prisma.JobPostSelect;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class EmployeeMatchingService {
  private cache = new Map<string, EmployeeEvaluation>();
  constructor(private prisma: PrismaService,private legacy:MatchingService = new MatchingService(prisma)) {}

  private enabled(profileId:string) {
    const percent = Number(process.env.EMPLOYEE_MATCHING_V2_PERCENT ?? 100);
    const bucket = parseInt(digest(profileId).slice(0,8),16) % 100;
    return bucket < (Number.isFinite(percent) ? Math.max(0,Math.min(100,percent)) : 100);
  }

  private async context(profileId: string) {
    const [profile, roles] = await Promise.all([
      this.prisma.employeeProfile.findUniqueOrThrow({where:{id:profileId}, include:{
        skills:{include:{skill:{include:{aliases:{select:{aliasKey:true}}}}}}, experiences:true,
        languages:{include:{language:true}}, preferredCountries:{select:{id:true}},
        city:{include:{province:{select:{countryId:true}}}},
      }}),
      this.prisma.jobTitle.findMany({where:{archivedAt:null},select:{id:true,name:true,nameId:true,nameUz:true,nameRu:true,
        normalizedKey:true,matchingMetadata:true,aliases:{select:{alias:true,aliasKey:true}}}}),
    ]);
    return { profile, index:new OccupationIndex(roles), fingerprint:digest([EMPLOYEE_MATCH_VERSION,profile,roles,new Date().toISOString().slice(0,10)]) };
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

  async scoreJobsForProfile(profileId: string, ids: string[]) {
    if (!ids.length) return new Map<string, EmployeeEvaluation>();
    const [context,jobs] = await Promise.all([this.context(profileId),this.prisma.jobPost.findMany({where:{id:{in:ids}},select:employeeJobFeatures})]);
    const old = this.enabled(profileId) ? null : await this.legacy.scoreJobsForProfile(profileId,ids);
    return new Map(jobs.map(job => { const evaluation=this.evaluate(context,job);return [job.id,old ? {...evaluation,score:old.get(job.id)?.total ?? 0,positiveCore:true} : evaluation]; }));
  }

  async forJob(profileId: string, jobId: string) {
    return (await this.scoreJobsForProfile(profileId,[jobId])).get(jobId) ?? null;
  }

  async recommend(profileId: string, page = 1, limit = 24) {
    const now = new Date();
    const context = await this.context(profileId);
    // Retrieve lightweight evidence only. Full posting content is fetched for one page.
    const features = await this.prisma.jobPost.findMany({where:{...liveJobWhere(now),
      applications:{none:{profileId}}},select:employeeJobFeatures});
    const old = this.enabled(profileId) ? null : await this.legacy.scoreJobsForProfile(profileId,features.map(job=>job.id));
    const scored = features.map(job => {const evaluation=this.evaluate(context,job);return {job,evaluation:old ? {...evaluation,score:old.get(job.id)?.total ?? 0,positiveCore:true} : evaluation};});
    const personal = scored.filter(row => row.evaluation.positiveCore);
    const selected = personal.length ? personal : scored;
    const organic = rankEmployeeJobs(selected);
    const promotions = await loadJobPromotions(this.prisma, organic.map(row => row.job.id), now);
    const placementEnabled = process.env.EMPLOYEE_BOOST_PLACEMENTS_ENABLED === 'true' && this.enabled(profileId)
      && personal.length > 0 && promotions.available && promotions.enabled;
    const activeBoosts = new Set(placementEnabled ? [...promotions.rows].filter(([, state]) => state.publicState.boostActive).map(([id]) => id) : []);
    const ranked = placeEmployeeBoosts(organic, activeBoosts);
    const rankingRevision = digest([context.fingerprint, placementEnabled, promotions.available,
      ranked.map(row => [row.job.id, row.placement, promotions.rows.get(row.job.id)?.publicState])]);
    const total = ranked.length;
    const totalPages = Math.max(1,Math.ceil(total/limit));
    page = Math.min(page,totalPages);
    const rows = ranked.slice((page-1)*limit,page*limit);
    const jobs = await this.prisma.jobPost.findMany({where:{id:{in:rows.map(row => row.job.id)},...liveJobWhere(now)},
      select:{id:true,title:true,companyId:true,isAnonymous:true,locale:true,createdAt:true,publishedAt:true,
        employmentType:true,workMode:true,salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true,
        city:{include:{province:true}},country:true,category:true,
        company:{select:{id:true,name:true,slug:true,logoUrl:true}}}});
    const byId = new Map(jobs.map(job => [job.id,job]));
    return { items:rows.flatMap(row => {
      const job = byId.get(row.job.id);
      return job ? [{job:{...job,...publicJobPromotion(promotions,job.id),placement:row.placement},matchScore:row.evaluation.score,matchInsights:row.evaluation.insights}] : [];
    }), page,limit,total,totalPages,mode:personal.length ? 'PERSONALIZED' as const : 'LATEST' as const,version:EMPLOYEE_MATCH_VERSION,rankingRevision };
  }
}
