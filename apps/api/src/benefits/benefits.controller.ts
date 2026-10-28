import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { packageSettings } from './benefit-policy';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitsService } from './benefits.service';
import { JobsSearchService } from '../search/jobs-search.service';

@Controller('benefits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BenefitsController {
  constructor(
    private benefits: BenefitsService,
    private search: JobsSearchService,
  ) {}
  @Get('companies/:companyId')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  company(@CurrentUser() user: AuthUser, @Param('companyId') id: string) {
    return this.benefits.company(user, id);
  }
  @Get('jobs/:jobId')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  job(@CurrentUser() user: AuthUser, @Param('jobId') id: string) {
    return this.benefits.job(user, id);
  }
  @Post('jobs/:jobId/boost')
  @Roles('RECRUITER', 'SUPER_ADMIN')
  async boost(
    @CurrentUser() user: AuthUser,
    @Param('jobId') id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    const result = await this.benefits.boost(user, id, key);
    await this.search.syncJob(id);
    return result;
  }
}

@Controller('admin/benefits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminBenefitsController {
  constructor(
    private benefits: BenefitsService,
    private db: PrismaService,
    private search: JobsSearchService,
  ) {}
  @Get('policies')
  async policies() {
    const rows = await this.db.packagePolicy.findMany({
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
    return rows.map((row) => ({ ...row, settings: packageSettings(row.settings) }));
  }
  @Get('exposure-policy')
  exposure() {
    return this.db.featureFlag.findUnique({
      where: { key: 'hr_exposure_policy' },
      select: { payload: true },
    });
  }
  @Post('exposure-policy')
  async exposurePolicy(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseDto(
      z.object({
        halfLifeDays: z.number().min(1).max(365),
        cap: z.number().min(1).max(3),
        boostAmplitude: z.number().min(0).max(1),
        reason: z.string().trim().min(8).max(1000),
      }),
      body,
    );
    const row = await this.db.$transaction(async (db) => {
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(742159732)`;
      const previous = await db.featureFlag.findUnique({ where: { key: 'hr_exposure_policy' } });
      const before = previous?.payload as { version?: number } | null;
      const payload = {
        version: (before?.version ?? 0) + 1,
        halfLifeDays: input.halfLifeDays,
        cap: input.cap,
        boostAmplitude: input.boostAmplitude,
      };
      const row = await db.featureFlag.upsert({
        where: { key: 'hr_exposure_policy' },
        create: { key: 'hr_exposure_policy', payload },
        update: { payload },
      });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'EXPOSURE_POLICY_VERSION',
          entityType: 'FeatureFlag',
          entityId: row.id,
          metadata: { previous: previous?.payload ?? null, current: payload, reason: input.reason },
        },
      });
      return row;
    });
    this.search.reindexInBackground();
    return row;
  }
  @Post('policies')
  async policy(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseDto(
      z.object({
        code: z.enum(['FREE', 'STANDARD', 'PREMIUM']),
        reason: z.string().trim().min(8).max(1000),
        settings: z.object({
          durationDays: z.literal(30),
          boostDays: z.number().int().min(0).max(30),
          featuredDays: z.number().int().min(0).max(365),
          visibility: z.number().min(1).max(1.8),
          conversions: z.boolean(),
          reports: z.boolean(),
          prioritySupport: z.boolean(),
        }),
      }),
      body,
    );
    return this.db.$transaction(async (db) => {
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(742159731)`;
      const latest = await db.packagePolicy.findMany({ orderBy: { version: 'desc' } });
      const effective = Object.fromEntries(
        ['FREE', 'STANDARD', 'PREMIUM'].map((code) => [
          code,
          code === input.code ? input.settings : latest.find((row) => row.code === code)?.settings,
        ]),
      );
      const policySchema = z.object({
        boostDays: z.number(),
        featuredDays: z.number(),
        visibility: z.number(),
        conversions: z.boolean(),
        reports: z.boolean(),
        prioritySupport: z.boolean(),
      });
      const free = policySchema.parse(effective.FREE),
        standard = policySchema.parse(effective.STANDARD),
        premium = policySchema.parse(effective.PREMIUM);
      for (const field of ['boostDays', 'featuredDays', 'visibility'] as const)
        if (free[field] > standard[field] || standard[field] > premium[field])
          throw new ForbiddenException('Benefits must increase monotonically across tiers');
      if (
        free.boostDays !== 0 ||
        free.featuredDays !== 0 ||
        free.conversions ||
        free.reports ||
        free.prioritySupport ||
        !standard.conversions ||
        standard.reports ||
        standard.prioritySupport ||
        !premium.conversions ||
        !premium.reports ||
        !premium.prioritySupport
      )
        throw new ForbiddenException('Capability hierarchy must be preserved');
      const version = (latest.find((row) => row.code === input.code)?.version ?? 0) + 1;
      const row = await db.packagePolicy.create({
        data: { code: input.code, version, settings: input.settings, createdById: user.id },
      });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'PACKAGE_POLICY_CREATED',
          entityType: 'PackagePolicy',
          entityId: row.id,
          metadata: { reason: input.reason, code: input.code, version },
        },
      });
      return row;
    });
  }
  @Get('companies/:companyId/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Param('companyId') companyId: string,
    @Query('page') raw?: string,
  ) {
    await this.benefits.member(user, companyId);
    const page = parseDto(z.coerce.number().int().min(1).default(1), raw);
    const grants = await this.db.jobPackageGrant.findMany({
      where: { benefit: { companyId } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * 50,
      take: 50,
    });
    return { grants: grants.map(({ candidateDelta: _retired, ...grant }) => grant), page };
  }
  @Post('jobs/:jobId/grants')
  async grant(
    @CurrentUser() user: AuthUser,
    @Param('jobId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const input = parseDto(
      z.object({
        code: z.enum(['STANDARD', 'PREMIUM']),
        reason: z.string().trim().min(8).max(1000),
      }),
      body,
    );
    const result = await this.benefits.grant(user, id, input.code, input.reason, key);
    await this.search.syncJob(id);
    return result;
  }
  @Post('jobs/:jobId/adjustments')
  adjustPromotion(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const input = parseDto(
      z
        .object({
          boostDays: z.number().int().min(-30).max(30),
          featuredDays: z.number().int().min(-365).max(365),
          reason: z.string().trim().min(8).max(1000),
        })
        .refine((value) => value.boostDays !== 0 || value.featuredDays !== 0),
      body,
    );
    return this.benefits.adjustPromotion(user, jobId, input, key);
  }
  @Get('health')
  async health() {
    const [expiryBacklog, operationsNeedingReview, oldestRunning] = await Promise.all([
      this.db.jobBenefit.count({
        where: { expiresAt: { lte: new Date() }, job: { status: { in: ['PUBLISHED', 'PAUSED'] } } },
      }),
      this.db.operationKey.count({ where: { state: 'REVIEW' } }),
      this.db.operationKey.findFirst({
        where: { state: 'RUNNING' },
        orderBy: { createdAt: 'asc' },
        select: { scope: true, createdAt: true },
      }),
    ]);
    return {
      expiryBacklog,
      operationsNeedingReview,
      oldestRunning,
      index: this.search.projectionHealth(),
    };
  }
  @Post('rollout')
  rollout(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.benefits.rollout(user, key);
  }
}
