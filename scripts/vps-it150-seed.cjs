/* Explicit one-off Indonesia seed. Never imported by application startup. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const apiRoot = path.resolve(process.env.TALENTIO_API_ROOT || path.join(__dirname, '../apps/api'));
const req = createRequire(path.join(apiRoot, 'package.json'));
if (process.env.VPS_SEED_SOURCE === 'true') req('tsx/cjs');
const runtime = process.env.VPS_SEED_SOURCE === 'true' ? 'src' : 'dist';
const {PrismaClient, Prisma} = req('@prisma/client');
const bcrypt = req('bcryptjs');
const {canonical, sha256, readSnapshot, TABLES, quote} = req(path.join(apiRoot, runtime, 'catalog-sync/catalog-sync'));
const {jobFingerprint, contentHash} = req(path.join(apiRoot, runtime, 'common/dedupe'));
const {BenefitsService} = req(path.join(apiRoot, runtime, 'benefits/benefits.service'));
const CATALOG_SHA = 'ec770367a292c3d8231847c02273263e5015cfeb0feb6d0d0988e08b39ddaacb';
const BATCH = 'indonesia-it150-v1';
const MARKER = 'vps_seed_' + BATCH;
const CORE = ['User','Company','JobPost','EmployeeProfile','Resume','Application','Conversation','Payment','JobPurchaseOrder'];
const id = (type, key) => `it150_${type}_${key}`;
const countBy = (rows, field) => rows.reduce((out, row) => (out[row[field]]=(out[row[field]]||0)+1, out), {});

function guardTarget(env = process.env) {
  const url = new URL(env.DATABASE_URL || '');
  assert.equal(env.DEPLOYMENT_TARGET, 'indonesia-vps', 'Wrong deployment target');
  assert.equal(env.CATALOG_SOURCE_MODE, 'database', 'Catalogs must be database-managed');
  assert.equal(url.pathname, '/talentio', 'Only database talentio is allowed');
  assert.ok(['localhost','127.0.0.1','host.docker.internal'].includes(url.hostname), 'Unexpected database host');
}
function validateManifest(m) {
  assert.equal(m.version,1); assert.equal(m.batch,BATCH); assert.equal(m.catalogSha256,CATALOG_SHA);
  assert.equal(m.companies.length,3); assert.equal(m.jobs.length,150);
  assert.equal(new Set(m.companies.map(c=>c.key)).size,3);
  assert.equal(new Set(m.companies.map(c=>c.slug)).size,3);
  assert.equal(new Set(m.companies.map(c=>c.email)).size,3);
  assert.equal(new Set(m.jobs.map(j=>j.key)).size,150);
  assert.equal(new Set(m.jobs.map(j=>contentHash(j.description))).size,150, 'Duplicate descriptions');
  for (const c of m.companies) {
    assert.match(c.email,/^hr\.[a-z]+@example\.test$/); assert.equal(c.locale,'id');
    assert.ok(c.description.includes('fiktif')); assert.equal(c.industrySlug,'it');
    assert.match(c.logoSvg,/^<svg /); assert.ok(!/<script|https?:|on\w+=|<image|href=/i.test(c.logoSvg.replace('xmlns="http://www.w3.org/2000/svg"','')));
    const jobs=m.jobs.filter(j=>j.companyKey===c.key); assert.equal(jobs.length,50);
    assert.deepEqual(countBy(jobs,'package'),{FREE:20,STANDARD:20,PREMIUM:10});
    assert.deepEqual(countBy(jobs,'experienceLevel'),{JUNIOR:10,MIDDLE:25,SENIOR:12,LEAD:3});
    assert.deepEqual(countBy(jobs,'workMode'),{ONSITE:15,HYBRID:25,REMOTE:10});
    assert.deepEqual(countBy(jobs,'group'),{Frontend:8,Backend:10,Fullstack:8,AI:8,Data:6,DevOps:6,QA:4});
    assert.equal(Object.keys(countBy(jobs,'citySlug')).length,10);
    assert.ok(Object.values(countBy(jobs,'citySlug')).every(n=>n===5));
    assert.equal(new Set(jobs.map(j=>jobFingerprint({title:j.title,cityId:j.citySlug,workMode:j.workMode}))).size,50);
  }
  for (const j of m.jobs) {
    assert.ok(m.companies.some(c=>c.key===j.companyKey));
    assert.equal(j.locale,'id'); assert.equal(j.countryIso2,'ID'); assert.equal(j.categorySlug,'it-software');
    assert.equal(j.currency,'IDR'); assert.equal(j.salaryPeriod,'MONTHLY'); assert.equal(j.employmentType,'FULL_TIME');
    assert.ok(j.salaryMin>0 && j.salaryMax>j.salaryMin); assert.ok(j.experienceYearsMin>0);
    const words=j.description.trim().split(/\s+/).length; assert.ok(words>=300 && words<=500,j.key+' word count '+words);
    for(const heading of ['Tentang tim dan produk','Tujuan dan tanggung jawab','Kualifikasi wajib','Nilai tambah','Pengaturan kerja dan benefit','Proses seleksi']) assert.ok(j.description.includes(heading));
    assert.ok(j.description.includes('bahasa Indonesia')); assert.equal(j.screeningQuestions.length,2);
    assert.ok(j.screeningQuestions.every(q=>q.length>=30));
    assert.ok(j.skillSlugs.length>=5 && j.skillSlugs.length<=8); assert.equal(new Set(j.skillSlugs).size,j.skillSlugs.length);
  }
}
async function tableNames(tx) {
  return (await tx.$queryRawUnsafe(`SELECT tablename::text AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`)).map(r=>r.name);
}
async function state(tx, tables) {
  const catalog = await readSnapshot(tx,'target'); assert.equal(catalog.sha256,CATALOG_SHA,'Catalog fingerprint mismatch');
  const hashes={catalog:catalog.sha256};
  for (const name of tables.filter(t=>!TABLES.includes(t))) {
    const rows=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS data FROM public.${quote(name)} t`);
    hashes[name]=sha256(rows.map(r=>canonical(r.data)).sort());
  }
  return sha256(hashes);
}
async function resolve(tx,m) {
  const maps={};
  for(const [table,field] of [['country','iso2'],['city','slug'],['jobTitle','slug'],['industry','slug'],['jobCategory','slug'],['skill','slug'],['benefit','slug'],['language','code']]) {
    maps[table]=new Map((await tx[table].findMany({where:{archivedAt:null}})).map(r=>[r[field],r]));
  }
  const get=(table,key)=>{const r=maps[table].get(key);assert.ok(r,`Missing active ${table}: ${key}`);return r;};
  const country=get('country','ID');assert.equal(country.isActive,true);
  const provinces=new Map((await tx.province.findMany({where:{countryId:country.id,archivedAt:null}})).map(r=>[r.id,r]));
  const city=slug=>{const r=get('city',slug);assert.ok(provinces.has(r.provinceId));assert.equal(r.kind,'CITY');return r;};
  for(const c of m.companies) {city(c.hqCitySlug);get('industry',c.industrySlug);}
  for(const j of m.jobs) {
    city(j.citySlug);assert.equal(get('jobTitle',j.jobTitleSlug).name,j.title);get('jobCategory',j.categorySlug);
    j.skillSlugs.forEach(s=>get('skill',s));j.benefitSlugs.forEach(s=>get('benefit',s));j.languages.forEach(l=>get('language',l.code));
  }
  const policies={};
  for(const code of ['FREE','STANDARD','PREMIUM']) {
    const row=await tx.packagePolicy.findFirstOrThrow({where:{code},orderBy:{version:'desc'}});
    const p=row.settings;assert.equal(p.durationDays,30);assert.ok(p.boostDays>=0 && p.featuredDays>=0 && p.visibility>=1);
    policies[code]=row;
  }
  for(const key of ['hr_packages','hr_rollout','hr_promotions']) assert.equal((await tx.featureFlag.findUniqueOrThrow({where:{key}})).enabled,true);
  return {get,city,country,policies};
}
async function existingBatch(tx,m,manifestSha) {
  const marker=await tx.featureFlag.findUnique({where:{key:MARKER}});
  if(!marker) return null;
  assert.equal(marker.payload.manifestSha,manifestSha,'Batch manifest changed');
  for(const c of m.companies) {
    assert.ok(await tx.company.findUnique({where:{id:id('company',c.key)}}),'Seed company removed; no automatic repair');
    assert.ok(await tx.user.findUnique({where:{id:id('hr',c.key)}}),'Seed HR removed; no automatic repair');
  }
  assert.equal(await tx.jobPost.count({where:{id:{in:m.jobs.map(j=>id('job',j.key))}}}),150,'Seed jobs removed; no automatic repair');
  return marker.payload;
}
async function emptyGuard(tx,m) {
  for(const name of CORE) {
    const rows=await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM public.${quote(name)}`);
    assert.equal(rows[0].count,0,'Initial business data must be empty: '+name);
  }
  assert.equal(await tx.company.count({where:{slug:{in:m.companies.map(c=>c.slug)}}}),0);
  assert.equal(await tx.user.count({where:{email:{in:m.companies.map(c=>c.email)}}}),0);
}
async function verifyData(tx,m,strict=true) {
  const refs=await resolve(tx,m);const groups={};
  for(const c of m.companies) {
    const companyId=id('company',c.key),hrId=id('hr',c.key);
    const user=await tx.user.findUniqueOrThrow({where:{id:hrId}});
    assert.equal(user.role,'RECRUITER');assert.equal(user.email,c.email);assert.equal(user.locale,'id');
    assert.equal((await tx.companyMember.findUniqueOrThrow({where:{companyId_userId:{companyId,userId:hrId}}})).role,'OWNER');
    assert.equal((await tx.recruiterOnboarding.findUniqueOrThrow({where:{userId:hrId}})).status,'COMPLETE');
    const company=await tx.company.findUniqueOrThrow({where:{id:companyId}});assert.equal(company.slug,c.slug);
    if(strict) {assert.equal(company.description,c.description);assert.equal(company.name,c.name);assert.equal(company.cityId,refs.city(c.hqCitySlug).id);assert.equal(company.logoUrl,logoUrl(c));}
    const jobs=await tx.jobPost.findMany({where:{companyId},include:{benefit:true,jobSkills:true,benefits:true,jobLanguages:true,questions:true}});
    assert.equal(jobs.length,50);
    groups[c.key]={jobs:jobs.length,packages:countBy(jobs.map(j=>j.benefit),'code')};
    for(const j of m.jobs.filter(j=>j.companyKey===c.key)) {
      const row=jobs.find(r=>r.id===id('job',j.key));assert.ok(row);assert.equal(row.status,'PUBLISHED');
      if(!strict) continue;
      for(const f of ['title','description','locale','workMode','salaryMin','salaryMax','currency','salaryPeriod','experienceLevel','experienceYearsMin'])assert.equal(row[f],j[f],j.key+' '+f);
      assert.equal(row.countryId,refs.country.id);assert.equal(row.cityId,refs.city(j.citySlug).id);assert.equal(row.jobTitleId,refs.get('jobTitle',j.jobTitleSlug).id);
      assert.equal(row.fingerprint,jobFingerprint(row));assert.equal(row.contentHash,contentHash(j.description));
      assert.deepEqual(row.jobSkills.map(r=>r.skillId).sort(),j.skillSlugs.map(s=>refs.get('skill',s).id).sort());
      assert.deepEqual(row.benefits.map(r=>r.benefitId).sort(),j.benefitSlugs.map(s=>refs.get('benefit',s).id).sort());
      assert.deepEqual(row.questions.sort((a,b)=>a.sortOrder-b.sortOrder).map(q=>q.question),j.screeningQuestions);
      const b=row.benefit,p=refs.policies[j.package];assert.ok(b);assert.equal(b.code,j.package);assert.equal(b.highestCode,j.package);
      assert.equal(b.policyVersion,p.version);assert.ok(b.selectionConfirmedAt && b.startsAt && b.expiresAt);assert.equal(b.expiresAt-b.startsAt,p.settings.durationDays*86400000);
      assert.equal(b.boostGrantedSeconds,p.settings.boostDays*86400);assert.equal(b.featuredGrantedSeconds,p.settings.featuredDays*86400);
      assert.equal(await tx.boostEpisode.count({where:{benefitId:b.id}}),0);
      const period=await tx.jobPublicationPeriod.findUniqueOrThrow({where:{jobId_cycle:{jobId:row.id,cycle:1}}});assert.equal(period.code,j.package);
      assert.equal(period.expiresAt.getTime(),b.expiresAt.getTime());
    }
  }
  assert.equal((await readSnapshot(tx,'target')).sha256,CATALOG_SHA);
  return groups;
}
function logoKey(c) {return `public/seed/${BATCH}/${c.key}.svg`;}
function logoUrl(c) {return `https://api.cari-kerja.co.id/talentio/${logoKey(c)}`;}
async function execute({db,manifest:m,mode,plan,password,failAfter=0}) {
  guardTarget();validateManifest(m);const manifestSha=sha256(m);
  assert.ok(['dry-run','apply','verify'].includes(mode));
  if(mode==='apply') {assert.equal(plan?.manifestSha,manifestSha,'Manifest fingerprint changed');assert.match(plan?.targetSha||'',/^[a-f0-9]{64}$/);}
  return db.$transaction(async tx=>{
    if(mode!=='apply') await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const tables=await tableNames(tx);
    if(mode==='apply') {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '15s'");
      await tx.$executeRawUnsafe(`LOCK TABLE ${tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const refs=await resolve(tx,m), prior=await existingBatch(tx,m,manifestSha);
    if(prior) {
      if(mode==='verify') return {verified:true,manifestSha,groups:await verifyData(tx,m),appliedAt:prior.appliedAt};
      return {applied:false,replayed:true,manifestSha,changes:0,appliedAt:prior.appliedAt};
    }
    assert.notEqual(mode,'verify','Batch not applied');
    await emptyGuard(tx,m);const targetSha=await state(tx,tables);
    if(mode==='dry-run') return {version:1,batch:BATCH,manifestSha,targetSha,changes:{users:3,companies:3,jobs:150,packages:{FREE:60,STANDARD:60,PREMIUM:30}},catalogSha:CATALOG_SHA};
    assert.equal(plan.targetSha,targetSha,'Target changed after dry-run');
    assert.ok(typeof password==='string' && password.length>0,'Set VPS_SEED_HR_PASSWORD');
    const passwordHash=await bcrypt.hash(password,12),now=new Date();
    const benefitsService=new BenefitsService(tx,null);
    for(const c of m.companies) {
      const companyId=id('company',c.key),userId=id('hr',c.key);
      await tx.user.create({data:{id:userId,email:c.email,passwordHash,fullName:c.hrName,role:'RECRUITER',locale:'id',emailVerified:false}});
      await tx.company.create({data:{id:companyId,name:c.name,slug:c.slug,description:c.description,locale:'id',cityId:refs.city(c.hqCitySlug).id,industryId:refs.get('industry',c.industrySlug).id,size:c.size,logoUrl:logoUrl(c)}});
      await tx.companyMember.create({data:{id:id('member',c.key),companyId,userId,role:'OWNER'}});
      await tx.recruiterOnboarding.create({data:{userId,companyId,status:'COMPLETE',step:3,completedAt:now}});
    }
    let inserted=0;
    for(const j of m.jobs) {
      const jobId=id('job',j.key),companyId=id('company',j.companyKey),cityId=refs.city(j.citySlug).id;
      const policy=refs.policies[j.package];
      await tx.jobPost.create({data:{id:jobId,companyId,jobTitleId:refs.get('jobTitle',j.jobTitleSlug).id,title:j.title,description:j.description,locale:'id',
        countryId:refs.country.id,cityId,categoryId:refs.get('jobCategory',j.categorySlug).id,employmentType:j.employmentType,workMode:j.workMode,
        salaryMin:j.salaryMin,salaryMax:j.salaryMax,salaryPeriod:j.salaryPeriod,currency:j.currency,experienceLevel:j.experienceLevel,experienceYearsMin:j.experienceYearsMin,
        status:'DRAFT',fingerprint:jobFingerprint({title:j.title,cityId,workMode:j.workMode}),contentHash:contentHash(j.description)}});
      await tx.jobPostSkill.createMany({data:j.skillSlugs.map((s,n)=>({id:id('skill',j.key+'-'+n),jobPostId:jobId,skillId:refs.get('skill',s).id,isRequired:n<4,weight:n<3?1.5:1,minLevel:j.experienceLevel==='JUNIOR'?'BEGINNER':j.experienceLevel==='MIDDLE'?'INTERMEDIATE':'ADVANCED'}))});
      await tx.jobPostBenefit.createMany({data:j.benefitSlugs.map((s,n)=>({id:id('benefit',j.key+'-'+n),jobPostId:jobId,benefitId:refs.get('benefit',s).id}))});
      await tx.jobPostLanguage.createMany({data:j.languages.map((l,n)=>({id:id('language',j.key+'-'+n),jobPostId:jobId,languageId:refs.get('language',l.code).id,minLevel:l.minLevel,isRequired:l.isRequired,provenance:'EMPLOYER_CONFIRMED'}))});
      for(const [n,question] of j.screeningQuestions.entries()) {
        const q=await tx.jobQuestion.create({data:{id:id('question',j.key+'-'+n),jobPostId:jobId,question,type:'TEXT',isRequired:true,sortOrder:n}});
        await tx.jobQuestionVersion.create({data:{id:id('qversion',j.key+'-'+n),questionId:q.id,revision:1,snapshot:JSON.parse(JSON.stringify(q))}});
      }
      await tx.jobBenefit.create({data:{id:id('package',j.key),jobId,companyId,code:j.package,highestCode:j.package,policyVersion:policy.version,policySnapshot:policy.settings,selectionConfirmedAt:now}});
      // Use the real publication allocator for period, promotion and boost allowance.
      await benefitsService.publish(jobId,tx);
      const b=await tx.jobBenefit.findUniqueOrThrow({where:{jobId}});
      await tx.jobPost.update({where:{id:jobId},data:{status:'PUBLISHED',publishedAt:b.startsAt}});
      await tx.jobPackageGrant.create({data:{id:id('grant',j.key),benefitId:b.id,actorId:'seed-operator:'+BATCH,code:j.package,policyVersion:policy.version,reason:'ADMINISTRATIVE_SEED_ALLOCATION:'+BATCH,boostDeltaSeconds:b.boostGrantedSeconds,featuredDeltaSeconds:b.featuredGrantedSeconds}});
      if(failAfter && ++inserted===failAfter) throw new Error('Injected seed failure');
    }
    const groups=await verifyData(tx,m);
    for(const c of m.companies) {
      const user=await tx.user.findUniqueOrThrow({where:{id:id('hr',c.key)}});assert.ok(await bcrypt.compare(password,user.passwordHash));
    }
    const payload={manifestSha,appliedAt:now.toISOString(),groups};
    await tx.featureFlag.create({data:{key:MARKER,enabled:true,payload}});
    await tx.auditLog.create({data:{action:'VPS_IT150_SEED_APPLIED',entityType:'SeedBatch',entityId:BATCH,metadata:{...payload,allocation:'administrative; no payment collected'}}});
    return {applied:true,...payload};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:20000,timeout:180000});
}
async function main() {
  const [mode,file,planFile]=process.argv.slice(2);
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  const plan=planFile?JSON.parse(fs.readFileSync(planFile,'utf8')):undefined;
  const db=new PrismaClient();
  try {console.log(JSON.stringify(await execute({db,manifest,mode,plan,password:process.env.VPS_SEED_HR_PASSWORD})));}
  finally {await db.$disconnect();}
}
module.exports={execute,validateManifest,guardTarget,id,logoKey,logoUrl,BATCH,CATALOG_SHA};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
