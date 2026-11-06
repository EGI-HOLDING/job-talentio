import { practicalFit, employeePracticalEnabled, EMPLOYEE_PRACTICAL_POLICY_VERSION } from './employee-practical-policy';
import { candidateExperienceSelect,employeeExperienceRevision,employeeExperiencePolicyEnabled } from './employee-experience-policy';
import { currentRoleSelect,currentRoleIdentity } from './employee-occupation';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { createHash } from 'node:crypto';
import { EMPLOYEE_INTENT_VERSION, EMPLOYEE_RELATED_RANKING_VERSION, type EmployeeRecommendationState, type EmployeeEvidenceState, type EmployeeEligibility } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';
import { loadJobPromotions, publicJobPromotion } from '../benefits/job-promotion';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { applyEmployeeOverrides, evidenceConflicts, hasEmployeeCareerEvidence, type IntentFacts, type EvidenceOverride, employeeEvidenceParserVersion } from './employee-intent-evidence';
import { evaluateIntent, compareIntent, type IntentEvaluation, type IntentExperienceCache } from './employee-intent';
import { VacancyTasksService, type VacancySelection } from './vacancy-tasks.service';
export const employeeIntentJobSelect = { ...candidateExperienceSelect, id: true, updatedAt:true, title: true, jobTitleId: true, jobTitle:{select:currentRoleSelect}, companyId: true, publishedAt: true, countryId: true, cityId: true, workMode: true, experienceYearsMin: true, experienceLevel: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { select: { province: { select: { countryId: true } } } }, jobSkills: { include: { skill: { select: { name: true, matchingKind: true } } } }, jobLanguages: { include: { language: { select: { code: true, name: true } } } } } as const;
export const intentRoleScope = (context:{allowedIds:string[];vacancies?:VacancySelection}) =>
  context.vacancies ? {id:{in:[...context.vacancies.decisions.keys()]}} : {jobTitleId:{in:context.allowedIds}};
export const intentJobScope = (context:{allowedIds:string[];vacancies?:VacancySelection;practicalSelection?:{mainIds:string[]}}) =>
  context.practicalSelection ? {id:{in:context.practicalSelection.mainIds}} : intentRoleScope(context);
