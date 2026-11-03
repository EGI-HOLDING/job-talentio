import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import {Prisma,PrismaClient} from '@prisma/client';
import {applyCatalogRepair,planCatalogRepair,catalogDigest,readCatalogRepairInput} from '../matching/employee-catalog-repair';
import {planJobOccupationLinks,planCandidatePreferences} from '../matching/employee-catalog-repair-links';
import {planReviewedRelations,recommendationCoverage} from '../matching/employee-related-curation';
import {intentRoleInclude,employeeOccupationRevision,employeeRecommendationRevision} from '../matching/employee-occupation';
import {liveJobWhere} from '../benefits/benefit-policy';

async function main(){
 const url=new URL(process.env.DATABASE_URL||'');
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434'||!/^\/(job_talentio|talentio_recommendation_v32_it_\d+)$/.test(url.pathname))throw Error('This command only supports the verified local development/test databases on localhost:5434');
 const args=process.argv.slice(2),at=args.indexOf('--report'),file=at<0?null:args[at+1];if(!file)throw Error('--report required');
 const db=new PrismaClient(),apply=args.includes('--apply-local');
 try{
  const official=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../prisma/data/job-titles/audit-2026-10-24.json'),'utf8').replace(/^\uFEFF/,'')).rows;
  const input=await readCatalogRepairInput(db,official),catalog=planCatalogRepair(input);
  if(catalog.errors.length||catalog.unknown.length)throw Error('Resolve catalog conflicts before applying related occupations: '+catalog.errors.join(';'));
  const jobs=await db.jobPost.findMany({select:{id:true,title:true,jobTitleId:true,status:true},orderBy:{id:'asc'}});
  const profiles=await db.employeeProfile.findMany({select:{id:true,desiredPositions:true,desiredPosition:true,matchingPreferencesReviewed:true,desiredRoles:{select:{jobTitleId:true}},phone:true,onboardingStatus:true},orderBy:{id:'asc'}});
  const links=planJobOccupationLinks(jobs,catalog.index),preferences=planCandidatePreferences(profiles,catalog.index),relations=planReviewedRelations(catalog.roles);
  const hash=catalogDigest([catalog.hash,links,preferences,relations]);
  const report:any={policyVersion:'related-roles-v32',hash,applied:false,catalog:{created:catalog.creates.length,changed:catalog.updates.length},jobLinks:links.updates.length,unresolvedJobs:links.unresolved.map(j=>({title:j.title,reason:j.reason})),preferenceUpdates:preferences.updates.length,relations:relations.updates.map(u=>({name:u.name,id:u.id,before:u.before,after:u.metadata})),pending:relations.pending,humanValidated:false,precisionAt10:null,ndcgAt10:null};
  if(apply){
   if(args[args.indexOf('--expected-hash')+1]!==hash)throw Error('Dry-run hash missing or changed');
   await db.$transaction(async tx=>{
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(742159744)`);
    const current=planCatalogRepair(await readCatalogRepairInput(tx,official));if(current.hash!==catalog.hash)throw Error('Catalog changed; repeat dry run');
    await applyCatalogRepair(tx,current);
    for(const l of links.updates){const updated=await tx.jobPost.updateMany({where:{id:l.id,title:l.expectedTitle,jobTitleId:l.expectedJobTitleId},data:{jobTitleId:l.jobTitleId}});if(updated.count!==1)throw Error('Job changed during preparation');}
    for(const p of preferences.updates){const before=await tx.employeeProfile.findUniqueOrThrow({where:{id:p.id},include:{desiredRoles:{select:{jobTitleId:true}}}});if(catalogDigest([before.desiredPositions,before.desiredPosition,before.matchingPreferencesReviewed,before.desiredRoles.map(r=>r.jobTitleId).sort(),before.phone||null,before.onboardingStatus||null])!==p.expectedRevision)throw Error('Preferences changed during preparation');await tx.employeeProfile.update({where:{id:p.id},data:{...(p.requiresContactReview?{onboardingStatus:'IN_PROGRESS' as const}:{}),desiredPositions:p.names,desiredPosition:p.names[0]??null,matchingPreferencesReviewed:true,desiredRoles:{deleteMany:{},create:p.ids.map(jobTitleId=>({jobTitleId}))}}});}
    const before=await tx.jobTitle.findMany({include:intentRoleInclude});
    const changes=planReviewedRelations(before);
    for(const row of changes.updates){await tx.jobTitle.update({where:{id:row.id},data:{matchingMetadata:row.metadata}});await tx.auditLog.create({data:{action:'REVIEW_RELATED_OCCUPATIONS_LOCAL',entityType:'JobTitle',entityId:row.id,metadata:{before:row.before as any,after:row.metadata,source:changes.version,humanValidated:false}}});}
    const after=await tx.jobTitle.findMany({include:intentRoleInclude});
    if(employeeOccupationRevision(before)!==employeeOccupationRevision(after))throw Error('Relation changes must not alter CV identity revision');
    report.identityUnchangedByRelations=true;report.recommendationRevision=employeeRecommendationRevision(after);
   },{timeout:120000,isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
   report.applied=true;
  }
  const roles=apply?await db.jobTitle.findMany({include:intentRoleInclude}):catalog.roles.map(r=>({...r,matchingMetadata:relations.updates.find(u=>u.id===r.id)?.metadata??r.matchingMetadata}));
  const live=await db.jobPost.findMany({where:liveJobWhere(),select:{jobTitleId:true}});
  const selected=await db.employeeDesiredRole.findMany({select:{jobTitleId:true}});
  report.coverage=recommendationCoverage(roles,live,selected.map(r=>r.jobTitleId));report.snapshotHash=catalogDigest([roles,live]);
  fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({hash,applied:report.applied,coverage:report.coverage.length,relationsChanged:report.relations.length,pending:report.pending.length,humanValidated:false}));
 }finally{await db.$disconnect();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1});
