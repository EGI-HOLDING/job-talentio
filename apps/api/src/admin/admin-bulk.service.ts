import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import type { CatalogI18nStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobsSearchService } from '../search/jobs-search.service';
import { TranslationService } from '../translation/translation.service';
import { catalogDelegate } from '../common/i18n/catalog-kind';
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { canTransition } from '../jobs/job-status';
import { JobsService } from '../jobs/jobs.service';
import type { AuthUser } from '../common/auth.decorators';

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
    private jobs: JobsService,
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

  private auditInTransaction(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    entityType: string,
    entityIds: string[],
    metadata: Record<string, unknown>,
  ) {
    if (!entityIds.length) return Promise.resolve();
    return tx.auditLog.createMany({
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

    let applied: string[] = [];
    if (targets.length) {
      applied = await this.prisma.$transaction(async (tx) => {
        const changed: string[] = [];
        for (const id of targets) {
          const result = await tx.user.updateMany({
            where: { id, isBanned: !banned },
            data: {
              isBanned: banned,
              ...(banned ? { tokenVersion: { increment: 1 } } : {}),
            },
          });
          if (result.count) changed.push(id);
        }
        if (banned && changed.length) {
          await tx.refreshToken.updateMany({
            where: { userId: { in: changed }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await this.auditInTransaction(
          tx,
          actorId,
          banned ? 'BAN_USER' : 'UNBAN_USER',
          'User',
          changed,
          { bulk: true },
        );
        return changed;
      }, { maxWait: 10_000, timeout: 15_000 });
      for (const id of targets) {
        if (!applied.includes(id)) skipped.push({ id, reason: 'Account changed by another request' });
      }
    }

    return { requested: ids.length, applied: applied.length, skipped };
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

    let applied: string[] = [];
    if (targets.length) {
      applied = await this.prisma.$transaction(async (tx) => {
        const changed: string[] = [];
        for (const id of targets) {
          const result = await tx.company.updateMany({
            where: { id, isBanned: !banned },
            data: { isBanned: banned },
          });
          if (result.count) changed.push(id);
        }
        if (banned && changed.length) {
          // Same side effect as the single-company path: live postings go quiet.
          await tx.jobPost.updateMany({
            where: { companyId: { in: changed }, status: 'PUBLISHED' },
            data: { status: 'PAUSED' },
          });
        }
        await this.auditInTransaction(
          tx,
          actorId,
          banned ? 'BAN_COMPANY' : 'UNBAN_COMPANY',
          'Company',
          changed,
          { bulk: true },
        );
        return changed;
      }, { maxWait: 10_000, timeout: 15_000 });
      for (const id of targets) {
        if (!applied.includes(id)) skipped.push({ id, reason: 'Company changed by another request' });
      }
      for (const id of applied) {
        void this.jobsSearch.syncCompanyJobs(id).catch(() => undefined);
      }
    }

    return { requested: ids.length, applied: applied.length, skipped };
  }

  // ─── Jobs ─────────────────────────────────────────────────

  async setJobStatuses(user: AuthUser, ids: string[], status: JobStatus): Promise<BulkResult> {
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
        try {
          await this.jobs.changeStatus(user, job.id, status, { actorId: user.id, bulk: true });
          targets.push(job.id);
        } catch (error) {
          skipped.push({ id: job.id, reason: error instanceof Error ? error.message : 'Status change failed' });
        }
      }
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

    const applied = targets.length
      ? await this.prisma.$transaction(async (tx) => {
          const changed: string[] = [];
          for (const id of targets) {
            const result = await tx.report.updateMany({
              where: { id, status: 'OPEN' },
              data: { status, resolution },
            });
            if (result.count) changed.push(id);
          }
          await this.auditInTransaction(tx, actorId, 'RESOLVE_REPORT', 'Report', changed, {
            status,
            bulk: true,
          });
          return changed;
        }, { maxWait: 10_000, timeout: 15_000 })
      : [];
    for (const id of targets) {
      if (!applied.includes(id)) skipped.push({ id, reason: 'Report changed by another request' });
    }
    return { requested: ids.length, applied: applied.length, skipped };
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

    const applied = targets.length
      ? await this.prisma.$transaction(async (tx) => {
          const txDelegate = catalogDelegate(tx as unknown as PrismaClient, kind);
          const changed: string[] = [];
          for (const row of rows) {
            if (!targets.includes(row.id)) continue;
            const result = await txDelegate.updateMany({
              where: { id: row.id, i18nStatus: row.i18nStatus },
              data: { i18nStatus: status },
            });
            if (result.count) changed.push(row.id);
          }
          await this.auditInTransaction(
            tx,
            actorId,
            'SET_CATALOG_I18N_STATUS',
            catalogEntityType(kind),
            changed,
            { status, bulk: true },
          );
          return changed;
        }, { maxWait: 10_000, timeout: 15_000 })
      : [];
    for (const id of targets) {
      if (!applied.includes(id)) skipped.push({ id, reason: 'Catalog entry changed by another request' });
    }
    return { requested: ids.length, applied: applied.length, skipped };
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
