/** Explicit occupation repair runner. Default dry run; an apply requires the
 * exact plan hash. Production access is available only to the separately
 * guarded Indonesia VPS entry point, never to the local command. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CandidateCache } from '../common/candidate-cache';
import { applyCatalogRepair, catalogDigest, planCatalogRepair, readCatalogRepairInput } from '../matching/employee-catalog-repair';
import { planCandidatePreferences, planJobOccupationLinks } from '../matching/employee-catalog-repair-links';

export async function runCatalogRepair(target:'LOCAL'|'INDONESIA_VPS'='LOCAL'){
 const url=new URL(process.env.DATABASE_URL||'');
 if(target==='LOCAL'&&(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5434'||!/^\/talentio_mapping_local_\d+$/.test(url.pathname)))throw Error('Repair requires an isolated talentio_mapping_local_DATE database on localhost:5434');
 if(target==='INDONESIA_VPS'&&(process.env.EMPLOYEE_CATALOG_REPAIR_TARGET!=='indonesia-vps'||!fs.existsSync('/.dockerenv')||url.hostname!=='host.docker.internal'||url.port!=='5432'||url.pathname!=='/talentio'))throw Error('Indonesia repair requires the explicit VPS target and the Talentio API container database');
 const args=process.argv.slice(2),apply=args.includes(target==='LOCAL'?'--apply-local':'--apply-indonesia-vps');
 if(args.includes(target==='LOCAL'?'--apply-indonesia-vps':'--apply-local'))throw Error('Apply target does not match the command');
 const arg=(flag:string)=>{const at=args.indexOf(flag);return at<0?undefined:args[at+1];};
 const file=arg('--report');if(!file)throw Error('--report is required');
 let backup: {file:string;sha256:string}|null=null;
 if(target==='INDONESIA_VPS'&&apply){
   const backupFile=arg('--backup-file');if(!backupFile||!backupFile.startsWith('/release-backups/'))throw Error('VPS apply requires a mounted backup under /release-backups/');
   const buffer=fs.readFileSync(backupFile);if(buffer.length<1000||buffer.subarray(0,5).toString()!=='PGDMP')throw Error('Valid PostgreSQL custom backup required');
   backup={file:backupFile,sha256:createHash('sha256').update(buffer).digest('hex')};
 }
 const official=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../prisma/data/job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,'' )).rows;
 const db=new PrismaClient();
 try{
   const input=await readCatalogRepairInput(db,official);
   const plan=planCatalogRepair(input);
   const jobs=await db.jobPost.findMany({select:{id:true,title:true,jobTitleId:true,status:true},orderBy:{id:'asc'}});
   const profiles=await db.employeeProfile.findMany({include:{desiredRoles:{select:{jobTitleId:true}}},orderBy:{id:'asc'}});
   const links=planJobOccupationLinks(jobs,plan.index),preferences=planCandidatePreferences(profiles,plan.index);
   const hash=catalogDigest([plan.hash,links,preferences]);
   const report={mode:apply?'APPLY_'+target:'DRY_RUN',target,backup,database:url.pathname,version:plan.version,hash,positionsCreated:plan.creates.length,positionsChanged:plan.updates.length,aliasesApproved:plan.aliasDecisions.filter(a=>a.approved).length,aliasesNeedingReview:plan.aliasDecisions.filter(a=>!a.approved),quarantined:plan.pending,unmapped:plan.unknown,errors:plan.errors,jobLinks:links,preferences,evidenceQueued:0,applied:false};
   fs.writeFileSync(path.resolve(file),JSON.stringify(report,null,2));
   if(plan.errors.length)throw Error('Catalog conflicts; see report');
   if(plan.unknown.length)throw Error('Unmapped active occupations remain; see report');
   const unresolvedPublished=links.unresolved.filter(j=>jobs.find(row=>row.id===j.id)?.status==='PUBLISHED');
   if(unresolvedPublished.length)throw Error('Published jobs still lack verified occupation identities; see report');
   if(apply){
     if(arg('--expected-hash')!==hash)throw Error('Plan changed or --expected-hash does not match the dry-run report');
     await db.$transaction(async tx=>{
       await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159744)`);
       const current=planCatalogRepair(await readCatalogRepairInput(tx,official));
       if(current.hash!==plan.hash)throw Error('Catalog changed since plan; rerun dry run');
       const changed=await applyCatalogRepair(tx,current);
       for(const row of links.updates){
         const result=await tx.jobPost.updateMany({where:{id:row.id,title:row.expectedTitle,jobTitleId:row.expectedJobTitleId},data:{jobTitleId:row.jobTitleId}});
         if(result.count!==1)throw Error('Job changed since plan: '+row.id);
       }
       for(const row of preferences.updates){
         await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${row.id} FOR UPDATE`);
         const current=await tx.employeeProfile.findUniqueOrThrow({where:{id:row.id},include:{desiredRoles:{select:{jobTitleId:true}}}});
         if(catalogDigest([current.desiredPositions,current.desiredPosition,current.matchingPreferencesReviewed,current.desiredRoles.map(r=>r.jobTitleId).sort(),current.phone||null,current.onboardingStatus||null])!==row.expectedRevision)throw Error('Candidate preferences changed since plan: '+row.id);
         await tx.employeeProfile.update({where:{id:row.id},data:{...(row.requiresContactReview?{onboardingStatus:'IN_PROGRESS' as const}:{}),desiredPositions:row.names,desiredPosition:row.names[0]||null,matchingPreferencesReviewed:true,desiredRoles:{deleteMany:{},create:row.ids.map(jobTitleId=>({jobTitleId}))}}});
       }
       if(changed.positionsCreated||changed.positionsChanged||changed.aliasChanges){
         const versions=await tx.resumeVersion.findMany({where:{parseStatus:'READY',currentFor:{is:{isPrimary:true,deletedAt:null}}},select:{id:true,parseGeneration:true}});
         for(const v of versions)await tx.resumeEmployeeEvidence.upsert({where:{versionId:v.id},create:{versionId:v.id,generation:v.parseGeneration,parserVersion:'employee-cv-v3.1'},update:{status:'PENDING',startedAt:null,error:null,generation:v.parseGeneration,revision:{increment:1}}});
         report.evidenceQueued=versions.length;
       }
     },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:120000});
     const cache=new CandidateCache(new ConfigService());try{await cache.invalidateAndWait(true);}finally{cache.onModuleDestroy();}
     report.applied=true;fs.writeFileSync(path.resolve(file),JSON.stringify(report,null,2));
   }
   console.log(JSON.stringify({mode:report.mode,hash,positionsCreated:report.positionsCreated,positionsChanged:report.positionsChanged,aliasesApproved:report.aliasesApproved,quarantined:report.quarantined.length,unmapped:report.unmapped.length,errors:report.errors.length,jobsLinked:links.updates.length,jobsUnresolved:links.unresolved.length,preferencesMapped:preferences.updates.length,preferencesUnresolved:preferences.unresolved.length,profilesRequiringContact:preferences.updates.filter(p=>p.requiresContactReview).length,evidenceQueued:report.evidenceQueued,applied:report.applied}));
 }finally{await db.$disconnect();}
}
if(require.main===module)void runCatalogRepair().catch(e=>{console.error(e.message);process.exitCode=1});
