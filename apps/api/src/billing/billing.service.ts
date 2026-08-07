import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanCode } from '@prisma/client';
import { PLAN_PRICES_UZS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { JobsService } from '../jobs/jobs.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { AuthUser } from '../common/auth.decorators';

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private companies: CompaniesService,
    private jobs: JobsService,
    private payments: MockPaymentProvider,
  ) {}

  /** Auto-confirm mock payments only when explicitly enabled (local/dev). */
  private mockAutoConfirmEnabled() {
    return process.env.PAYMENTS_MOCK === 'true';
  }

  async getSubscription(user: AuthUser, companyId: string) {
    await this.companies.assertMember(user, companyId);
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    const activeJobs = await this.prisma.jobPost.count({
      where: { companyId, status: 'PUBLISHED' },
    });
    return { ...sub, activePublishedJobs: activeJobs, prices: PLAN_PRICES_UZS };
  }

  async upgrade(user: AuthUser, companyId: string, plan: 'STANDARD' | 'PREMIUM') {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const amount = PLAN_PRICES_UZS[plan];
    const intent = await this.payments.createPayment({
      companyId,
      amountUzs: amount,
      purpose: `plan_${plan}`,
      metadata: { plan },
    });

    const payment = await this.prisma.payment.create({
      data: {
        companyId,
        provider: 'mock',
        externalId: intent.id,
        purpose: `plan_${plan}`,
        amountUzs: amount,
        status: 'PENDING',
        metadata: { plan },
      },
    });

    if (this.mockAutoConfirmEnabled()) {
      return this.confirmPayment(user, payment.id, true);
    }
    return payment;
  }

  async buyHotJob(user: AuthUser, companyId: string, jobId: string, days: 7 | 14 | 30) {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== companyId) {
      throw new NotFoundException('Job not found');
    }
    const key = `HOT_JOB_${days}D` as keyof typeof PLAN_PRICES_UZS;
    const amount = PLAN_PRICES_UZS[key];
    const payment = await this.prisma.payment.create({
      data: {
        companyId,
        provider: 'mock',
        externalId: `mock_hot_${Date.now()}`,
        purpose: `hot_job_${days}`,
        amountUzs: amount,
        status: 'PENDING',
        metadata: { jobId, days },
      },
    });
    if (this.mockAutoConfirmEnabled()) {
      return this.confirmPayment(user, payment.id, true);
    }
    return payment;
  }

  async confirmPayment(user: AuthUser, paymentId: string, allowAuto = false) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.companies.assertMember(user, payment.companyId, ['OWNER', 'ADMIN']);

    if (!allowAuto && !this.mockAutoConfirmEnabled()) {
      throw new BadRequestException(
        'Manual payment confirmation is disabled until a real payment provider is configured. Set PAYMENTS_MOCK=true only for local development.',
      );
    }

    if (payment.status === 'MOCKED' || payment.status === 'PAID') {
      return payment;
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'MOCKED' },
    });

    if (payment.purpose.startsWith('plan_')) {
      const plan = payment.purpose.replace('plan_', '') as PlanCode;
      await this.prisma.subscription.update({
        where: { companyId: payment.companyId },
        data: {
          plan,
          status: 'ACTIVE',
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    if (payment.purpose.startsWith('hot_job_')) {
      const meta = payment.metadata as { jobId?: string; days?: number } | null;
      if (meta?.jobId && meta.days) {
        await this.jobs.activateHotJob(
          user,
          meta.jobId,
          meta.days as 7 | 14 | 30,
        );
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'PAYMENT_CONFIRMED',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { purpose: payment.purpose, amountUzs: payment.amountUzs },
      },
    });

    return updated;
  }

  async adminSetPlan(actorId: string, companyId: string, plan: PlanCode) {
    const sub = await this.prisma.subscription.update({
      where: { companyId },
      data: { plan, status: 'ACTIVE', startsAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADMIN_SET_PLAN',
        entityType: 'Company',
        entityId: companyId,
        metadata: { plan },
      },
    });
    return sub;
  }
}
