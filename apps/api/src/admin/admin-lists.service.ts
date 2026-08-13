import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CompanySize,
  EmploymentType,
  ExperienceLevel,
  JobStatus,
  PlanCode,
  ReportEntityType,
  ReportStatus,
  UserRole,
  WorkMode,
} from '@prisma/client';
import type { z } from 'zod';
import type {
  adminAuditListSchema,
  adminCompanyListSchema,
  adminJobListSchema,
  adminReportListSchema,
  adminUserListSchema,
} from '@job-talentio/shared';
import { MAX_BULK_IDS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  compact,
  dateRange,
  enumFilter,
  envelope,
  inFilter,
  sinceWindow,
  skipFor,
} from './admin-query';

const USER_ROLES = ['EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN'] as const;
const PLAN_CODES = ['FREE', 'STANDARD', 'PREMIUM', 'VIP'] as const;
const COMPANY_SIZES = [
  'SIZE_1_10',
  'SIZE_11_50',
  'SIZE_51_200',
  'SIZE_201_1000',
  'SIZE_1000_PLUS',
] as const;
const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'EXPIRED'] as const;
const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
] as const;
const WORK_MODES = ['ONSITE', 'REMOTE', 'HYBRID'] as const;
const EXPERIENCE_LEVELS = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'] as const;
const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
const REPORT_ENTITY_TYPES = ['JOB_POST', 'USER', 'COMPANY', 'CHAT_MESSAGE'] as const;
const LOCALES = ['uz', 'ru', 'en'] as const;

type UserQuery = z.infer<typeof adminUserListSchema>;
type CompanyQuery = z.infer<typeof adminCompanyListSchema>;
type JobQuery = z.infer<typeof adminJobListSchema>;
type ReportQuery = z.infer<typeof adminReportListSchema>;
type AuditQuery = z.infer<typeof adminAuditListSchema>;

/**
 * Read side of the admin console. Every method returns the same envelope so one
 * table component can drive every section, and every filter is derived from the
 * validated query rather than trusted as-is.
 */
@Injectable()
export class AdminListsService {
  constructor(private prisma: PrismaService) {}

  // ─── Users ────────────────────────────────────────────────

  private userWhere(query: UserQuery): Prisma.UserWhereInput {
    const term = query.q?.trim();
    const seenSince = sinceWindow(query.seenWithin);
    return compact({
      role: inFilter(enumFilter<UserRole>(query.role, USER_ROLES)),
      isBanned: query.banned,
      emailVerified: query.verified,
      locale: inFilter(enumFilter(query.locale, LOCALES)),
      createdAt: dateRange(query.createdFrom, query.createdTo),
      lastSeenAt: seenSince ? { gte: seenSince } : undefined,
      OR: term
        ? [
            { email: { contains: term, mode: 'insensitive' as const } },
            { fullName: { contains: term, mode: 'insensitive' as const } },
          ]
        : undefined,
    });
  }

