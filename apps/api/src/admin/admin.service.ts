import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogI18nStatus, JobStatus, PlanCode } from '@prisma/client';
import type { z } from 'zod';
import type { adminCatalogListSchema } from '@job-talentio/shared';
import { MAX_BULK_IDS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dateRange, envelope, skipFor } from './admin-query';
import { BillingService } from '../billing/billing.service';
import { JobsSearchService } from '../search/jobs-search.service';
import { TranslationService } from '../translation/translation.service';
import {
  allowsTechIdentity,
  catalogAlias,
  catalogDelegate,
  relationDelegate,
  CATALOG_RELATIONS,
} from '../common/i18n/catalog-kind';
import type { CatalogKind, CatalogRelation } from '../common/i18n/catalog-kind';
import { isCatalogTechIdentity } from '../common/i18n/catalog-tech-identity';
import { normalizeSkillKey } from '../common/skill-resolve';
import { normalizeJobTitleKey } from '../common/title-resolve';
import { benefitKey } from '../common/benefit-resolve';
import { languageKey } from '../common/language-resolve';

type CatalogListQuery = z.infer<typeof adminCatalogListSchema>;

/** Audit rows store the Prisma model name so they read like the other entries. */
function catalogEntityType(kind: CatalogKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Same normalization the resolvers use, so a merged spelling still matches. */
function catalogAliasKey(kind: CatalogKind, name: string): string {
  if (kind === 'skill') return normalizeSkillKey(name);
  if (kind === 'jobTitle') return normalizeJobTitleKey(name);
  if (kind === 'benefit') return benefitKey(name);
  return languageKey(name);
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private jobsSearch: JobsSearchService,
    private translation: TranslationService,
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

  async banUser(actorId: string, userId: string, banned: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isBanned: true,
        createdAt: true,
      },
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
    void this.jobsSearch.syncCompanyJobs(companyId);
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
    void this.jobsSearch.syncJob(jobId);
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

  /**
   * Review queue for catalogs users can extend. Rows are returned with their raw
   * locale columns because an admin edits them directly; the response is exempt
   * from the locale rewrite for the same reason.
   */
  async listCatalogI18n(query: CatalogListQuery) {
    const delegate = catalogDelegate(this.prisma, query.kind);
    const where = this.catalogWhere(query);

    const [items, total] = await Promise.all([
      delegate.findMany({
        where,
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        orderBy: { [query.sort]: query.dir },
        select: {
          id: true,
          name: true,
          nameUz: true,
          nameRu: true,
          nameUzIsMachine: true,
          nameRuIsMachine: true,
          i18nStatus: true,
          createdAt: true,
        },
      }),
      delegate.count({ where }),
    ]);

    return { kind: query.kind, status: query.status, ...envelope(items, total, query.page, query.limit) };
  }

  /** Ids for "select all matching", capped like every other bulk source. */
  async catalogI18nIds(query: CatalogListQuery) {
    const delegate = catalogDelegate(this.prisma, query.kind);
    const where = this.catalogWhere(query);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        take: MAX_BULK_IDS,
        orderBy: { [query.sort]: query.dir },
        select: { id: true },
      }),
      delegate.count({ where }),
    ]);
    const ids = rows.map((row) => row.id);
    return { ids, total, capped: total > ids.length };
  }

  private catalogWhere(query: CatalogListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = { i18nStatus: query.status };
    const term = query.q?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { nameUz: { contains: term, mode: 'insensitive' } },
        { nameRu: { contains: term, mode: 'insensitive' } },
      ];
    }
    const created = dateRange(query.createdFrom, query.createdTo);
    if (created) where.createdAt = created;
    return where;
  }

  /** Counts per status, so the admin nav can show how much work is waiting. */
  async catalogI18nSummary() {
    const kinds: CatalogKind[] = ['skill', 'jobTitle', 'language', 'benefit'];
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const delegate = catalogDelegate(this.prisma, kind);
        const [pending, complete, ignored] = await Promise.all([
          delegate.count({ where: { i18nStatus: 'PENDING' } }),
          delegate.count({ where: { i18nStatus: 'COMPLETE' } }),
          delegate.count({ where: { i18nStatus: 'IGNORED' } }),
        ]);
        return [kind, { pending, complete, ignored }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /** Admin wording is human by definition, so the machine flags are cleared. */
  async updateCatalogEntry(
    actorId: string,
    kind: CatalogKind,
    id: string,
    patch: { name?: string; nameUz?: string | null; nameRu?: string | null },
  ) {
    const delegate = catalogDelegate(this.prisma, kind);
    const row = await delegate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Name cannot be empty');
      data.name = name;
    }
    if (patch.nameUz !== undefined) {
      data.nameUz = patch.nameUz?.trim() || null;
      data.nameUzIsMachine = false;
    }
    if (patch.nameRu !== undefined) {
      data.nameRu = patch.nameRu?.trim() || null;
      data.nameRuIsMachine = false;
    }
    if (!Object.keys(data).length) return row;

    const nameUz = 'nameUz' in data ? (data.nameUz as string | null) : row.nameUz;
    const nameRu = 'nameRu' in data ? (data.nameRu as string | null) : row.nameRu;
    if (row.i18nStatus !== 'IGNORED') {
      data.i18nStatus = nameUz && nameRu ? 'COMPLETE' : 'PENDING';
    }

    const updated = await delegate.update({ where: { id }, data });
    await this.logCatalogAction(actorId, kind, id, 'UPDATE_CATALOG_I18N', {
      fields: Object.keys(data),
    });
    return updated;
  }

  async translateCatalogEntry(actorId: string, kind: CatalogKind, id: string) {
    const result = await this.translation.translateCatalogLabel(kind, id);
    if (result.status === 'ready') {
      await this.logCatalogAction(actorId, kind, id, 'TRANSLATE_CATALOG_I18N', {
        filled: result.filled,
      });
    }
    return result;
  }

  /** Marks a label that reads the same everywhere, so it leaves the queue. */
  async setCatalogStatus(
    actorId: string,
    kind: CatalogKind,
    id: string,
    status: CatalogI18nStatus,
  ) {
    const delegate = catalogDelegate(this.prisma, kind);
    const row = await delegate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    const updated = await delegate.update({ where: { id }, data: { i18nStatus: status } });
    await this.logCatalogAction(actorId, kind, id, 'SET_CATALOG_I18N_STATUS', { status });
    return updated;
  }

  /**
   * Folds a duplicate into a canonical row: everything pointing at the duplicate
   * is repointed, its spellings become aliases of the survivor, and the row is
   * deleted so future user input can no longer match it.
   */
  async mergeCatalogEntry(
    actorId: string,
    kind: CatalogKind,
    id: string,
    targetId: string,
  ) {
    if (id === targetId) throw new BadRequestException('Cannot merge an entry into itself');

    const delegate = catalogDelegate(this.prisma, kind);
    const [source, target] = await Promise.all([
      delegate.findUnique({ where: { id } }),
      delegate.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) throw new NotFoundException();

    for (const relation of CATALOG_RELATIONS[kind]) {
      await this.repointRelation(relation, id, targetId);
    }

    const { delegate: alias, foreignKey } = catalogAlias(this.prisma, kind);
    await alias.updateMany({ where: { [foreignKey]: id }, data: { [foreignKey]: targetId } });
    // The duplicate's own spelling has to survive as an alias, otherwise the
    // next user typing it would simply recreate the row.
    const aliasKey = catalogAliasKey(kind, source.name);
    if (aliasKey && aliasKey !== catalogAliasKey(kind, target.name)) {
      await alias
        .create({
          data: { [foreignKey]: targetId, alias: source.name.slice(0, 80), aliasKey },
        })
        .catch(() => undefined);
    }

    await (this.prisma[kind] as { delete: (args: unknown) => Promise<unknown> }).delete({
      where: { id },
    });
    await this.logCatalogAction(actorId, kind, id, 'MERGE_CATALOG_I18N', {
      targetId,
      mergedName: source.name,
    });
    return { ok: true, mergedInto: targetId };
  }

  /** Rows that would collide with an existing pair are dropped, not moved. */
  private async repointRelation(relation: CatalogRelation, id: string, targetId: string) {
    const delegate = relationDelegate(this.prisma, relation.model);
    if (!relation.owner) {
      await delegate.updateMany({
        where: { [relation.key]: id },
        data: { [relation.key]: targetId },
      });
      return;
    }

    const [sourceRows, targetRows] = await Promise.all([
      delegate.findMany({
        where: { [relation.key]: id },
        select: { id: true, [relation.owner]: true },
      }),
      delegate.findMany({
        where: { [relation.key]: targetId },
        select: { [relation.owner]: true },
      }),
    ]);
    const owned = new Set(targetRows.map((row) => row[relation.owner as string]));

    const duplicates = sourceRows
      .filter((row) => owned.has(row[relation.owner as string]))
      .map((row) => row.id);
    if (duplicates.length) {
      await delegate.deleteMany({ where: { id: { in: duplicates } } });
    }
    await delegate.updateMany({
      where: { [relation.key]: id },
      data: { [relation.key]: targetId },
    });
  }

  /** Re-runs the create-time classifier over everything still awaiting review. */
  async reclassifyCatalog(actorId: string, kind: CatalogKind) {
    if (!allowsTechIdentity(kind)) return { kind, ignored: 0 };

    const delegate = catalogDelegate(this.prisma, kind);
    const pending = await delegate.findMany({
      where: { i18nStatus: 'PENDING' },
      select: { id: true, name: true },
    });
    const ids = pending.filter((row) => isCatalogTechIdentity(row.name)).map((row) => row.id);
    if (ids.length) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'RECLASSIFY_CATALOG_I18N',
          entityType: catalogEntityType(kind),
          entityId: kind,
          metadata: { ignored: ids.length },
        },
      });
      for (const id of ids) {
        await delegate.update({ where: { id }, data: { i18nStatus: 'IGNORED' } });
      }
    }
    return { kind, ignored: ids.length };
  }

  private logCatalogAction(
    actorId: string,
    kind: CatalogKind,
    entityId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType: catalogEntityType(kind),
        entityId,
        metadata: metadata as never,
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
