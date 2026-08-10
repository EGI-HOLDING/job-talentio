import { Injectable } from '@nestjs/common';
import { JobStatus, PlanCode } from '@prisma/client';
import type { CatalogI18nStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobsSearchService } from '../search/jobs-search.service';
import { TranslationService } from '../translation/translation.service';
import { catalogDelegate } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { canTransition } from '../jobs/job-status';

export type BulkSkip = { id: string; reason: string };

export type BulkResult = {
  requested: number;
  applied: number;
  skipped: BulkSkip[];
};

/**
 * Bulk mutations for the admin tables. Two rules hold everywhere: a row that
 * cannot legally change is reported back instead of failing the whole call, and
 * every row that does change gets its own AuditLog entry so per-entity history
 * stays complete.
 */
@Injectable()
export class AdminBulkService {
  constructor(
    private prisma: PrismaService,
    private jobsSearch: JobsSearchService,
    private translation: TranslationService,
  ) {}

  private async audit(
    actorId: string,
    action: string,
    entityType: string,
    entityIds: string[],
    metadata: Record<string, unknown>,
  ) {
    if (!entityIds.length) return;
    await this.prisma.auditLog.createMany({
      data: entityIds.map((entityId) => ({
        actorId,
        action,
        entityType,
        entityId,
        metadata: metadata as never,
      })),
    });
  }

  // ─── Users ────────────────────────────────────────────────

