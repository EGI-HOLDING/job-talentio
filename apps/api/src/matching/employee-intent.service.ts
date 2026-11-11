import { practicalFit, employeePracticalEnabled, EMPLOYEE_PRACTICAL_POLICY_VERSION } from './employee-practical-policy';
import { candidateExperienceSelect,employeeExperienceRevision,employeeExperiencePolicyEnabled } from './employee-experience-policy';
import { currentRoleSelect,currentRoleIdentity } from './employee-occupation';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { EMPLOYEE_INTENT_VERSION, EMPLOYEE_RELATED_RANKING_VERSION, type EmployeeRecommendationState, type EmployeeEvidenceState, type EmployeeEligibility } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';
import { loadJobPromotions, publicJobPromotion } from '../benefits/job-promotion';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { applyEmployeeOverrides, evidenceConflicts, hasEmployeeCareerEvidence, type IntentFacts, type EvidenceOverride, EMPLOYEE_EVIDENCE_PARSER } from './employee-intent-evidence';
import { evaluateIntent, compareIntent, type IntentEvaluation, type IntentExperienceCache } from './employee-intent';
import { VacancyTasksService, type VacancySelection } from './vacancy-tasks.service';
import {PositionGroupService} from './position-group.service';
import {PositionGroupOccupationIndex} from './position-group-index';
import {compileHierarchy, EmployeeHierarchyIndex, employeeHierarchyMode, loadHierarchyManifest} from './employee-hierarchy';
import { effectiveJobGroup, jobGroupCatalog, jobGroupSelect, jobGroupWhere, matchJobGroup } from './job-group-scope';
export const employeeIntentJobSelect = { ...candidateExperienceSelect, ...jobGroupSelect, id: true, updatedAt:true, title: true, jobTitleId: true, jobTitle:{select:currentRoleSelect}, companyId: true, publishedAt: true, countryId: true, cityId: true, workMode: true, experienceYearsMin: true, experienceLevel: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { select: { province: { select: { countryId: true } } } }, jobSkills: { include: { skill: { select: { name: true, matchingKind: true } } } }, jobLanguages: { include: { language: { select: { code: true, name: true } } } } } as const;
type IntentRoleScope = {allowedIds:string[];vacancies?:VacancySelection;groupJobs?:Prisma.JobPostWhereInput[]};
export const intentRoleScope = (context:IntentRoleScope): Prisma.JobPostWhereInput => ({
  OR: [context.vacancies ? {id:{in:[...context.vacancies.decisions.keys()]}} : {jobTitleId:{in:context.allowedIds}}, ...context.groupJobs??[]],
});
export const intentJobScope = (context:IntentRoleScope&{practicalSelection?:{mainIds:string[]}}) =>
  context.practicalSelection ? {id:{in:context.practicalSelection.mainIds}} : intentRoleScope(context);
