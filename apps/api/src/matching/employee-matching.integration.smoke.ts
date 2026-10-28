import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeMatchingService, employeeJobFeatures } from './employee-matching.service';
import { OccupationIndex, evaluateEmployee, rankEmployeeJobs } from './employee-matching';
import { MatchingService } from './matching.service';
import { JobsService } from '../jobs/jobs.service';
import { AdminCatalogService } from '../admin/admin-catalog.service';

async function main() {
  const root=path.resolve(__dirname,'../../../..');
  const dotenv=createRequire(require.resolve('@nestjs/config'))('dotenv');
  const config=dotenv.parse(fs.readFileSync(path.join(root,'.env'),'utf8'));
  const url=new URL(config.DATABASE_URL);url.pathname='/job_talentio_matching_audit_20261024';
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5434')throw Error('Local isolated DB only');
  const db=new PrismaService({datasources:{db:{url:url.toString()}}});
  try{
    const before=await Promise.all([db.jobPost.count(),db.application.count(),db.employeeProfile.count(),db.jobTitle.count(),db.jobPostLanguage.count()]);
    const [profiles,jobs,roles]=await Promise.all([
      db.employeeProfile.findMany({include:{skills:{include:{skill:{include:{aliases:true}}}},experiences:true,educations:true,certifications:true,languages:{include:{language:true}},preferredCountries:true,city:{include:{province:true}}}}),
      db.jobPost.findMany({where:{status:'PUBLISHED',company:{isBanned:false,anonymizedAt:null}},select:employeeJobFeatures}),
      db.jobTitle.findMany({where:{archivedAt:null},include:{aliases:true}}),
    ]);
    const index=new OccupationIndex(roles);const legacy=new MatchingService(db);let pairs=0;
    const groups:Record<string,{pairs:number;positiveCore:number;unknownRequirements:number;rankMovement:number}>={};
    for(const p of profiles){
      const previous=jobs.map(j=>({id:j.id,total:legacy.compute(p,{...j,jobTitle:index.roles.get(j.jobTitleId ?? '')}).total})).sort((a,b)=>b.total-a.total||a.id.localeCompare(b.id));
      const positions=new Map(previous.map((row,i)=>[row.id,i]));
      const next=rankEmployeeJobs(jobs.map(j=>({job:j,evaluation:evaluateEmployee(p,j,index)})));
      next.forEach((row,i)=>{const group=(index.roles.get(row.job.jobTitleId ?? '')?.matchingMetadata as {isco08?:string} | null)?.isco08?.[0] ?? 'unmapped';
        const report=groups[group] ??= {pairs:0,positiveCore:0,unknownRequirements:0,rankMovement:0};report.rankMovement+=Math.abs((positions.get(row.job.id)??i)-i);});
    }
    for(const p of profiles)for(const j of jobs){
      const evaluation=evaluateEmployee(p,j,index);
      const group=(index.roles.get(j.jobTitleId ?? '')?.matchingMetadata as {isco08?:string} | null)?.isco08?.[0] ?? 'unmapped';
      const report=groups[group] ??= {pairs:0,positiveCore:0,unknownRequirements:0,rankMovement:0};
      report.pairs++;if(evaluation.positiveCore)report.positiveCore++;
      report.unknownRequirements+=evaluation.insights.evidence.filter(e=>e.required&&e.status==='UNKNOWN').length;
      assert.ok(evaluation.score>=0&&Number.isFinite(evaluation.score));
      const expanded={...p,skills:[...p.skills,{id:'extra',profileId:p.id,skillId:'not-required',level:'EXPERT' as const,levelSource:'USER_CONFIRMED',skill:{id:'not-required',name:'unrelated-fixture',slug:'unrelated-fixture',normalizedKey:'unrelated-fixture',aliases:[]}}]};
      assert.equal(evaluateEmployee(expanded,j,index).score,evaluation.score,'adding unrelated skills must not penalize existing evidence');
      pairs++;
    }
    const profile=profiles.find(p=>p.skills.length&&p.headline)!;
    const service=new EmployeeMatchingService(db);
    const page=await service.recommend(profile.id,1,12);
    assert.ok(page.items.length<=12);
    if(page.totalPages>1){const next=await service.recommend(profile.id,2,12);assert.ok(next.items.every(row=>!page.items.some(previous=>previous.job.id===row.job.id)));}
    const facade=new JobsService(db,null as never,legacy,null as never,null as never,null as never,service);
    const visible=await facade.recommendedForUser({id:profile.userId,role:'EMPLOYEE'} as never,'id',1,12);
    assert.ok(!Array.isArray(visible));
    for(const row of (visible as any).items){
      assert.equal(row.matchInsights.version,'employee-evidence-v2');
      assert.ok(!('description' in row.job),'recommendation summaries must not return full descriptions');
      if(row.job.isAnonymous){assert.ok(!row.job.companyId);assert.equal(row.job.company.id,'');}
    }
    // Changes are limited to the isolated copy, then rolled back atomically.
    const rollback=Symbol('rollback');
    try{await db.$transaction(async tx=>{
      const catalog=new AdminCatalogService(tx as unknown as PrismaService);
      const created=await catalog.create('jobTitle',{name:'Matching audit occupation '+Date.now(),nameId:'Jabatan audit',nameUz:'Audit kasbi',matchingMetadata:{sources:[{provider:'Audit fixture',version:'test'}],relatedRoles:[]}});
      assert.equal((created.matchingMetadata as any).sources[0].provider,'Audit fixture');
      const alias=await catalog.addAlias('jobTitle',created.id,'audit-occupation-alias-'+Date.now());
      assert.equal((await catalog.listAliases('jobTitle',created.id)).length,1);
      await catalog.removeAlias('jobTitle',created.id,alias.id);
      const employee=new EmployeeMatchingService(tx as unknown as PrismaService);
      const application=await tx.application.findFirst({where:{jobPost:{company:{isBanned:false,anonymizedAt:null}}},include:{profile:{select:{userId:true}}}});
      if(application){
        const access=new JobsService(tx as unknown as PrismaService,null as never,legacy,null as never,null as never,null as never,employee);
        await tx.jobPost.update({where:{id:application.jobPostId},data:{status:'DRAFT'}});
        await assert.rejects(()=>access.employeeInsights({id:application.profile.userId,role:'EMPLOYEE'} as never,application.jobPostId),/Job not found/);
        await tx.jobPost.update({where:{id:application.jobPostId},data:{status:'CLOSED'}});
        assert.ok((await access.employeeInsights({id:application.profile.userId,role:'EMPLOYEE'} as never,application.jobPostId)).matchInsights);
      }
      const target=jobs.find(j=>j.jobSkills.length>0)!;
      const original=await employee.forJob(profile.id,target.id);
      await tx.employeeProfile.update({where:{id:profile.id},data:{headline:target.title,desiredPosition:target.title}});
      const updated=await employee.forJob(profile.id,target.id);
      assert.ok(updated?.insights.evidence.some(e=>e.kind==='ROLE'&&e.status==='MET'),'profile edit invalidates evaluator cache');
      assert.notStrictEqual(original,updated);
      const role=await tx.jobTitle.findUniqueOrThrow({where:{id:target.jobTitleId!}});
      await tx.jobTitle.update({where:{id:role.id},data:{name:'Temporary new identity',nameId:null,nameUz:null,nameRu:null,normalizedKey:'temporary-new-identity'}});
      await tx.jobTitleAlias.deleteMany({where:{jobTitleId:role.id}});
      const afterCatalog=await employee.forJob(profile.id,target.id);
      assert.notStrictEqual(afterCatalog,updated,'catalog changes invalidate identity cache');
      await tx.jobPost.update({where:{id:target.id},data:{experienceYearsMin:49}});
      const afterJob=await employee.forJob(profile.id,target.id);
      assert.notStrictEqual(afterJob,afterCatalog,'job edits invalidate evaluator cache');
      assert.ok(afterJob?.insights.evidence.some(e=>e.kind==='EXPERIENCE'&&e.label==='49'));
      const language=await tx.jobPostLanguage.findFirst({where:{jobPostId:target.id}});
      if(language){
        await tx.jobPostLanguage.update({where:{id:language.id},data:{provenance:'EMPLOYER_CONFIRMED',minLevel:'NATIVE'}});
        const afterLanguage=await employee.forJob(profile.id,target.id);
        assert.notStrictEqual(afterLanguage,afterJob,'requirement relation edits invalidate cache');
        assert.ok(afterLanguage?.insights.evidence.some(e=>e.evidenceRefs.includes(`jobLanguage:${language.id}`)&&e.code!=='UNVERIFIED_REQUIREMENT'));
      }
      throw rollback;
    },{timeout:60000});}catch(error){if(error!==rollback)throw error;}
    const after=await Promise.all([db.jobPost.count(),db.application.count(),db.employeeProfile.count(),db.jobTitle.count(),db.jobPostLanguage.count()]);
    assert.deepEqual(after,before);
    const report={version:'employee-evidence-v2',database:'isolated local copy',pairs,profiles:profiles.length,jobs:jobs.length,groups,
      pagination:true,anonymousCompanyMasking:true,cacheInvalidation:true,adminMetadataAndAliases:true,businessCountsPreserved:true,
      humanValidated:false,ndcgAt10:null,precisionAt10:null};
    const output=path.join(root,'output/matching');fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'employee-v2-local-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await db.$disconnect();}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
