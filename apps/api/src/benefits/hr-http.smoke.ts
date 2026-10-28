import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../auth/jwt.strategy';
import { RolesGuard, AuthUser } from '../common/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JobsSearchService } from '../search/jobs-search.service';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';
import { BenefitsController, AdminBenefitsController } from './benefits.controller';
import { HrReportsController, HrSupportController, FeaturedController } from './hr.controller';
import { BenefitsService } from './benefits.service';
import { CandidateAccessService } from '../profiles/candidate-access.service';
import { CandidateAccessController } from '../profiles/candidate-access.controller';
import { HrAnalyticsService } from './hr-analytics.service';
import { HrSupportService } from './hr-support.service';
import { ApplicationsService } from '../applications/applications.service';
import { ApplicationsController } from '../applications/applications.controller';
import { MatchingService } from '../matching/matching.service';

export async function runHrHttpSuite(input: {
  db: PrismaService;
  benefits: BenefitsService;
  candidateAccess: CandidateAccessService;
  analytics: HrAnalyticsService;
  support: HrSupportService;
  admin: AuthUser;
  hr: AuthUser;
  outsider: AuthUser;
  employee: AuthUser;
  companyId: string;
  standardJobId: string;
  premiumJobId: string;
  resumeId: string;
  profileId: string;
  ticketId: string;
}) {
  const secret = 'isolated-real-http-authentication-key-2026';
  const config = new ConfigService({ JWT_SECRET: secret });
  const jwt = new JwtService({ secret });
  const token = (user: AuthUser) => jwt.sign({ sub: user.id, tv: 0 }, { expiresIn: '5m' });
  // tsx does not emit design metadata. Explicit test wiring uses the exact
  // production controllers, JWT strategy and role guard without an auth bypass.
  Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
  Reflect.defineMetadata('design:paramtypes', [Object, ConfigService], SearchRateLimitGuard);
  Reflect.defineMetadata(
    'design:paramtypes',
    [BenefitsService, JobsSearchService],
    BenefitsController,
  );
  Reflect.defineMetadata(
    'design:paramtypes',
    [BenefitsService, PrismaService, JobsSearchService],
    AdminBenefitsController,
  );
  Reflect.defineMetadata('design:paramtypes', [HrAnalyticsService], HrReportsController);
  Reflect.defineMetadata('design:paramtypes', [HrSupportService], HrSupportController);
  Reflect.defineMetadata(
    'design:paramtypes',
    [CandidateAccessService, PrismaService, StorageService],
    CandidateAccessController,
  );
  Reflect.defineMetadata('design:paramtypes', [PrismaService, BenefitsService], FeaturedController);
  Reflect.defineMetadata('design:paramtypes', [ApplicationsService], ApplicationsController);
  const applications=new ApplicationsService(input.db,{} as never,{assertMember:async(actor:AuthUser,id:string)=>({company:await input.benefits.member(actor,id)})} as never,new MatchingService(input.db),{create:async()=>{}} as never,{} as never);
  let fileAvailable = false;
  let onFileRead: (() => Promise<void>) | undefined;
  class TestModule {}
  Module({})(TestModule);
  const app = await NestFactory.create(
    {
      module: TestModule,
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        BenefitsController,
        CandidateAccessController,
        FeaturedController,
        AdminBenefitsController,
        HrReportsController,
        HrSupportController,
        ApplicationsController,
      ],
      providers: [
        { provide: PrismaService, useValue: input.db },
        { provide: ConfigService, useValue: config },
        { provide: JwtStrategy, useValue: new JwtStrategy(config, input.db) },
        { provide: BenefitsService, useValue: input.benefits },
        { provide: CandidateAccessService, useValue: input.candidateAccess },
        { provide: HrAnalyticsService, useValue: input.analytics },
        { provide: HrSupportService, useValue: input.support },
        { provide: ApplicationsService, useValue: applications },
        { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
        { provide: SearchRateLimitGuard, useValue: { canActivate: () => true } },
        {
          provide: StorageService,
          useValue: {
            getObjectBuffer: async () => {
              if (!fileAvailable) throw Error('Synthetic missing file');
              await onFileRead?.();
              return Buffer.from('%PDF-1.7 synthetic isolated CV');
            },
          },
        },
        {
          provide: JobsSearchService,
          useValue: { syncJob: async () => {}, projectionHealth: () => ({ enabled: false }) },
        },
      ],
    },
    { logger: ['error'] },
  );
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = (path: string, user?: AuthUser, method = 'GET', body?: unknown, key?: string) =>
    fetch(base + '/api' + path, {
      method,
      headers: {
        ...(user ? { Authorization: 'Bearer ' + token(user) } : {}),
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const kanbanJob=await input.db.jobPost.create({data:{companyId:input.companyId,title:'HTTP Kanban fixture',description:'Isolated controller regression.'}});
    const kanbanApplication=await input.db.application.create({data:{jobPostId:kanbanJob.id,profileId:input.profileId}});
    const addPath='/applications/'+kanbanApplication.id+'/kanban';
    assert.equal((await request(addPath,undefined,'POST')).status,401);
    assert.equal((await request(addPath,input.employee,'POST')).status,403);
    assert.equal((await request(addPath,input.outsider,'POST')).status,403);
    assert.equal((await request(addPath,input.hr,'POST')).status,201);
    assert.equal((await request(addPath,input.hr,'POST')).status,201);
    const kanbanResponse=await request('/applications/jobs/'+kanbanJob.id+'/kanban',input.hr);
    assert.equal(kanbanResponse.status,200);
    const kanbanData=await kanbanResponse.json() as {columns:Array<{status:string;items:Array<{id:string}>;total:number}>};
    assert.ok(kanbanData.columns.find(column=>column.status==='NEW')?.items.some(item=>item.id===kanbanApplication.id));
    assert.equal((await request('/applications/jobs/'+kanbanJob.id+'/kanban?page=0',input.hr)).status,400);
    assert.equal((await request('/applications/jobs/'+kanbanJob.id+'/kanban',input.employee)).status,403);
    assert.equal((await request('/applications/jobs/'+kanbanJob.id+'/search?sort=match',input.outsider)).status,403);
    assert.equal((await request('/benefits/companies/' + input.companyId)).status, 401);
    assert.equal(
      (await request('/benefits/companies/' + input.companyId, input.employee)).status,
      403,
    );
    assert.equal(
      (await request('/benefits/companies/' + input.companyId, input.outsider)).status,
      403,
    );
    assert.equal((await request('/benefits/companies/' + input.companyId, input.hr)).status, 200);
    assert.equal(
      (
        await request(
          '/admin/benefits/jobs/' + input.standardJobId + '/grants',
          input.hr,
          'POST',
          { code: 'PREMIUM', reason: 'An invalid recruiter grant' },
          'http-unauthorized',
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/benefits/jobs/' + input.standardJobId + '/boost', input.hr, 'POST', {}))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          '/hr-reports/csv?companyId=' + input.companyId + '&jobId=' + input.standardJobId,
          input.hr,
        )
      ).status,
      403,
    );
    const csv = await request(
      '/hr-reports/csv?companyId=' + input.companyId + '&jobId=' + input.premiumJobId,
      input.hr,
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('Content-Type') || '', /text\/csv/);
    assert.equal(
      (
        await request('/profiles/me/database-cv-permission', input.hr, 'PATCH', {
          enabled: true,
          resumeId: input.resumeId,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/profiles/me/database-cv-permission', input.employee, 'PATCH', {
          enabled: true,
          resumeId: input.resumeId,
        })
      ).status,
      200,
    );
    const creditsBefore = await input.db.candidateCredit.findMany();
    const unlocksBefore = await input.db.candidateAccess.findMany();
    assert.equal(
      (
        await request(
          '/benefits/candidates/' + input.profileId + '/unlock',
          input.hr,
          'POST',
          { companyId: input.companyId, kind: 'CV' },
          'retired-unlock',
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          '/admin/benefits/companies/' + input.companyId + '/adjustments',
          input.admin,
          'POST',
          {
            amount: 10,
            expiresAt: new Date(Date.now() + 86400000),
            reason: 'Retired quota adjustment',
          },
          'retired-adjustment',
        )
      ).status,
      404,
    );
    const cvPath =
      '/profiles/candidates/' + input.profileId + '/database-cv?companyId=' + input.companyId;
    assert.equal((await request(cvPath, input.hr)).status, 404, 'Missing CV files return 404');
    fileAvailable = true;
    const cv = await request(cvPath, input.hr);
    assert.equal(cv.status, 200, 'CV is directly available without an unlock');
    assert.match(cv.headers.get('Cache-Control') || '', /no-store/);
    assert.match(await cv.text(), /synthetic isolated CV/);
    const freeMembership = await input.db.companyMember.findFirstOrThrow({
      where: { userId: input.outsider.id },
    });
    const freeCvPath =
      '/profiles/candidates/' +
      input.profileId +
      '/database-cv?companyId=' +
      freeMembership.companyId;
    assert.equal(
      (await request(freeCvPath, input.outsider)).status,
      200,
      'Free employer can access a non-applicant CV',
    );
    await input.db.featureFlag.update({ where: { key: 'hr_packages' }, data: { enabled: false } });
    assert.equal(
      (await request(freeCvPath, input.outsider)).status,
      200,
      'CV access does not depend on package rollout',
    );
    await input.db.featureFlag.update({ where: { key: 'hr_packages' }, data: { enabled: true } });
    assert.equal((await request(cvPath, input.employee)).status, 403);
    await input.db.employeeProfile.update({
      where: { id: input.profileId },
      data: { visibility: 'PRIVATE' },
    });
    assert.equal(
      (await request(freeCvPath, input.outsider)).status,
      404,
      'Private candidates are hidden from unrelated employers',
    );
    assert.equal(
      (await request(cvPath, input.hr)).status,
      200,
      'An existing applicant keeps submitted-company visibility',
    );
    await input.db.employeeProfile.update({
      where: { id: input.profileId },
      data: { visibility: 'PUBLIC' },
    });
    onFileRead = () =>
      input.db.employeeProfile
        .update({ where: { id: input.profileId }, data: { databaseCvEnabled: false } })
        .then(() => {});
    assert.equal(
      (await request(cvPath, input.hr)).status,
      403,
      'Revocation during storage IO prevents delivery',
    );
    onFileRead = undefined;
    await input.db.employeeProfile.update({
      where: { id: input.profileId },
      data: { databaseCvEnabled: true },
    });
    const selected = await input.db.resume.findUniqueOrThrow({ where: { id: input.resumeId } });
    onFileRead = () =>
      input.db.resume
        .update({ where: { id: input.resumeId }, data: { fileKey: 'replacement-during-read.pdf' } })
        .then(() => {});
    assert.equal(
      (await request(cvPath, input.hr)).status,
      404,
      'Replacement during storage IO cannot return the old bytes',
    );
    onFileRead = undefined;
    await input.db.resume.update({
      where: { id: input.resumeId },
      data: { fileKey: selected.fileKey },
    });
    await input.db.resume.update({
      where: { id: input.resumeId },
      data: { deletedAt: new Date() },
    });
    assert.equal((await request(cvPath, input.hr)).status, 403, 'Deleted CV cannot be downloaded');
    await input.db.resume.update({ where: { id: input.resumeId }, data: { deletedAt: null } });
    await input.db.company.update({
      where: { id: freeMembership.companyId },
      data: { isBanned: true },
    });
    assert.equal((await request(freeCvPath, input.outsider)).status, 403);
    await input.db.company.update({
      where: { id: freeMembership.companyId },
      data: { isBanned: false },
    });
    const anonymous = await input.db.company.create({
      data: { name: 'Confidential employer', slug: 'confidential-employer' },
    });
    await input.db.jobPost.createMany({
      data: [
        {
          companyId: anonymous.id,
          title: 'Confidential published role',
          description: 'Anonymous employer role for privacy regression.',
          isAnonymous: true,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        {
          companyId: anonymous.id,
          title: 'Unpublished named role',
          description: 'A private draft must not reveal a confidential employer.',
          status: 'DRAFT',
        },
      ],
    });
    await input.db.companyPromotion.create({
      data: {
        companyId: anonymous.id,
        endsAt: new Date(Date.now() + 86400000),
        grantedSeconds: 86400,
      },
    });
    const featured = (await (await request('/benefits/featured')).json()) as Array<{ id: string }>;
    assert.ok(featured.some((row) => row.id === input.companyId));
    assert.ok(
      !featured.some((row) => row.id === anonymous.id),
      'A named draft cannot reveal a confidential employer in featured cards',
    );
    await input.db.company.update({ where: { id: input.companyId }, data: { isBanned: true } });
    assert.ok(
      !((await (await request('/benefits/featured')).json()) as Array<{ id: string }>).some(
        (row) => row.id === input.companyId,
      ),
    );
    await input.db.company.update({ where: { id: input.companyId }, data: { isBanned: false } });
    assert.deepEqual(await input.db.candidateCredit.findMany(), creditsBefore);
    assert.deepEqual(await input.db.candidateAccess.findMany(), unlocksBefore);
    assert.equal(
      (
        await request('/profiles/me/database-cv-permission', input.employee, 'PATCH', {
          enabled: false,
          resumeId: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          '/profiles/candidates/' + input.profileId + '/database-cv?companyId=' + input.companyId,
          input.hr,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/hr-support/' + input.ticketId + '/assign-self', input.admin, 'POST', {}))
        .status,
      201,
    );
    assert.equal(
      (await input.db.supportTicket.findUniqueOrThrow({ where: { id: input.ticketId } }))
        .assignedToId,
      input.admin.id,
    );
    await input.db.user.update({ where: { id: input.hr.id }, data: { isBanned: true } });
    assert.equal((await request('/benefits/companies/' + input.companyId, input.hr)).status, 401);
    await input.db.user.update({ where: { id: input.hr.id }, data: { isBanned: false } });
  } finally {
    await app.close();
  }
}
