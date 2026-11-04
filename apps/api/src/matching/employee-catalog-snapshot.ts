import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateCache } from '../common/candidate-cache';
import { EmployeeOccupationIndex, intentRoleInclude, employeeOccupationRevision, employeeRecommendationRevision } from './employee-occupation';
import {OccupationRelationsService} from './occupation-relations.service';

@Injectable()
export class EmployeeCatalogSnapshot {
  constructor(private db: PrismaService, @Optional() private cache?: CandidateCache,@Optional()private relations?:OccupationRelationsService) {}
  async get(includeRelations=false) {
    const load = async () => {
      const roles = await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
      return {roles,index:new EmployeeOccupationIndex(roles),revision:employeeOccupationRevision(roles),recommendationRevision:employeeRecommendationRevision(roles)};
    };
    const base=this.cache?await this.cache.memo('occupation-catalog:' + await this.cache.version('catalog'),600,load):await load();
    if(!includeRelations||!this.relations)return base;
    const graph=await this.relations.snapshot();
    const project=async()=>{
      const rows=structuredClone(base.roles),byId=new Map(rows.map(r=>[r.id,r]));
      const overrides=new Map(graph.overrides.map(r=>[r.fromRoleId+':'+r.toRoleId,r]));
      const edges=new Map<string,Array<{id:string;kind:'RELATED';reference:string;approved:boolean;score?:number}>>();
      for(const relation of graph.relations){const override=overrides.get(relation.fromRoleId+':'+relation.toRoleId);if(override?.enabled===false)continue;const list=edges.get(relation.fromRoleId)||[];list.push({id:relation.toRoleId,kind:'RELATED',reference:override?'talentio:catalog-correction':relation.reference,approved:true,score:relation.score});edges.set(relation.fromRoleId,list);}
      for(const override of graph.overrides)if(override.enabled){const list=edges.get(override.fromRoleId)||[];if(!list.some(r=>r.id===override.toRoleId))list.push({id:override.toRoleId,kind:'RELATED',reference:'admin:'+override.reason,approved:true});edges.set(override.fromRoleId,list);}
      for(const role of rows){const metadata=(role.matchingMetadata||{}) as Record<string,unknown>;const manual=(Array.isArray(metadata.relatedRoles)?metadata.relatedRoles:[]) as Array<{id:string;kind:'RELATED';reference:string;approved:boolean}>;const merged=new Map((edges.get(role.id)||[]).map(r=>[r.id,r]));for(const row of manual)if(!overrides.has(role.id+':'+row.id)){if(row.approved)merged.set(row.id,row);else merged.delete(row.id);}for(const row of graph.overrides.filter(o=>o.fromRoleId===role.id&&!o.enabled))merged.delete(row.toRoleId);role.matchingMetadata={...metadata,relatedRoles:[...merged.values()].filter(r=>byId.has(r.id))};}
      return {...base,roles:rows,index:new EmployeeOccupationIndex(rows,true),recommendationRevision:base.recommendationRevision+':'+graph.revision,relationReleaseId:graph.releaseId};
    };
    return this.cache?this.cache.memo('employee-relation-catalog:'+base.revision+':'+graph.revision+':'+base.recommendationRevision,600,project):project();
  }
}
