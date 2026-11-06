import {Injectable,Logger,OnModuleDestroy,OnModuleInit,Optional,BadRequestException,ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {readFileSync,existsSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {PrismaService} from '../prisma/prisma.service';
import {CandidateCache} from '../common/candidate-cache';
import {intentRoleInclude,EmployeeOccupationIndex} from './employee-occupation';
import {buildProfessionGraph,professionCatalogRevision,professionDigest,PROFESSION_RELATION_ALGORITHM,type ProfessionSource} from './occupation-relations';
import {indonesiaProfessionDefinitions,professionWorkScopes} from './indonesia-profession-definitions';

@Injectable()
export class OccupationRelationsService implements OnModuleInit,OnModuleDestroy {
 private source?:ProfessionSource; private busy=false;private timer?:ReturnType<typeof setInterval>;private startup?:ReturnType<typeof setTimeout>;
 constructor(private db:PrismaService,@Optional()private cache?:CandidateCache){}
 onModuleInit(){const work=()=>{if(this.busy)return;this.busy=true;void this.build(false).catch(e=>new Logger('OccupationRelations').warn('Background enrichment failed; exact and exploration remain available: '+e.message)).finally(()=>this.busy=false);};this.startup=setTimeout(work,10000);this.startup.unref();this.timer=setInterval(work,60000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);if(this.startup)clearTimeout(this.startup);}
 loadSource(){if(!this.source){const directory=join(__dirname,'../../prisma/data/occupation-profiles');const source=JSON.parse(gunzipSync(readFileSync(join(directory,'esco-v1.2.1.json.gz'))).toString('utf8')) as ProfessionSource;const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));if(source.sourceVersion!=='v1.2.1'||professionDigest(source)!==manifest.sha256)throw new Error('ESCO source snapshot checksum/version mismatch');this.source={...source,localDefinitions:indonesiaProfessionDefinitions,workScopes:professionWorkScopes};}return this.source;}
 private compute(roles:Parameters<typeof buildProfessionGraph>[0],source:ProfessionSource):Promise<ReturnType<typeof buildProfessionGraph>>{
  const file=join(__dirname,'occupation-relations.worker.js');
  // Source-mode CLI runs offline; production always executes the compiled worker.
  if(!existsSync(file))return Promise.resolve(buildProfessionGraph(roles,source));
  return new Promise((resolve,reject)=>{const worker=new Worker(file,{workerData:{roles,source},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});let done=false;worker.once('message',graph=>{done=true;resolve(graph);});worker.once('error',reject);worker.once('exit',code=>{if(!done)reject(new Error('Profession graph worker exited '+code));});});
 }
 async build(dryRun=true,force=false,expectedId?:string){
  const source=this.loadSource(),roles=await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}}),catalogRevision=professionCatalogRevision(roles),sourceDigest=professionDigest(source);
  const id=professionDigest([PROFESSION_RELATION_ALGORITHM,catalogRevision,sourceDigest]);
  if(expectedId&&expectedId!==id)throw new ConflictException('Dry-run revision changed; repeat the catalog dry run');
  const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});
  if(!dryRun&&state?.pinned&&!force)return {id:state.activeReleaseId,pinned:true};
  if(!dryRun&&state?.activeReleaseId===id){if(force&&state.pinned){await this.db.occupationRelationState.update({where:{id:'employee'},data:{pinned:false}});await this.db.auditLog.create({data:{action:'RESUME_OCCUPATION_RELATION_ENRICHMENT',entityType:'OccupationRelationRelease',entityId:id}});}return {id,unchanged:true};}
  const graph=await this.compute(roles,source);
  if(dryRun)return {id:graph.id,report:graph.report,previousReleaseId:state?.activeReleaseId||null};
  await this.db.$transaction(async tx=>{
   await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159745)`);
   const latestState=await tx.occupationRelationState.findUnique({where:{id:'employee'}});
   if(latestState?.pinned&&!force)throw new ConflictException('Operator restored a pinned relation release');
   if(latestState?.activeReleaseId===graph.id)return;
   const current=await tx.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
   if(professionCatalogRevision(current)!==graph.catalogRevision)throw new ConflictException('Catalog changed during graph build; background rebuild will retry');
   const existing=await tx.occupationRelationRelease.findUnique({where:{id:graph.id}});
   if(!existing){
    await tx.occupationRelationRelease.create({data:{id:graph.id,sourceVersion:graph.sourceVersion,algorithmVersion:graph.algorithmVersion,sourceDigest:graph.sourceDigest,catalogRevision:graph.catalogRevision,report:graph.report}});
    for(let start=0;start<graph.profiles.length;start+=500)await tx.occupationProfessionProfile.createMany({data:graph.profiles.slice(start,start+500).map(p=>({...p,releaseId:graph.id}))});
    for(let start=0;start<graph.relations.length;start+=500)await tx.occupationProfessionRelation.createMany({data:graph.relations.slice(start,start+500).map(r=>({...r,releaseId:graph.id}))});
   }
   await tx.occupationRelationState.upsert({where:{id:'employee'},create:{id:'employee',activeReleaseId:graph.id},update:{activeReleaseId:graph.id,pinned:false}});
   await tx.auditLog.create({data:{action:'ACTIVATE_OCCUPATION_RELATIONS',entityType:'OccupationRelationRelease',entityId:graph.id,metadata:{previousReleaseId:state?.activeReleaseId||null,algorithmVersion:graph.algorithmVersion,report:graph.report}}});
  },{timeout:120000,isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  await this.cache?.invalidate(true);
  new Logger('OccupationRelations').log(JSON.stringify({release:graph.id,...graph.report,sourceMissing:graph.report.sourceMissing.length}));
  return {id:graph.id,report:graph.report,previousReleaseId:state?.activeReleaseId||null};
 }
 async snapshot(){
  const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});
  if(!state?.activeReleaseId)return {releaseId:null,revision:'none:'+state?.updatedAt.toISOString(),relations:[] as Array<{fromRoleId:string;toRoleId:string;score:number;reference:string}>,overrides:await this.db.occupationRelationOverride.findMany({select:{fromRoleId:true,toRoleId:true,enabled:true,reason:true}})};
  const revision=state.activeReleaseId+':'+state.updatedAt.toISOString();
  const load=async()=>{
   const [rows,overrides]=await Promise.all([
    this.db.$queryRaw<Array<{fromRoleId:string;toRoleId:string;score:number}>>`
      SELECT "fromRoleId", "toRoleId", "score"
      FROM "OccupationProfessionRelation"
      WHERE "releaseId" = ${state.activeReleaseId}
        AND COALESCE("basis"->>'kind', 'RELATED') = 'RELATED'
    `,
    this.db.occupationRelationOverride.findMany({select:{fromRoleId:true,toRoleId:true,enabled:true,reason:true}}),
   ]);
   return {releaseId:state.activeReleaseId,revision,relations:rows.map(r=>({...r,reference:'talentio:derived-competencies:'+state.activeReleaseId})),overrides};
  };
  return this.cache?this.cache.memo('profession-relations:'+revision,600,load):load();
 }
 async correct(fromRoleId:string,toRoleId:string,enabled:boolean,reason:string,actorId:string){
  if(fromRoleId===toRoleId)throw new BadRequestException('A profession cannot be related to itself');
  const roles=await this.db.jobTitle.findMany({include:intentRoleInclude}),index=new EmployeeOccupationIndex(roles);
  if(index.identity(fromRoleId)?.canonicalRoleId!==fromRoleId||index.identity(toRoleId)?.canonicalRoleId!==toRoleId)throw new BadRequestException('Select active canonical professions');
  await this.db.$transaction(async tx=>{const before=await tx.occupationRelationOverride.findUnique({where:{fromRoleId_toRoleId:{fromRoleId,toRoleId}}});await tx.occupationRelationOverride.upsert({where:{fromRoleId_toRoleId:{fromRoleId,toRoleId}},create:{fromRoleId,toRoleId,enabled,reason,actorId},update:{enabled,reason,actorId}});await tx.occupationRelationState.upsert({where:{id:'employee'},create:{id:'employee'},update:{updatedAt:new Date()}});await tx.auditLog.create({data:{actorId,action:'CORRECT_OCCUPATION_RELATION',entityType:'OccupationRelationOverride',entityId:fromRoleId+':'+toRoleId,metadata:{before,after:{enabled,reason}} as unknown as Prisma.InputJsonValue}});});
  await this.cache?.invalidate(true);return {fromRoleId,toRoleId,enabled,reason};
 }
 async activate(id:string,actorId?:string){
  if(id!=='none'&&!await this.db.occupationRelationRelease.findUnique({where:{id}}))throw new BadRequestException('Relation release does not exist');
  const activeReleaseId=id==='none'?null:id;
  await this.db.$transaction(async tx=>{await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159745)`);const before=await tx.occupationRelationState.findUnique({where:{id:'employee'}});await tx.occupationRelationState.upsert({where:{id:'employee'},create:{id:'employee',activeReleaseId,pinned:true},update:{activeReleaseId,pinned:true}});await tx.auditLog.create({data:{actorId,action:'RESTORE_OCCUPATION_RELATION_RELEASE',entityType:'OccupationRelationRelease',entityId:id,metadata:{previousReleaseId:before?.activeReleaseId||null}}});});await this.cache?.invalidate(true);return {activeReleaseId,pinned:true};
 }
}