export const practicalJobSelect = {countryId:true,city:{select:{province:{select:{countryId:true}}}},salaryMin:true,salaryMax:true,currency:true,salaryPeriod:true} as const;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type RecommendationOptions = {separated?:boolean;scope?:'primary'|'related';relatedRoleId?:string};
export function rankRelatedProfessions(
    ranked: ReadonlyArray<{job:{publishedAt:Date|null};evaluation:IntentEvaluation}>,
    hierarchyActive: boolean,
) {
    const professions = new Map<string,{count:number;best:typeof ranked[number]}>();
    for (const row of ranked) {
        const {canonicalRoleId, matchType} = row.evaluation.eligibility;
        const group = row.evaluation.insights.practicalFit?.group ?? 'MAIN';
        if (matchType !== 'RELATED' || group !== 'MAIN' || !canonicalRoleId) continue;
        const previous = professions.get(canonicalRoleId);
        if (previous) previous.count++;
        else professions.set(canonicalRoleId, {count:1,best:row});
    }
    return [...professions].sort(([a,left],[b,right]) => (hierarchyActive
        ? compareIntent(left.best.evaluation,right.best.evaluation)
          || (right.best.job.publishedAt?.getTime()??0)-(left.best.job.publishedAt?.getTime()??0)
        : right.count-left.count) || a.localeCompare(b)).slice(0,3);
}
@Injectable()
export class EmployeeIntentService {
    private readonly scopes=new WeakMap<EmployeeOccupationIndex,Map<string,{allowedIds:string[];relatedCatalogTotal:number}>>();
    private readonly hierarchySnapshots=new WeakMap<EmployeeOccupationIndex,{
        groupRevision:string;
        compiled:ReturnType<typeof compileHierarchy>;
        indexes:Map<string,EmployeeHierarchyIndex>;
    }>();
    private readonly hierarchyManifest=loadHierarchyManifest();
    constructor(private db: PrismaService, @Optional() private catalogSnapshot?: EmployeeCatalogSnapshot, @Optional() private cache?: CandidateCache, @Optional() private vacancyTasks?:VacancyTasksService,@Optional() private positionGroups?:PositionGroupService) { }
    onModuleInit(){new Logger('EmployeeIntent').log('Candidate engine V3.2 is the only engine: exact/related occupations, partial evidence and explicit exploration.');}
    catalog(){return (this.catalogSnapshot||new EmployeeCatalogSnapshot(this.db)).get(true);}
    private roleScope(index:EmployeeOccupationIndex,selectedIds:string[]){
        let entries=this.scopes.get(index);
        if(!entries){entries=new Map();this.scopes.set(index,entries);}
        const key=JSON.stringify(selectedIds),cached=entries.get(key);
        if(cached)return cached;
        const allowedIds:string[]=[],related=new Set<string>();
        for(const {id} of index.roles.values()){
            const eligibility=index.eligibility(selectedIds,id);
            if(!eligibility.eligible)continue;
            allowedIds.push(id);
            if(eligibility.matchType==='RELATED'&&eligibility.canonicalRoleId)related.add(eligibility.canonicalRoleId);
        }
        const result={allowedIds,relatedCatalogTotal:related.size};
        entries.set(key,result);
        if(entries.size>64)entries.delete(entries.keys().next().value!);
        return result;
    }
    async context(profileId: string, includeVacancies=true, prepareSearchScope=false) {
        const [profile, catalog] = await Promise.all([
            this.db.employeeProfile.findUniqueOrThrow({ where: { id: profileId }, include: { desiredGroups:{include:{group:true}},desiredRoles: {include:{jobTitle:{select:currentRoleSelect}}}, languages:{include:{language:true}},city:{include:{province:{select:{countryId:true}}}}, preferredCountries: { select: { id: true } }, resumes: { where: { isPrimary: true, deletedAt: null, fileKey: { not: null } }, take: 1, include: { currentVersion: { select: {id:true,parseStatus:true,parseGeneration:true,matchingData:true,experienceYears:true,employeeEvidence:true} } } } } }),
            this.catalog(),
        ]);

        const experiencePolicyEnabled=employeeExperiencePolicyEnabled();
        const experienceCache:IntentExperienceCache=new Map();
        const {roles} = catalog;
        let index=!catalog.index.allowRelated?new EmployeeOccupationIndex(roles,true):catalog.index;
        const version = profile.resumes[0]?.currentVersion;
        const stored = version?.employeeEvidence;
        const parserVersion=EMPLOYEE_EVIDENCE_PARSER+'@'+catalog.revision;
        const rawSelectedIds = profile.desiredRoles.map(r => r.jobTitleId);
        const explicitIds = rawSelectedIds.filter(id=>!!index.identity(id));
        const groupIds=(profile.desiredGroups??[]).map(g=>g.groupId);
        const hierarchyMode=employeeHierarchyMode();
        const groupResolution=groupIds.length&&this.positionGroups&&!hierarchyMode?await this.positionGroups.resolve(roles,explicitIds,groupIds):null;
        const groupSnapshot=groupResolution?.snapshot??await this.positionGroups?.snapshot(roles);
        const groups=groupSnapshot?.choices.filter(group=>groupIds.includes(group.id))??[];
        let hierarchyRevision:string|null=null;
        if(hierarchyMode){
            const groupRevision=groupSnapshot?`${groupSnapshot.releaseId}:${groupSnapshot.revision}`:'unavailable';
            let snapshot=this.hierarchySnapshots.get(index);
            if(!snapshot||snapshot.groupRevision!==groupRevision){
                const compiled=compileHierarchy(index,groupSnapshot?.choices??[],this.hierarchyManifest);
                snapshot={groupRevision,compiled,indexes:new Map()};
                this.hierarchySnapshots.set(index,snapshot);
                if(compiled.reasons.length)new Logger('EmployeeIntent').warn('Related hierarchy unavailable: '+compiled.reasons.join(', '));
            }
            hierarchyRevision=digest([hierarchyMode,groupRevision,snapshot.compiled.revision]);
            const key=digest([hierarchyMode,[...explicitIds].sort(),[...groupIds].sort()]);
            let resolved=snapshot.indexes.get(key);
            if(!resolved){
                resolved=new EmployeeHierarchyIndex(roles,explicitIds,groups,groupSnapshot?.releaseId??'',snapshot.compiled,hierarchyMode==='direct-only');
                snapshot.indexes.set(key,resolved);
                if(snapshot.indexes.size>64)snapshot.indexes.delete(snapshot.indexes.keys().next().value!);
            }
            index=resolved;
        } else if(groupResolution)index=groupResolution.index;
        const selectedIds=index instanceof PositionGroupOccupationIndex?index.expandedIds:explicitIds;
        const groupReleaseVersion=groupSnapshot?.releaseId??null;
        const vacancyGroups=jobGroupCatalog(groupSnapshot?.choices);
        const groupIntent={
            groups:new Set(groupIds),
            roles:new Map(explicitIds.flatMap(id=>{
                const identity=index.identity(id);
                if(!identity)return [];
                const root=identity.canonicalRoleId;
                return [[root,groupSnapshot?.labels.get(root)??index.roles.get(root)?.name??root] as const];
            })),
        };
        const groupJobs=jobGroupWhere(vacancyGroups,groupIntent,groupReleaseVersion);
        const groupUnavailable=groupIds.some(id=>!groups.some(group=>group.id===id&&group.members.length));
        const preferenceWarnings= [...(!profile.matchingPreferencesReviewed||explicitIds.length!==rawSelectedIds.length?['PREFERENCES_REVIEW_REQUIRED']:[]),...(groupUnavailable?['POSITION_GROUP_UNAVAILABLE']:[])];
        const preferences = { ...profile, selectedIds };
        const state:EmployeeRecommendationState=process.env.EMPLOYEE_RECOMMENDATIONS_AVAILABLE==='false'?'UNAVAILABLE':groupUnavailable&&!selectedIds.length?'UNAVAILABLE':!selectedIds.length?(profile.desiredPositions.length||rawSelectedIds.length?'PREFERENCES_REVIEW_REQUIRED':'PREFERENCES_REQUIRED'):'READY';
        let facts: IntentFacts = { roles: [], skills: [], experiences: [], languages: [] };
        // Only the completed projection of this CV generation may supply ranking facts.
        // A conflict in one correction must not suppress unrelated evidence.
        if (stored?.facts && stored.status === 'READY' && (version?.parseStatus === 'READY' && stored.generation === version.parseGeneration && stored.parserVersion === parserVersion)) {
            const original = stored.facts as unknown as IntentFacts;
            const overrides = (stored.overrides ?? []) as EvidenceOverride[];
            const conflicts = new Set(evidenceConflicts(original, overrides));
            facts = applyEmployeeOverrides(original, overrides.filter(row => !conflicts.has(row.key)));

        }

        let evidenceState:EmployeeEvidenceState=!version?'REQUIRED':version.parseStatus==='FAILED'||stored?.status==='FAILED'?'FAILED':version.parseStatus!=='READY'||!stored||stored.parserVersion!==parserVersion||stored.generation!==version.parseGeneration||['PENDING','PROCESSING'].includes(stored.status)?'PROCESSING':!stored.facts||stored.status!=='READY'||evidenceConflicts(stored.facts as unknown as IntentFacts,(stored.overrides??[]) as EvidenceOverride[]).length||!hasEmployeeCareerEvidence(facts)?'REVIEW_REQUIRED':'READY';
        const {allowedIds,relatedCatalogTotal}=state==='READY'?this.roleScope(index,selectedIds):{allowedIds:[],relatedCatalogTotal:0};
        const graphSelectionRevision='selectionRevision' in catalog?catalog.selectionRevision??null:null;
        const selectionRevision=hierarchyRevision?digest([graphSelectionRevision,hierarchyRevision]):graphSelectionRevision;
        const taskVersion='taskVersion' in catalog?catalog.taskVersion as string|undefined:undefined;
        const relationReleaseId='relationReleaseId' in catalog?catalog.relationReleaseId as string|null|undefined:undefined;
        let vacancies:VacancySelection|undefined;
        if(includeVacancies&&state==='READY'&&this.vacancyTasks){
          vacancies=await this.vacancyTasks.select(index,selectedIds,allowedIds,relationReleaseId,undefined,taskVersion);
        }
        const practicalEnabled = employeePracticalEnabled();
        let practicalSelection:{mainIds:string[];unknownIds:string[];roleCandidateCount:number}|undefined;
        if (practicalEnabled && includeVacancies && prepareSearchScope && state === 'READY') {
          const candidates=await this.db.jobPost.findMany({where:{...liveJobWhere(),AND:[intentRoleScope({allowedIds,vacancies,groupJobs})],applications:{none:{profileId}}},select:{id:true,...practicalJobSelect}});
          practicalSelection={mainIds:[],unknownIds:[],roleCandidateCount:candidates.length};
          for (const job of candidates) {
            const fit=practicalFit(preferences,job);
            if(fit.group==='MAIN')practicalSelection.mainIds.push(job.id);
            if(fit.group==='SALARY_UNVERIFIED')practicalSelection.unknownIds.push(job.id);
          }
        }
        const preferencesOnly = !hasEmployeeCareerEvidence(facts) && !facts.languages.length;
        return { selectionRevision,taskVersion,relationReleaseId,relatedCatalogTotal,groupReleaseVersion,groupIds,groupUnavailable,experienceCache, experiencePolicyEnabled, profile, preferences, index, facts, state, allowedIds, vacancies, groupJobs, vacancyGroups, groupIntent, practicalEnabled, practicalSelection, evidenceState, preferenceWarnings, preferencesOnly, cvSource: { versionId: version?.id ?? null, status: version?.parseStatus ?? 'NONE', evidenceRevision: stored?.revision ?? null }, fingerprint: digest([selectionRevision,groupReleaseVersion,groupSnapshot?.revision,groupJobs.length>0,groupIds,profile.preferencesRevision,employeeExperienceRevision(),EMPLOYEE_INTENT_VERSION, EMPLOYEE_RELATED_RANKING_VERSION, profile, catalog.recommendationRevision,state,evidenceState,'partial-evidence-v1',vacancies?.revision,EMPLOYEE_PRACTICAL_POLICY_VERSION]) };
    }
    async status(userId:string) {
        const profile = await this.db.employeeProfile.findUnique({where:{userId},select:{id:true}});
        if(!profile)return {state:'PREFERENCES_REQUIRED',cvSource:{versionId:null,status:'NONE',evidenceRevision:null},revision:'none'};
        const context=await this.context(profile.id,false);
        const library=await this.db.resume.findMany({where:{profileId:profile.id,deletedAt:null},select:{id:true,currentVersion:{select:{id:true,parseStatus:true,parseGeneration:true}}},orderBy:{id:'asc'}});
        return {selectionRevision:context.selectionRevision,groupReleaseVersion:context.groupReleaseVersion,version:EMPLOYEE_INTENT_VERSION,state:context.state,evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings,cvSource:context.cvSource,revision:digest([context.fingerprint,library])};
    }
    async scoreJobsForProfile(profileId: string, ids: string[],provided?:Awaited<ReturnType<EmployeeIntentService['context']>>) {
        const result = new Map<string, IntentEvaluation>();
        if (!ids.length)
            return result;
        const context = provided || await this.context(profileId);
        if (context.state !== 'READY')
            return result;
        const requested=new Set(ids);
        const jobs = await this.db.jobPost.findMany({ where: { ...liveJobWhere(),id:{in:ids},AND:[intentRoleScope(context)],applications:{none:{profileId}} }, select: employeeIntentJobSelect });
        for (const job of jobs) {
            if(!requested.has(job.id))continue;
            const current = job.jobTitle === undefined ? context.index.identity(job.jobTitleId || '') : currentRoleIdentity(job.jobTitle);
            if(!job.positionGroupId&&!current)continue;
            const e = this.evaluate(context,job);
            if (e.eligibility.eligible && practicalFit(context.preferences,job,context.practicalEnabled).group==='MAIN')
                result.set(job.id, e);
        }
        return result;
    }
    private eligibility(context:Awaited<ReturnType<EmployeeIntentService['context']>>,job:{id:string;jobTitleId:string|null;updatedAt?:Date;jobTitle?:Parameters<typeof currentRoleIdentity>[0]}&Partial<Prisma.JobPostGetPayload<{select:typeof jobGroupSelect}>>) {
        const unreviewed={eligible:false,reason:'POSITION_MISMATCH'} as const;
        if(job.positionGroupId)return matchJobGroup({
            positionGroupId:job.positionGroupId,positionGroup:job.positionGroup??null,approvedPositionMembers:job.approvedPositionMembers??[],
        },context.vacancyGroups,context.groupIntent,context.groupReleaseVersion);
        const isCurrent=(decision:EmployeeEligibility)=>{
            if(!(context.index instanceof EmployeeHierarchyIndex)||job.jobTitle===undefined||!decision.eligible)return true;
            const identity=currentRoleIdentity(job.jobTitle);
            return identity?.canonicalRoleId===decision.canonicalRoleId&&identity?.familyId===decision.familyId;
        };
        if(!context.vacancies){
            const decision=context.index.eligibility(context.preferences.selectedIds,job.jobTitleId);
            return isCurrent(decision)?decision:unreviewed;
        }
        const row=context.vacancies.decisions.get(job.id);
        return row&&row.roleId===job.jobTitleId&&row.updatedAt.getTime()===job.updatedAt?.getTime()&&isCurrent(row.eligibility)?row.eligibility:unreviewed;
    }
    evaluate(context:Awaited<ReturnType<EmployeeIntentService['context']>>,job:Parameters<typeof evaluateIntent>[2]&{updatedAt?:Date}&Partial<Prisma.JobPostGetPayload<{select:typeof jobGroupSelect}>>,now=new Date()) {
        const group=job.positionGroupId?effectiveJobGroup({
            positionGroupId:job.positionGroupId,positionGroup:job.positionGroup??null,approvedPositionMembers:job.approvedPositionMembers??[],
        },context.vacancyGroups):null;
        const evaluation=evaluateIntent(context.preferences,context.facts,job,context.index,now,this.eligibility(context,job),context.experiencePolicyEnabled,context.experienceCache,group?.members);
        if(context.preferencesOnly){evaluation.tier=1;evaluation.score=0;evaluation.optionalScore=0;evaluation.insights={...evaluation.insights,mode:'PREFERENCES_BASED',evidence:evaluation.insights.evidence.filter(e=>e.kind==='ROLE')};}
        if(context.groupReleaseVersion)evaluation.insights={...evaluation.insights,groupReleaseVersion:context.groupReleaseVersion,groupPolicyVersion:'position-groups-v1',selectionBasis:evaluation.eligibility.matchType};
        if(context.practicalEnabled)evaluation.insights={...evaluation.insights,practicalFit:practicalFit(context.preferences,job)};
        return evaluation;
    }
    async recommend(profileId: string, page = 1, limit = 24, provided?:Awaited<ReturnType<EmployeeIntentService['context']>>,feed:'recommendations'|'related'|'salary-unverified'='recommendations',options:RecommendationOptions={}) {
        const context = provided || await this.context(profileId);
        const now = new Date();
        let mainTotal=0,salaryUnverifiedTotal=0;
        let primaryTotal=0,relatedTotal=0,primarySalaryUnverifiedTotal=0,relatedSalaryUnverifiedTotal=0;
        let relatedProfessions:Array<{id:string;slug:string;name:string;nameId:string|null;nameRu:string|null;nameUz:string|null;count:number}>=[];
        const separated=options.separated||feed==='related';
        const relatedRoleId=feed==='related'?options.relatedRoleId:undefined;
        const relatedTarget=relatedRoleId?context.index.identity(relatedRoleId)?.canonicalRoleId:undefined;
        const policy={version:EMPLOYEE_PRACTICAL_POLICY_VERSION,active:context.practicalEnabled,countryFilterApplied:!!(context.preferences.preferredCountries.length||context.preferences.residenceCountryId)};
        const selectionMeta={selectionRevision:context.selectionRevision,relatedCatalogTotal:context.relatedCatalogTotal};
        const empty = (state: EmployeeRecommendationState,emptyReason: import('@job-talentio/shared').EmployeeEmptyReason=state==='UNAVAILABLE'?'SERVICE_UNAVAILABLE':state.startsWith('PREFERENCES')?'UNRECOGNIZED_PREFERENCES':'NO_RELEVANT_JOBS') => ({ ...selectionMeta,primaryTotal,relatedTotal,relatedProfessions,primarySalaryUnverifiedTotal,relatedSalaryUnverifiedTotal,groupReleaseVersion:context.groupReleaseVersion,mainTotal,salaryUnverifiedTotal,practicalPolicy:policy,feed,items: [], page: 1, limit, total: 0, totalPages: 1, mode: 'UNAVAILABLE' as const, state, emptyReason, evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings, version: EMPLOYEE_INTENT_VERSION, rankingRevision: digest([context.fingerprint,feed,relatedRoleId]), cvSource: context.cvSource });
        if (context.state !== 'READY')
            return empty(context.state);
        const compute=async()=>{
          const jobs = await this.db.jobPost.findMany({ where: { ...liveJobWhere(now), AND:[intentRoleScope(context)], applications: { none: { profileId } } }, select: employeeIntentJobSelect });
          new Logger('EmployeeIntent').log(JSON.stringify({policy:'related-roles-v32',stage:'retrieval',allowedTitles:context.allowedIds.length,retrieved:jobs.length,evidenceState:context.evidenceState}));
          return jobs.map(job => ({ job:{id:job.id,companyId:job.companyId,jobTitleId:job.jobTitleId,publishedAt:job.publishedAt,updatedAt:job.updatedAt?.toISOString()}, evaluation: this.evaluate(context,job,now) })).filter(row => row.evaluation.eligibility.eligible).sort((a, b) => compareIntent(a.evaluation, b.evaluation) || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
        };
        let ranked=this.cache?await this.cache.ranked(['intent-v3',profileId,context.fingerprint,new Date().toISOString().slice(0,10)],compute):await compute();
        {
          const live=await this.db.jobPost.findMany({where:{...liveJobWhere(now),id:{in:ranked.map(r=>r.job.id)},AND:[intentRoleScope(context)],applications:{none:{profileId}}},select:{id:true,updatedAt:true,jobTitleId:true,jobTitle:{select:currentRoleSelect},...jobGroupSelect,...practicalJobSelect}});
          const revisions=new Map(ranked.map(r=>[r.job.id,r.job.updatedAt]));
          if(live.some(j=>revisions.get(j.id)!==j.updatedAt?.toISOString()))ranked=await compute();
          const allowed=new Set(live.filter(j=>(j.positionGroupId||currentRoleIdentity(j.jobTitle))&&this.eligibility(context,j).eligible).map(j=>j.id));
          const fits=new Map(live.map(job=>[job.id,practicalFit(context.preferences,job,context.practicalEnabled)]));
          ranked=ranked.filter(r=>allowed.has(r.job.id)).map(row=>({...row,evaluation:{...row.evaluation,insights:{...row.evaluation.insights,...(context.practicalEnabled?{practicalFit:fits.get(row.job.id)}:{})}}}));
        }
        const roleTotal=ranked.length;
        const group=(row:typeof ranked[number])=>row.evaluation.insights.practicalFit?.group||'MAIN';
        mainTotal=ranked.filter(row=>group(row)==='MAIN').length;
        salaryUnverifiedTotal=ranked.filter(row=>group(row)==='SALARY_UNVERIFIED').length;
        const isRelated=(row:typeof ranked[number])=>row.evaluation.eligibility.matchType==='RELATED';
        primaryTotal=ranked.filter(row=>!isRelated(row)&&group(row)==='MAIN').length;
        relatedTotal=ranked.filter(row=>isRelated(row)&&group(row)==='MAIN').length;
        primarySalaryUnverifiedTotal=ranked.filter(row=>!isRelated(row)&&group(row)==='SALARY_UNVERIFIED').length;
        relatedSalaryUnverifiedTotal=ranked.filter(row=>isRelated(row)&&group(row)==='SALARY_UNVERIFIED').length;
        const topRelated=rankRelatedProfessions(ranked,context.index instanceof EmployeeHierarchyIndex);
        if(topRelated.length){
          const roles=await this.db.jobTitle.findMany({where:{id:{in:topRelated.map(([id])=>id)}},select:{id:true,slug:true,name:true,nameId:true,nameRu:true,nameUz:true}});
          const byRole=new Map(roles.map(role=>[role.id,role]));
          relatedProfessions=topRelated.flatMap(([id,{count}])=>{const role=byRole.get(id);return role?[{...role,count}]:[];});
        }
        const section=ranked.filter(row=>(!separated||isRelated(row)===(feed==='related'||feed==='salary-unverified'&&options.scope==='related'))
            &&(!relatedRoleId||!!relatedTarget&&row.evaluation.eligibility.canonicalRoleId===relatedTarget));
        ranked=section.filter(row=>group(row)===(feed==='salary-unverified'?'SALARY_UNVERIFIED':'MAIN'));
        if (!ranked.length){
            if(section.length)return empty('NO_ELIGIBLE_JOBS','PRACTICAL_PREFERENCES');
            if(roleTotal)return empty('NO_ELIGIBLE_JOBS','NO_RELEVANT_JOBS');
            const [activeInScope,inventory,knownTasks]=await Promise.all([
              this.db.jobPost.count({where:{...liveJobWhere(now),AND:[intentRoleScope(context)]}}),
              this.db.jobPost.count({where:liveJobWhere(now)}),
              context.selectionRevision&&context.taskVersion?this.db.jobOccupationTaskEvidence.count({where:{version:context.taskVersion,state:{in:['RECOGNIZED','PARTIAL']},job:liveJobWhere(now)}}):Promise.resolve(null),
            ]);
            const reason=activeInScope?'ALL_APPLIED':!inventory?'NO_ACTIVE_JOBS':knownTasks===0?'TASK_COVERAGE_INCOMPLETE':'NO_RELEVANT_JOBS';
            new Logger('EmployeeIntent').log(JSON.stringify({policy:'related-roles-v32',stage:'empty',activeInScope,returned:0,reason}));
            return empty('NO_ELIGIBLE_JOBS',reason);
        }
        const total = ranked.length, totalPages = Math.max(1, Math.ceil(total / limit));
        page = Math.min(Math.max(1, page), totalPages);
        const selected = ranked.slice((page - 1) * limit, page * limit);
        const [full, promotions] = await Promise.all([this.db.jobPost.findMany({ where: { AND:[{id:{in:selected.map(r=>r.job.id)}},intentRoleScope(context)], ...liveJobWhere(now),applications:{none:{profileId}} }, select: { ...jobGroupSelect, id: true, updatedAt:true, countryId:true, jobTitleId:true, title: true, companyId: true, isAnonymous: true, locale: true, createdAt: true, publishedAt: true, employmentType: true, workMode: true, salaryMin: true, salaryMax: true, currency: true, salaryPeriod: true, city: { include: { province: true } }, country: true, category: true, company: { select: { id: true, name: true, slug: true, logoUrl: true } } } }), loadJobPromotions(this.db, selected.map(r => r.job.id), now)]);
        const byId = new Map(full.filter(j=>this.eligibility(context,j).eligible&&practicalFit(context.preferences,j,context.practicalEnabled).group===(feed==='salary-unverified'?'SALARY_UNVERIFIED':'MAIN')).map(({updatedAt:_updatedAt,jobTitleId:_jobTitleId,positionGroup:_positionGroup,approvedPositionMembers:_members,...job}) => [job.id, job]));
        const items = selected.flatMap(row => { const job = byId.get(row.job.id); return job ? [{ job: { ...job, ...publicJobPromotion(promotions, job.id), placement: 'ORGANIC' as const }, selectionBasis:row.evaluation.eligibility.matchType,selectedGroupId:row.evaluation.eligibility.selectedGroupId,selectedGroupName:row.evaluation.eligibility.selectedGroupName,groupReleaseVersion:context.groupReleaseVersion,recommendationType:row.evaluation.eligibility.matchType||'EXACT' as const, matchScore: context.preferencesOnly?null:row.evaluation.score, matchType:row.evaluation.eligibility.matchType,selectedRoleId:row.evaluation.eligibility.selectedRoleId,selectedRoleName:row.evaluation.eligibility.selectedRoleName,relationReference:row.evaluation.eligibility.relationReference, matchInsights: row.evaluation.insights, eligibility: row.evaluation.eligibility }] : []; });
        if (!items.length)
            return empty('NO_ELIGIBLE_JOBS');
        new Logger('EmployeeIntent').log(JSON.stringify({ version: EMPLOYEE_INTENT_VERSION, state: 'READY', eligible: total, returned: items.length, unknown: items.reduce((n, i) => n + i.matchInsights.evidence.filter(e => e.status === 'UNKNOWN').length, 0) }));
        return { ...selectionMeta,primaryTotal,relatedTotal,relatedProfessions,primarySalaryUnverifiedTotal,relatedSalaryUnverifiedTotal,groupReleaseVersion:context.groupReleaseVersion,mainTotal,salaryUnverifiedTotal,practicalPolicy:policy,feed,items, page, limit, total, totalPages, mode: context.preferencesOnly?'PREFERENCES_BASED' as const:'PERSONALIZED' as const, state: 'READY' as const, evidenceState:context.evidenceState,preferenceWarnings:context.preferenceWarnings, version: EMPLOYEE_INTENT_VERSION, rankingRevision: digest([context.fingerprint,feed,relatedRoleId, ranked.map(r => [r.job.id, r.evaluation])]), cvSource: context.cvSource };
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
        const job = await this.db.jobPost.findFirst({ where: { id: jobId,...liveJobWhere(),applications:{none:{profileId}},
            AND:[{OR:[{positionGroupId:null},...context.groupJobs]}],
        }, select: employeeIntentJobSelect });
        const eligibility = job ? this.eligibility(context,job) : context.index.eligibility(context.preferences.selectedIds,null);
        if (context.state !== 'READY' || !job || !eligibility.eligible)
            return { state: context.state === 'READY' ? 'NO_ELIGIBLE_JOBS' : context.state, eligibility, matchScore: null, matchInsights: null };
        const evaluation = this.evaluate(context,job);
        const fit=practicalFit(context.preferences,job,context.practicalEnabled);
        return { selectionRevision:context.selectionRevision,state: fit.group==='EXCLUDED'?'NO_ELIGIBLE_JOBS' as const:'READY' as const, practicalFit:fit, evidenceState:context.evidenceState,eligibility,matchType:eligibility.matchType,selectedRoleName:eligibility.selectedRoleName,relationReference:eligibility.relationReference, matchScore: context.preferencesOnly?null:evaluation.score, matchInsights: evaluation.insights };
    }
    async traceSelection(profileId:string,jobId:string) {
        const [context,job,live,applied]=await Promise.all([
          this.context(profileId),this.db.jobPost.findUniqueOrThrow({where:{id:jobId},select:employeeIntentJobSelect}),
          this.db.jobPost.count({where:{id:jobId,...liveJobWhere()}}),
          this.db.application.count({where:{profileId,jobPostId:jobId}}),
        ]);
        const catalog=job.positionGroupId?this.eligibility(context,job):context.index.eligibility(context.preferences.selectedIds,job.jobTitleId);
        return {version:EMPLOYEE_INTENT_VERSION,selectionRevision:context.selectionRevision,graphReleaseId:context.relationReleaseId,rankingRevision:context.fingerprint,
          jobId,jobTitleId:job.jobTitleId,selectedRoleIds:context.preferences.selectedIds,state:context.state,evidenceState:context.evidenceState,
          catalog,task:await this.vacancyTasks?.traceJob(context.index,context.preferences.selectedIds,context.allowedIds,job,context.relationReleaseId,context.taskVersion),
          selected:context.vacancies?.decisions.has(jobId)??catalog.eligible,live:!!live,applied:!!applied,practicalFit:practicalFit(context.preferences,job,context.practicalEnabled)};
    }
}
