import { Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, PlanCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  async metrics() {
    const [users, companies, jobs, applications, payments] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.company.count(),
      this.prisma.jobPost.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.application.count(),
      this.prisma.payment.aggregate({
        _sum: { amountUzs: true },
        where: { status: { in: ['PAID', 'MOCKED'] } },
      }),
    ]);
    return {
      users,
      companies,
      publishedJobs: jobs,
      applications,
      revenueUzs: payments._sum.amountUzs ?? 0,
    };
  }

  listUsers(page = 1, limit = 50) {
    return this.prisma.user.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isBanned: true,
        createdAt: true,
      },
    });
  }

  async banUser(actorId: string, userId: string, banned: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: banned ? 'BAN_USER' : 'UNBAN_USER',
        entityType: 'User',
        entityId: userId,
      },
    });
    return user;
  }

  listCompanies(page = 1, limit = 50) {
    return this.prisma.company.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: true,
        _count: { select: { jobPosts: true, members: true } },
      },
    });
  }

  async banCompany(actorId: string, companyId: string, banned: boolean) {
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { isBanned: banned },
    });
    if (banned) {
      await this.prisma.jobPost.updateMany({
        where: { companyId, status: 'PUBLISHED' },
        data: { status: 'PAUSED' },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: banned ? 'BAN_COMPANY' : 'UNBAN_COMPANY',
        entityType: 'Company',
        entityId: companyId,
      },
    });
    return company;
  }

  listJobs(page = 1, limit = 50) {
    return this.prisma.jobPost.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async forceJobStatus(actorId: string, jobId: string, status: JobStatus) {
    const job = await this.prisma.jobPost.update({
      where: { id: jobId },
      data: { status },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'FORCE_JOB_STATUS',
        entityType: 'JobPost',
        entityId: jobId,
        metadata: { status },
      },
    });
    return job;
  }

  setPlan(actorId: string, companyId: string, plan: PlanCode) {
    return this.billing.adminSetPlan(actorId, companyId, plan);
  }

  async setHotJob(actorId: string, jobId: string, days: number) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException();
    const updated = await this.prisma.jobPost.update({
      where: { id: jobId },
      data: {
        boostWeight: 1,
        boostUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'ADMIN_HOT_JOB',
        entityType: 'JobPost',
        entityId: jobId,
        metadata: { days },
      },
    });
    return updated;
  }

  listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  upsertFlag(actorId: string, key: string, enabled: boolean, payload?: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.upsert({
        where: { key },
        create: { key, enabled, payload: payload as never },
        update: { enabled, payload: payload as never },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'UPSERT_FEATURE_FLAG',
          entityType: 'FeatureFlag',
          entityId: flag.id,
          metadata: { key, enabled },
        },
      });
      return flag;
    });
  }

  auditLogs(page = 1, limit = 50) {
    return this.prisma.auditLog.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, email: true, fullName: true } } },
    });
  }

  listReports(page = 1, limit = 50) {
    return this.prisma.report.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  resolveReport(
    actorId: string,
    reportId: string,
    status: 'RESOLVED' | 'DISMISSED',
    resolution?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id: reportId },
        data: { status, resolution },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'RESOLVE_REPORT',
          entityType: 'Report',
          entityId: reportId,
          metadata: { status },
        },
      });
      return report;
    });
  }
}
