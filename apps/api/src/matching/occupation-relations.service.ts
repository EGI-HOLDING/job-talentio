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
import {TASK_CONCEPT_VERSION,type TaskSkill} from './task-concepts';
import {LEGACY_VACANCY_TASK_VERSION,vacancyTaskEvidenceVersion} from './vacancy-tasks';

export const EMPLOYEE_SELECTION_POLICY_VERSION='employee-selection-core-tasks-v1';

export function loadProfessionSource(directory=join(__dirname,'../../prisma/data/occupation-profiles')):ProfessionSource {
 const json=(name:string)=>JSON.parse(readFileSync(join(directory,name),'utf8'));
 const compressed=(name:string)=>JSON.parse(gunzipSync(readFileSync(join(directory,name))).toString('utf8'));
 const base=compressed('esco-v1.2.1.json.gz') as ProfessionSource;
 const manifest=json('manifest.json');
 if(base.sourceVersion!=='v1.2.1'||professionDigest(base)!==manifest.sha256)throw new Error('ESCO source snapshot checksum/version mismatch');
 const supplement=compressed('esco-task-vocabulary-v1.2.1.json.gz') as {sourceVersion:string;skills:Partial<TaskSkill>[]};
 const vocabulary=json('task-vocabulary-manifest.json');
 if(supplement.sourceVersion!==base.sourceVersion||professionDigest(supplement)!==vocabulary.sha256||supplement.skills.length!==base.skills.length)throw new Error('ESCO task vocabulary checksum/version mismatch');
 const byUri=new Map(supplement.skills.map(skill=>[skill.uri,skill]));
 if(byUri.size!==base.skills.length||base.skills.some(skill=>!byUri.has(skill.uri)))throw new Error('ESCO task vocabulary is incomplete');
 const skills=base.skills.map(skill=>({...byUri.get(skill.uri),...skill}));
 return {...base,skills,taskVocabularyDigest:vocabulary.sha256,localDefinitions:indonesiaProfessionDefinitions,workScopes:professionWorkScopes};
}