export const practicalJobSelect = {countryId:true,city:{select:{province:{select:{countryId:true}}}},salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true} as const;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
@Injectable()
export class EmployeeIntentService {
    constructor(private db: PrismaService, @Optional() private catalogSnapshot?: EmployeeCatalogSnapshot, @Optional() private cache?: CandidateCache, @Optional() private vacancyTasks?:VacancyTasksService) { }
    onModuleInit(){new Logger('EmployeeIntent').log('Candidate engine V3.2 is the only engine: exact/related occupations, partial evidence and explicit exploration.');}
    catalog(){return (this.catalogSnapshot||new EmployeeCatalogSnapshot(this.db)).get(true);}
    async context(profileId: string, includeVacancies=true) {
        const [profile, catalog] = await Promise.all([
            this.db.employeeProfile.findUniqueOrThrow({ where: { id: profileId }, include: { desiredRoles: {include:{jobTitle:{select:currentRoleSelect}}}, languages:{include:{language:true}},city:{include:{province:{select:{countryId:true}}}}, preferredCountries: { select: { id: true } }, resumes: { where: { isPrimary: true, deletedAt: null, fileKey: { not: null } }, take: 1, include: { currentVersion: { select: {id:true,parseStatus:true,parseGeneration:true,matchingData:true,experienceYears:true,employeeEvidence:true} } } } } }),
            this.catalog(),
        ]);

        const experiencePolicyEnabled=employeeExperiencePolicyEnabled();
        const experienceCache:IntentExperienceCache=new Map();
        const {roles} = catalog;
        const index=!catalog.index.allowRelated?new EmployeeOccupationIndex(roles,true):catalog.index;
        const version = profile.resumes[0]?.currentVersion;
        const stored = version?.employeeEvidence;
        const rawSelectedIds = profile.desiredRoles.map(r => r.jobTitleId);
        const selectedIds = rawSelectedIds.filter(id=>!!index.identity(id));
        const preferenceWarnings= (!profile.matchingPreferencesReviewed || selectedIds.length!==rawSelectedIds.length)?['PREFERENCES_REVIEW_REQUIRED']:[];
        const preferences = { ...profile, selectedIds };
        const state:EmployeeRecommendationState=process.env.EMPLOYEE_RECOMMENDATIONS_AVAILABLE==='false'?'UNAVAILABLE':!selectedIds.length?(profile.desiredPositions.length||rawSelectedIds.length?'PREFERENCES_REVIEW_REQUIRED':'PREFERENCES_REQUIRED'):'READY';
        let facts: IntentFacts = { roles: [], skills: [], experiences: [], languages: [] };
        // Only the completed projection of this CV generation may supply ranking facts.
        // A conflict in one correction must not suppress unrelated evidence.
        if (stored?.facts && stored.status === 'READY' && (version?.parseStatus === 'READY' && stored.generation === version.parseGeneration && stored.parserVersion === employeeEvidenceParserVersion(roles))) {
            const original = stored.facts as unknown as IntentFacts;
            const overrides = (stored.overrides ?? []) as EvidenceOverride[];
            const conflicts = new Set(evidenceConflicts(original, overrides));
            facts = applyEmployeeOverrides(original, overrides.filter(row => !conflicts.has(row.key)));

        }

        let evidenceState:EmployeeEvidenceState=!version?'REQUIRED':version.parseStatus==='FAILED'||stored?.status==='FAILED'?'FAILED':version.parseStatus!=='READY'||!stored||stored.parserVersion!==employeeEvidenceParserVersion(roles)||stored.generation!==version.parseGeneration||['PENDING','PROCESSING'].includes(stored.status)?'PROCESSING':!stored.facts||stored.status!=='READY'||evidenceConflicts(stored.facts as unknown as IntentFacts,(stored.overrides??[]) as EvidenceOverride[]).length||!hasEmployeeCareerEvidence(facts)?'REVIEW_REQUIRED':'READY';
        const allowedIds = state === 'READY' ? roles.filter(role => index.eligibility(selectedIds, role.id).eligible).map(r => r.id) : [];
        let vacancies:VacancySelection|undefined;
        if(includeVacancies&&state==='READY'&&this.vacancyTasks){
          vacancies=await this.vacancyTasks.select(index,selectedIds,allowedIds,'relationReleaseId' in catalog?catalog.relationReleaseId as string|null:undefined);
        }
        const practicalEnabled = employeePracticalEnabled();
        let practicalSelection:{mainIds:string[];unknownIds:string[];roleCandidateCount:number}|undefined;
        if (practicalEnabled && includeVacancies && state === 'READY') {
          const candidates=await this.db.jobPost.findMany({where:{...liveJobWhere(),...intentRoleScope({allowedIds,vacancies}),applications:{none:{profileId}}},select:{id:true,...practicalJobSelect}});
          practicalSelection={mainIds:[],unknownIds:[],roleCandidateCount:candidates.length};
          for (const job of candidates) {
            const fit=practicalFit(preferences,job);
            if(fit.group==='MAIN')practicalSelection.mainIds.push(job.id);
            if(fit.group==='SALARY_UNVERIFIED')practicalSelection.unknownIds.push(job.id);
          }
        }
        const preferencesOnly = !hasEmployeeCareerEvidence(facts) && !facts.languages.length;
        return { experienceCache, experiencePolicyEnabled, profile, preferences, index, facts, state, allowedIds, vacancies, practicalEnabled, practicalSelection, evidenceState, preferenceWarnings, preferencesOnly, cvSource: { versionId: version?.id ?? null, status: version?.parseStatus ?? 'NONE', evidenceRevision: stored?.revision ?? null }, fingerprint: digest([employeeExperienceRevision(),EMPLOYEE_INTENT_VERSION, EMPLOYEE_RELATED_RANKING_VERSION, profile, catalog.recommendationRevision,state,evidenceState,'partial-evidence-v1',vacancies?.revision,EMPLOYEE_PRACTICAL_POLICY_VERSION]) };
    }
    async status(userId:string) {
        const profile = await this.db.employeeProfile.findUnique({where:{userId},select:{id:true}});
        if(!profile)return {state:'PREFERENCES_REQUIRED',cvSource:{versionId:null,status:'NONE',evidenceRevision:null},revision:'none'};
        const context=await this.context(profile.id,false);
        const library=await this.db.resume.findMany({where:{profileId:profile.id,deletedAt:null},select:{id:true,currentVersion:{select:{id:true,parseStatus:true,parseGeneration:true}}},orderBy:{id:'asc'}});
        return {version:EMPLOYEE_INTENT_VERSION,state:context.state,evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings,cvSource:context.cvSource,revision:digest([context.fingerprint,library])};
    }
    async scoreJobsForProfile(profileId: string, ids: string[],provided?:Awaited<ReturnType<EmployeeIntentService['context']>>) {
        const result = new Map<string, IntentEvaluation>();
        if (!ids.length)
            return result;
        const context = provided || await this.context(profileId);
        if (context.state !== 'READY')
            return result;
        const requested=new Set(ids);
        const scope=context.vacancies
          ? {id:{in:[...context.vacancies.decisions.keys()].filter(id=>requested.has(id))}}
          : {id:{in:ids},jobTitleId:{in:context.allowedIds}};
        const jobs = await this.db.jobPost.findMany({ where: { ...scope,...liveJobWhere(),applications:{none:{profileId}} }, select: employeeIntentJobSelect });
        for (const job of jobs) {
            if(!requested.has(job.id))continue;
            const current = job.jobTitle === undefined ? context.index.identity(job.jobTitleId || '') : currentRoleIdentity(job.jobTitle);
            if(!current)continue;
            const e = this.evaluate(context,job);
            if (e.eligibility.eligible && practicalFit(context.preferences,job,context.practicalEnabled).group==='MAIN')
                result.set(job.id, e);
        }
        return result;
    }
    private eligibility(context:Awaited<ReturnType<EmployeeIntentService['context']>>,job:{id:string;jobTitleId:string|null;updatedAt?:Date}) {
        if(!context.vacancies)return context.index.eligibility(context.preferences.selectedIds,job.jobTitleId);
        const row=context.vacancies.decisions.get(job.id);
        return row&&row.roleId===job.jobTitleId&&row.updatedAt.getTime()===job.updatedAt?.getTime()?row.eligibility:{eligible:false,reason:'POSITION_MISMATCH'} as const;
    }
    evaluate(context:Awaited<ReturnType<EmployeeIntentService['context']>>,job:Parameters<typeof evaluateIntent>[2]&{updatedAt?:Date},now=new Date()) {
        const evaluation=evaluateIntent(context.preferences,context.facts,job,context.index,now,this.eligibility(context,job),context.experiencePolicyEnabled,context.experienceCache);
        if(context.preferencesOnly){evaluation.tier=1;evaluation.score=0;evaluation.optionalScore=0;evaluation.insights={...evaluation.insights,mode:'PREFERENCES_BASED',evidence:evaluation.insights.evidence.filter(e=>e.kind==='ROLE')};}
        if(context.practicalEnabled)evaluation.insights={...evaluation.insights,practicalFit:practicalFit(context.preferences,job)};
        return evaluation;
    }
    async recommend(profileId: string, page = 1, limit = 24, provided?:Awaited<ReturnType<EmployeeIntentService['context']>>,feed:'recommendations'|'salary-unverified'='recommendations') {
        const context = provided || await this.context(profileId);
        const now = new Date();
        let mainTotal=0,salaryUnverifiedTotal=0;
        const policy={version:EMPLOYEE_PRACTICAL_POLICY_VERSION,active:context.practicalEnabled,countryFilterApplied:!!(context.preferences.preferredCountries.length||context.preferences.residenceCountryId)};
        const empty = (state: EmployeeRecommendationState,emptyReason: import('@job-talentio/shared').EmployeeEmptyReason=state==='UNAVAILABLE'?'SERVICE_UNAVAILABLE':state.startsWith('PREFERENCES')?'UNRECOGNIZED_PREFERENCES':'NO_ACTIVE_JOBS') => ({ mainTotal,salaryUnverifiedTotal,practicalPolicy:policy,feed,items: [], page: 1, limit, total: 0, totalPages: 1, mode: 'UNAVAILABLE' as const, state, emptyReason, evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings, version: EMPLOYEE_INTENT_VERSION, rankingRevision: context.fingerprint, cvSource: context.cvSource });
        if (context.state !== 'READY')
            return empty(context.state);
        const compute=async()=>{
          const jobs = await this.db.jobPost.findMany({ where: { ...liveJobWhere(now), ...intentRoleScope(context), applications: { none: { profileId } } }, select: employeeIntentJobSelect });
          new Logger('EmployeeIntent').log(JSON.stringify({policy:'related-roles-v32',stage:'retrieval',allowedTitles:context.allowedIds.length,retrieved:jobs.length,evidenceState:context.evidenceState}));
          return jobs.map(job => ({ job:{id:job.id,companyId:job.companyId,jobTitleId:job.jobTitleId,publishedAt:job.publishedAt,updatedAt:job.updatedAt?.toISOString()}, evaluation: this.evaluate(context,job,now) })).filter(row => row.evaluation.eligibility.eligible).sort((a, b) => compareIntent(a.evaluation, b.evaluation) || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
        };
        let ranked=this.cache?await this.cache.ranked(['intent-v3',profileId,context.fingerprint,new Date().toISOString().slice(0,10)],compute):await compute();
        {
          const live=await this.db.jobPost.findMany({where:{...liveJobWhere(now),id:{in:ranked.map(r=>r.job.id)},applications:{none:{profileId}}},select:{id:true,updatedAt:true,jobTitleId:true,jobTitle:{select:currentRoleSelect},...practicalJobSelect}});
          const revisions=new Map(ranked.map(r=>[r.job.id,r.job.updatedAt]));
          if(live.some(j=>revisions.get(j.id)!==j.updatedAt?.toISOString()))ranked=await compute();
          const allowed=new Set(live.filter(j=>currentRoleIdentity(j.jobTitle)&&this.eligibility(context,j).eligible).map(j=>j.id));
          const fits=new Map(live.map(job=>[job.id,practicalFit(context.preferences,job,context.practicalEnabled)]));
          ranked=ranked.filter(r=>allowed.has(r.job.id)).map(row=>({...row,evaluation:{...row.evaluation,insights:{...row.evaluation.insights,...(context.practicalEnabled?{practicalFit:fits.get(row.job.id)}:{})}}}));
        }
        const roleTotal=ranked.length;
        const group=(row:typeof ranked[number])=>row.evaluation.insights.practicalFit?.group||'MAIN';
        mainTotal=ranked.filter(row=>group(row)==='MAIN').length;
        salaryUnverifiedTotal=ranked.filter(row=>group(row)==='SALARY_UNVERIFIED').length;
        ranked=ranked.filter(row=>group(row)===(feed==='salary-unverified'?'SALARY_UNVERIFIED':'MAIN'));
        if (!ranked.length){
            if(roleTotal)return empty('NO_ELIGIBLE_JOBS','PRACTICAL_PREFERENCES');
            const active=await this.db.jobPost.count({where:{...liveJobWhere(now),...intentJobScope(context)}});
            new Logger('EmployeeIntent').log(JSON.stringify({policy:'related-roles-v32',stage:'empty',activeInScope:active,returned:0,reason:active?'ALL_APPLIED':'NO_ACTIVE_JOBS'}));
            return empty('NO_ELIGIBLE_JOBS',active?'ALL_APPLIED':'NO_ACTIVE_JOBS');
        }
        const total = ranked.length, totalPages = Math.max(1, Math.ceil(total / limit));
        page = Math.min(Math.max(1, page), totalPages);
        const selected = ranked.slice((page - 1) * limit, page * limit);
        const [full, promotions] = await Promise.all([this.db.jobPost.findMany({ where: { AND:[{id:{in:selected.map(r=>r.job.id)}},intentRoleScope(context)], ...liveJobWhere(now),applications:{none:{profileId}} }, select: { id: true, updatedAt:true, countryId:true, jobTitleId:true, title: true, companyId: true, isAnonymous: true, locale: true, createdAt: true, publishedAt: true, employmentType: true, workMode: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { include: { province: true } }, country: true, category: true, company: { select: { id: true, name: true, slug: true, logoUrl: true } } } }), loadJobPromotions(this.db, selected.map(r => r.job.id), now)]);
        const byId = new Map(full.filter(j=>this.eligibility(context,j).eligible&&practicalFit(context.preferences,j,context.practicalEnabled).group===(feed==='salary-unverified'?'SALARY_UNVERIFIED':'MAIN')).map(({updatedAt:_updatedAt,jobTitleId:_jobTitleId,...job}) => [job.id, job]));
        const items = selected.flatMap(row => { const job = byId.get(row.job.id); return job ? [{ job: { ...job, ...publicJobPromotion(promotions, job.id), placement: 'ORGANIC' as const }, recommendationType:row.evaluation.eligibility.matchType||'EXACT' as const, matchScore: context.preferencesOnly?null:row.evaluation.score, matchType:row.evaluation.eligibility.matchType,selectedRoleId:row.evaluation.eligibility.selectedRoleId,selectedRoleName:row.evaluation.eligibility.selectedRoleName,relationReference:row.evaluation.eligibility.relationReference, matchInsights: row.evaluation.insights, eligibility: row.evaluation.eligibility }] : []; });
        if (!items.length)
            return empty('NO_ELIGIBLE_JOBS');
        new Logger('EmployeeIntent').log(JSON.stringify({ version: EMPLOYEE_INTENT_VERSION, state: 'READY', eligible: total, returned: items.length, unknown: items.reduce((n, i) => n + i.matchInsights.evidence.filter(e => e.status === 'UNKNOWN').length, 0) }));
        return { mainTotal,salaryUnverifiedTotal,practicalPolicy:policy,feed,items, page, limit, total, totalPages, mode: context.preferencesOnly?'PREFERENCES_BASED' as const:'PERSONALIZED' as const, state: 'READY' as const, evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings, version: EMPLOYEE_INTENT_VERSION, rankingRevision: digest([context.fingerprint,feed, ranked.map(r => [r.job.id, r.evaluation])]), cvSource: context.cvSource };
    }
    async explore(profileId:string,page:number,limit:number,context?:Awaited<ReturnType<EmployeeIntentService['context']>>){
        context??=await this.context(profileId,false);
        const where={...liveJobWhere(),applications:{none:{profileId}}};
        const total=await this.db.jobPost.count({where}),totalPages=Math.max(1,Math.ceil(total/limit));page=Math.min(Math.max(1,page),totalPages);
        const jobs=await this.db.jobPost.findMany({where,orderBy:[{publishedAt:'desc'},{id:'asc'}],skip:(page-1)*limit,take:limit,select:{id:true,title:true,companyId:true,isAnonymous:true,locale:true,createdAt:true,publishedAt:true,employmentType:true,workMode:true,salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true,city:{include:{province:true}},country:true,category:true,company:{select:{id:true,name:true,slug:true,logoUrl:true}}}});
        new Logger('EmployeeIntent').log(JSON.stringify({policy:'related-roles-v32',stage:'exploration',returned:jobs.length,total}));
        const promotions=await loadJobPromotions(this.db,jobs.map(j=>j.id),new Date());
        const items=jobs.map(job=>({job:{...job,...publicJobPromotion(promotions,job.id),placement:'ORGANIC' as const},recommendationType:'EXPLORATION' as const,matchType:undefined,selectedRoleId:undefined,selectedRoleName:undefined,relationReference:undefined,matchScore:null,matchInsights:{version:EMPLOYEE_INTENT_VERSION,mode:'EXPLORATION' as const,evidence:[],reviewExperienceIds:[]},eligibility:{eligible:false,reason:'POSITION_MISMATCH'} as EmployeeEligibility}));
        const remainingReason=total===0&&await this.db.jobPost.count({where:liveJobWhere()})>0?'ALL_APPLIED' as const:'NO_ACTIVE_JOBS' as const;
        return {items,page,limit,total,totalPages,mode:'EXPLORATION' as const,state:items.length?'READY' as const:'NO_ELIGIBLE_JOBS' as const,emptyReason:items.length?undefined:remainingReason,version:EMPLOYEE_INTENT_VERSION,rankingRevision:digest([profileId,'exploration',total,await this.cache?.version('jobs')]),cvSource:context.cvSource};
    }
    async explain(profileId: string, jobId: string) {
        const context = await this.context(profileId);
        const job = await this.db.jobPost.findFirst({ where: { id: jobId,...liveJobWhere(),applications:{none:{profileId}} }, select: employeeIntentJobSelect });
        const eligibility = job ? this.eligibility(context,job) : context.index.eligibility(context.preferences.selectedIds,null);
        if (context.state !== 'READY' || !job || !eligibility.eligible)
            return { state: context.state === 'READY' ? 'NO_ELIGIBLE_JOBS' : context.state, eligibility, matchScore: null, matchInsights: null };
        const evaluation = this.evaluate(context,job);
        const fit=practicalFit(context.preferences,job,context.practicalEnabled);
        return { state: fit.group==='EXCLUDED'?'NO_ELIGIBLE_JOBS' as const:'READY' as const, practicalFit:fit, evidenceState:context.evidenceState,eligibility,matchType:eligibility.matchType,selectedRoleName:eligibility.selectedRoleName,relationReference:eligibility.relationReference, matchScore: context.preferencesOnly?null:evaluation.score, matchInsights: evaluation.insights };
    }
}
