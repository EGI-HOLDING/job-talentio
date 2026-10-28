import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobPackageCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import {
  BenefitPolicy,
  DAY_MS,
  INITIAL_POLICIES,
  PACKAGE_ORDER,
  HR_PUBLICATION_LOCK,
  initializePublicationPeriods,
  packageSettings,
} from './benefit-policy';
import { OperationsService } from './operations.service';
import type { PurchaseIntent } from './package-catalog';

type Tx = Prisma.TransactionClient;
@Injectable()
export class BenefitsService {
  constructor(
    private db: PrismaService,
    private operations: OperationsService,
  ) {}

  async enabled(key = 'hr_packages', db: Tx = this.db) {
    return (await db.featureFlag.findUnique({ where: { key } }))?.enabled === true;
  }
  async assertEnabled(key = 'hr_packages') {
    if (!(await this.enabled(key))) throw new NotFoundException('Feature is not enabled');
  }
  async member(actor: AuthUser, companyId: string, db: Tx = this.db) {
    if (actor.isBanned) throw new ForbiddenException('Account banned');
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company || company.isBanned || company.anonymizedAt)
      throw new ForbiddenException('Company unavailable');
    if (
      actor.role !== 'SUPER_ADMIN' &&
      !(await db.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: actor.id } },
      }))
    )
      throw new ForbiddenException('Company membership required');
    return company;
  }
  async context(actor: AuthUser, companyId?: string) {
    if (companyId) {
      await this.member(actor, companyId);
      return companyId;
    }
    const memberships = await this.db.companyMember.findMany({
      where: { userId: actor.id, company: { isBanned: false, anonymizedAt: null } },
      select: { companyId: true },
    });
    if (memberships.length !== 1)
      throw new BadRequestException('An explicit companyId is required');
    return memberships[0].companyId;
  }
  private async lock(companyId: string, db: Tx) {
    await db.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`);
  }
  async policy(code: JobPackageCode, db: Tx = this.db) {
    const policy = await db.packagePolicy.findFirst({
      where: { code },
      orderBy: { version: 'desc' },
    });
    if (!policy) throw new ConflictException('Package policy has not been installed');
    return { version: policy.version, settings: packageSettings(policy.settings) };
  }
  private async ensure(jobId: string, db: Tx) {
    const found = await db.jobBenefit.findUnique({ where: { jobId } });
    if (found) return found;
    const job = await db.jobPost.findUniqueOrThrow({ where: { id: jobId } });
    const policy = await this.policy('FREE', db);
    return db.jobBenefit.create({
      data: {
        jobId,
        companyId: job.companyId,
        policyVersion: policy.version,
        policySnapshot: policy.settings,
      },
    });
  }
  private async allocate(benefit: Awaited<ReturnType<BenefitsService['ensure']>>, db: Tx) {
    if (!benefit.startsAt || !benefit.expiresAt) return benefit;
    const policy = benefit.policySnapshot as unknown as BenefitPolicy;
    const featuredDelta = Math.max(0, policy.featuredDays * 86400 - benefit.featuredGrantedSeconds);
    const boostDelta = Math.max(0, policy.boostDays * 86400 + benefit.boostAllowanceOffset - benefit.boostGrantedSeconds);
    if (featuredDelta) {
      const current = await db.companyPromotion.findUnique({
        where: { companyId: benefit.companyId },
      });
      const endsAt = new Date(
        Math.max(Date.now(), current?.endsAt.getTime() ?? 0) + featuredDelta * 1000,
      );
      await db.companyPromotion.upsert({
        where: { companyId: benefit.companyId },
        create: { companyId: benefit.companyId, endsAt, grantedSeconds: featuredDelta },
        update: { endsAt, grantedSeconds: { increment: featuredDelta } },
      });
    }
    await db.jobPublicationPeriod.upsert({where: {jobId_cycle: {jobId: benefit.jobId, cycle: benefit.publicationCycle}},
      create: {jobId: benefit.jobId, companyId: benefit.companyId, cycle: benefit.publicationCycle, code: benefit.code,
        startsAt: benefit.startsAt, expiresAt: benefit.expiresAt, policySnapshot: benefit.policySnapshot as Prisma.InputJsonValue},
      update: {code: benefit.code, policySnapshot: benefit.policySnapshot as Prisma.InputJsonValue},
    });
    return db.jobBenefit.update({
      where: { id: benefit.id },
      data: {
        featuredGrantedSeconds: { increment: featuredDelta },
        boostGrantedSeconds: { increment: boostDelta },
      },
    });
  }
  /** Called inside the same company-locked publication transaction. */
  async publish(jobId: string, db: Tx) {
    if (!(await this.enabled('hr_packages', db)) && !(await this.enabled('hr_rollout', db))) return;
    let benefit = await this.ensure(jobId, db);
    if (!benefit.selectionConfirmedAt && await this.enabled('hr_packages', db))
      throw new ConflictException('PACKAGE_REQUIRED: Choose a package for this job before publishing');
    if (!benefit.selectionConfirmedAt) benefit = await db.jobBenefit.update({where: {id: benefit.id}, data: {selectionConfirmedAt: new Date()}});
    const now = new Date();
    if (benefit.expiresAt && benefit.expiresAt <= now)
      throw new ConflictException('Posting expired. Duplicate it as a new draft.');
    if (!benefit.startsAt) {
      const policy = benefit.policySnapshot as unknown as BenefitPolicy;
      benefit = await db.jobBenefit.update({
        where: { id: benefit.id },
        data: { startsAt: now, expiresAt: new Date(now.getTime() + policy.durationDays * DAY_MS) },
      });
      await this.allocate(benefit, db);
    }
  }
  async grant(actor: AuthUser, jobId: string, code: JobPackageCode, reason: string, key?: string) {
    await this.assertEnabled();
    if (actor.role !== 'SUPER_ADMIN' || actor.isBanned)
      throw new ForbiddenException('Super Admin required');
    const job = await this.db.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    const result = await this.operations.transaction(
      `package:${jobId}`,
      key,
      { actorId: actor.id, code, reason },
      async (db) => {
        await this.lock(job.companyId, db);
        await this.member(actor, job.companyId, db);
        const currentJob = await db.jobPost.findUniqueOrThrow({ where: { id: jobId } });
        let benefit = await this.ensure(jobId, db);
        if (PACKAGE_ORDER.indexOf(code) <= PACKAGE_ORDER.indexOf(benefit.code))
          throw new ConflictException('Only a package upgrade is allowed');
        if (benefit.expiresAt && benefit.expiresAt <= new Date())
          throw new ConflictException('Posting has expired');
        const policy = await this.policy(code, db);
        const before = benefit;
        const prior = packageSettings(before.policySnapshot);
        const effectivePolicy = {
          ...policy.settings,
          visibility: Math.max(prior.visibility, policy.settings.visibility),
          boostDays: Math.max(prior.boostDays, policy.settings.boostDays),
          featuredDays: Math.max(prior.featuredDays, policy.settings.featuredDays),
        };
        benefit = await db.jobBenefit.update({
          where: { id: benefit.id },
          data: {
            code,
            highestCode: code,
            policyVersion: policy.version,
            policySnapshot: effectivePolicy,
            selectionConfirmedAt: new Date(),
          },
        });
        // Existing published jobs are initialized by rollout before grants are enabled.
        if (!benefit.startsAt && currentJob.status !== 'DRAFT')
          throw new ConflictException('Initialize the rollout period before granting this job');
        benefit = await this.allocate(benefit, db);
        const delta = {
          boostDeltaSeconds: benefit.boostGrantedSeconds - before.boostGrantedSeconds,
          featuredDeltaSeconds: benefit.featuredGrantedSeconds - before.featuredGrantedSeconds,
        };
        await db.jobPackageGrant.create({
          data: {
            benefitId: benefit.id,
            actorId: actor.id,
            code,
            policyVersion: policy.version,
            reason,
            ...delta,
          },
        });
        await db.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'JOB_PACKAGE_GRANTED',
            entityType: 'JobPost',
            entityId: jobId,
            metadata: { code, reason, ...delta },
          },
        });
        return benefit;
      },
    );
    return result.value;
  }
  async company(actor: AuthUser, companyId: string) {
    await this.assertEnabled();
    await this.member(actor, companyId);
    const now = new Date();
    const [promotion, premium] = await Promise.all([
      this.db.companyPromotion.findUnique({ where: { companyId } }),
      this.db.jobBenefit.count({
        where: {
          companyId,
          code: 'PREMIUM',
          startsAt: { lte: now },
          expiresAt: { gt: now },
          job: { status: { in: ['PUBLISHED', 'PAUSED'] } },
        },
      }),
    ]);
    return {
      companyId,
      featuredUntil: promotion?.endsAt ?? null,
      prioritySupport: premium > 0,
    };
  }
  async job(actor: AuthUser, jobId: string) {
    await this.assertEnabled();
    const job = await this.db.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException();
    await this.member(actor, job.companyId);
    const benefit = await this.db.jobBenefit.findUnique({
      where: { jobId },
      include: { boosts: { orderBy: { startsAt: 'desc' } } },
    });
    const reportPolicy = {
      settings: benefit?.startsAt
        ? (benefit.policySnapshot as unknown as BenefitPolicy)
        : INITIAL_POLICIES.FREE,
    };
    const reserved =
      benefit?.boosts.reduce(
        (sum, episode) => sum + (episode.endsAt.getTime() - episode.startsAt.getTime()) / 1000,
        0,
      ) ?? 0;
    const boostRemainingSeconds = Math.max(0, (benefit?.boostGrantedSeconds ?? 0) - reserved);
    return {
      code: benefit?.code ?? 'FREE',
      selected: Boolean(benefit?.selectionConfirmedAt),
      startsAt: benefit?.startsAt ?? null,
      expiresAt: benefit?.expiresAt ?? null,
      boostEnabled: await this.enabled('hr_promotions'),
      boostRemainingSeconds,
      boostEffectiveSeconds: Math.max(
        0,
        Math.min(boostRemainingSeconds, ((benefit?.expiresAt?.getTime() ?? 0) - Date.now()) / 1000),
      ),
      activeBoost:
        benefit?.boosts.find(
          (episode) => episode.startsAt <= new Date() && episode.endsAt > new Date(),
        ) ?? null,
      conversions: reportPolicy.settings.conversions,
      reports: reportPolicy.settings.reports,
    };
  }

  /** Commerce holds the company lock and verifies the immutable paid order.
   * An upgrade preserves the period; renewal is available only after expiry. */
  async applyPurchase(
    actor: AuthUser, jobId: string, code: JobPackageCode, intent: PurchaseIntent,
    policy: { version: number; settings: BenefitPolicy }, db: Tx,
  ) {
    const before = await this.ensure(jobId, db);
    const now = new Date();
    if (intent === 'RENEW') {
      if (!before.expiresAt || before.expiresAt > now)
        throw new ConflictException('Renewal is available after this publication period expires');
      // Completed boost episodes remain in the audit ledger; allowances in a new
      // period include those reservations so they cannot be claimed twice.
      const episodes = await db.boostEpisode.findMany({ where: { benefitId: before.id } });
      const reserved = episodes.reduce((sum, row) => sum + (row.endsAt.getTime() - row.startsAt.getTime()) / 1000, 0);
      await db.jobBenefit.update({ where: { id: before.id }, data: {
        code, highestCode: code, policyVersion: policy.version, policySnapshot: policy.settings,
        selectionConfirmedAt: now, startsAt: null, expiresAt: null,
        publicationCycle: {increment: 1},
        boostGrantedSeconds: Math.round(reserved), boostAllowanceOffset: Math.round(reserved), featuredGrantedSeconds: 0,
      } });
      await db.jobPost.update({ where: { id: jobId }, data: { status: 'DRAFT', publishedAt: null, closedAt: null } });
    } else {
      await db.jobBenefit.update({ where: { id: before.id }, data: {
        code, highestCode: code, policyVersion: policy.version, policySnapshot: policy.settings,
        selectionConfirmedAt: now,
      } });
    }
    const benefit = await this.allocate(await db.jobBenefit.findUniqueOrThrow({ where: { jobId } }), db);
    await db.jobPackageGrant.create({ data: {
      benefitId: benefit.id, actorId: actor.id, code, policyVersion: policy.version,
      reason: `CHECKOUT_${intent}`, boostDeltaSeconds: Math.max(0, benefit.boostGrantedSeconds - before.boostGrantedSeconds),
      featuredDeltaSeconds: Math.max(0, benefit.featuredGrantedSeconds - before.featuredGrantedSeconds),
    } });
    return benefit;
  }
  async boost(actor: AuthUser, jobId: string, key?: string) {
    await this.assertEnabled('hr_promotions');
    await this.assertEnabled();
    const job = await this.db.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException();
    await this.member(actor, job.companyId);
    return (
      await this.operations.transaction(
        `boost:${jobId}`,
        key,
        { actorId: actor.id },
        async (db) => {
          await this.lock(job.companyId, db);
          await this.member(actor, job.companyId, db);
          const currentJob = await db.jobPost.findUniqueOrThrow({ where: { id: jobId } });
          if (currentJob.status !== 'PUBLISHED')
            throw new ConflictException('Only published jobs can activate boost');
          const benefit = await db.jobBenefit.findUniqueOrThrow({
            where: { jobId },
            include: { boosts: true },
          });
          const now = new Date();
          if (!benefit.expiresAt || benefit.expiresAt <= now)
            throw new ConflictException('Posting expired');
          if (benefit.boosts.some((episode) => episode.endsAt > now))
            throw new ConflictException('Boost is already active');
          const reserved = benefit.boosts.reduce(
            (sum, episode) => sum + (episode.endsAt.getTime() - episode.startsAt.getTime()) / 1000,
            0,
          );
          const seconds = Math.min(
            benefit.boostGrantedSeconds - reserved,
            (benefit.expiresAt.getTime() - now.getTime()) / 1000,
          );
          if (seconds <= 0) throw new ConflictException('No boost allowance remains');
          const episode = await db.boostEpisode.create({
            data: {
              benefitId: benefit.id,
              startsAt: now,
              endsAt: new Date(now.getTime() + seconds * 1000),
              createdById: actor.id,
            },
          });
          await db.auditLog.create({
            data: {
              actorId: actor.id,
              action: 'JOB_BOOST_ACTIVATED',
              entityType: 'JobPost',
              entityId: jobId,
              metadata: { episodeId: episode.id, seconds },
            },
          });
          return episode;
        },
      )
    ).value;
  }
  async rollout(actor: AuthUser, key?: string) {
    if (actor.role !== 'SUPER_ADMIN' || actor.isBanned) throw new ForbiddenException();
    return (
      await this.operations.transaction('hr-rollout', key, {}, async (db) => {
        await db.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(${HR_PUBLICATION_LOCK}::bigint)`,
        );
        const prior = await db.featureFlag.findUnique({ where: { key: 'hr_rollout' } });
        if (prior?.enabled) return prior.payload;
        const now = new Date();
        await initializePublicationPeriods(db, now);
        await db.featureFlag.upsert({
          where: { key: 'hr_rollout' },
          create: { key: 'hr_rollout', enabled: true, payload: { startsAt: now.toISOString() } },
          update: { enabled: true, payload: { startsAt: now.toISOString() } },
        });
        await db.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'HR_ROLLOUT_INITIALIZED',
            entityType: 'FeatureFlag',
            metadata: { startsAt: now.toISOString() },
          },
        });
        return { startsAt: now.toISOString() };
      })
    ).value;
  }

  async adjustPromotion(
    actor: AuthUser,
    jobId: string,
    input: { boostDays: number; featuredDays: number; reason: string },
    key?: string,
  ) {
    await this.assertEnabled();
    if (actor.role !== 'SUPER_ADMIN' || actor.isBanned) throw new ForbiddenException();
    const job = await this.db.jobPost.findUniqueOrThrow({ where: { id: jobId } });
    await this.member(actor, job.companyId);
    return (
      await this.operations.transaction(
        'promotion-adjustment:' + jobId,
        key,
        { actorId: actor.id, ...input },
        async (db) => {
          await this.lock(job.companyId, db);
          await this.member(actor, job.companyId, db);
          const benefit = await db.jobBenefit.findUniqueOrThrow({
            where: { jobId },
            include: { boosts: true },
          });
          if (
            !benefit.startsAt ||
            !benefit.expiresAt ||
            benefit.expiresAt <= new Date() ||
            benefit.code === 'FREE'
          )
            throw new ConflictException('An active Standard or Premium grant is required');
          const boostDeltaSeconds = Math.round(input.boostDays * 86400),
            featuredDeltaSeconds = Math.round(input.featuredDays * 86400);
          const reserved = benefit.boosts.reduce(
            (sum, row) => sum + (row.endsAt.getTime() - row.startsAt.getTime()) / 1000,
            0,
          );
          if (
            benefit.boostGrantedSeconds + boostDeltaSeconds < reserved ||
            benefit.featuredGrantedSeconds + featuredDeltaSeconds < 0
          )
            throw new ConflictException('Already reserved or used benefits cannot be removed');
          const promotion = await db.companyPromotion.findUnique({
            where: { companyId: job.companyId },
          });
          const end = new Date(
            Math.max(Date.now(), promotion?.endsAt.getTime() ?? 0) + featuredDeltaSeconds * 1000,
          );
          if (featuredDeltaSeconds < 0 && end < new Date())
            throw new ConflictException('Featured time has already elapsed');
          await db.jobBenefit.update({
            where: { id: benefit.id },
            data: {
              boostGrantedSeconds: { increment: boostDeltaSeconds },
              featuredGrantedSeconds: { increment: featuredDeltaSeconds },
            },
          });
          if (featuredDeltaSeconds)
            await db.companyPromotion.upsert({
              where: { companyId: job.companyId },
              create: {
                companyId: job.companyId,
                endsAt: end,
                grantedSeconds: featuredDeltaSeconds,
              },
              update: { endsAt: end, grantedSeconds: { increment: featuredDeltaSeconds } },
            });
          await db.jobPackageGrant.create({
            data: {
              benefitId: benefit.id,
              actorId: actor.id,
              code: benefit.code,
              policyVersion: benefit.policyVersion,
              reason: input.reason,
              boostDeltaSeconds,
              featuredDeltaSeconds,
            },
          });
          await db.auditLog.create({
            data: {
              actorId: actor.id,
              action: 'PROMOTION_BENEFIT_ADJUSTMENT',
              entityType: 'JobPost',
              entityId: jobId,
              metadata: input,
            },
          });
          return { boostDeltaSeconds, featuredDeltaSeconds };
        },
      )
    ).value;
  }
}