@Injectable()
export class OccupationRelationsService implements OnModuleInit,OnModuleDestroy {
 private source?:ProfessionSource; private busy=false;private timer?:ReturnType<typeof setInterval>;private startup?:ReturnType<typeof setTimeout>;
 constructor(private db:PrismaService,@Optional()private cache?:CandidateCache){}
 onModuleInit(){const work=()=>{if(this.busy||process.env.EMPLOYEE_CORE_TASK_SELECTION_ENABLED!=='true')return;this.busy=true;void (async()=>{const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});if(state?.activeReleaseId&&!state.pinned&&await this.db.employeeSelectionRelease.findUnique({where:{graphReleaseId:state.activeReleaseId},select:{id:true}}))await this.build(false);})().catch(e=>new Logger('OccupationRelations').warn('Background enrichment failed; the active selection release remains available: '+e.message)).finally(()=>this.busy=false);};this.startup=setTimeout(work,10000);this.startup.unref();this.timer=setInterval(work,60000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);if(this.startup)clearTimeout(this.startup);}
 loadSource(){return this.source??=loadProfessionSource();}
 taskVersion(){return vacancyTaskEvidenceVersion(this.loadSource().taskVocabularyDigest);}
 private compute(roles:Parameters<typeof buildProfessionGraph>[0],source:ProfessionSource):Promise<ReturnType<typeof buildProfessionGraph>>{
  const file=join(__dirname,'occupation-relations.worker.js');
  // Source-mode CLI runs offline; production always executes the compiled worker.
  if(!existsSync(file))return Promise.resolve(buildProfessionGraph(roles,source));
  return new Promise((resolve,reject)=>{const worker=new Worker(file,{workerData:{roles,source},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});let done=false;worker.once('message',graph=>{done=true;resolve(graph);});worker.once('error',reject);worker.once('exit',code=>{if(!done)reject(new Error('Profession graph worker exited '+code));});});
 }
 async build(dryRun=true,force=false,expectedId?:string,publish=true){
  const source=this.loadSource(),roles=await this.db.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}}),catalogRevision=professionCatalogRevision(roles),sourceDigest=professionDigest(source);
  const id=professionDigest([PROFESSION_RELATION_ALGORITHM,catalogRevision,sourceDigest]);
  if(expectedId&&expectedId!==id)throw new ConflictException('Dry-run revision changed; repeat the catalog dry run');
  const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});
  if(!dryRun&&state?.pinned&&!force)return {id:state.activeReleaseId,pinned:true};
  if(!dryRun&&state?.activeReleaseId===id){if(force&&state.pinned){await this.db.occupationRelationState.update({where:{id:'employee'},data:{pinned:false}});await this.db.auditLog.create({data:{action:'RESUME_OCCUPATION_RELATION_ENRICHMENT',entityType:'OccupationRelationRelease',entityId:id}});}return {id,unchanged:true};}
  const existing=await this.db.occupationRelationRelease.findUnique({where:{id}});
  const graph=existing?null:await this.compute(roles,source);
  const report=existing?.report??graph!.report;
  const taskVersion=this.taskVersion();
  const selectionRevision=professionDigest([id,TASK_CONCEPT_VERSION,taskVersion,EMPLOYEE_SELECTION_POLICY_VERSION]);
  if(dryRun)return {id,report,taskVersion,selectionRevision,previousReleaseId:state?.activeReleaseId||null};
  const result=await this.db.$transaction(async tx=>{
   await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159745)`);
   const latestState=await tx.occupationRelationState.findUnique({where:{id:'employee'}});
   if(latestState?.pinned&&!force)throw new ConflictException('Operator restored a pinned relation release');
   if(latestState?.activeReleaseId===id)return {activated:false,pendingTasks:0};
   const current=await tx.jobTitle.findMany({include:intentRoleInclude,orderBy:{id:'asc'}});
   if(professionCatalogRevision(current)!==catalogRevision)throw new ConflictException('Catalog changed during graph build; background rebuild will retry');
   const stored=await tx.occupationRelationRelease.findUnique({where:{id}});
   if(!stored&&graph){
    await tx.occupationRelationRelease.create({data:{id:graph.id,sourceVersion:graph.sourceVersion,algorithmVersion:graph.algorithmVersion,sourceDigest:graph.sourceDigest,catalogRevision:graph.catalogRevision,report:graph.report}});
    for(let start=0;start<graph.profiles.length;start+=500)await tx.occupationProfessionProfile.createMany({data:graph.profiles.slice(start,start+500).map(p=>({...p,releaseId:graph.id}))});
    for(let start=0;start<graph.relations.length;start+=500)await tx.occupationProfessionRelation.createMany({data:graph.relations.slice(start,start+500).map(r=>({...r,releaseId:graph.id}))});
   }
   await tx.employeeSelectionRelease.upsert({where:{graphReleaseId:id},create:{id:selectionRevision,graphReleaseId:id,dictionaryVersion:TASK_CONCEPT_VERSION,taskEvidenceVersion:taskVersion,policyVersion:EMPLOYEE_SELECTION_POLICY_VERSION,sourceDigest,validation:report as Prisma.InputJsonValue},update:{}});
   const [coverage]=await tx.$queryRaw<Array<{pending:number}>>`SELECT count(*)::int AS pending FROM "JobPost" job LEFT JOIN "JobOccupationTaskEvidence" task ON task."jobId"=job.id AND task.version=${taskVersion} AND task."jobUpdatedAt"=job."updatedAt" AND task.state<>'FAILED' WHERE job.status='PUBLISHED' AND task."jobId" IS NULL`;
   if(!publish||coverage.pending)return {activated:false,pendingTasks:coverage.pending};
   await tx.occupationRelationState.upsert({where:{id:'employee'},create:{id:'employee',activeReleaseId:id},update:{activeReleaseId:id,pinned:false}});
   await tx.auditLog.create({data:{action:'ACTIVATE_OCCUPATION_RELATIONS',entityType:'OccupationRelationRelease',entityId:id,metadata:{previousReleaseId:latestState?.activeReleaseId||null,algorithmVersion:PROFESSION_RELATION_ALGORITHM,selectionRevision,taskVersion}}});
   return {activated:true,pendingTasks:0};
  },{timeout:120000,isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  if(result.activated)await this.cache?.invalidate(true);
  new Logger('OccupationRelations').log(JSON.stringify({release:id,selectionRevision,taskVersion,...result}));
  return {id,report,selectionRevision,taskVersion,...result,previousReleaseId:state?.activeReleaseId||null};
 }
 async snapshot(){
  const state=await this.db.occupationRelationState.findUnique({where:{id:'employee'}});
  if(!state?.activeReleaseId)return {releaseId:null,selectionRevision:null,taskVersion:LEGACY_VACANCY_TASK_VERSION,revision:'none:'+state?.updatedAt.toISOString(),relations:[] as Array<{fromRoleId:string;toRoleId:string;score:number;reference:string}>,overrides:await this.db.occupationRelationOverride.findMany({select:{fromRoleId:true,toRoleId:true,enabled:true,reason:true}})};
  const revision=state.activeReleaseId+':'+state.updatedAt.toISOString();
  const load=async()=>{
   const [rows,overrides,selection]=await Promise.all([
    this.db.$queryRaw<Array<{fromRoleId:string;toRoleId:string;score:number}>>`
      SELECT "fromRoleId", "toRoleId", "score"
      FROM "OccupationProfessionRelation"
      WHERE "releaseId" = ${state.activeReleaseId}
        AND COALESCE("basis"->>'kind', 'RELATED') = 'RELATED'
    `,
    this.db.occupationRelationOverride.findMany({select:{fromRoleId:true,toRoleId:true,enabled:true,reason:true}}),
    this.db.employeeSelectionRelease?.findUnique({where:{graphReleaseId:state.activeReleaseId!},select:{id:true,taskEvidenceVersion:true}}),
   ]);
   return {releaseId:state.activeReleaseId,selectionRevision:selection?.id??null,taskVersion:selection?.taskEvidenceVersion??LEGACY_VACANCY_TASK_VERSION,revision,relations:rows.map(r=>({...r,reference:'talentio:derived-competencies:'+state.activeReleaseId})),overrides};
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
  if(id!=='none'&&await this.db.employeeSelectionRelease.findUnique({where:{graphReleaseId:id}})&&!await this.db.auditLog.findFirst({where:{action:'ACTIVATE_OCCUPATION_RELATIONS',entityType:'OccupationRelationRelease',entityId:id},select:{id:true}}))throw new BadRequestException('A staged release must pass publication checks before it can be restored');
  const activeReleaseId=id==='none'?null:id;
  await this.db.$transaction(async tx=>{await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159745)`);const before=await tx.occupationRelationState.findUnique({where:{id:'employee'}});await tx.occupationRelationState.upsert({where:{id:'employee'},create:{id:'employee',activeReleaseId,pinned:true},update:{activeReleaseId,pinned:true}});await tx.auditLog.create({data:{actorId,action:'RESTORE_OCCUPATION_RELATION_RELEASE',entityType:'OccupationRelationRelease',entityId:id,metadata:{previousReleaseId:before?.activeReleaseId||null}}});});await this.cache?.invalidate(true);return {activeReleaseId,pinned:true};
 }
}