  async banUsers(actorId: string, ids: string[], banned: boolean): Promise<BulkResult> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true, isBanned: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(users.map((u) => u.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets: string[] = [];
    for (const user of users) {
      // An admin locking themselves or a peer out of the console is never a
      // recoverable mistake, so those rows are refused rather than applied.
      if (user.id === actorId) {
        skipped.push({ id: user.id, reason: 'Cannot ban yourself' });
      } else if (user.role === 'SUPER_ADMIN') {
        skipped.push({ id: user.id, reason: 'Cannot ban a super admin' });
      } else if (user.isBanned === banned) {
        skipped.push({ id: user.id, reason: banned ? 'Already banned' : 'Not banned' });
      } else {
        targets.push(user.id);
      }
    }

    if (targets.length) {
      await this.prisma.user.updateMany({
        where: { id: { in: targets } },
        data: { isBanned: banned },
      });
      await this.audit(
        actorId,
        banned ? 'BAN_USER' : 'UNBAN_USER',
        'User',
        targets,
        { bulk: true },
      );
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  // ─── Companies ────────────────────────────────────────────

  async banCompanies(actorId: string, ids: string[], banned: boolean): Promise<BulkResult> {
    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, isBanned: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(companies.map((c) => c.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets = companies
      .filter((c) => {
        if (c.isBanned === banned) {
          skipped.push({ id: c.id, reason: banned ? 'Already banned' : 'Not banned' });
          return false;
        }
        return true;
      })
      .map((c) => c.id);

    if (targets.length) {
      await this.prisma.company.updateMany({
        where: { id: { in: targets } },
        data: { isBanned: banned },
      });
      if (banned) {
        // Same side effect as the single-company path: live postings go quiet.
        await this.prisma.jobPost.updateMany({
          where: { companyId: { in: targets }, status: 'PUBLISHED' },
          data: { status: 'PAUSED' },
        });
      }
      for (const id of targets) void this.jobsSearch.syncCompanyJobs(id);
      await this.audit(
        actorId,
        banned ? 'BAN_COMPANY' : 'UNBAN_COMPANY',
        'Company',
        targets,
        { bulk: true },
      );
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  async setCompanyPlans(actorId: string, ids: string[], plan: PlanCode): Promise<BulkResult> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { companyId: { in: ids } },
      select: { companyId: true, plan: true },
    });

    const skipped: BulkSkip[] = [];
    const withSubscription = new Map(subscriptions.map((s) => [s.companyId, s.plan]));
    const targets: string[] = [];
    for (const id of ids) {
      const current = withSubscription.get(id);
      if (current === undefined) {
        skipped.push({ id, reason: 'No subscription record' });
      } else if (current === plan) {
        skipped.push({ id, reason: `Already on ${plan}` });
      } else {
        targets.push(id);
      }
    }

    if (targets.length) {
      await this.prisma.subscription.updateMany({
        where: { companyId: { in: targets } },
        data: { plan, status: 'ACTIVE', startsAt: new Date() },
      });
      await this.audit(actorId, 'ADMIN_SET_PLAN', 'Company', targets, { plan, bulk: true });
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  // ─── Jobs ─────────────────────────────────────────────────

  async setJobStatuses(actorId: string, ids: string[], status: JobStatus): Promise<BulkResult> {
    const jobs = await this.prisma.jobPost.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(jobs.map((j) => j.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets: string[] = [];
    for (const job of jobs) {
      if (job.status === status) {
        skipped.push({ id: job.id, reason: `Already ${status}` });
      } else if (!canTransition(job.status, status)) {
        skipped.push({ id: job.id, reason: `${job.status} cannot become ${status}` });
      } else {
        targets.push(job.id);
      }
    }

    if (targets.length) {
      await this.prisma.jobPost.updateMany({
        where: { id: { in: targets } },
        data: { status },
      });
      for (const id of targets) void this.jobsSearch.syncJob(id);
      await this.audit(actorId, 'FORCE_JOB_STATUS', 'JobPost', targets, { status, bulk: true });
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  async boostJobs(actorId: string, ids: string[], days: number): Promise<BulkResult> {
    const jobs = await this.prisma.jobPost.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(jobs.map((j) => j.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets = jobs.map((j) => j.id);
    if (targets.length) {
      await this.prisma.jobPost.updateMany({
        where: { id: { in: targets } },
        data: {
          boostWeight: 1,
          boostUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        },
      });
      await this.audit(actorId, 'ADMIN_HOT_JOB', 'JobPost', targets, { days, bulk: true });
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  // ─── Reports ──────────────────────────────────────────────

  async resolveReports(
    actorId: string,
    ids: string[],
    status: 'RESOLVED' | 'DISMISSED',
    resolution?: string,
  ): Promise<BulkResult> {
    const reports = await this.prisma.report.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(reports.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets: string[] = [];
    for (const report of reports) {
      if (report.status !== 'OPEN') {
        skipped.push({ id: report.id, reason: `Already ${report.status}` });
      } else {
        targets.push(report.id);
      }
    }

    if (targets.length) {
      await this.prisma.report.updateMany({
        where: { id: { in: targets } },
        data: { status, resolution },
      });
      await this.audit(actorId, 'RESOLVE_REPORT', 'Report', targets, { status, bulk: true });
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  // ─── Catalog ──────────────────────────────────────────────

  async setCatalogStatuses(
    actorId: string,
    kind: CatalogKind,
    ids: string[],
    status: CatalogI18nStatus,
  ): Promise<BulkResult> {
    const delegate = catalogDelegate(this.prisma, kind);
    const rows = await delegate.findMany({
      where: { id: { in: ids } },
      select: { id: true, i18nStatus: true },
    });

    const skipped: BulkSkip[] = [];
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ id, reason: 'Not found' });
    }

    const targets: string[] = [];
    for (const row of rows) {
      if (row.i18nStatus === status) {
        skipped.push({ id: row.id, reason: `Already ${status}` });
      } else {
        targets.push(row.id);
      }
    }

    if (targets.length) {
      await delegate.updateMany({
        where: { id: { in: targets } },
        data: { i18nStatus: status },
      });
      await this.audit(
        actorId,
        'SET_CATALOG_I18N_STATUS',
        catalogEntityType(kind),
        targets,
        { status, bulk: true },
      );
    }

    return { requested: ids.length, applied: targets.length, skipped };
  }

  /**
   * Machine translation is sequential and stops early when the provider is off
   * or the monthly budget runs out, so one click cannot silently burn it.
   */
  async translateCatalog(
    actorId: string,
    kind: CatalogKind,
    ids: string[],
  ): Promise<BulkResult> {
    const skipped: BulkSkip[] = [];
    const applied: string[] = [];

    for (const id of ids) {
      const result = await this.translation.translateCatalogLabel(kind, id);
      if (result.status === 'ready') {
        applied.push(id);
        continue;
      }
      skipped.push({ id, reason: bulkTranslateReason(result.status) });
      if (result.status === 'disabled' || result.status === 'budget-exceeded') {
        const remaining = ids.slice(ids.indexOf(id) + 1);
        for (const rest of remaining) {
          skipped.push({ id: rest, reason: bulkTranslateReason(result.status) });
        }
        break;
      }
    }

    if (applied.length) {
      await this.audit(
        actorId,
        'TRANSLATE_CATALOG_I18N',
        catalogEntityType(kind),
        applied,
        { bulk: true },
      );
    }

    return { requested: ids.length, applied: applied.length, skipped };
  }
}

function catalogEntityType(kind: CatalogKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function bulkTranslateReason(status: string): string {
  if (status === 'disabled') return 'Machine translation is turned off';
  if (status === 'budget-exceeded') return 'Monthly translation budget is used up';
  if (status === 'unsupported') return 'Provider cannot translate this language';
  if (status === 'exists') return 'Nothing left to translate';
  return 'Translation failed';
}