  async listUsers(query: UserQuery) {
    const where = this.userWhere(query);
    const orderBy = { [query.sort]: query.dir } as Prisma.UserOrderByWithRelationInput;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          locale: true,
          avatarUrl: true,
          isBanned: true,
          emailVerified: true,
          lastSeenAt: true,
          createdAt: true,
          passwordHash: true,
          anonymizedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return envelope(
      items.map(({ passwordHash, anonymizedAt, ...row }) => ({
        ...row,
        hasPassword: Boolean(passwordHash),
        anonymized: Boolean(anonymizedAt),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  userIds(query: UserQuery) {
    return this.matchingIds(
      this.prisma.user.findMany({
        where: this.userWhere(query),
        select: { id: true },
        take: MAX_BULK_IDS,
        orderBy: { [query.sort]: query.dir } as Prisma.UserOrderByWithRelationInput,
      }),
      this.prisma.user.count({ where: this.userWhere(query) }),
    );
  }

  // ─── Companies ────────────────────────────────────────────

  private companyWhere(query: CompanyQuery): Prisma.CompanyWhereInput {
    const term = query.q?.trim();
    const plans = enumFilter<PlanCode>(query.plan, PLAN_CODES);
    return compact({
      isVerified: query.verified,
      isBanned: query.banned,
      size: inFilter(enumFilter<CompanySize>(query.size, COMPANY_SIZES)),
      subscription: plans.length ? { plan: { in: plans } } : undefined,
      industry: query.industrySlug ? { slug: query.industrySlug } : undefined,
      city: query.citySlug ? { slug: query.citySlug } : undefined,
      createdAt: dateRange(query.createdFrom, query.createdTo),
      OR: term
        ? [
            { name: { contains: term, mode: 'insensitive' as const } },
            { slug: { contains: term, mode: 'insensitive' as const } },
          ]
        : undefined,
    });
  }

  private companyOrderBy(query: CompanyQuery): Prisma.CompanyOrderByWithRelationInput {
    if (query.sort === 'jobs') return { jobPosts: { _count: query.dir } };
    return { [query.sort]: query.dir } as Prisma.CompanyOrderByWithRelationInput;
  }

  async listCompanies(query: CompanyQuery) {
    const where = this.companyWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: this.companyOrderBy(query),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          size: true,
          isVerified: true,
          isBanned: true,
          createdAt: true,
          city: { select: { name: true, slug: true } },
          industry: { select: { name: true, slug: true } },
          subscription: { select: { plan: true, status: true } },
          _count: { select: { jobPosts: true, members: true, followers: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);
    return envelope(items, total, query.page, query.limit);
  }

  companyIds(query: CompanyQuery) {
    const where = this.companyWhere(query);
    return this.matchingIds(
      this.prisma.company.findMany({
        where,
        select: { id: true },
        take: MAX_BULK_IDS,
        orderBy: this.companyOrderBy(query),
      }),
      this.prisma.company.count({ where }),
    );
  }

  // ─── Jobs ─────────────────────────────────────────────────

  private jobWhere(query: JobQuery): Prisma.JobPostWhereInput {
    const term = query.q?.trim();
    return compact({
      status: inFilter(enumFilter<JobStatus>(query.status, JOB_STATUSES)),
      employmentType: inFilter(
        enumFilter<EmploymentType>(query.employmentType, EMPLOYMENT_TYPES),
      ),
      workMode: inFilter(enumFilter<WorkMode>(query.workMode, WORK_MODES)),
      experienceLevel: inFilter(
        enumFilter<ExperienceLevel>(query.experienceLevel, EXPERIENCE_LEVELS),
      ),
      companyId: query.companyId || undefined,
      locale: inFilter(enumFilter(query.locale, LOCALES)),
      createdAt: dateRange(query.createdFrom, query.createdTo),
      // "Hot" is not a column: a posting is boosted while boostUntil is ahead of now.
      boostUntil: query.hotOnly ? { gt: new Date() } : undefined,
      OR: term
        ? [
            { title: { contains: term, mode: 'insensitive' as const } },
            { company: { name: { contains: term, mode: 'insensitive' as const } } },
          ]
        : undefined,
    });
  }

  private jobOrderBy(query: JobQuery): Prisma.JobPostOrderByWithRelationInput {
    if (query.sort === 'applications') return { applications: { _count: query.dir } };
    return { [query.sort]: query.dir } as Prisma.JobPostOrderByWithRelationInput;
  }

  async listJobs(query: JobQuery) {
    const where = this.jobWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where,
        orderBy: this.jobOrderBy(query),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: {
          id: true,
          title: true,
          status: true,
          locale: true,
          employmentType: true,
          workMode: true,
          experienceLevel: true,
          boostUntil: true,
          boostWeight: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          company: { select: { id: true, name: true, slug: true } },
          city: { select: { name: true } },
          _count: { select: { applications: true, views: true } },
        },
      }),
      this.prisma.jobPost.count({ where }),
    ]);
    return envelope(items, total, query.page, query.limit);
  }

  jobIds(query: JobQuery) {
    const where = this.jobWhere(query);
    return this.matchingIds(
      this.prisma.jobPost.findMany({
        where,
        select: { id: true },
        take: MAX_BULK_IDS,
        orderBy: this.jobOrderBy(query),
      }),
      this.prisma.jobPost.count({ where }),
    );
  }

  // ─── Reports ──────────────────────────────────────────────

  private reportWhere(query: ReportQuery): Prisma.ReportWhereInput {
    const term = query.q?.trim();
    return compact({
      status: inFilter(enumFilter<ReportStatus>(query.status, REPORT_STATUSES)),
      entityType: inFilter(
        enumFilter<ReportEntityType>(query.entityType, REPORT_ENTITY_TYPES),
      ),
      createdAt: dateRange(query.createdFrom, query.createdTo),
      OR: term
        ? [
            { reason: { contains: term, mode: 'insensitive' as const } },
            { entityId: { contains: term, mode: 'insensitive' as const } },
          ]
        : undefined,
    });
  }

  async listReports(query: ReportQuery) {
    const where = this.reportWhere(query);
    const orderBy = { [query.sort]: query.dir } as Prisma.ReportOrderByWithRelationInput;
    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy,
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        include: { reporter: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.report.count({ where }),
    ]);
    return envelope(items, total, query.page, query.limit);
  }

  reportIds(query: ReportQuery) {
    const where = this.reportWhere(query);
    return this.matchingIds(
      this.prisma.report.findMany({
        where,
        select: { id: true },
        take: MAX_BULK_IDS,
        orderBy: { createdAt: query.dir },
      }),
      this.prisma.report.count({ where }),
    );
  }

  // ─── Audit log ────────────────────────────────────────────

  private auditWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
    const term = query.q?.trim();
    const actions = splitList(query.action);
    const entityTypes = splitList(query.entityType);
    return compact({
      // action and entityType are free-form strings, so they are matched exactly
      // against whatever the writers used rather than an enum.
      action: actions.length ? { in: actions } : undefined,
      entityType: entityTypes.length ? { in: entityTypes } : undefined,
      actorId: query.actorId || undefined,
      createdAt: dateRange(query.createdFrom, query.createdTo),
      OR: term
        ? [
            { entityId: { contains: term, mode: 'insensitive' as const } },
            { action: { contains: term, mode: 'insensitive' as const } },
          ]
        : undefined,
    });
  }

  async listAuditLogs(query: AuditQuery) {
    const where = this.auditWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: query.dir },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        include: { actor: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return envelope(items, total, query.page, query.limit);
  }

  /** Distinct action and entity values, so the log filters offer real choices. */
  async auditFacets() {
    const [actions, entityTypes] = await Promise.all([
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
        take: 200,
      }),
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
        take: 100,
      }),
    ]);
    return {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType),
    };
  }

  /**
   * Ids for "select all matching". Capped at MAX_BULK_IDS while still reporting
   * the true total, so the UI can say the selection is partial.
   */
  private async matchingIds(
    rows: Promise<Array<{ id: string }>>,
    total: Promise<number>,
  ): Promise<{ ids: string[]; total: number; capped: boolean }> {
    const [found, count] = await Promise.all([rows, total]);
    const ids = found.map((row) => row.id);
    return { ids, total: count, capped: count > ids.length };
  }
}

/** Free-form filter values still arrive comma separated. */
function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
