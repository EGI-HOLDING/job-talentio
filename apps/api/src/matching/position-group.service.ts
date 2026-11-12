import {Injectable,Optional,ConflictException,BadRequestException,Logger,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {Prisma,type PositionGroup,type PositionGroupMembership} from '@prisma/client';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {PrismaService} from '../prisma/prisma.service';
import {CandidateCache} from '../common/candidate-cache';
import {OccupationRelationsService} from './occupation-relations.service';
import {intentRoleInclude,type IntentRole,EmployeeOccupationIndex} from './employee-occupation';
import {professionCatalogRevision,professionDigest} from './occupation-relations';
import {buildPositionGroups,groupDigest,positionRoleRevision,type GroupDefinition} from './position-groups';
import {PositionGroupOccupationIndex,type GroupChoice} from './position-group-index';
import {compileHierarchy, employeeHierarchyMode, loadHierarchyManifest} from './employee-hierarchy';

export const positionGroupsEnabled=()=>process.env.POSITION_GROUPS_ENABLED==='true';
type GroupSnapshot={releaseId:string;revision:number;groups:PositionGroup[];choices:GroupChoice[];labels:Map<string,string>;memberships:PositionGroupMembership[]};
@Injectable()
export class PositionGroupService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private busy=false;
  private readonly snapshots=new WeakMap<IntentRole[],{releaseId:string;revision:number;value:Promise<GroupSnapshot>}>();
  private readonly indexes=new WeakMap<IntentRole[],Map<string,PositionGroupOccupationIndex>>();
  constructor(private db:PrismaService,private professions:OccupationRelationsService,@Optional()private cache?:CandidateCache){}
  definitions(){return JSON.parse(readFileSync(join(__dirname,'../../prisma/data/position-groups/heads-v1.json'),'utf8')).heads as GroupDefinition[];}
  private englishLabels(){const file=join(__dirname,'../../prisma/data/position-groups/english-labels-v1.json');return existsSync(file)?JSON.parse(readFileSync(file,'utf8')) as Record<string,string>:{};}
  async snapshot(roles:IntentRole[]){
    if(!positionGroupsEnabled())return null;
    const state=await this.db.positionGroupState.findUnique({where:{id:'indonesia'}});
    if(!state?.activeReleaseId)return null;
    const cached=this.snapshots.get(roles);
    if(cached?.releaseId===state.activeReleaseId&&cached.revision===state.revision)return cached.value;
    const value=this.loadSnapshot(roles,{activeReleaseId:state.activeReleaseId,revision:state.revision});
    this.snapshots.set(roles,{releaseId:state.activeReleaseId,revision:state.revision,value});
    try{return await value;}catch(error){this.snapshots.delete(roles);throw error;}
  }
  private async loadSnapshot(roles:IntentRole[],state:{activeReleaseId:string;revision:number}):Promise<GroupSnapshot>{
    const load=async()=>{
      const release=await this.db.positionGroupRelease.findUniqueOrThrow({where:{id:state.activeReleaseId!},include:{memberships:true,labels:true}});
      const rows=await this.db.positionGroup.findMany({where:{archivedAt:null},orderBy:{id:'asc'}});
      const definitions=new Map(((release.report as {headDefinitions?:GroupDefinition[]}).headDefinitions??[]).map(h=>[h.id,h]));
      const groups=rows.filter(row=>definitions.has(row.id)).map(row=>{const definition=definitions.get(row.id)!;return {...row,nameEn:definition.nameEn,definition:definition.definition,scope:definition.scope,source:definition.source as Prisma.JsonValue};});
      return {release,groups};
    };
    const data=await (this.cache?this.cache.memo('position-groups:'+state.activeReleaseId,600,load):load());
    const byId=new Map(roles.map(role=>[role.id,role]));
    const canonical=new EmployeeOccupationIndex(roles);
    const memberships=data.release.memberships.filter(m=>{const role=byId.get(m.jobTitleId);return role&&canonical.identity(role.id)?.canonicalRoleId===role.id&&(m.basis as {roleRevision?:string}).roleRevision===positionRoleRevision(role);});
    const choices:GroupChoice[]=data.groups.map(g=>{const members=memberships.filter(m=>m.groupId===g.id);return {id:g.id,nameEn:g.nameEn,members:members.map(m=>m.jobTitleId),evidence:Object.fromEntries(members.map(m=>{const basis=m.basis as {method:string;sourceUri?:string;sharedTasks?:Array<{label:string}>;tasks?:Array<{label:string}>};return [m.jobTitleId,{method:basis.method,sourceUri:basis.sourceUri,tasks:(basis.sharedTasks??basis.tasks??[]).slice(0,8).map(t=>t.label)}];}))};});
    return {releaseId:state.activeReleaseId,revision:state.revision,groups:data.groups,choices,labels:new Map(data.release.labels.map(l=>[l.jobTitleId,l.nameEn])),memberships};
  }
  async resolve(roles:IntentRole[],roleIds:string[],groupIds:string[]){
    const snapshot=await this.snapshot(roles);
    const groups=snapshot?.choices.filter(g=>groupIds.includes(g.id))??[];
    const missing=groupIds.filter(id=>!groups.some(g=>g.id===id));
    const indexes=this.indexes.get(roles)??new Map<string,PositionGroupOccupationIndex>();
    this.indexes.set(roles,indexes);
    const key=professionDigest([snapshot?.releaseId,[...roleIds].sort(),[...groupIds].sort()]);
    let index=indexes.get(key);
    if(!index&&groups.length){index=new PositionGroupOccupationIndex(roles,roleIds,groups,snapshot!.releaseId);indexes.set(key,index);if(indexes.size>200)indexes.delete(indexes.keys().next().value!);}
    return {snapshot,groups,missing,index:index??new EmployeeOccupationIndex(roles,true)};
  }
  async build(dryRun=true,expectedId?:string){
    const roles=await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
    const corrections=await this.db.positionGroupCorrection.findMany({orderBy:[{createdAt:'asc'},{id:'asc'}]});
    const latest=new Map(corrections.map(c=>[c.groupId+':'+c.jobTitleId,c]));
    const english=this.englishLabels();
    for(const correction of latest.values())if(correction.groupId==='label:en'&&correction.enabled){const source=correction.source as {nameEn?:string};if(source.nameEn)english[correction.jobTitleId]=source.nameEn;}
    const graph=buildPositionGroups(roles,this.professions.loadSource(),this.definitions(),english,[...latest.values()].filter(c=>c.groupId!=='label:en'));
    const byId=new Map(roles.map(role=>[role.id,role]));
    const {dispositions,...summary}=graph.report;
    if(expectedId&&graph.id!==expectedId)throw new ConflictException('Catalog or group data changed after dry run');
    if(dryRun)return {...graph,summary};
    await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7749932)`;
      const current=await tx.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
      if(professionCatalogRevision(current)!==graph.catalogRevision)throw new ConflictException('Catalog changed; repeat group dry run');
      for(const head of graph.heads)await tx.positionGroup.upsert({where:{id:head.id},create:{id:head.id,code:head.code,nameEn:head.nameEn,definition:head.definition,scope:head.scope,source:head.source as Prisma.InputJsonValue,sourceRoleId:head.sourceRoleId&&byId.has(head.sourceRoleId)?head.sourceRoleId:null},update:{}});
      if(await tx.positionGroupRelease.findUnique({where:{id:graph.id}}))return;
      await tx.positionGroupRelease.create({data:{id:graph.id,catalogRevision:graph.catalogRevision,checksum:graph.checksum,algorithmVersion:graph.algorithmVersion,report:{...summary,headDefinitions:graph.heads} as unknown as Prisma.InputJsonValue}});
      for(let at=0;at<graph.memberships.length;at+=500)await tx.positionGroupMembership.createMany({data:graph.memberships.slice(at,at+500).map(m=>({...m,releaseId:graph.id,basis:m.basis as Prisma.InputJsonValue}))});
      for(let at=0;at<graph.labels.length;at+=500)await tx.positionGroupRoleLabel.createMany({data:graph.labels.slice(at,at+500).map(l=>({...l,source:l.source as Prisma.InputJsonValue,releaseId:graph.id}))});
    },{timeout:120000,isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return {id:graph.id,summary};
  }
  async activate(id:string,expectedRevision:number,actorId:string|null){
    const result=await this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7749932)`;
      const release=await tx.positionGroupRelease.findUniqueOrThrow({where:{id},include:{memberships:{orderBy:[{groupId:'asc'},{jobTitleId:'asc'}]},labels:{orderBy:{jobTitleId:'asc'}}}});
      const report=release.report as {groups?:number;unknownLabels?:unknown[];headDefinitions?:GroupDefinition[]};
      if(report.groups!==99||report.unknownLabels?.length)throw new BadRequestException('Complete the approved groups and English catalog labels before activation');
      const checksum=groupDigest([report.headDefinitions,release.memberships.map(({releaseId,...member})=>member).sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.jobTitleId.localeCompare(b.jobTitleId)),release.labels.map(({releaseId,...label})=>label).sort((a,b)=>a.jobTitleId.localeCompare(b.jobTitleId))]);
      if(checksum!==release.checksum)throw new ConflictException('Staged group release checksum mismatch');
      const roles=await tx.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
      if(release.catalogRevision!==professionCatalogRevision(roles))throw new ConflictException('Catalog changed after staging');
      if(employeeHierarchyMode()==='strict'){
        const active=await tx.positionGroup.findMany({where:{archivedAt:null},select:{id:true}});
        const groupIds=new Set(active.map(group=>group.id));
        const members=new Map<string,string[]>();
        for(const row of release.memberships){
          if(!groupIds.has(row.groupId))continue;
          const ids=members.get(row.groupId)??[];
          ids.push(row.jobTitleId);
          members.set(row.groupId,ids);
        }
        const choices=(report.headDefinitions??[]).map(head=>({id:head.id,nameEn:head.nameEn,members:members.get(head.id)??[]}));
        const hierarchy=compileHierarchy(new EmployeeOccupationIndex(roles),choices,loadHierarchyManifest());
        if(hierarchy.reasons.length)throw new ConflictException({
          message:'POSITION_GROUP_RELEASE_BREAKS_RELATED_HIERARCHY',reasons:hierarchy.reasons,
        });
      }
      const state=await tx.positionGroupState.upsert({where:{id:'indonesia'},create:{id:'indonesia'},update:{}});
      if(state.revision!==expectedRevision)throw new ConflictException('Active group release changed');
      const next=await tx.positionGroupState.update({where:{id:'indonesia',revision:expectedRevision},data:{activeReleaseId:id,revision:{increment:1}}});
      if(state.activeReleaseId&&state.activeReleaseId!==id)await tx.positionGroupRelease.update({where:{id:state.activeReleaseId},data:{status:'RETIRED'}});
      await tx.positionGroupRelease.update({where:{id},data:{status:'ACTIVE'}});
      await tx.auditLog.create({data:{actorId,action:'ACTIVATE_POSITION_GROUPS',entityType:'PositionGroupRelease',entityId:id,metadata:{previousReleaseId:state.activeReleaseId,revision:next.revision}}});
      return next;
    },{timeout:120000,isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    await this.cache?.invalidateAndWait(false);return result;
  }
  async rollback(id:string,expectedRevision:number,actorId:string|null){
    // Older releases retain only memberships whose role revision is still current at read time.
    const release=await this.db.positionGroupRelease.findUnique({where:{id}});if(!release)throw new BadRequestException('Unknown group release');
    const result=await this.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(7749932)`;const state=await tx.positionGroupState.findUniqueOrThrow({where:{id:'indonesia'}});if(state.revision!==expectedRevision)throw new ConflictException('Active group release changed');const next=await tx.positionGroupState.update({where:{id:'indonesia',revision:expectedRevision},data:{activeReleaseId:id,revision:{increment:1}}});if(state.activeReleaseId&&state.activeReleaseId!==id)await tx.positionGroupRelease.update({where:{id:state.activeReleaseId},data:{status:'RETIRED'}});await tx.positionGroupRelease.update({where:{id},data:{status:'ACTIVE'}});await tx.auditLog.create({data:{actorId,action:'ROLLBACK_POSITION_GROUPS',entityType:'PositionGroupRelease',entityId:id,metadata:{previousReleaseId:state.activeReleaseId}}});return next;});
    await this.cache?.invalidateAndWait(false);return result;
  }
  onModuleInit(){if(!positionGroupsEnabled())return;const work=async()=>{if(this.busy)return;this.busy=true;try{const state=await this.db.positionGroupState.findUnique({where:{id:'indonesia'},include:{activeRelease:true}});if(!state?.activeRelease)return;const roles=await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});if(state.activeRelease.catalogRevision===professionCatalogRevision(roles))return;const built=await this.build(false);await this.activate(built.id,state.revision,null);}catch(e){new Logger('PositionGroups').warn('Catalog enrichment pending: '+(e as Error).message);}finally{this.busy=false;}};this.timer=setInterval(()=>void work(),60000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
