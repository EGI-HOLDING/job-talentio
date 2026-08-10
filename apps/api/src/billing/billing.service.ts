import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { Payment, PlanCode } from '@prisma/client';
import { PLAN_PRICES_UZS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { JobsService } from '../jobs/jobs.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { AuthUser } from '../common/auth.decorators';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private companies: CompaniesService,
    private jobs: JobsService,
    @Inject(PAYMENT_PROVIDER) private payments: PaymentProvider,
  ) {}

  /** Auto-confirm mock payments only when explicitly enabled (local/dev). */
  private mockAutoConfirmEnabled() {
    return process.env.PAYMENTS_MOCK === 'true';
  }

  private checkoutUrlFor(paymentId: string) {
    const base = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/billing/mock-checkout?paymentId=${encodeURIComponent(paymentId)}`;
  }

  private wrapCheckoutResult(payment: { id: string; status: string }) {
    return {
      payment,
      checkoutUrl:
        payment.status === 'PENDING' ? this.checkoutUrlFor(payment.id) : null,
    };
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

  async getPayment(user: AuthUser, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.companies.assertMember(user, payment.companyId, ['OWNER', 'ADMIN']);
    return payment;
  }

  async upgrade(user: AuthUser, companyId: string, plan: 'STANDARD' | 'PREMIUM' | 'VIP') {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const current = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!current) throw new NotFoundException('Subscription not found');
    const order: PlanCode[] = [
      PlanCode.FREE,
      PlanCode.STANDARD,
      PlanCode.PREMIUM,
      PlanCode.VIP,
    ];
    if (order.indexOf(current.plan) >= order.indexOf(plan as PlanCode)) {
      throw new BadRequestException(`Already on ${current.plan} or higher`);
    }
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
        provider: this.payments.name,
        externalId: intent.id,
        purpose: `plan_${plan}`,
        amountUzs: amount,
        status: 'PENDING',
        metadata: { plan },
      },
    });

    if (this.mockAutoConfirmEnabled()) {
      const confirmed = await this.confirmPayment(user, payment.id, true);
      return this.wrapCheckoutResult(confirmed);
    }
    return this.wrapCheckoutResult(payment);
  }

  async buyHotJob(user: AuthUser, companyId: string, jobId: string, days: 7 | 14 | 30) {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== companyId) {
      throw new NotFoundException('Job not found');
    }
    const key = `HOT_JOB_${days}D` as keyof typeof PLAN_PRICES_UZS;
    const amount = PLAN_PRICES_UZS[key];
    const intent = await this.payments.createPayment({
      companyId,
      amountUzs: amount,
      purpose: `hot_job_${days}`,
      metadata: { jobId, days },
    });
    const payment = await this.prisma.payment.create({
      data: {
        companyId,
        provider: this.payments.name,
        externalId: intent.id,
        purpose: `hot_job_${days}`,
        amountUzs: amount,
        status: 'PENDING',
        metadata: { jobId, days },
      },
    });
    if (this.mockAutoConfirmEnabled()) {
      const confirmed = await this.confirmPayment(user, payment.id, true);
      return this.wrapCheckoutResult(confirmed);
    }
    return this.wrapCheckoutResult(payment);
  }

  async confirmPayment(user: AuthUser, paymentId: string, allowAuto = false) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.companies.assertMember(user, payment.companyId, ['OWNER', 'ADMIN']);

    // Explicit mock checkout (provider=mock) is allowed for OWNER/ADMIN.
    // Silent auto-confirm only when PAYMENTS_MOCK=true. Real providers will use webhooks later.
    const isMockProvider = payment.provider === 'mock';
    if (!allowAuto && !this.mockAutoConfirmEnabled() && !isMockProvider) {
      throw new BadRequestException(
        'Manual payment confirmation is disabled until a real payment provider is configured.',
      );
    }

    if (payment.status === 'MOCKED' || payment.status === 'PAID') {
      return payment;
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'MOCKED' },
    });

    await this.applyPaymentEffects(payment);

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

  /** Grant what the payment bought. Caller has already authorized the payment. */
  private async applyPaymentEffects(payment: Payment) {
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
        await this.jobs.activateHotJobSystem(meta.jobId, meta.days as 7 | 14 | 30);
      }
    }
  }

  /**
   * Signature-verified provider webhook - the production-shaped confirm path.
   * Idempotent: already-settled payments are acknowledged without re-applying.
   */
  async handleWebhook(
    providerName: string,
    headers: IncomingHttpHeaders,
    rawBody: Buffer | undefined,
  ) {
    if (providerName !== this.payments.name) {
      throw new NotFoundException('Unknown payment provider');
    }
    if (!rawBody || !rawBody.length) {
      throw new BadRequestException('Empty webhook body');
    }

    const event = this.payments.parseWebhook(headers, rawBody);

    const payment = await this.prisma.payment.findFirst({
      where: { externalId: event.externalId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === 'PAID' || payment.status === 'MOCKED') {
      return { ok: true, paymentId: payment.id, status: payment.status };
    }

    if (event.status === 'FAILED') {
      const failed = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'PAYMENT_WEBHOOK_FAILED',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { purpose: payment.purpose, provider: providerName },
        },
      });
      return { ok: true, paymentId: failed.id, status: failed.status };
    }

    const paid = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID' },
    });
    await this.applyPaymentEffects(paid);
    await this.prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'PAYMENT_WEBHOOK_PAID',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: {
          purpose: payment.purpose,
          amountUzs: payment.amountUzs,
          provider: providerName,
        },
      },
    });
    this.logger.log(`Webhook confirmed payment ${payment.id} (${payment.purpose})`);
    return { ok: true, paymentId: paid.id, status: paid.status };
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
