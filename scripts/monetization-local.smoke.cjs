// Actual service integration against a NEW, isolated local PostgreSQL database.
// No fixture, seed, migration or deletion runs against the application's database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(repo, 'apps/api/package.json'));
apiRequire('reflect-metadata');
const { PrismaClient } = apiRequire('@prisma/client');
const { ConfigService } = apiRequire('@nestjs/config');
const ts = apiRequire('typescript');
const dotenv = createRequire(apiRequire.resolve('@nestjs/config'))('dotenv');
const configured = new URL(dotenv.parse(fs.readFileSync(path.join(repo, '.env'))).DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(configured.hostname), 'Only local PostgreSQL is allowed');
const databaseName = 'jt_monetization_audit_' + Date.now().toString(36);
assert.match(databaseName, /^jt_monetization_audit_[a-z0-9]+$/);
const target = new URL(configured);
target.pathname = '/' + databaseName;
assert.notEqual(target.pathname, configured.pathname);
const management = new URL(configured);
management.pathname = '/postgres';
const adminDb = new PrismaClient({ datasources: { db: { url: management.href } } });
const db = new PrismaClient({ datasources: { db: { url: target.href } } });
const load = (name) => apiRequire(path.join(repo, 'apps/api/dist', name));
const noOp = async () => undefined;
const storage = {
  keyFromPublicUrl: () => null,
  getPresignedGetUrl: async (key) => 'http://127.0.0.1/isolated/' + key,
  delete: noOp,
  putObject: async (key) => ({ key, url: 'http://127.0.0.1/isolated/' + key }),
  publicUrlForKey: (key) => 'http://127.0.0.1/isolated/' + key,
};
const mail = { send: noOp };
const notifications = { create: noOp };
const search = { enabled: false, syncJob: noOp, syncCompanyJobs: noOp, searchJobIds: async () => null, reindexInBackground: noOp };
const telegram = { announceJob: noOp };
const presence = { getOne: async () => null, getMany: async () => ({}), getPresence: async () => ({}) };
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function denied(run, statuses) {
  await assert.rejects(run, (error) => statuses.includes(error.getStatus?.()));
}

