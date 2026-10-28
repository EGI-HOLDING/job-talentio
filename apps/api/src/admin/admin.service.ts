import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogI18nStatus, JobStatus, Prisma } from '@prisma/client';
import { HR_PUBLICATION_LOCK, initializePublicationPeriods } from '../benefits/benefit-policy';
import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { adminCatalogListSchema } from '@job-talentio/shared';
import { MAX_BULK_IDS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { dateRange, envelope, skipFor } from './admin-query';
import { JobsSearchService } from '../search/jobs-search.service';
import { TranslationService } from '../translation/translation.service';
import { JobsService } from '../jobs/jobs.service';
import type { AuthUser } from '../common/auth.decorators';
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
    private jobsSearch: JobsSearchService,
    private translation: TranslationService,
    private jobs: JobsService,
  ) {}

  async metrics() {
    const [users, companies, jobs, applications] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.company.count(),
      this.prisma.jobPost.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.application.count(),
    ]);
    return {
      users,
      companies,
      publishedJobs: jobs,
      applications,
    };
  }

  async banCompany(actorId: string, companyId: string, banned: boolean) {
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.company.updateMany({
        where: { id: companyId, isBanned: !banned },
        data: { isBanned: banned },
      });
      if (!changed.count) {
        const current = await tx.company.findUnique({ where: { id: companyId } });
        if (!current) throw new NotFoundException('Company not found');
        if (current.isBanned !== banned) throw new ConflictException('Company changed. Refresh and try again.');
        return { company: current, changed: false };
      }
      if (banned) {
        await tx.jobPost.updateMany({
          where: { companyId, status: 'PUBLISHED' },
          data: { status: 'PAUSED' },
        });
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: banned ? 'BAN_COMPANY' : 'UNBAN_COMPANY',
          entityType: 'Company',
          entityId: companyId,
        },
      });
      return { company, changed: true };
    });
    if (result.changed) void this.jobsSearch.syncCompanyJobs(companyId).catch(() => undefined);
    return result.company;
  }

  async forceJobStatus(user: AuthUser, jobId: string, status: JobStatus) {
    return this.jobs.changeStatus(user, jobId, status, { actorId: user.id });
  }

  listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  upsertFlag(actorId: string, key: string, enabled: boolean, payload?: unknown) {
    return this.prisma.$transaction(async (tx) => {
      if(['hr_rollout','hr_exposure_policy'].includes(key))throw new BadRequestException('Use the dedicated HR benefits control for this policy');
      if (key.startsWith('hr_')) await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(${HR_PUBLICATION_LOCK}::bigint)`);
      if (enabled && key === 'hr_packages' && !(await tx.featureFlag.findUnique({where:{key:'hr_rollout'}}))?.enabled) throw new BadRequestException('Initialize the HR rollout before enabling packages');
      if (enabled && key === 'hr_packages') {
        const rollout = await tx.featureFlag.findUniqueOrThrow({ where: { key: 'hr_rollout' } });
        const startsAt = new Date((rollout.payload as { startsAt: string }).startsAt);
        if (!Number.isFinite(startsAt.getTime())) throw new BadRequestException('Invalid HR rollout period');
        await initializePublicationPeriods(tx, startsAt);
      }
      if(enabled && ['hr_promotions','hr_support'].includes(key) && !(await tx.featureFlag.findUnique({where:{key:'hr_packages'}}))?.enabled) throw new BadRequestException('Enable HR packages first');
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
          nameRu: true, nameId: true,
          nameUzIsMachine: true,
          nameRuIsMachine: true,
          nameIdIsMachine: true,
          i18nStatus: true,
          createdAt: true,
        },
      }),
      delegate.count({ where }),
    ]);

    return {
      kind: query.kind,
      status: query.status ?? null,
      ...envelope(items, total, query.page, query.limit),
    };
  }

  /** Returns only explicitly selected translation rows for admin exports. */
  async selectedCatalogI18n(kind: CatalogKind, ids: string[]) {
    const delegate = catalogDelegate(this.prisma, kind);
    const items = await delegate.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        nameUz: true,
        nameRu: true,
        nameId: true,
        nameUzIsMachine: true,
        nameRuIsMachine: true,
        nameIdIsMachine: true,
        i18nStatus: true,
        createdAt: true,
      },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
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
    // No status means every state, which is how an admin finds a merge target
    // that sits in a different part of the queue.
    const where: Record<string, unknown> = query.status ? { i18nStatus: query.status } : {};
    const term = query.q?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { nameUz: { contains: term, mode: 'insensitive' } },
        { nameRu: { contains: term, mode: 'insensitive' } },
        { nameId: { contains: term, mode: 'insensitive' } },
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
    patch: { name?: string; nameUz?: string | null; nameRu?: string | null; nameId?: string | null },
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
    if (patch.nameId !== undefined) {
      data.nameId = patch.nameId?.trim() || null;
      data.nameIdIsMachine = false;
    }
    if (!Object.keys(data).length) return row;

    const nameUz = 'nameUz' in data ? (data.nameUz as string | null) : row.nameUz;
    const nameRu = 'nameRu' in data ? (data.nameRu as string | null) : row.nameRu;
    const nameId = 'nameId' in data ? (data.nameId as string | null) : row.nameId;
    if (row.i18nStatus !== 'IGNORED') {
      data.i18nStatus = nameUz && nameRu && nameId ? 'COMPLETE' : 'PENDING';
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

    return this.prisma.$transaction(async (tx) => {
      const client = tx as unknown as PrismaClient;
      const delegate = catalogDelegate(client, kind);
      const [source, target] = await Promise.all([
        delegate.findUnique({ where: { id } }),
        delegate.findUnique({ where: { id: targetId } }),
      ]);
      if (!source || !target) throw new NotFoundException();

      for (const relation of CATALOG_RELATIONS[kind]) {
        await this.repointRelation(client, relation, id, targetId);
      }

      const { delegate: alias, foreignKey } = catalogAlias(client, kind);
      await alias.updateMany({ where: { [foreignKey]: id }, data: { [foreignKey]: targetId } });
      // The duplicate's own spelling has to survive as an alias, otherwise the
      // next user typing it would simply recreate the row. A collision with a
      // different canonical row must abort the whole merge instead of vanishing.
      const aliasKey = catalogAliasKey(kind, source.name);
      if (aliasKey && aliasKey !== catalogAliasKey(kind, target.name)) {
        const existingAlias = await alias.findUnique({ where: { aliasKey } });
        const currentOwner = existingAlias?.[foreignKey as keyof typeof existingAlias];
        if (existingAlias && currentOwner !== targetId) {
          throw new BadRequestException('The duplicate name is already an alias of another catalog entry');
        }
        if (!existingAlias) {
          await alias.create({
            data: { [foreignKey]: targetId, alias: source.name.slice(0, 80), aliasKey },
          });
        }
      }

      await (client[kind] as { delete: (args: unknown) => Promise<unknown> }).delete({
        where: { id },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'MERGE_CATALOG_I18N',
          entityType: catalogEntityType(kind),
          entityId: id,
          metadata: { targetId, mergedName: source.name },
        },
      });
      return { ok: true, mergedInto: targetId };
    });
  }

  /** Rows that would collide with an existing pair are dropped, not moved. */
  private async repointRelation(prisma: PrismaClient, relation: CatalogRelation, id: string, targetId: string) {
    const delegate = relationDelegate(prisma, relation.model);
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
    if (!ids.length) return { kind, ignored: 0 };
    const ignored = await this.prisma.$transaction(async (tx) => {
      const txDelegate = catalogDelegate(tx as unknown as PrismaClient, kind);
      const updated = await txDelegate.updateMany({
        where: { id: { in: ids }, i18nStatus: 'PENDING' },
        data: { i18nStatus: 'IGNORED' },
      });
      if (updated.count) {
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'RECLASSIFY_CATALOG_I18N',
            entityType: catalogEntityType(kind),
            entityId: kind,
            metadata: { ignored: updated.count },
          },
        });
      }
      return updated.count;
    });
    return { kind, ignored };
  }

  /**
   * Runs a catalog write and records it. The entity id comes from the result
   * for a create, where it does not exist yet at call time.
   */
  async auditCatalogWrite<T>(
    actorId: string,
    type: string,
    action: string,
    run: () => Promise<T>,
    entityId?: string,
  ): Promise<T> {
    const result = await run();
    const id = entityId ?? (result as { id?: string } | null)?.id;
    if (id) {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          action,
          entityType: type.charAt(0).toUpperCase() + type.slice(1),
          entityId: id,
          metadata: { catalogType: type } as never,
        },
      });
    }
    return result;
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
      const claimed = await tx.report.updateMany({
        where: { id: reportId, status: 'OPEN' },
        data: { status, resolution },
      });
      if (!claimed.count) {
        const exists = await tx.report.findUnique({ where: { id: reportId }, select: { id: true } });
        if (!exists) throw new NotFoundException('Report not found');
        throw new BadRequestException('Report was already resolved');
      }
      const report = await tx.report.findUniqueOrThrow({ where: { id: reportId } });
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
