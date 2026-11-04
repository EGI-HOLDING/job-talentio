import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeOccupationIndex } from './employee-occupation';
import { escoTaskDictionary, primaryTaskScope, professionTaskKeys, taskCompatibility, taskDigest, taskEvidence, VACANCY_TASK_VERSION, type EscoTaskDictionary, type TaskEvidence, type VacancyEligibility } from './vacancy-tasks';
import { employeeRecommendationV32Enabled } from './employee-recommendation-policy';
import { OccupationRelationsService } from './occupation-relations.service';

export const vacancyTaskMode = () => process.env.EMPLOYEE_VACANCY_TASK_MODE ?? 'off';
export type VacancySelection = {
  decisions: Map<string,{ roleId:string; updatedAt:Date; eligibility:VacancyEligibility }>;
  revision: string;
};
type TaskRow = {id:string;jobTitleId:string|null;updatedAt:Date;keys:string[]|null;evidence:TaskEvidence[]|null};

@Injectable()
export class VacancyTasksService implements OnModuleInit,OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private dictionary?: EscoTaskDictionary;
  private readonly logger = new Logger(VacancyTasksService.name);
  constructor(private readonly db: PrismaService,private readonly relations:OccupationRelationsService) {}

  private concepts() { return this.dictionary??=escoTaskDictionary(this.relations.loadSource().skills); }

  project(posting:{id:string;jobTitleId:string|null;description:string;updatedAt:Date}):TaskRow {
    const evidence=taskEvidence(posting.description,this.concepts());
    return {id:posting.id,jobTitleId:posting.jobTitleId,updatedAt:posting.updatedAt,keys:evidence.map(task=>task.key),evidence};
  }

  onModuleInit() {
    if (!employeeRecommendationV32Enabled() || !['shadow','enabled'].includes(vacancyTaskMode())) return;
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
      const rows=await this.db.$queryRaw<Array<{id:string;description:string;updatedAt:Date}>>`
        SELECT job."id",job."description",job."updatedAt"
        FROM "JobPost" job
        LEFT JOIN "JobOccupationTaskEvidence" evidence
          ON evidence."jobId"=job."id" AND evidence."version"=${VACANCY_TASK_VERSION}
          AND evidence."jobUpdatedAt"=job."updatedAt"
        WHERE job."status"='PUBLISHED' AND evidence."jobId" IS NULL
        ORDER BY job."updatedAt" DESC,job."id"
        LIMIT ${limit}
      `;
      for(const row of rows){
        const evidence=taskEvidence(row.description,this.concepts());
        const keys=evidence.map(task=>task.key);
        await this.db.$executeRaw`
          INSERT INTO "JobOccupationTaskEvidence" ("jobId","version","jobUpdatedAt","coreKeys","evidence")
          SELECT job."id",${VACANCY_TASK_VERSION},job."updatedAt",${keys}::text[],${JSON.stringify(evidence)}::jsonb
          FROM "JobPost" job
          WHERE job."id"=${row.id} AND job."updatedAt"=${row.updatedAt} AND job."status"='PUBLISHED'
          ON CONFLICT ("jobId","version") DO UPDATE
          SET "jobUpdatedAt"=EXCLUDED."jobUpdatedAt","coreKeys"=EXCLUDED."coreKeys","evidence"=EXCLUDED."evidence"
          WHERE "JobOccupationTaskEvidence"."jobUpdatedAt" < EXCLUDED."jobUpdatedAt"
        `;
      }
      return rows.length;
    } finally { this.working=false; }
  }

  async select(index:EmployeeOccupationIndex, selectedIds:string[], graphIds:string[], snapshotRelease?:string|null, preview?:readonly TaskRow[]):Promise<VacancySelection> {
    const choices=[...new Set(selectedIds.flatMap(id=>index.identity(id)?.canonicalRoleId??[]))].sort();
    if(!choices.length)return {decisions:new Map(),revision:VACANCY_TASK_VERSION};
    const release=snapshotRelease===undefined?(await this.db.occupationRelationState.findUnique({where:{id:'employee'},select:{activeReleaseId:true}}))?.activeReleaseId:snapshotRelease;
    const profiles=release?await this.db.occupationProfessionProfile.findMany({
      where:{releaseId:release,jobTitleId:{in:choices}},
      select:{jobTitleId:true,description:true,facts:true},
    }):[];
    const scopesByRole=new Map(profiles.map(row=>{
      const facts=row.facts as {essential?:Array<{label:string;uri:string}>};
      const essential=facts.essential??[];
      const primary=primaryTaskScope(professionTaskKeys([row.description]));
      const derived=professionTaskKeys([row.description,...essential.map(task=>task.label)]);
      const scoped=primary.size?derived.filter(key=>[...primaryTaskScope([key])].some(output=>primary.has(output))):derived;
      const keys=[...new Set([...scoped,...essential.filter(task=>this.concepts().keys.has(task.uri)).map(task=>task.uri)])];
      return [row.jobTitleId,{keys,primary}] as const;
    }));
    const keys=[...new Set([...scopesByRole.values()].flatMap(scope=>scope.keys))];
    const rows=preview??await this.db.$queryRaw<TaskRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id" FROM "JobPost" WHERE "status"='PUBLISHED' AND "jobTitleId"=ANY(${graphIds}::text[])
        UNION
        SELECT "jobId" FROM "JobOccupationTaskEvidence" WHERE "version"=${VACANCY_TASK_VERSION} AND "coreKeys" && ${keys}::text[]
      )
      SELECT job."id",job."jobTitleId",job."updatedAt",ev."coreKeys" AS "keys",ev."evidence"
      FROM candidates JOIN "JobPost" job ON job."id"=candidates."id"
      LEFT JOIN "JobOccupationTaskEvidence" ev ON ev."jobId"=job."id"
        AND ev."version"=${VACANCY_TASK_VERSION} AND ev."jobUpdatedAt"=job."updatedAt"
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
      const basis=row.basis as {sharedEssentialSkills?:Array<{label:string}>};
      return [row.fromRoleId+':'+row.toRoleId,basis.sharedEssentialSkills?.slice(0,2).map(task=>task.label)] as const;
    }));
    const decisions:VacancySelection['decisions']=new Map();
    for(const row of rows) {
      if(!row.jobTitleId)continue;
      const target=index.identity(row.jobTitleId);
      if(!target)continue;
      const exact=index.eligibility(choices,row.jobTitleId);
      if(exact.matchType==='EXACT'){
        decisions.set(row.id,{roleId:row.jobTitleId,updatedAt:row.updatedAt,eligibility:exact});
        continue;
      }
      const candidates:VacancyEligibility[]=[];
      for(const source of choices){
        if(blocked.has(source+':'+target.canonicalRoleId))continue;
        const scope=scopesByRole.get(source);
        const tasks=taskCompatibility(scope?.keys??[],row.keys??[],scope?.primary);
        if(tasks.conflict)continue;
        const graph=index.eligibility([source],row.jobTitleId);
        const sharedTasks=row.evidence?.filter(task=>tasks.shared.includes(task.key)).map(task=>task.excerpt).slice(0,2);
        if(graph.eligible) candidates.push({...graph,sharedTasks:sharedTasks?.length?sharedTasks:graphTasks.get(source+':'+target.canonicalRoleId)});
        else if(tasks.strong)candidates.push({eligible:true,reason:'MATCH',...target,matchType:'RELATED',selectedRoleId:source,selectedRoleName:index.roles.get(source)?.name,relationReference:VACANCY_TASK_VERSION,relationScore:tasks.shared.length/(row.keys?.length||1),sharedTasks});
      }
      const best=candidates.sort((a,b)=>(b.relationScore??0)-(a.relationScore??0)||a.selectedRoleId!.localeCompare(b.selectedRoleId!))[0];
      if(best)decisions.set(row.id,{roleId:row.jobTitleId,updatedAt:row.updatedAt,eligibility:best});
    }
    const revision=taskDigest([VACANCY_TASK_VERSION,release,[...decisions].sort(([a],[b])=>a.localeCompare(b))]);
    return {decisions,revision};
  }
}
