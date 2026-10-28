import assert from 'node:assert/strict';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from './matching.service';
import { ProfilesService } from '../profiles/profiles.service';
import { ApplicationsService } from '../applications/applications.service';
import { CandidateAccessService } from '../profiles/candidate-access.service';
import { BenefitsService } from '../benefits/benefits.service';
import type { AuthUser } from '../common/auth.decorators';

/** Called only by the disposable HR harness; never reads root .env. */
export async function runRecruiterMatchingSuite(db:PrismaService,benefits:BenefitsService){
  assert.equal(process.env.DATABASE_URL,process.env.HR_TEST_DATABASE_URL);
  assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/talentio_hr_it_\d+$/);
  const hr=await db.user.create({data:{fullName:'Ranking HR',role:'RECRUITER'}}) as AuthUser;
  const outsider=await db.user.create({data:{fullName:'Ranking outsider',role:'RECRUITER'}}) as AuthUser;
  const company=await db.company.create({data:{name:'Ranking fixture company',slug:'ranking-fixture-company',members:{create:{userId:hr.id,role:'OWNER'}}}});
  const foreign=await db.company.create({data:{name:'Foreign ranking company',slug:'foreign-ranking-company',members:{create:{userId:outsider.id,role:'OWNER'}}}});
  hr.memberships=[{companyId:company.id,role:'OWNER'}];outsider.memberships=[{companyId:foreign.id,role:'OWNER'}];
  const companies={assertMember:async(user:AuthUser,id:string)=>({company:await benefits.member(user,id)})};
  const matching=new MatchingService(db), access=new CandidateAccessService(db);
  const profiles=new ProfilesService(db,{} as never,companies as never,matching,{} as never,{getPresence:async()=>({}),getOne:async()=>null} as never,{} as never,null,access);
  const applications=new ApplicationsService(db,{} as never,companies as never,matching,{create:async()=>{}} as never,{} as never);
  const role=await db.jobTitle.create({data:{name:'Fixture occupation',nameId:'Pekerjaan uji',nameUz:'Sinov kasbi',normalizedKey:'fixture-occupation',slug:'fixture-occupation',aliases:{create:{alias:'FO',aliasKey:'fo'}}}});
  const skill=await db.skill.create({data:{name:'Fixture task competency',slug:'fixture-task-competency',normalizedKey:'fixture-task-competency'}});
  const job=await db.jobPost.create({data:{companyId:company.id,title:role.name,jobTitleId:role.id,description:'A synthetic occupation with an explicit task requirement.',status:'PUBLISHED',publishedAt:new Date(),jobSkills:{create:{skillId:skill.id,isRequired:true,weight:1}}}});
  const draft=await db.jobPost.create({data:{companyId:company.id,title:role.name,description:'Draft fixture with no publication.'}});
  // The best profile is older than a full scan batch and lexically last by ID.
  for(let n=0;n<106;n++){
    await db.user.create({data:{id:'hr-rank-user-'+n,fullName:'Ranking fixture '+n,role:'EMPLOYEE',isBanned:n===103,employeeProfile:{create:{id:'hr-rank-profile-'+String(n).padStart(3,'0'),headline:n===105?'FO':'Unrelated fixture occupation',visibility:n===104?'PRIVATE':'PUBLIC',updatedAt:new Date(n===105?'2020-01-01':'2026-10-25'),...(n===105?{skills:{create:{skillId:skill.id,level:'BEGINNER',levelSource:'CV_DEFAULT'}}}:{})}}}});
  }
  const resume=await db.resume.create({data:{profileId:'hr-rank-profile-105',title:'Shared fixture CV',fileKey:'synthetic/private-ranking-cv.pdf'}});
  await db.employeeProfile.update({where:{id:'hr-rank-profile-105'},data:{databaseCvEnabled:true,databaseResumeId:resume.id,updatedAt:new Date('2020-01-01')}});
  const input={companyId:company.id,matchJobId:job.id,q:'Ranking fixture',sort:'match' as const,page:1,limit:10,excludeApplied:true,locale:'en' as const};
  const page=await profiles.searchCandidates(hr,input);
  assert.equal(page.total,104);assert.equal(page.items[0].id,'hr-rank-profile-105','Ranking happens before pagination across all batches');
  assert.equal(page.items[0].matchScore,100);assert.equal((page.items[0].matchBreakdown as any).version,'hr-evidence-v1');
  assert.ok(!page.items.some(row=>['hr-rank-profile-103','hr-rank-profile-104'].includes(row.id)));
  assert.equal(page.items[0].canReadCv,true,'Visible CV action follows current permission and file availability');
  assert.equal(page.items[1].canReadCv,false,'A profile without a shared CV has no file action');
  assert.doesNotMatch(JSON.stringify(page.items),/fileKey|private-ranking-cv|databaseResume":/,'List exposes only availability, never a storage key');
  await db.employeeProfile.update({where:{id:'hr-rank-profile-105'},data:{databaseCvEnabled:false}});
  assert.equal((await profiles.searchCandidates(hr,input)).items[0].canReadCv,false,'Revocation removes the list action');
  await db.employeeProfile.update({where:{id:'hr-rank-profile-105'},data:{databaseCvEnabled:true,updatedAt:new Date('2020-01-01')}});
  await db.resume.update({where:{id:resume.id},data:{deletedAt:new Date()}});
  assert.equal((await profiles.searchCandidates(hr,input)).items[0].canReadCv,false,'A deleted file is unavailable');
  await db.resume.update({where:{id:resume.id},data:{deletedAt:null}});
  await assert.rejects(()=>profiles.searchCandidates(outsider,input));
  await assert.rejects(()=>profiles.searchCandidates(hr,{...input,companyId:foreign.id}));
  await assert.rejects(()=>profiles.searchCandidates(hr,{...input,matchJobId:draft.id}));
  const detail=await profiles.getCandidateProfile(hr,'hr-rank-profile-105',job.id,'en',company.id);
  assert.equal((detail.match as any).total,page.items[0].matchScore,'Detail and search use identical evaluator');
  const strong=await db.application.create({data:{jobPostId:job.id,profileId:'hr-rank-profile-105',matchScore:1,matchBreakdown:{version:'legacy',total:1},createdAt:new Date('2020-01-01')}});
  const weak=await db.application.create({data:{jobPostId:job.id,profileId:'hr-rank-profile-000',matchScore:99,matchBreakdown:{version:'legacy',total:99}}});
  const ranked=await applications.searchForJob(hr,job.id,{page:1,limit:1,sort:'match'},'en');
  assert.equal(ranked.total,2);assert.equal(ranked.items[0].id,strong.id);assert.equal(ranked.items[0].matchScore,100);
  assert.equal(ranked.items[0].matchSnapshot.score,1,'Historical snapshot retained separately');
  const latest=await applications.searchForJob(hr,job.id,{page:1,limit:1,sort:'newest',minMatch:0},'en');
  assert.equal(latest.items[0].id,weak.id,'Explicit newest remains newest even with match filter');
  const filtered=await applications.searchForJob(hr,job.id,{page:1,limit:10,sort:'match',minMatch:90},'en');
  assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,strong.id,'Minimum match uses live evidence, not old snapshot');
  const pool=await profiles.searchCandidates(hr,input);assert.equal(pool.total,102);assert.ok(!pool.items.some(row=>row.id==='hr-rank-profile-105'),'Applicants excluded from database pool');
  await db.profileSkill.deleteMany({where:{profileId:'hr-rank-profile-105'}});
  const changed=await applications.getForJob(hr,job.id,strong.id,'en');
  assert.ok(changed.matchScore!<100,'Profile edit invalidates current evaluation without stale cache');
  assert.equal((await db.application.findUniqueOrThrow({where:{id:strong.id}})).matchScore,1,'Reading current score never rewrites history');
  await db.profileSkill.create({data:{profileId:'hr-rank-profile-105',skillId:skill.id,level:'BEGINNER'}});
  await db.employeeProfile.update({where:{id:'hr-rank-profile-001'},data:{skills:{create:{skillId:skill.id,level:'INTERMEDIATE'}}}});
  const candidate=await db.user.findUniqueOrThrow({where:{id:'hr-rank-user-1'}}) as AuthUser;
  const created=await applications.apply(candidate,job.id);
  const stored=await db.application.findUniqueOrThrow({where:{id:created.id}});
  assert.equal((stored.matchBreakdown as any).version,'hr-evidence-v1','New application snapshot uses new evaluator');
  await db.company.update({where:{id:company.id},data:{isBanned:true}});
  await assert.rejects(()=>profiles.searchCandidates(hr,input));
  console.log('Recruiter DB regression passed: full-pool ranking, live/snapshot separation, fresh profile updates, job context, pagination, privacy and company guards.');
}
