import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {CandidateCache} from '../common/candidate-cache';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeOccupationIndex } from './employee-occupation';
import { escoTaskDictionary, primaryTaskScope, professionTaskKeys, taskCompatibility, taskDigest, projectTaskEvidence, vacancyTaskText, LEGACY_VACANCY_TASK_VERSION, type EscoTaskDictionary, type TaskEvidence, type TaskEvidenceState, type VacancyEligibility } from './vacancy-tasks';
import { OccupationRelationsService } from './occupation-relations.service';
import {PositionGroupOccupationIndex} from './position-group-index';
import { EmployeeHierarchyIndex } from './employee-hierarchy';

export type VacancySelection = {
  decisions: Map<string,{ roleId:string; updatedAt:Date; eligibility:VacancyEligibility }>;
  revision: string;
  trace?: Array<{sourceRoleId:string;reason:string;sharedTasks:string[]}>;
};
type TaskRow = {id:string;jobTitleId:string|null;updatedAt:Date;keys:string[]|null;evidence:TaskEvidence[]|null;state?:TaskEvidenceState};

@Injectable()
export class VacancyTasksService implements OnModuleInit,OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private dictionary?: EscoTaskDictionary;
  private specificOutputs?: ReadonlySet<string>;
  private readonly selections=new WeakMap<EmployeeOccupationIndex,Map<string,{expires:number;value:Promise<VacancySelection>}>>();
  private readonly logger = new Logger(VacancyTasksService.name);
  constructor(private readonly db: PrismaService,private readonly relations:OccupationRelationsService,@Optional()private readonly cache?:CandidateCache) {}

  private concepts() {
    if(this.dictionary)return this.dictionary;
    const source=this.relations.loadSource();
    const local=new Map(source.localDefinitions?.flatMap(row=>(row.coreTasks??[]).map(task=>[task.id,{uri:'urn:talentio:occupation-task:'+task.id,label:task.label,type:'skill',reuse:'occupation-specific'}] as const)));
    const dictionary=escoTaskDictionary([...source.skills,...local.values()]);
    const frequencies=new Map<string,number>();
    for(const role of source.occupations)for(const key of new Set(role.essential.map(task=>task.uri)))frequencies.set(key,(frequencies.get(key)??0)+1);
    const threshold=Math.max(10,Math.ceil(source.occupations.length*.02));
    this.specificOutputs=new Set([...dictionary.specificKeys].filter(key=>(frequencies.get(key)??0)<=threshold));
    return this.dictionary=dictionary;
  }
  evidenceVersion(){return this.relations.taskVersion();}

  project(posting:{id:string;jobTitleId:string|null;description:string;responsibilities?:readonly string[];updatedAt:Date}) {
    const text=vacancyTaskText(posting),projection=projectTaskEvidence(text,this.concepts());
    return {id:posting.id,jobTitleId:posting.jobTitleId,updatedAt:posting.updatedAt,keys:projection.evidence.map(task=>task.key),...projection,sourceDigest:taskDigest([this.evidenceVersion(),text])};
  }

  onModuleInit() {
    if(process.env.EMPLOYEE_CORE_TASK_SELECTION_ENABLED!=='true')return;
    this.concepts();
    const recover=()=>void this.refresh().catch(error=>this.logger.warn('Vacancy evidence refresh failed: '+error.message));
    recover();
    this.timer=setInterval(recover,5000);
    this.timer.unref();
  }

  onModuleDestroy() { if(this.timer) clearInterval(this.timer); }

  async refresh(limit=100) {
    if(this.working)return 0;
    this.working=true;
    try {
      const version=this.evidenceVersion();
      const processed=await this.db.$transaction(async tx=>{
      const [lease]=await tx.$queryRaw<Array<{acquired:boolean}>>`SELECT pg_try_advisory_xact_lock(742159746) AS acquired`;
      if(!lease.acquired)return 0;
      const rows=await tx.$queryRaw<Array<{id:string;jobTitleId:string|null;description:string;responsibilities:string[];updatedAt:Date}>>`
        SELECT job."id",job."jobTitleId",job."description",job."responsibilities",job."updatedAt"
        FROM "JobPost" job
        LEFT JOIN "JobOccupationTaskEvidence" evidence
          ON evidence."jobId"=job."id" AND evidence."version"=${version}
          AND evidence."jobUpdatedAt"=job."updatedAt"
        WHERE job."status"='PUBLISHED' AND (evidence."jobId" IS NULL OR (evidence.state='FAILED' AND evidence."processedAt"<NOW()-INTERVAL '1 minute'))
        ORDER BY job."updatedAt" DESC,job."id"
        LIMIT ${Math.min(Math.max(1,limit),100)}
      `;
      for(const row of rows){
        let result:Omit<ReturnType<VacancyTasksService['project']>,'state'>&{state:TaskEvidenceState};
        try{result=this.project(row);}catch{this.logger.warn('Vacancy task projection failed for '+row.id);result={...row,keys:[],evidence:[],state:'FAILED',recognizedClauses:0,unrecognizedClauses:0,sourceDigest:taskDigest([version,row.id,row.updatedAt])};}
        await tx.$executeRaw`
          INSERT INTO "JobOccupationTaskEvidence" ("jobId","version","jobUpdatedAt","coreKeys","evidence","state","recognizedClauses","unrecognizedClauses","sourceDigest","processedAt")
          SELECT job."id",${version},job."updatedAt",${result.keys}::text[],${JSON.stringify(result.evidence)}::jsonb,${result.state},${result.recognizedClauses},${result.unrecognizedClauses},${result.sourceDigest},NOW()
          FROM "JobPost" job
          WHERE job."id"=${row.id} AND job."updatedAt"=${row.updatedAt} AND job."status"='PUBLISHED'
          ON CONFLICT ("jobId","version") DO UPDATE
          SET "jobUpdatedAt"=EXCLUDED."jobUpdatedAt","coreKeys"=EXCLUDED."coreKeys","evidence"=EXCLUDED."evidence","state"=EXCLUDED."state","recognizedClauses"=EXCLUDED."recognizedClauses","unrecognizedClauses"=EXCLUDED."unrecognizedClauses","sourceDigest"=EXCLUDED."sourceDigest","processedAt"=EXCLUDED."processedAt"
          WHERE "JobOccupationTaskEvidence"."jobUpdatedAt" < EXCLUDED."jobUpdatedAt"
            OR ("JobOccupationTaskEvidence"."jobUpdatedAt" = EXCLUDED."jobUpdatedAt" AND "JobOccupationTaskEvidence"."state"='FAILED')
        `;
      }
      return rows.length;
      },{timeout:30000});
      if(processed)await this.cache?.invalidate();
      return processed;
    } finally { this.working=false; }
  }

  async select(index:EmployeeOccupationIndex, selectedIds:string[], graphIds:string[], snapshotRelease?:string|null, preview?:readonly TaskRow[], evidenceVersion?:string):Promise<VacancySelection> {
    const version=evidenceVersion??(preview?this.evidenceVersion():LEGACY_VACANCY_TASK_VERSION);
    if(!this.cache||preview)return this.computeSelection(index,selectedIds,graphIds,snapshotRelease,version,preview);
    const key=taskDigest([await this.cache.version('jobs'),snapshotRelease,version,selectedIds,graphIds,index instanceof EmployeeHierarchyIndex?index.hierarchy.revision:null]);
    const entries=this.selections.get(index)??new Map();this.selections.set(index,entries);
    const previous=entries.get(key);if(previous&&previous.expires>Date.now())return previous.value;
    const value=this.computeSelection(index,selectedIds,graphIds,snapshotRelease,version).catch(error=>{entries.delete(key);throw error;});
    entries.set(key,{expires:Date.now()+30000,value});while(entries.size>20)entries.delete(entries.keys().next().value!);
    return value;
  }

  private async computeSelection(index:EmployeeOccupationIndex, selectedIds:string[], graphIds:string[], snapshotRelease:string|null|undefined, version:string, preview?:readonly TaskRow[]):Promise<VacancySelection> {
    const strict=index instanceof EmployeeHierarchyIndex?index:null;
    const choices=strict?[...strict.explicitRoleIds]:index instanceof PositionGroupOccupationIndex&&selectedIds===index.expandedIds?selectedIds:[...new Set(selectedIds.flatMap(id=>index.identity(id)?.canonicalRoleId??[]))].sort();
    if(!choices.length&&!strict?.expandedIds.length)return {decisions:new Map(),revision:version};
    const legacy=version===LEGACY_VACANCY_TASK_VERSION;
    const dictionary=this.concepts();
    const eligibleTaskKeys=legacy?new Set(this.relations.loadSource().skills.filter(skill=>skill.type==='skill'&&skill.reuse==='occupation-specific').map(skill=>skill.uri)):dictionary.keys;
    const release=snapshotRelease===undefined?(await this.db.occupationRelationState.findUnique({where:{id:'employee'},select:{activeReleaseId:true}}))?.activeReleaseId:snapshotRelease;
    const profiles=release?await this.db.occupationProfessionProfile.findMany({
      where:{releaseId:release,jobTitleId:{in:choices}},
      select:{jobTitleId:true,description:true,facts:true},
    }):[];
    const scopesByRole=new Map(profiles.map(row=>{
      const facts=row.facts as {essential?:Array<{label:string;uri:string}>;primaryTaskIds?:string[]};
      const essential=facts.essential??[];
      const primary=primaryTaskScope(professionTaskKeys([row.description]));
      const derived=professionTaskKeys([row.description,...essential.map(task=>task.label)]);
      const scoped=primary.size?derived.filter(key=>[...primaryTaskScope([key])].some(output=>primary.has(output))):derived;
      const keys=[...new Set([...scoped,...essential.filter(task=>eligibleTaskKeys.has(task.uri)).map(task=>task.uri)])];
      const primaryOfficial=new Set(facts.primaryTaskIds??[]);
      return [row.jobTitleId,{keys,primary,primaryOfficial}] as const;
    }));
    const keys=[...new Set([...scopesByRole.values()].flatMap(scope=>scope.keys))];
    const rows=preview??await this.db.$queryRaw<TaskRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id" FROM "JobPost" WHERE "status"='PUBLISHED' AND "jobTitleId"=ANY(${graphIds}::text[])
        ${strict?Prisma.empty:Prisma.sql`UNION
        SELECT "jobId" FROM "JobOccupationTaskEvidence" WHERE "version"=${version} AND "state"<>'FAILED' AND "coreKeys" && ${keys}::text[]`}
      )
      SELECT job."id",job."jobTitleId",job."updatedAt",ev."coreKeys" AS "keys",ev."evidence",ev."state"
      FROM candidates JOIN "JobPost" job ON job."id"=candidates."id"
      LEFT JOIN "JobOccupationTaskEvidence" ev ON ev."jobId"=job."id"
        AND ev."version"=${version} AND ev."jobUpdatedAt"=job."updatedAt" AND ev."state"<>'FAILED'
      WHERE job."status"='PUBLISHED' AND (job."jobTitleId"=ANY(${graphIds}::text[]) OR ev."jobId" IS NOT NULL)
    `);
    const overrides=await this.db.occupationRelationOverride.findMany({where:{fromRoleId:{in:choices},enabled:false},select:{fromRoleId:true,toRoleId:true}});
    const blocked=new Set(overrides.map(row=>row.fromRoleId+':'+row.toRoleId));
    const targets=[...new Set(rows.flatMap(row=>row.jobTitleId?index.identity(row.jobTitleId)?.canonicalRoleId??[]:[]))];
    const graph=release?await this.db.occupationProfessionRelation.findMany({
      where:{releaseId:release,fromRoleId:{in:choices},toRoleId:{in:targets}},
      select:{fromRoleId:true,toRoleId:true,basis:true},
    }):[];
    const graphTasks=new Map(graph.map(row=>{
      const basis=row.basis as {kind?:string;sharedEssentialSkills?:Array<{uri:string;label:string}>};
      return [row.fromRoleId+':'+row.toRoleId,basis.kind==='RELATED'?basis.sharedEssentialSkills?.slice(0,2):undefined] as const;
    }));
    const decisions:VacancySelection['decisions']=new Map();
    const trace:VacancySelection['trace']=preview?.length===1?[]:undefined;
    for(const row of rows) {
      if(!row.jobTitleId)continue;
      const target=index.identity(row.jobTitleId);
      if(!target)continue;
      const exact=index.eligibility(choices,row.jobTitleId);
      if(exact.matchType==='EXACT'||exact.matchType==='GROUP'){
        decisions.set(row.id,{roleId:row.jobTitleId,updatedAt:row.updatedAt,eligibility:exact});
        continue;
      }
      const candidates:VacancyEligibility[]=[];
      const withinScope=strict?.relatedSources(row.jobTitleId);
      if(strict&&!withinScope?.length){
        trace?.push({sourceRoleId:choices[0]??'',reason:'OUTSIDE_VERIFIED_HIERARCHY',sharedTasks:[]});
        continue;
      }
      for(const source of withinScope?.map(row=>row.selectedRoleId!)??choices){
        const excluded=blocked.has(source+':'+target.canonicalRoleId);
        if(!strict&&excluded){trace?.push({sourceRoleId:source,reason:'ADMIN_EXCLUDED',sharedTasks:[]});continue;}
        const scope=scopesByRole.get(source);
        const tasks=taskCompatibility(scope?.keys??[],row.keys??[],scope?.primary,legacy?'RECOGNIZED':row.state??'UNRECOGNIZED',legacy?undefined:{
          specific:this.specificOutputs??dictionary.specificKeys,primary:scope?.primaryOfficial??new Set(),independent:dictionary.independent,
        });
        if(!strict&&tasks.conflict){trace?.push({sourceRoleId:source,reason:'CONFLICTING_DUTIES',sharedTasks:tasks.shared});continue;}
        const sharedTasks=[...new Set(row.evidence?.filter(task=>tasks.shared.includes(task.key)).map(task=>task.excerpt))].slice(0,2);
        const basis=graphTasks.get(source+':'+target.canonicalRoleId);
        if(strict){
          const approved=withinScope!.find(item=>item.selectedRoleId===source)!;
          const useGraph=!excluded&&(basis?.length||approved.relationScore!==undefined);
          const useTasks=!excluded&&tasks.strong&&!tasks.conflict;
          trace?.push({sourceRoleId:source,reason:'VERIFIED_HIERARCHY',sharedTasks:excluded||tasks.conflict?[]:tasks.shared});
          candidates.push({...approved,
            ...(useGraph?{selectionEvidence:'PROFESSION_GRAPH' as const,taskConceptIds:basis?.map(t=>t.uri),sharedTasks:useTasks&&sharedTasks.length?sharedTasks:basis?.map(t=>t.label)}
              :useTasks?{selectionEvidence:'VACANCY_TASKS' as const,relationScore:tasks.shared.length/(row.keys?.length||1),taskConceptIds:tasks.shared,sharedTasks}
              :{relationScore:undefined}),
          });
          continue;
        }
        const graph=index.eligibility([source],row.jobTitleId);
        trace?.push({sourceRoleId:source,reason:graph.eligible?'PROFESSION_GRAPH':tasks.strong?'VACANCY_TASKS':!row.keys?.length?'TASKS_UNRECOGNIZED':'INSUFFICIENT_TASK_OVERLAP',sharedTasks:tasks.shared});
        if(graph.eligible) candidates.push({...graph,selectionEvidence:'PROFESSION_GRAPH',taskConceptIds:basis?.map(t=>t.uri)??tasks.shared,sharedTasks:sharedTasks?.length?sharedTasks:basis?.map(t=>t.label)});
        else if(tasks.strong)candidates.push({eligible:true,reason:'MATCH',...target,matchType:'RELATED',selectedRoleId:source,selectedRoleName:index.roles.get(source)?.name,relationReference:version,relationScore:tasks.shared.length/(row.keys?.length||1),selectionEvidence:'VACANCY_TASKS',taskConceptIds:tasks.shared,sharedTasks});
      }
      const best=candidates.sort((a,b)=>(b.relationScore??0)-(a.relationScore??0)||a.selectedRoleId!.localeCompare(b.selectedRoleId!))[0];
      if(best)decisions.set(row.id,{roleId:row.jobTitleId,updatedAt:row.updatedAt,eligibility:best});
    }
    const revision=taskDigest([version,release,[...decisions].sort(([a],[b])=>a.localeCompare(b))]);
    return {decisions,revision,...(trace?{trace}:{})};
  }

  async traceJob(index:EmployeeOccupationIndex,choices:string[],graphIds:string[],job:{id:string;jobTitleId:string|null;updatedAt:Date},release:string|null|undefined,version=LEGACY_VACANCY_TASK_VERSION) {
    const record=await this.db.jobOccupationTaskEvidence.findUnique({where:{jobId_version:{jobId:job.id,version}}});
    const fresh=record?.jobUpdatedAt.getTime()===job.updatedAt.getTime();
    const state:TaskEvidenceState=record&&!fresh?'STALE':fresh?record!.state as TaskEvidenceState:'UNRECOGNIZED';
    const row={...job,state,keys:fresh&&state!=='FAILED'?record!.coreKeys:[],evidence:fresh&&state!=='FAILED'?record!.evidence as TaskEvidence[]:[]};
    const result=await this.computeSelection(index,choices,graphIds,release,version,[row]);
    return {taskVersion:version,state,recognizedClauses:fresh?record?.recognizedClauses:0,unrecognizedClauses:fresh?record?.unrecognizedClauses:0,taskConceptIds:row.keys,sourceDigest:fresh?record?.sourceDigest:null,decision:result.decisions.get(job.id)?.eligibility??null,checks:result.trace??[]};
  }
}
