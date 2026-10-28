import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitsService } from './benefits.service';
import { OperationsService } from './operations.service';
import { HrEventsService } from './hr-events.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { HrSupportService } from './hr-support.service';
import { JobsService } from '../jobs/jobs.service';
import { ApplicationsService } from '../applications/applications.service';
import { BulkCommsService } from '../bulk-comms/bulk-comms.service';
import { AuthUser } from '../common/auth.decorators';
import { JobsSearchService } from '../search/jobs-search.service';
import { rebuildJobsIndex } from '../search/jobs-index.sync';
import { DAY_MS, exposureLog, INITIAL_POLICIES } from './benefit-policy';
import { jobPostSchema } from '@job-talentio/shared';
import { ProfilesService } from '../profiles/profiles.service';
import { CandidateAccessService } from '../profiles/candidate-access.service';
import { AdminService } from '../admin/admin.service';
import { BenefitsWorker } from './benefits.worker';
import { runHrHttpSuite } from './hr-http.smoke';
import { safeApplication } from '../applications/application-payload';
import { runRecruiterMatchingSuite } from '../matching/recruiter-matching.integration.smoke';
import { runApplicantsKanbanSuite } from '../applications/applicants-kanban.integration.smoke';

async function main() {
  assert.equal(process.env.DATABASE_URL, process.env.HR_TEST_DATABASE_URL);
  const target = new URL(process.env.DATABASE_URL!);
  assert.match(target.pathname, /^\/talentio_hr_it_\d+$/);
  assert.equal(target.hostname, '127.0.0.1');
  const db = new PrismaService();
  await db.$connect();
  try {
    const operations = new OperationsService(db),
      benefits = new BenefitsService(db, operations),
      candidateAccess = new CandidateAccessService(db),
      events = new HrEventsService(
        db,
        benefits,
        new ConfigService({ JWT_SECRET: 'isolated-hr-integration-signing-key-2026' }),
      ),
      analytics = new HrAnalyticsService(db, benefits),
      support = new HrSupportService(db, benefits, operations);
    const actor = async (
      role: 'SUPER_ADMIN' | 'RECRUITER' | 'EMPLOYEE',
      name: string,
    ): Promise<AuthUser> => {
      const user = await db.user.create({
        data: { role, fullName: name, email: name.replaceAll(' ', '') + '@test.invalid' },
      });
      return { ...user, isBanned: false };
    };
    const admin = await actor('SUPER_ADMIN', 'Admin'),
      hr = await actor('RECRUITER', 'HR One'),
      hr2 = await actor('RECRUITER', 'HR Two'),
      outsider = await actor('RECRUITER', 'Outsider');
    const company = await db.company.create({
      data: {
        name: 'Isolated company',
        slug: 'isolated-company',
        members: {
          create: [
            { userId: hr.id, role: 'OWNER' },
            { userId: hr2.id, role: 'RECRUITER' },
          ],
        },
      },
    });
    const other = await db.company.create({
      data: {
        name: 'Other company',
        slug: 'other-company',
        members: { create: { userId: outsider.id, role: 'OWNER' } },
      },
    });
    hr.memberships = [{ companyId: company.id, role: 'OWNER' }];
    hr2.memberships = [{ companyId: company.id, role: 'RECRUITER' }];
    assert.equal(await benefits.enabled(), false);
    await benefits.rollout(admin, 'initial-rollout');
    await db.featureFlag.updateMany({
      where: { key: { in: ['hr_packages', 'hr_promotions', 'hr_analytics', 'hr_support'] } },
      data: { enabled: true },
    });
    const companies = {
      assertMember: async (user: AuthUser, id: string) => ({
        company: await benefits.member(user, id),
      }),
      assertOpen: (value: { anonymizedAt?: Date | null }) => {
        assert.equal(value.anonymizedAt, null);
      },
    };
    const matching = {
      compute: () => ({ total: 50 }),
      scoreInputs: async () => ({ total: 50 }),
      scoreProfilesAgainstJob: async (profiles: unknown[]) => profiles.map(()=>({total:50,positiveCore:true,evidenceCoverage:100,optionalScore:0})),
      computeForProfileAndJob: () => ({ total: 50 }),
      scoreProfileForJob: () => ({ total: 50 }),
    };
    const search = {
      syncJob: async () => {},
      enabled: false,
      rankedIds: async () => null,
      retryFailedSyncs: async () => {},
      reindexInBackground() {},
    };
    const jobs = new JobsService(
      db,
      companies as never,
      matching as never,
      { create: async () => {} } as never,
      search as never,
      { announceJob: async () => {} } as never,
      undefined,
      benefits,
      analytics,
    );
    const applications = new ApplicationsService(
      db,
      { assertObjectAvailable:async()=>{}, getPresignedGetUrl: async (key: string) => 'test:' + key } as never,
      companies as never,
      matching as never,
      { create: async () => {} } as never,
      {} as never,
      operations,
      events,
    );
    assert.equal(
      jobPostSchema.safeParse({ title: '   ', description: ' '.repeat(25) }).success,
      false,
    );
    const create = (title: string, description: string) =>
      jobs.create(hr, company.id, { title, description, workMode: 'REMOTE', skills: [] });
    const first = (await create(
      'Kitchen Coordinator',
      'Coordinate food preparation and kitchen safety across shifts.',
    ))!;
    const second = (await create(
      'Industrial Technician',
      'Maintain production machinery and ensure workplace safety standards.',
    ))!;
    const third = (await create(
      'Logistics Planner',
      'Manage transportation schedules and warehouse inventory delivery planning.',
    ))!;
    await assert.rejects(() =>
      jobs.create(hr, company.id, {
        title: 'Operations Auditor',
        description: 'Audit operating procedures and document compliance findings.',
        workMode: 'REMOTE',
        skills: [{ name: '<invalid>!' }],
      }),
    );
    assert.equal(
      await db.jobPost.count(),
      3,
      'Failed create must roll back the job and all relations',
    );
    const before = (await db.jobPost.findUniqueOrThrow({ where: { id: first.id } })).description;
    await assert.rejects(() =>
      jobs.update(hr, first.id, {
        description: 'Changed description that should be rolled back after invalid relations.',
        skills: [{ name: '<invalid>!' }],
      }),
    );
    assert.equal(
      (await db.jobPost.findUniqueOrThrow({ where: { id: first.id } })).description,
      before,
    );
    await assert.rejects(() =>
      benefits.grant(hr, first.id, 'STANDARD', 'Unauthorized grant', 'forbidden-grant'),
    );
    await benefits.grant(admin, first.id, 'STANDARD', 'Synthetic Standard grant', 'standard-first');
    assert.equal(await db.candidateCredit.count(), 0, 'Draft grants create no candidate quota');
    await benefits.grant(admin, second.id, 'STANDARD', 'Synthetic second grant', 'standard-second');
    await benefits.grant(admin, third.id, 'PREMIUM', 'Synthetic Premium grant', 'premium-third');
    for (const job of [first, second, third]) {
      await jobs.changeStatus(hr, job.id, 'PUBLISHED');
    }
    assert.equal(await db.candidateCredit.count(), 0, 'Publication creates no candidate quota');
    const promotion = await db.companyPromotion.findUniqueOrThrow({
      where: { companyId: company.id },
    });
    assert.equal(promotion.grantedSeconds, 44 * 86400);
    assert.ok(Math.abs(promotion.endsAt.getTime() - Date.now() - 44 * DAY_MS) < 10000);
    await jobs.changeStatus(hr, first.id, 'PAUSED');
    await jobs.changeStatus(hr, first.id, 'PUBLISHED');
    assert.equal(await db.candidateCredit.count(), 0, 'Reopening does not create candidate quotas');
    const candidate = await actor('EMPLOYEE', 'Candidate');
    const profile = await db.employeeProfile.create({
      data: { userId: candidate.id, visibility: 'PUBLIC' },
    });
    await assert.rejects(() => candidateAccess.assertAccess(hr, other.id, profile.id, 'CONTACT'));
    await assert.rejects(() => candidateAccess.assertAccess(hr, company.id, profile.id, 'CV'));
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        candidateAccess.assertAccess(i % 2 ? hr : hr2, company.id, profile.id, 'CONTACT'),
      ),
    );
    assert.equal(await db.candidateCredit.count(), 0);
    assert.equal(
      await db.candidateAccess.count(),
      0,
      'Concurrent access never creates paid unlocks',
    );
    const expires = (await db.jobBenefit.findUniqueOrThrow({ where: { jobId: first.id } }))
      .expiresAt!;
    await benefits.grant(admin, first.id, 'PREMIUM', 'Upgrade after one access', 'upgrade-first');
    await benefits.grant(admin, first.id, 'PREMIUM', 'Upgrade after one access', 'upgrade-first');
    const upgraded = await db.jobBenefit.findUniqueOrThrow({ where: { jobId: first.id } });
    assert.equal(upgraded.expiresAt?.getTime(), expires.getTime());
    assert.equal(upgraded.boostGrantedSeconds, 7 * 86400);
    assert.equal(await db.candidateCredit.count(), 0, 'Upgrade does not grant access credits');
    assert.equal(
      (await db.companyPromotion.findUniqueOrThrow({ where: { companyId: company.id } }))
        .grantedSeconds,
      67 * 86400,
    );
    await assert.rejects(() =>
      benefits.grant(admin, first.id, 'STANDARD', 'Do not allow downgrade', 'downgrade-first'),
    );
    const episode = await benefits.boost(hr, first.id, 'boost-first');
    await benefits.boost(hr, first.id, 'boost-first');
    assert.equal(await db.boostEpisode.count({ where: { benefitId: upgraded.id } }), 1);
    await jobs.changeStatus(hr, first.id, 'PAUSED');
    assert.equal((await benefits.job(hr, first.id)).activeBoost?.id, episode.id);
    const resume = await db.resume.create({
      data: { profileId: profile.id, title: 'Shared CV', fileKey: 'synthetic/file.pdf' },
    });
    await db.employeeProfile.update({
      where: { id: profile.id },
      data: { databaseCvEnabled: true, databaseResumeId: resume.id },
    });
    await candidateAccess.assertAccess(hr2, company.id, profile.id, 'CV');
    await db.employeeProfile.update({
      where: { id: profile.id },
      data: { databaseCvEnabled: false },
    });
    await assert.rejects(() => candidateAccess.assertAccess(hr2, company.id, profile.id, 'CV'));
    await db.employeeProfile.update({ where: { id: profile.id }, data: { visibility: 'PRIVATE' } });
    await assert.rejects(() =>
      candidateAccess.assertAccess(hr2, company.id, profile.id, 'CONTACT'),
    );
    await db.employeeProfile.update({ where: { id: profile.id }, data: { visibility: 'PUBLIC' } });
    const q = await jobs.addQuestion(hr, second.id, {
      question: 'Years doing this role?',
      type: 'NUMBER',
      isRequired: true,
    });
    const app = await db.application.create({
      data: {
        jobPostId: second.id,
        profileId: profile.id,
        status: 'REJECTED',
        answers: {
          create: {
            questionId: q.id,
            answer: '2',
            questionRevision: q.revision,
            questionSnapshot: JSON.parse(JSON.stringify(q)),
          },
        },
        events: {
          create: [
            { toStatus: 'NEW', actorUserId: candidate.id },
            { fromStatus: 'NEW', toStatus: 'INTERVIEW', actorUserId: hr.id },
            { fromStatus: 'INTERVIEW', toStatus: 'REJECTED', actorUserId: hr.id },
          ],
        },
      },
    });
    await jobs.updateQuestion(hr, second.id, q.id, { question: 'Expected salary?' });
    await jobs.removeQuestion(hr, second.id, q.id);
    const historical = await db.application.findUniqueOrThrow({
      where: { id: app.id },
      include: { answers: { include: { question: true } } },
    });
    assert.equal(
      (safeApplication(historical).answers[0].question as { question: string }).question,
      'Years doing this role?',
    );
    assert.equal(await db.applicationAnswer.count(), 1);
    assert.ok(
      !(await jobs.listMine(hr, company.id))
        .find((row) => row.id === second.id)!
        .questions.some((row) => row.id === q.id),
      'Archived questions must not reappear in the employer editor',
    );
    const direct = await events.track(
      {
        jobId: third.id,
        visitor: '8dba9c70-9740-4dc0-b5b3-f523199fb589',
        kind: 'DETAIL_VIEW',
        source: 'synthetic',
      },
      candidate,
    );
    await events.track(
      { jobId: third.id, visitor: '8dba9c70-9740-4dc0-b5b3-f523199fb589', kind: 'DETAIL_VIEW' },
      candidate,
    );
    assert.equal(await db.jobEvent.count(), 1);
    assert.deepEqual(
      await events.track(
        { jobId: third.id, visitor: '8dba9c70-9740-4dc0-b5b3-f523199fb589', kind: 'IMPRESSION' },
        hr,
      ),
      { ignored: true },
    );
    const app2 = await db.application.create({
      data: { jobPostId: third.id, profileId: profile.id },
    });
    await db.$transaction((tx) => events.submitted(tx, app2, direct.session));
    assert.equal(await db.jobEvent.count({ where: { kind: 'APPLICATION_SUBMITTED' } }), 1);
    // Full-data aggregation exceeds both removed sampling limits.
    const users = Array.from({ length: 305 }, (_, i) => ({
      id: 'bulk-user-' + i,
      fullName: 'Synthetic ' + i,
      role: 'EMPLOYEE' as const,
    }));
    await db.user.createMany({ data: users });
    await db.employeeProfile.createMany({
      data: users.map((row, i) => ({ id: 'bulk-profile-' + i, userId: row.id })),
    });
    // These synthetic applications are three days old, so their publication
    // period must already have started. Reports never include pre-publication data.
    const historicalStart = new Date(Date.now() - 4 * DAY_MS), historicalEnd = new Date(Date.now() + 26 * DAY_MS);
    await db.jobPost.update({where: {id: first.id}, data: {publishedAt: historicalStart}});
    await db.jobBenefit.update({where: {jobId: first.id}, data: {startsAt: historicalStart, expiresAt: historicalEnd}});
    await db.jobPublicationPeriod.update({where: {jobId_cycle: {jobId: first.id, cycle: 1}}, data: {startsAt: historicalStart, expiresAt: historicalEnd}});
    await db.application.createMany({
      data: users.map((row, i) => ({
        id: 'bulk-app-' + i,
        jobPostId: first.id,
        profileId: 'bulk-profile-' + i,
        createdAt: new Date(Date.now() - 3 * DAY_MS),
      })),
    });
    await db.jobView.createMany({
      data: Array.from({ length: 5001 }, () => ({ jobPostId: first.id })),
    });
    const report = await analytics.summary(hr, company.id);
    assert.equal(report.historicalViews, 5001);
    assert.equal(report.responseTime.waitingOverSla, 305);
    assert.ok(report.totalApplications >= 307);
    assert.ok(!report.funnel.interview, 'Standard history is excluded from Premium report scope');
    const standardReport = await analytics.summary(hr, company.id, second.id);
    assert.equal(standardReport.capabilities.reports, false);
    await assert.rejects(() => analytics.csv(hr, company.id, second.id));
    assert.match(await analytics.csv(hr, company.id), /Applications/);
    await db.pipelineEvent.create({
      data: { applicationId: 'bulk-app-0', toStatus: 'INTERVIEW', actorUserId: hr.id },
    });
    await db.pipelineEvent.create({
      data: {
        applicationId: 'bulk-app-0',
        fromStatus: 'INTERVIEW',
        toStatus: 'REJECTED',
        actorUserId: hr.id,
      },
    });
    const report2 = await analytics.summary(hr, company.id);
    assert.equal(report2.funnel.interview, 1);
    assert.equal(report2.funnel.inReview, 0, 'Do not invent skipped stages');
    const ticket = await support.create(
      hr,
      {
        companyId: company.id,
        title: 'Synthetic issue',
        body: 'This is a synthetic support request.',
      },
      'support-first',
    );
    assert.equal(ticket.priority, true);
    const rankTime = new Date();
    const rankingFixtures = Array.from({ length: 1105 }, (_, i) => ({
      id: 'rank-' + String(i).padStart(5, '0'),
      companyId: company.id,
      title: 'Universal vacancy ' + i,
      description: 'A broad synthetic occupation for ranking and stable pagination tests.',
      status: 'PUBLISHED' as const,
      workMode: 'REMOTE' as const,
      publishedAt: new Date(rankTime.getTime() - (i === 1104 ? 3600000 : 0)),
      createdAt: rankTime,
    }));
    await db.jobPost.createMany({ data: rankingFixtures });
    await db.jobBenefit.create({
      data: {
        jobId: 'rank-01104',
        companyId: company.id,
        code: 'PREMIUM',
        highestCode: 'PREMIUM',
        policySnapshot: INITIAL_POLICIES.PREMIUM,
        startsAt: rankTime,
        expiresAt: new Date(rankTime.getTime() + 30 * DAY_MS),
      },
    });
    const fallback = await jobs.search({ q: 'Universal', sort: 'relevance', page: 1, limit: 12 });
    assert.equal(fallback.total, 1105);
    assert.equal(
      fallback.items[0].id,
      'rank-01104',
      'Exposure must rank before pagination across the full pool',
    );
    const nextPage = await jobs.search({ q: 'Universal', sort: 'relevance', page: 2, limit: 12 });
    assert.equal(new Set([...fallback.items, ...nextPage.items].map((job) => job.id)).size, 24);
    assert.ok(process.env.HR_TEST_MEILI_INDEX?.startsWith('talentio_hr_it_'));
    await rebuildJobsIndex({
      prisma: db,
      host: process.env.HR_TEST_MEILI_HOST,
      apiKey: process.env.HR_TEST_MEILI_KEY,
      index: process.env.HR_TEST_MEILI_INDEX,
    });
    const native = new JobsSearchService(
      db,
      new ConfigService({
        MEILI_HOST: process.env.HR_TEST_MEILI_HOST,
        MEILI_MASTER_KEY: process.env.HR_TEST_MEILI_KEY,
        MEILI_JOBS_INDEX: process.env.HR_TEST_MEILI_INDEX,
      }),
    );
    const nativeJobs = new JobsService(
      db,
      companies as never,
      matching as never,
      {} as never,
      native,
      {} as never,
      undefined,
      benefits,
      analytics,
    );
    for(let rebuild=0;rebuild<2;rebuild++) {
      if(rebuild)await rebuildJobsIndex({prisma:db,host:process.env.HR_TEST_MEILI_HOST,apiKey:process.env.HR_TEST_MEILI_KEY,index:process.env.HR_TEST_MEILI_INDEX});
      const coverage=await native.rankedIds('',rankingFixtures.map(row=>row.id));
      assert.equal(coverage?.length,rankingFixtures.length,'every equal-timestamp job must be indexed exactly once across all batches');
      assert.equal(new Set(coverage).size,rankingFixtures.length);
      assert.equal(native.projectionHealth().rebuilding,false,'complete rebuild must not immediately require another repair');
    }
    const nativePage = await nativeJobs.search({
      q: 'Universal',
      sort: 'relevance',
      page: 1,
      limit: 12,
    });
    assert.equal(nativePage.total, 1105);
    assert.equal(nativePage.items[0].id, 'rank-01104');
    const typo = await nativeJobs.search({ q: 'Univresal', sort: 'relevance', page: 1, limit: 12 });
    assert.equal(typo.total, 1105, 'Native search must retain typo tolerance');
    const explicit = await nativeJobs.search({
      q: 'Universal',
      sort: 'newest',
      page: 1,
      limit: 12,
    });
    assert.notEqual(
      explicit.items[0].id,
      'rank-01104',
      'Explicit newest sort must ignore package exposure',
    );
    // An index can acknowledge a request before applying it. A failed or stale
    // projection must force database ranking rather than retain paid priority.
    const testHost = process.env.HR_TEST_MEILI_HOST!,
      testIndex = process.env.HR_TEST_MEILI_INDEX!;
    const staleTaskResponse = await fetch(testHost + '/indexes/' + testIndex + '/documents', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.HR_TEST_MEILI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          id: 'rank-01104',
          boostProjectedActive: true,
          boostEndsAt: Date.now() - 1000,
          exposureUpdatedAt: Date.now() - 120000,
        },
      ]),
    });
    assert.ok(staleTaskResponse.ok);
    const staleTask = (await staleTaskResponse.json()) as { taskUid: number };
    const taskDeadline = Date.now() + 15000;
    for (;;) {
      const task = (await (
        await fetch(testHost + '/tasks/' + staleTask.taskUid, {
          headers: { Authorization: 'Bearer ' + process.env.HR_TEST_MEILI_KEY },
        })
      ).json()) as { status: string };
      if (task.status === 'succeeded') break;
      assert.ok(Date.now() < taskDeadline && task.status !== 'failed');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      await native.rankedIds(
        'Universal',
        rankingFixtures.map((row) => row.id),
      ),
      null,
      'An ended boost cannot survive in a stale projection',
    );
    while (native.projectionHealth().rebuilding) {
      assert.ok(Date.now() < taskDeadline + 30000);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      (
        await native.rankedIds(
          'Universal',
          rankingFixtures.map((row) => row.id),
        )
      )?.length,
      'Projection rebuild restores native ranking',
    );
    const originalFetch=globalThis.fetch;
    globalThis.fetch=(async(...args:Parameters<typeof fetch>)=>{
      if(String(args[0]).startsWith(testHost+'/indexes/'+testIndex))throw Error('Injected search projection outage');
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await native.syncJob(rankingFixtures[0].id);
      assert.ok(native.projectionHealth().pendingJobs>0);
      const outagePage=await nativeJobs.search({q:'Universal',sort:'relevance',page:1,limit:12});
      assert.equal(outagePage.total,1105);assert.equal(outagePage.items[0].id,'rank-01104','search outage retains SQL package ranking');
    } finally {globalThis.fetch=originalFetch;}
    await native.retryFailedSyncs();assert.equal(native.projectionHealth().pendingJobs,0,'recovered search retries the retained projection');
    const restartedSearch=new JobsSearchService(db,new ConfigService({MEILI_HOST:testHost,MEILI_MASTER_KEY:process.env.HR_TEST_MEILI_KEY,MEILI_JOBS_INDEX:testIndex}));
    await restartedSearch.onModuleInit();
    await db.jobPost.updateMany({
      where: { id: { in: rankingFixtures.map((row) => row.id) } },
      data: { status: 'CLOSED' },
    });
    const applicant = await actor('EMPLOYEE', 'Actual applicant');
    const applicantProfile = await db.employeeProfile.create({
      data: { userId: applicant.id, visibility: 'PUBLIC', bulkCommsOptOut: true },
    });
    const applicantCv = await db.resume.create({
      data: {
        profileId: applicantProfile.id,
        title: 'Original file',
        fileKey: 'submitted-original.pdf',
      },
    });
    const required = await jobs.addQuestion(hr, second.id, {
      question: 'Do you have the required certificate?',
      type: 'YES_NO',
      isRequired: true,
    });
    await assert.rejects(() => applications.apply(applicant, second.id));
    const concurrent = await Promise.allSettled([
      applications.apply(
        applicant,
        second.id,
        undefined,
        [{ questionId: required.id, answer: 'Yes' }],
        applicantCv.id,
      ),
      applications.apply(
        applicant,
        second.id,
        undefined,
        [{ questionId: required.id, answer: 'Yes' }],
        applicantCv.id,
      ),
    ]);
    assert.equal(concurrent.filter((row) => row.status === 'fulfilled').length, 1);
    const actual = await db.application.findUniqueOrThrow({
      where: { jobPostId_profileId: { jobPostId: second.id, profileId: applicantProfile.id } },
    });
    assert.equal(
      await db.jobEvent.count({
        where: { applicationId: actual.id, kind: 'APPLICATION_SUBMITTED' },
      }),
      1,
      'Server records success even without browser tracking',
    );
    assert.match(await analytics.csv(hr, company.id), /Median time to hire/);
    await db.resume.update({
      where: { id: applicantCv.id },
      data: { fileKey: 'changed-library.pdf' },
    });
    assert.equal(
      (await applications.downloadResume(hr, actual.id)).url,
      'test:submitted-original.pdf',
    );
    await assert.rejects(() => applications.downloadResume(outsider, actual.id));
    const schedule = { scheduledAt: new Date(Date.now() + DAY_MS).toISOString() };
    await applications.scheduleInterview(hr, actual.id, schedule, 'repeat-interview');
    await applications.scheduleInterview(hr, actual.id, schedule, 'repeat-interview');
    assert.equal(await db.interview.count({ where: { applicationId: actual.id } }), 1);
    let sent = 0;
    const bulk = new BulkCommsService(
      db,
      companies as never,
      applications,
      {
        startConversation: async () => ({ id: 'synthetic-conversation' }),
        sendMessage: async () => {
          sent++;
          return { id: 'synthetic-message' };
        },
      } as never,
      {} as never,
      {} as never,
      operations,
    );
    const campaign = {
      companyId: company.id,
      jobPostId: second.id,
      applicationIds: [actual.id],
      messageBody: 'Synthetic message only',
      toStatus: 'IN_REVIEW' as const,
      channels: { app: true, email: false, telegram: false },
    };
    const delivery = await bulk.runCampaign(hr, campaign, 'campaign-optout');
    assert.equal(sent, 0);
    assert.equal(delivery.recipients[0].deliveryStatus, 'SKIPPED_OPTED_OUT');
    assert.equal(
      (await db.application.findUniqueOrThrow({ where: { id: actual.id } })).status,
      'IN_REVIEW',
    );
    await db.employeeProfile.update({
      where: { id: applicantProfile.id },
      data: { bulkCommsOptOut: false },
    });
    await bulk.runCampaign(hr, campaign, 'campaign-repeat');
    await bulk.runCampaign(hr, campaign, 'campaign-repeat');
    assert.equal(sent, 1);
    assert.equal(await db.bulkCampaign.count(), 2);
    await db.workExperience.createMany({
      data: [
        {
          profileId: applicantProfile.id,
          title: 'Technician',
          companyName: 'Synthetic A',
          startDate: new Date('2020-01-01'),
          endDate: new Date('2022-01-01'),
        },
        {
          profileId: applicantProfile.id,
          title: 'Technician',
          companyName: 'Synthetic B',
          startDate: new Date('2021-01-01'),
          endDate: new Date('2023-01-01'),
        },
      ],
    });
    const overlap = await applications.searchForJob(
      hr,
      second.id,
      {
        q: 'Actual applicant',
        experienceYearsMin: 2.9,
        experienceYearsMax: 3.1,
        page: 1,
        limit: 12,
      },
      'en',
    );
    assert.equal(overlap.total, 1, 'Applicant filters merge overlapping work periods');
    const wrongYears = await applications.searchForJob(
      hr,
      second.id,
      { q: 'Actual applicant', experienceYearsMax: 2, page: 1, limit: 12 },
      'en',
    );
    assert.equal(wrongYears.total, 0);
    const filtered = await applications.searchForJob(
      hr,
      second.id,
      { q: 'Actual applicant', hasCertification: false, page: 1, limit: 12 },
      'en',
    );
    assert.equal(filtered.total, 1);
    await assert.rejects(() =>
      applications.searchForJob(outsider, second.id, { page: 1, limit: 12 }, 'en'),
    );
    const idCountry = await db.country.upsert({where:{iso2:'ID'},create:{name:'Indonesia',slug:'indonesia',iso2:'ID',iso3:'IDN',phoneCode:'62'},update:{}});
    const uzCountry = await db.country.upsert({where:{iso2:'UZ'},create:{name:'Uzbekistan',slug:'uzbekistan',iso2:'UZ',iso3:'UZB',phoneCode:'998'},update:{}});
    const province = await db.province.create({data:{countryId:idCountry.id,name:'Synthetic province',slug:'synthetic-province'}});
    const city = await db.city.create({data:{provinceId:province.id,name:'Synthetic city',slug:'synthetic-filter-city'}});
    const skill = await db.skill.create({data:{name:'Synthetic safety skill',slug:'synthetic-safety'}});
    const language = await db.language.upsert({where:{code:'en'},create:{code:'en',name:'English'},update:{}});
    await db.employeeProfile.update({where:{id:applicantProfile.id},data:{cityId:city.id,residenceCountryId:idCountry.id}});
    await db.profileSkill.create({data:{profileId:applicantProfile.id,skillId:skill.id,level:'INTERMEDIATE'}});
    await db.profileLanguage.create({data:{profileId:applicantProfile.id,languageId:language.id,level:'B2'}});
    await db.education.create({data:{profileId:applicantProfile.id,school:'Synthetic school',degree:'BACHELOR'}});
    await db.certification.create({data:{profileId:applicantProfile.id,name:'Synthetic qualification'}});
    const filterCount = async (filter: Record<string, unknown>) => (await applications.searchForJob(hr,second.id,{q:'Actual applicant',page:1,limit:12,...filter},'en')).total;
    assert.equal(await filterCount({country:idCountry.slug,city:city.slug,degree:'BACHELOR',skills:skill.slug,languages:'en:B2',hasCertification:true,experienceYearsMin:2.9}),1,'All applicant filters combine without losing the correct candidate');
    assert.equal(await filterCount({country:uzCountry.slug}),0);
    assert.equal(await filterCount({degree:'PHD'}),0);
    assert.equal(await filterCount({languages:'en:C1'}),0);
    assert.equal(await filterCount({skills:skill.slug+',missing-skill',skillMode:'AND'}),0);
    assert.equal(await filterCount({skills:skill.slug+',missing-skill',skillMode:'OR'}),1);
    await db.employeeProfile.update({where:{id:applicantProfile.id},data:{residenceCountryId:null}});
    assert.equal(await filterCount({country:idCountry.slug}),1,'Legacy country filters use the actual city country');
    await db.employeeProfile.update({where:{id:applicantProfile.id},data:{residenceCountryId:uzCountry.id}});
    assert.equal(await filterCount({country:idCountry.slug}),0,'Explicit residence must take precedence over an old city');
    assert.equal(await filterCount({country:uzCountry.slug}),1);
    await runHrHttpSuite({
      db,
      benefits,
      candidateAccess,
      analytics,
      support,
      admin,
      hr,
      outsider,
      employee: applicant,
      companyId: company.id,
      standardJobId: second.id,
      premiumJobId: first.id,
      resumeId: applicantCv.id,
      profileId: applicantProfile.id,
      ticketId: ticket.id,
    });
    const profileService = new ProfilesService(
      db,
      {} as never,
      companies as never,
      matching as never,
      {} as never,
      {} as never,
      {} as never,
      null,
      candidateAccess,
    );
    await db.contactRevealCounter.create({
      data: {
        actorId: hr.id,
        windowStart: new Date(Math.floor(Date.now() / 3600000) * 3600000),
        count: 29,
      },
    });
    const contactRace = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        profileService.revealCandidateContact(hr, profile.id, company.id),
      ),
    );
    assert.equal(
      contactRace.filter((row) => row.status === 'fulfilled').length,
      1,
      'Database anti-scraping limit remains atomic without Redis',
    );
    assert.equal(
      await db.auditLog.count({ where: { actorId: hr.id, action: 'CANDIDATE_CONTACT_REVEAL' } }),
      1,
    );
    await support.update(admin, ticket.id, { status: 'RESOLVED' });
    assert.equal((await support.list(hr, company.id)).total, 0);
    assert.equal((await support.list(hr, company.id, 1, 'ALL')).total, 1);
    await support.reply(hr, ticket.id, 'Please reopen this synthetic issue.', 'support-reopen');
    assert.equal((await support.get(hr, ticket.id)).priority, true);
    assert.equal(await db.candidateCredit.count(), 0);
    await candidateAccess.assertAccess(hr, company.id, applicantProfile.id, 'CONTACT');
    // A Free company can read every available candidate without an unlock.
    const freeCandidates = await Promise.all(
      Array.from({ length: 6 }, (_, index) => actor('EMPLOYEE', 'Free quota ' + index)),
    );
    const freeProfiles = await Promise.all(
      freeCandidates.map((user) =>
        db.employeeProfile.create({ data: { userId: user.id, visibility: 'PUBLIC' } }),
      ),
    );
    const freeRace = await Promise.allSettled(
      freeProfiles.map((row) =>
        candidateAccess.assertAccess(outsider, other.id, row.id, 'CONTACT'),
      ),
    );
    assert.equal(
      freeRace.filter((row) => row.status === 'fulfilled').length,
      6,
      'Free companies have no five-candidate cap',
    );
    const legacyCredit = await db.candidateCredit.create({
      data: {
        companyId: other.id,
        sourceKey: 'archived-empty-balance',
        capacity: 0,
        startsAt: new Date(Date.now() - 60 * DAY_MS),
        expiresAt: new Date(Date.now() - 30 * DAY_MS),
      },
    });
    const legacyAccess = await db.candidateAccess.create({
      data: {
        companyId: other.id,
        profileId: freeProfiles[0].id,
        creditId: legacyCredit.id,
        openedById: outsider.id,
        expiresAt: new Date(Date.now() - DAY_MS),
      },
    });
    await candidateAccess.assertAccess(outsider, other.id, freeProfiles[0].id, 'CONTACT');
    assert.deepEqual(
      await db.candidateCredit.findUnique({ where: { id: legacyCredit.id } }),
      legacyCredit,
    );
    assert.deepEqual(
      await db.candidateAccess.findUnique({ where: { id: legacyAccess.id } }),
      legacyAccess,
    );
    // Upgrade after consuming Standard's full episode adds four days, not seven.
    const standardEpisode = await benefits.boost(hr, second.id, 'used-standard-boost');
    const episodeEnd = new Date(Date.now() - 1000);
    await db.boostEpisode.update({
      where: { id: standardEpisode.id },
      data: { startsAt: new Date(episodeEnd.getTime() - 3 * DAY_MS), endsAt: episodeEnd },
    });
    await benefits.grant(
      admin,
      second.id,
      'PREMIUM',
      'Upgrade after Standard boost consumption',
      'used-boost-upgrade',
    );
    assert.equal((await benefits.job(hr, second.id)).boostRemainingSeconds, 4 * 86400);
    const originalThirdExpiry = (
      await db.jobBenefit.findUniqueOrThrow({ where: { jobId: third.id } })
    ).expiresAt!;
    const nearEnd = new Date(Date.now() + 300000);
    await db.jobBenefit.update({ where: { jobId: third.id }, data: { expiresAt: nearEnd } });
    const nearBoost = await benefits.boost(hr, third.id, 'near-expiry-boost');
    assert.equal(nearBoost.endsAt.getTime(), nearEnd.getTime());
    await db.jobBenefit.update({
      where: { jobId: third.id },
      data: { expiresAt: originalThirdExpiry },
    });
    await db.company.update({ where: { id: other.id }, data: { isBanned: true } });
    await assert.rejects(() => benefits.company(outsider, other.id));
    await db.company.update({ where: { id: other.id }, data: { isBanned: false } });
    // Staged activation cannot leave newly published jobs with an unlimited period.
    const lifecycleCompany = await db.company.create({
      data: {
        name: 'Lifecycle company',
        slug: 'lifecycle-company',
        members: { create: { userId: hr.id, role: 'OWNER' } },
      },
    });
    await db.featureFlag.update({ where: { key: 'hr_packages' }, data: { enabled: false } });
    const staged = (await jobs.create(hr, lifecycleCompany.id, {
      title: 'Staged vacancy',
      description: 'A vacancy published while rollout is staged.',
      workMode: 'REMOTE',
    }))!;
    await jobs.changeStatus(hr, staged.id, 'PUBLISHED');
    const stagedPeriod = await db.jobBenefit.findUniqueOrThrow({ where: { jobId: staged.id } });
    assert.ok(stagedPeriod.startsAt && stagedPeriod.expiresAt);
    assert.equal(stagedPeriod.expiresAt!.getTime() - stagedPeriod.startsAt!.getTime(), 30 * DAY_MS);
    const missing = await db.jobPost.create({
      data: {
        companyId: lifecycleCompany.id,
        title: 'Legacy missing period',
        description: 'Simulate a posting from the previous rollout gap.',
        workMode: 'REMOTE',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const adminService = new AdminService(db, search as never, {} as never, jobs);
    const racing = (await jobs.create(hr, lifecycleCompany.id, {
      title: 'Concurrent rollout vacancy',
      description: 'Publishing concurrently with activation must preserve expiry.',
      workMode: 'REMOTE',
    }))!;
    await db.jobBenefit.create({data: {jobId: racing.id, companyId: lifecycleCompany.id, policySnapshot: INITIAL_POLICIES.FREE, selectionConfirmedAt: new Date()}});
    await Promise.all([
      adminService.upsertFlag(admin.id, 'hr_packages', true),
      jobs.changeStatus(hr, racing.id, 'PUBLISHED'),
    ]);
    for (const id of [staged.id, missing.id, racing.id]) {
      const row = await db.jobBenefit.findUniqueOrThrow({ where: { jobId: id } });
      assert.ok(row.startsAt && row.expiresAt);
      assert.equal(row.expiresAt!.getTime() - row.startsAt!.getTime(), 30 * DAY_MS);
    }
    await db.company.update({ where: { id: lifecycleCompany.id }, data: { isBanned: true } });
    await assert.rejects(() =>
      benefits.grant(
        admin,
        staged.id,
        'PREMIUM',
        'Blocked company must not receive benefits',
        'blocked-grant',
      ),
    );
    await assert.rejects(() =>
      candidateAccess.assertAccess(hr, lifecycleCompany.id, profile.id, 'CONTACT'),
    );
    await db.company.update({ where: { id: lifecycleCompany.id }, data: { isBanned: false } });
    assert.equal(
      await db.jobPackageGrant.count({ where: { benefit: { companyId: lifecycleCompany.id } } }),
      0,
    );
    const policyDraft = (await jobs.create(hr, lifecycleCompany.id, {
      title: 'Historical policy vacancy',
      description: 'An upgrade cannot reduce previously granted policy benefits.',
      workMode: 'REMOTE',
    }))!;
    await db.packagePolicy.create({
      data: {
        code: 'STANDARD',
        version: 2,
        settings: {
          ...INITIAL_POLICIES.STANDARD,
          visibility: 1.6,
          boostDays: 10,
          featuredDays: 40,
        },
      },
    });
    await benefits.grant(
      admin,
      policyDraft.id,
      'STANDARD',
      'A historical Standard policy',
      'historical-policy-standard',
    );
    await jobs.changeStatus(hr, policyDraft.id, 'PUBLISHED');
    // Policies can later be reduced for new grants, without rewriting old snapshots.
    await db.packagePolicy.create({
      data: { code: 'STANDARD', version: 3, settings: INITIAL_POLICIES.STANDARD },
    });
    await benefits.grant(
      admin,
      policyDraft.id,
      'PREMIUM',
      'Upgrade after policy revision',
      'historical-policy-premium',
    );
    const historicalBenefit = await db.jobBenefit.findUniqueOrThrow({
      where: { jobId: policyDraft.id },
    });
    assert.equal((historicalBenefit.policySnapshot as { visibility: number }).visibility, 1.6);
    assert.equal(historicalBenefit.boostGrantedSeconds, 10 * 86400);
    assert.equal(historicalBenefit.featuredGrantedSeconds, 40 * 86400);
    const noFileApplication = await db.application.create({
      data: {
        jobPostId: staged.id,
        profileId: profile.id,
        resumeId: resume.id,
        resumeSnapshot: { resume: { title: 'No submitted CV', fileKey: null } },
      },
    });
    await assert.rejects(
      () => applications.downloadResume(hr, noFileApplication.id),
      'An empty submitted snapshot must not disclose the current library CV',
    );
    const atomicDraft = (await jobs.create(hr, lifecycleCompany.id, {
      title: 'Atomic screening vacancy',
      description: 'Job content and screening must commit or roll back together.',
      workMode: 'REMOTE',
      screeningQuestions: [
        { question: 'Do you hold a certificate?', type: 'YES_NO', isRequired: true, sortOrder: 0 },
      ],
    }))!;
    const atomicQuestion = atomicDraft.questions[0];
    assert.equal(
      await db.jobQuestionVersion.count({ where: { questionId: atomicQuestion.id } }),
      1,
    );
    const oldDescription = atomicDraft.description;
    await assert.rejects(() =>
      jobs.update(hr, atomicDraft.id, {
        description: 'This content must never be partially saved after invalid screening.',
        screeningQuestions: [
          {
            id: q.id,
            question: 'Cross-job question?',
            type: 'TEXT',
            isRequired: true,
            sortOrder: 0,
          },
        ],
      }),
    );
    assert.equal(
      (await db.jobPost.findUniqueOrThrow({ where: { id: atomicDraft.id } })).description,
      oldDescription,
    );
    assert.equal(
      (await db.jobQuestion.findUniqueOrThrow({ where: { id: atomicQuestion.id } })).archivedAt,
      null,
    );
    await jobs.update(hr, atomicDraft.id, {
      screeningQuestions: [
        {
          id: atomicQuestion.id,
          question: 'Do you hold a certificate?',
          type: 'YES_NO',
          isRequired: true,
          sortOrder: 0,
        },
      ],
    });
    assert.equal(
      await db.jobQuestionVersion.count({ where: { questionId: atomicQuestion.id } }),
      1,
      'An unrelated save does not invent a question revision',
    );
    const atomicUpdated = (await jobs.update(hr, atomicDraft.id, {
      screeningQuestions: [
        {
          id: atomicQuestion.id,
          question: 'Do you hold an active certificate?',
          type: 'YES_NO',
          isRequired: true,
          sortOrder: 0,
        },
      ],
    }))!;
    assert.equal(atomicUpdated.questions[0].revision, 2);
    await jobs.update(hr, atomicDraft.id, { screeningQuestions: [] });
    assert.equal(
      (await jobs.listMine(hr, lifecycleCompany.id)).find((row) => row.id === atomicDraft.id)!
        .questions.length,
      0,
    );
    assert.equal(
      await db.jobQuestionVersion.count({ where: { questionId: atomicQuestion.id } }),
      2,
    );
    const beforeEditors = await db.jobPost.findUniqueOrThrow({ where: { id: atomicDraft.id } });
    const editRace = await Promise.allSettled([
      jobs.update(hr, atomicDraft.id, {
        description: 'First HR edit must not overwrite a concurrent editor silently.',
        expectedUpdatedAt: beforeEditors.updatedAt.toISOString(),
      }),
      jobs.update(hr2, atomicDraft.id, {
        description: 'Second HR edit must not overwrite a concurrent editor silently.',
        expectedUpdatedAt: beforeEditors.updatedAt.toISOString(),
      }),
    ]);
    // hr2 has no membership here, so test actual competing editors on the same company.
    assert.equal(editRace.filter((row) => row.status === 'fulfilled').length, 1);
    const beforeRevision = await db.jobPost.findUniqueOrThrow({ where: { id: atomicDraft.id } });
    await db.companyMember.create({
      data: { companyId: lifecycleCompany.id, userId: hr2.id, role: 'RECRUITER' },
    });
    const actualEditRace = await Promise.allSettled([
      jobs.update(hr, atomicDraft.id, {
        description: 'A complete first editor description with a fresh version.',
        expectedUpdatedAt: beforeRevision.updatedAt.toISOString(),
      }),
      jobs.update(hr2, atomicDraft.id, {
        description: 'A complete second editor description with a fresh version.',
        expectedUpdatedAt: beforeRevision.updatedAt.toISOString(),
      }),
    ]);
    assert.equal(
      actualEditRace.filter((row) => row.status === 'fulfilled').length,
      1,
      'Two editors cannot silently overwrite the same version',
    );
    const staleRevision = (await db.jobPost.findUniqueOrThrow({ where: { id: atomicDraft.id } }))
      .updatedAt;
    await jobs.addQuestion(hr, atomicDraft.id, {
      question: 'A newly added question?',
      type: 'TEXT',
    });
    await assert.rejects(
      () =>
        jobs.update(hr, atomicDraft.id, {
          expectedUpdatedAt: staleRevision.toISOString(),
          screeningQuestions: [],
        }),
      'A stale editor cannot silently archive another HR question',
    );
    const beforeInvalidCreate = await db.jobPost.count();
    await assert.rejects(() =>
      jobs.create(hr, lifecycleCompany.id, {
        title: 'Rejected screening create',
        description: 'Creating a job with a foreign question must be atomic.',
        workMode: 'REMOTE',
        screeningQuestions: [
          {
            id: atomicQuestion.id,
            question: 'Do you hold a certificate?',
            type: 'TEXT',
            isRequired: true,
            sortOrder: 0,
          },
        ],
      }),
    );
    assert.equal(await db.jobPost.count(), beforeInvalidCreate);
    const oneApplication = await applications.getForJob(hr, first.id, 'bulk-app-304', 'en');
    assert.equal(oneApplication.id, 'bulk-app-304', 'Notification detail works outside page one');
    await assert.rejects(() => applications.getForJob(hr, second.id, 'bulk-app-304', 'en'));
    await assert.rejects(() => applications.getForJob(outsider, first.id, 'bulk-app-304', 'en'));
    const pageA = await applications.searchForJob(
      hr,
      first.id,
      { sort: 'newest', page: 2, limit: 24 },
      'en',
    );
    const pageB = await applications.searchForJob(
      hr,
      first.id,
      { sort: 'newest', page: 3, limit: 24 },
      'en',
    );
    assert.equal(new Set([...pageA.items, ...pageB.items].map((row) => row.id)).size, 48);
    const expectedPage = await db.application.findMany({
      where: { jobPostId: first.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 24,
      take: 24,
      select: { id: true },
    });
    assert.deepEqual(
      pageA.items.map((row) => row.id),
      expectedPage.map((row) => row.id),
    );
    const limitedPage = await applications.searchForJob(
      hr,
      first.id,
      { sort: 'newest', page: 9999, limit: 24 },
      'en',
    );
    assert.equal(limitedPage.page, limitedPage.totalPages);
    await assert.rejects(() => analytics.summary(hr, company.id, missing.id));
    const cohortReport = await analytics.summary(hr, company.id);
    assert.equal(
      cohortReport.conversionSessions,
      cohortReport.sources.reduce((sum, row) => sum + row.count, 0),
    );
    for (const count of Object.values(cohortReport.conversion ?? {}))
      assert.ok(count <= cohortReport.conversionSessions!);
    await db.jobPost.update({ where: { id: first.id }, data: { title: ' \t=1+1' } });
    assert.ok(
      (await analytics.csv(hr, company.id)).includes('"\' \t=1+1"'),
      'CSV neutralizes formulas after leading whitespace',
    );
    await db.jobBenefit.updateMany({
      where: { companyId: company.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await assert.rejects(() => jobs.changeStatus(hr, first.id, 'PUBLISHED'));
    await assert.rejects(() => benefits.boost(hr, third.id, 'expired-boost'));
    const expiredApplicant = await actor('EMPLOYEE', 'Expired applicant');
    await db.employeeProfile.create({ data: { userId: expiredApplicant.id } });
    await assert.rejects(() => applications.apply(expiredApplicant, third.id));
    await assert.rejects(
      () => jobs.listQuestions(third.id),
      'Expired screening is unavailable even before the worker runs',
    );
    assert.ok(
      (await jobs.listMine(hr, company.id))
        .filter((row) => [first.id, second.id, third.id].includes(row.id))
        .every((row) => row.status === 'EXPIRED'),
    );
    const worker = new BenefitsWorker(db, benefits, search as never);
    await worker.tick();
    assert.equal(
      await db.jobPost.count({
        where: {
          companyId: company.id,
          status: { in: ['PUBLISHED', 'PAUSED'] },
          benefit: { expiresAt: { lte: new Date() } },
        },
      }),
      0,
      'Worker persists expiry after API already enforces it',
    );
    const copied = await jobs.duplicate(hr, third.id);
    assert.equal(copied.status, 'DRAFT');
    assert.equal(await db.jobBenefit.count({ where: { jobId: copied.id } }), 0);
    const copiedScreening = await jobs.duplicate(hr, second.id);
    assert.ok(copiedScreening.questions.some(row => row.question === required.question), 'Clone response must include copied screening before the editor can save it');
    for (const question of copiedScreening.questions) {
      assert.notEqual(question.id, required.id);
      assert.equal(await db.jobQuestionVersion.count({ where: { questionId: question.id } }), 1);
    }
    const ticketAfter = await support.get(hr, ticket.id);
    assert.equal(ticketAfter.priority, true);
    await assert.rejects(() => support.get(outsider, ticket.id));
    assert.equal(
      (await analytics.summary(hr, company.id, first.id)).capabilities.reports,
      true,
      'Report entitlement survives posting expiry',
    );
    const base = new Date();
    for (const age of [0, 1, 7, 29]) {
      const at = new Date(base.getTime() - age * DAY_MS);
      const free = exposureLog({ publishedAt: at, visibility: 1 }, base),
        standard = exposureLog({ publishedAt: at, visibility: 1.15 }, base),
        premium = exposureLog({ publishedAt: at, visibility: 1.3 }, base);
      assert.ok(free < standard && standard < premium);
      const boost = exposureLog(
        {
          publishedAt: at,
          visibility: 1.15,
          boost: { startsAt: base, endsAt: new Date(base.getTime() + DAY_MS) },
        },
        base,
      );
      assert.ok(boost > premium);
      assert.equal(
        exposureLog(
          {
            publishedAt: at,
            visibility: 1.15,
            boost: { startsAt: new Date(base.getTime() - DAY_MS), endsAt: base },
          },
          base,
        ),
        standard,
      );
    }
    await runRecruiterMatchingSuite(db, benefits);
    await runApplicantsKanbanSuite(db, benefits);
    console.log(
      'HR integration: transactions, unrestricted candidate access, 44 featured days, concurrency, upgrade deltas, boost, consent, screening history, analytics > old sample caps, support, real HTTP/JWT role guards and expiry passed.',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