async function runSeedWithLocalStorageStub() {
  // Execute the real seed, substituting only external blob storage and Prisma's
  // target. The schema/data operations are real and confined to the new DB.
  const seedPath = path.join(repo, 'apps/api/prisma/seed.ts');
  const js = ts.transpileModule(fs.readFileSync(seedPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  let failed;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const seedDb = new Proxy(db, { get(client, key) {
    if (key === '$disconnect') return async () => { finish(); };
    const value = client[key];
    return typeof value === 'function' ? value.bind(client) : value;
  } });
  vm.runInNewContext(js, {
    exports: {},
    require(name) {
      if (name === '@prisma/client') return { ...apiRequire(name), PrismaClient: class { constructor() { return seedDb; } } };
      if (name === '../src/common/demo-logo-storage') return { createDemoLogoUploaderFromEnv: () => storage };
      if (name.startsWith('../src/')) return load(name.slice('../src/'.length) + '.js');
      return apiRequire(name);
    },
    console: { log() {}, warn() {}, error(error) { failed = error; } },
    process: { env: {}, exit(code) { failed ||= new Error('Seed exited ' + code); } },
    Buffer, URL, Date, setTimeout, clearTimeout,
  }, { filename: seedPath });
  await finished;
  if (failed) throw failed;
}

async function main() {
  await adminDb.$executeRawUnsafe('CREATE DATABASE "' + databaseName + '"');
  const schema = spawnSync(process.execPath, [apiRequire.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(repo, 'apps/api/prisma/schema.prisma')], {
    cwd: repo, env: { ...process.env, DATABASE_URL: target.href }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(schema.status, 0, 'Cannot prepare isolated schema: ' + schema.stderr);
  console.log('Isolated database: ' + databaseName);

  await check('seed/startup create no packages, payments, product catalogs or demo jobs', async () => {
    // Seed legitimately requires a geographic dataset. These are test geography
    // fixtures, never product catalog rows or data in the application DB.
    const country = await db.country.create({ data: { iso2: 'UZ', iso3: 'UZB', phoneCode: '+998', name: 'Uzbekistan', slug: 'uzbekistan' } });
    const province = await db.province.create({ data: { name: 'Test province', slug: 'test-province', countryId: country.id } });
    const seed = fs.readFileSync(path.join(repo, 'apps/api/prisma/seed.ts'), 'utf8');
    const slugs = new Set([...seed.matchAll(/city: '([a-z-]+)'/g)].map((match) => match[1]));
    for (const slug of slugs) await db.city.create({ data: { name: slug, slug, provinceId: province.id, kind: 'CITY' } });
    await runSeedWithLocalStorageStub();
    const { EgiHospitalityDemoBackfillService } = load('meta/egi-hospitality-demo-backfill.service.js');
    const { JobLanguageBackfillService } = load('meta/job-language-backfill.service.js');
    await new EgiHospitalityDemoBackfillService(db, storage).onApplicationBootstrap();
    await new JobLanguageBackfillService(db).onApplicationBootstrap();
    assert.equal(await db.subscription.count(), 0);
    assert.equal(await db.payment.count(), 0);
    assert.equal(await db.jobPost.count(), 0);
    assert.equal(await db.application.count(), 0);
    for (const catalog of ['jobTitle', 'skill', 'language', 'benefit', 'jobCategory', 'industry', 'industryGroup']) assert.equal(await db[catalog].count(), 0, catalog);
    assert.equal(await db.featureFlag.count({ where: { key: 'hot_jobs' } }), 0);
  });

  // Any accidental commercial lookup/write by the actual services now fails.
  const coreDb = new Proxy(db, { get(client, key) {
    if (key === 'subscription' || key === 'payment') throw new Error('Core service accessed monetization: ' + String(key));
    const value = client[key];
    return typeof value === 'function' ? value.bind(client) : value;
  } });
  const { CompaniesService } = load('companies/companies.service.js');
  const { AuthService } = load('auth/auth.service.js');
  const { JobsService } = load('jobs/jobs.service.js');
  const { MatchingService } = load('matching/matching.service.js');
  const { ProfilesService } = load('profiles/profiles.service.js');
  const { ChatService } = load('chat/chat.service.js');
  const { ApplicationsService } = load('applications/applications.service.js');
  const config = new ConfigService({});
  const companies = new CompaniesService(coreDb, storage, {}, mail, config, search);
  const auth = new AuthService(coreDb, { signAsync: async () => 'isolated-token' }, config, mail, storage, companies, {});
  const matching = new MatchingService(coreDb);
  const jobs = new JobsService(coreDb, companies, matching, notifications, search, telegram);
  const profiles = new ProfilesService(coreDb, storage, companies, matching, {}, presence, {}, null);
  const chat = new ChatService(coreDb, presence, notifications, telegram);
  const applications = new ApplicationsService(coreDb, storage, companies, matching, notifications, mail);
  const actors = [];
  const ctx = (session) => ({ ...session.user, memberships: session.user.memberships || [] });
  for (const suffix of ['missing', 'free', 'standard', 'premium', 'vip', 'expired']) {
    const session = await auth.register({ email: suffix + '@isolated.test', password: 'IsolatedTest!2026', fullName: 'Isolated ' + suffix, role: 'RECRUITER', companyName: 'Isolated ' + suffix });
    actors.push(ctx(session));
  }
  const employee = ctx(await auth.register({ email: 'candidate@isolated.test', password: 'IsolatedTest!2026', fullName: 'Isolated Candidate', role: 'EMPLOYEE' }));
  const candidate = await db.employeeProfile.update({ where: { userId: employee.id }, data: { visibility: 'PUBLIC', phone: '+998901234567' } });
  await check('registrations and login work without subscriptions', async () => {
    assert.equal(await db.subscription.count(), 0);
    const session = await auth.login('missing@isolated.test', 'IsolatedTest!2026', 'RECRUITER');
    assert.equal(session.user.id, actors[0].id);
  });
  for (let index = 1; index < actors.length; index++) await db.subscription.create({ data: {
    companyId: actors[index].memberships[0].companyId, plan: ['FREE', 'STANDARD', 'PREMIUM', 'VIP', 'VIP'][index - 1],
    status: index === 5 ? 'PAST_DUE' : 'ACTIVE', endsAt: index === 5 ? new Date(0) : null,
  } });
  const subscriptionBefore = await db.subscription.findMany({ orderBy: { id: 'asc' } });
  const postings = [];
  await check('missing, Free, Standard, Premium, VIP and expired subscriptions have identical core access', async () => {
    for (const [index, actor] of actors.entries()) {
      const companyId = actor.memberships[0].companyId;
      const drafts = [];
      for (let n = 0; n < 4; n++) drafts.push(await jobs.create(actor, companyId, {
        title: `Isolated Role ${index} ${n}`, description: `Unique position ${index}/${n}. Responsibilities include collaboration, delivery and coordination for this specific role.`, workMode: 'REMOTE', locale: 'en',
      }));
      await Promise.all(drafts.map((job) => jobs.changeStatus(actor, job.id, 'PUBLISHED')));
      assert.equal(await db.jobPost.count({ where: { companyId, status: 'PUBLISHED' } }), 4);
      await jobs.changeStatus(actor, drafts[0].id, 'PAUSED');
      await jobs.changeStatus(actor, drafts[0].id, 'PUBLISHED');
      assert.equal((await profiles.revealCandidateContact(actor, candidate.id)).phone, candidate.phone);
      assert.equal((await profiles.getCandidateProfile(actor, candidate.id)).contactsBlurred, false);
      const result = await profiles.searchCandidates(actor, { page: 1, limit: 12, locale: 'en' });
      assert.equal(result.limited, false);
      assert.ok(result.items.some((row) => row.id === candidate.id));
      const conversation = await chat.startConversation(actor, employee.id, { companyId });
      assert.equal(conversation.isColdOutreach, true);
      postings.push(drafts[0]);
    }
  });
  await check('publication works above the former highest limit of 50', async () => {
    const actor = actors[0], companyId = actor.memberships[0].companyId;
    await db.jobPost.createMany({ data: Array.from({ length: 50 }, (_, n) => ({ companyId, title: 'Isolated fixture ' + n, description: 'Separate publication count fixture ' + n, status: 'PUBLISHED', workMode: 'REMOTE' })) });
    const draft = await jobs.create(actor, companyId, { title: 'Isolated Uncapped Publication', description: 'This distinct role confirms publication beyond the former highest commercial ceiling.', workMode: 'REMOTE' });
    await jobs.changeStatus(actor, draft.id, 'PUBLISHED');
    assert.equal(await db.jobPost.count({ where: { companyId, status: 'PUBLISHED' } }), 55);
  });
  await check('cold chat has no former 20/50 per-day commercial ceiling', async () => {
    const actor = actors[0], companyId = actor.memberships[0].companyId;
    const peers = await db.user.findMany({ where: { role: 'EMPLOYEE', id: { not: employee.id } }, take: 50 });
    assert.equal(peers.length, 50);
    await db.conversation.createMany({ data: peers.map((peer) => ({ userAId: actor.id, userBId: peer.id, companyId, initiatedBy: actor.id, isColdOutreach: true })) });
    const conversation = await chat.startConversation(actor, employee.id, { jobPostId: postings[0].id });
    assert.equal(conversation.isColdOutreach, true);
    assert.ok(await db.conversation.count({ where: { companyId, initiatedBy: actor.id, isColdOutreach: true } }) > 50);
  });
  await check('legacy boosts and paid filters have no discovery effect and leave history untouched', async () => {
    const job = postings[0];
    await db.jobPost.update({ where: { id: job.id }, data: { boostWeight: 99, boostUntil: new Date(Date.now() + 86400_000) } });
    const query = { page: 1, limit: 50, sort: 'newest', locale: 'en' };
    const normal = await jobs.search(query), legacy = await jobs.search({ ...query, hotOnly: true });
    assert.deepEqual(legacy.items.map((row) => row.id), normal.items.map((row) => row.id));
    for (const row of legacy.items) { assert.equal(row.isHot, false); assert.equal(row.boostWeight, 0); assert.equal(row.boostUntil, null); }
    const directory = { page: 1, limit: 48, sort: 'name' };
    assert.deepEqual(await companies.browse({ ...directory, plan: 'VIP' }), await companies.browse(directory));
    assert.equal((await db.jobPost.findUnique({ where: { id: job.id } })).boostWeight, 99);
    assert.deepEqual(await db.subscription.findMany({ orderBy: { id: 'asc' } }), subscriptionBefore);
    assert.equal(await db.payment.count(), 0);
  });
  await check('private candidates, nonmembers, banned companies and unauthorized CV downloads remain blocked', async () => {
    const actor = actors[0], job = postings[0];
    await db.employeeProfile.update({ where: { id: candidate.id }, data: { visibility: 'PRIVATE' } });
    await denied(() => profiles.revealCandidateContact(actor, candidate.id), [404]);
    // A distinct candidate ensures an earlier conversation cannot bypass privacy.
    const privateSession = ctx(await auth.register({ email: 'private@isolated.test', password: 'IsolatedTest!2026', fullName: 'Private Candidate', role: 'EMPLOYEE' }));
    await db.employeeProfile.update({ where: { userId: privateSession.id }, data: { visibility: 'PRIVATE' } });
    await denied(() => chat.startConversation(actor, privateSession.id), [404]);
    await denied(() => jobs.changeStatus(actors[1], job.id, 'PAUSED'), [403]);
    await denied(() => chat.startConversation({ ...actor, memberships: [] }, employee.id), [403]);
    const resume = await db.resume.create({ data: { profileId: candidate.id, title: 'Isolated CV', fileKey: 'isolated-cv.pdf', isPrimary: true } });
    await denied(() => profiles.downloadResume(actor, resume.id), [403]);
    const application = await applications.apply(employee, job.id, undefined, undefined, resume.id);
    assert.ok((await profiles.downloadResume(actor, resume.id)).url);
    assert.equal((await profiles.revealCandidateContact(actor, candidate.id)).phone, candidate.phone);
    await applications.updateStatus(actor, application.id, 'IN_REVIEW');
    await applications.updateStatus(actor, application.id, 'INTERVIEW');
    const interview = await applications.scheduleInterview(actor, application.id, { scheduledAt: new Date(Date.now() + 86400_000).toISOString(), durationMins: 30, meetingUrl: 'https://example.test/meeting' });
    assert.ok(interview.id);
    await db.company.update({ where: { id: actor.memberships[0].companyId }, data: { isBanned: true } });
    await denied(() => profiles.revealCandidateContact(actor, candidate.id), [404, 403]);
    await denied(() => chat.startConversation(actor, privateSession.id), [404]);
    await denied(() => jobs.changeStatus(actor, job.id, 'PAUSED'), [403]);
  });
  await check('contact anti-scraping quota and account erasure remain effective', async () => {
    const actor = actors[1];
    await db.employeeProfile.update({ where: { id: candidate.id }, data: { visibility: 'PUBLIC' } });
    await db.auditLog.createMany({ data: Array.from({ length: 30 }, () => ({ actorId: actor.id, action: 'CANDIDATE_CONTACT_REVEAL', entityType: 'EmployeeProfile', entityId: candidate.id })) });
    await denied(() => profiles.revealCandidateContact(actor, candidate.id), [429]);
    const { UserErasureService } = load('users/user-erasure.service.js');
    const erasure = new UserErasureService(coreDb, storage);
    const result = await erasure.erase(employee.id);
    assert.equal(result.ok, true);
    const account = await db.user.findUnique({ where: { id: employee.id } });
    assert.ok(account.anonymizedAt);
    await denied(() => profiles.revealCandidateContact(actors[2], candidate.id), [404]);
    await denied(() => erasure.erase(actors[2].id), [409, 400]);
  });
  assert.deepEqual(await db.subscription.findMany({ orderBy: { id: 'asc' } }), subscriptionBefore);
  console.log(`PASS ${passed} isolated integration groups. Application database unchanged; isolated DB retained for inspection.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); await adminDb.$disconnect(); });
