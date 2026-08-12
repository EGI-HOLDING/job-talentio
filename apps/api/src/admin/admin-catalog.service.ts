import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertCatalogLabel, catalogSlugify } from '../common/lookup-normalize';
import { normalizeSkillKey, resolveSkill, skillSlugify } from '../common/skill-resolve';
import {
  jobTitleSlugify,
  normalizeJobTitleKey,
  resolveJobTitle,
} from '../common/title-resolve';
import { languageKey, resolveLanguage } from '../common/language-resolve';
import { benefitKey, resolveBenefit } from '../common/benefit-resolve';
import { catalogAlias, isCatalogKind } from '../common/i18n/catalog-kind';
import { dateRange, envelope, skipFor } from './admin-query';
import {
  CATALOG_SPECS,
  CATALOG_TYPES,
  catalogDelegateFor,
  catalogSelect,
  countingDelegate,
} from './catalog-registry';
import type { CatalogRecord, CatalogSpec, CatalogType } from './catalog-registry';

export type CatalogListQuery = {
  q?: string;
  archived: 'true' | 'false' | 'any';
  sort: 'name' | 'createdAt' | 'sortOrder';
  dir: 'asc' | 'desc';
  page: number;
  limit: number;
  parentSlug?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type UsageBreakdown = { total: number; byRelation: Array<{ label: string; count: number }> };

@Injectable()
export class AdminCatalogService {
  constructor(private prisma: PrismaService) {}

  /** Registry the console uses to render forms and columns per catalog. */
  kinds() {
    return CATALOG_TYPES.map((type) => {
      const spec = CATALOG_SPECS[type];
      return {
        type: spec.type,
        label: spec.label,
        keyField: spec.keyField,
        hasLocaleNames: spec.hasLocaleNames,
        hasI18nStatus: spec.hasI18nStatus,
        hasSortOrder: spec.hasSortOrder,
        hasIcon: spec.hasIcon,
        parent: spec.parent ?? null,
        seedManaged: spec.seedManaged,
        supportsMerge: spec.supportsMerge,
        usageLabels: spec.usage.map((u) => u.label),
      };
    });
  }

  async list(type: CatalogType, query: CatalogListQuery) {
    const spec = CATALOG_SPECS[type];
    const delegate = catalogDelegateFor(this.prisma, type);
    const where = this.buildWhere(spec, query);

    const orderBy =
      query.sort === 'sortOrder' && spec.hasSortOrder
        ? [{ sortOrder: query.dir }, { name: 'asc' as const }]
        : query.sort === 'createdAt' && this.hasCreatedAt(spec)
          ? { createdAt: query.dir }
          : { name: query.dir };

    const [items, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy,
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: {
          ...catalogSelect(spec),
          ...(this.hasCreatedAt(spec) ? { createdAt: true } : {}),
          ...(spec.parent ? { [spec.parent.type]: { select: { name: true, slug: true } } } : {}),
        },
      }),
      delegate.count({ where }),
    ]);

    return { type, ...envelope(items, total, query.page, query.limit) };
  }

  private buildWhere(spec: CatalogSpec, query: CatalogListQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.archived === 'true') where.archivedAt = { not: null };
    else if (query.archived === 'false') where.archivedAt = null;

    const term = query.q?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { [spec.keyField]: { contains: term, mode: 'insensitive' } },
        ...(spec.hasLocaleNames
          ? [
              { nameUz: { contains: term, mode: 'insensitive' } },
              { nameRu: { contains: term, mode: 'insensitive' } },
            ]
          : []),
      ];
    }

    if (query.parentSlug && spec.parent) {
      where[spec.parent.type] = { slug: query.parentSlug };
    }

    if (this.hasCreatedAt(spec)) {
      const created = dateRange(query.createdFrom, query.createdTo);
      if (created) where.createdAt = created;
    }
    return where;
  }

  /** City, JobCategory, Industry and IndustryGroup have no createdAt column. */
  private hasCreatedAt(spec: CatalogSpec): boolean {
    return !['city', 'jobCategory', 'industry', 'industryGroup'].includes(spec.type);
  }

  async get(type: CatalogType, id: string) {
    const spec = CATALOG_SPECS[type];
    const row = await catalogDelegateFor(this.prisma, type).findUnique({
      where: { id },
      select: catalogSelect(spec),
    });
    if (!row) throw new NotFoundException('Catalog entry not found');
    return row;
  }

  /**
   * Counts everything that would break if the row disappeared. Used both for
   * the confirm dialog and to decide between purge and archive.
   */
  async usage(type: CatalogType, id: string): Promise<UsageBreakdown> {
    const spec = CATALOG_SPECS[type];
    const counts = await Promise.all(
      spec.usage.map(async (relation) => ({
        label: relation.label,
        count: await countingDelegate(this.prisma, relation.model).count({
          where: { [relation.field]: id },
        }),
      })),
    );
    return {
      total: counts.reduce((sum, c) => sum + c.count, 0),
      byRelation: counts.filter((c) => c.count > 0),
    };
  }

  /**
   * Creates through the matching resolver where one exists, so `normalizedKey`,
   * slug and aliases follow the same rules as user input. A raw insert would
   * produce a row the matcher can never find again.
   */
  async create(
    type: CatalogType,
    input: { name: string; key?: string; parentSlug?: string; sortOrder?: number; icon?: string },
  ) {
    const spec = CATALOG_SPECS[type];
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    try {
      assertCatalogLabel(name, { skipCharset: type === 'jobTitle' });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    if (spec.resolver) {
      const created = await this.createViaResolver(spec, name, input.key);
      return this.markCurated(type, created.id);
    }

    const parentId = await this.resolveParentId(spec, input.parentSlug);
    const key = (input.key?.trim() || catalogSlugify(name)).toLowerCase();
    if (!key) throw new BadRequestException('Could not derive a slug from that name');

    const delegate = catalogDelegateFor(this.prisma, type);
    const clash = await delegate.findFirst({ where: { [spec.keyField]: key } });
    if (clash) throw new BadRequestException(`An entry with ${spec.keyField} "${key}" already exists`);

    return delegate.create({
      data: {
        name,
        [spec.keyField]: key,
        ...(spec.parent && parentId ? { [spec.parent.field]: parentId } : {}),
        ...(spec.hasSortOrder ? { sortOrder: input.sortOrder ?? 0 } : {}),
        ...(spec.hasIcon && input.icon ? { icon: input.icon } : {}),
        curatedAt: new Date(),
      },
      select: catalogSelect(spec),
    });
  }

  private async createViaResolver(spec: CatalogSpec, name: string, key?: string) {
    if (spec.resolver === 'skill') {
      const { skill } = await resolveSkill(this.prisma, { name, slug: key, allowCreate: true });
      return skill;
    }
    if (spec.resolver === 'jobTitle') {
      const { jobTitle } = await resolveJobTitle(this.prisma, {
        name,
        slug: key,
        allowCreate: true,
      });
      return jobTitle;
    }
    if (spec.resolver === 'language') {
      const { language } = await resolveLanguage(this.prisma, {
        name,
        code: key,
        allowCreate: true,
      });
      return language;
    }
    const { benefit } = await resolveBenefit(this.prisma, { name, slug: key, allowCreate: true });
    return benefit;
  }

  /**
   * Renaming re-derives the key so a slug never drifts from the name it
   * describes, and marks the row as owned by an admin so deploy backfills stop
   * rewriting it. An explicit `key` overrides that identity after the rename
   * so a mistyped ISO code or slug can be corrected without inventing a new row.
   */
  async update(
    type: CatalogType,
    id: string,
    patch: {
      name?: string;
      key?: string;
      nameUz?: string | null;
      nameRu?: string | null;
      parentSlug?: string;
      sortOrder?: number;
      icon?: string | null;
    },
  ) {
    const spec = CATALOG_SPECS[type];
    const delegate = catalogDelegateFor(this.prisma, type);
    const row = await delegate.findUnique({ where: { id }, select: catalogSelect(spec) });
    if (!row) throw new NotFoundException('Catalog entry not found');

    const data: Record<string, unknown> = { curatedAt: new Date() };
    let previousKey: string | null = null;
    let nextKey: string | null = null;

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Name cannot be empty');
      try {
        assertCatalogLabel(name, { skipCharset: type === 'jobTitle' });
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      data.name = name;
      Object.assign(data, await this.rekey(spec, id, name));
    }

    if (patch.key !== undefined) {
      const currentKey = this.rowKey(row, spec);
      const normalized = this.normalizeIdentityKey(spec, patch.key);
      if (normalized !== currentKey) {
        await this.assertKeyFree(spec, id, { [spec.keyField]: normalized });
        data[spec.keyField] = normalized;
        previousKey = currentKey;
        nextKey = normalized;
      }
    }

    if (spec.hasLocaleNames) {
      if (patch.nameUz !== undefined) {
        data.nameUz = patch.nameUz?.trim() || null;
        if (spec.hasI18nStatus) data.nameUzIsMachine = false;
      }
      if (patch.nameRu !== undefined) {
        data.nameRu = patch.nameRu?.trim() || null;
        if (spec.hasI18nStatus) data.nameRuIsMachine = false;
      }
    }

    if (spec.hasI18nStatus && (patch.nameUz !== undefined || patch.nameRu !== undefined)) {
      const nameUz = 'nameUz' in data ? (data.nameUz as string | null) : row.nameUz;
      const nameRu = 'nameRu' in data ? (data.nameRu as string | null) : row.nameRu;
      if (row.i18nStatus !== 'IGNORED') {
        data.i18nStatus = nameUz && nameRu ? 'COMPLETE' : 'PENDING';
      }
    }

    if (spec.parent && patch.parentSlug !== undefined) {
      const parentId = await this.resolveParentId(spec, patch.parentSlug);
      if (parentId) data[spec.parent.field] = parentId;
    }
    if (spec.hasSortOrder && patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
    if (spec.hasIcon && patch.icon !== undefined) data.icon = patch.icon || null;

    const updated = await delegate.update({ where: { id }, data, select: catalogSelect(spec) });
    if (previousKey && nextKey && previousKey !== nextKey) {
      await this.preserveOldKeyAsAlias(type, id, previousKey);
    }
    return updated;
  }

  private rowKey(row: CatalogRecord, spec: CatalogSpec): string {
    return String((spec.keyField === 'code' ? row.code : row.slug) ?? '');
  }

  /**
   * Language codes stay ISO-shaped; everything else goes through the same
   * slug helpers create/resolvers already use.
   */
  private normalizeIdentityKey(spec: CatalogSpec, raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) throw new BadRequestException(`${spec.keyField} cannot be empty`);

    if (spec.type === 'language') {
      const code = trimmed.toLowerCase();
      if (!/^[a-z]{2,3}$/.test(code)) {
        throw new BadRequestException('Language code must be a 2-3 letter ISO code (e.g. id, en, uz)');
      }
      return code;
    }
    if (spec.type === 'skill') {
      const slug = skillSlugify(trimmed);
      if (!slug) throw new BadRequestException('Could not derive a slug from that key');
      return slug;
    }
    if (spec.type === 'jobTitle') {
      const slug = jobTitleSlugify(trimmed);
      if (!slug) throw new BadRequestException('Could not derive a slug from that key');
      return slug;
    }

    const slug = catalogSlugify(trimmed).toLowerCase();
    if (!slug) throw new BadRequestException('Could not derive a slug from that key');
    return slug;
  }

  /** Keeps the previous identity findable so old user input still resolves. */
  private async preserveOldKeyAsAlias(type: CatalogType, id: string, oldKey: string) {
    if (!isCatalogKind(type) || !oldKey) return;
    const aliasKey = this.aliasKeyFor(type, oldKey);
    if (!aliasKey) return;
    const { delegate, foreignKey } = catalogAlias(this.prisma, type);
    await delegate
      .create({
        data: { [foreignKey]: id, alias: oldKey.slice(0, 80), aliasKey },
      })
      .catch(() => undefined);
  }

  private aliasKeyFor(
    type: 'skill' | 'jobTitle' | 'language' | 'benefit',
    value: string,
  ): string {
    if (type === 'skill') return normalizeSkillKey(value);
    if (type === 'jobTitle') return normalizeJobTitleKey(value);
    if (type === 'benefit') return benefitKey(value);
    return languageKey(value);
  }

  /** Recomputes slug and normalizedKey, refusing a rename that collides. */
  private async rekey(spec: CatalogSpec, id: string, name: string): Promise<Record<string, unknown>> {
    if (spec.type === 'skill') {
      const key = normalizeSkillKey(name);
      const slug = skillSlugify(name);
      await this.assertKeyFree(spec, id, { normalizedKey: key, slug });
      return { normalizedKey: key, slug };
    }
    if (spec.type === 'jobTitle') {
      const key = normalizeJobTitleKey(name);
      const slug = catalogSlugify(name);
      await this.assertKeyFree(spec, id, { normalizedKey: key, slug });
      return { normalizedKey: key, slug };
    }
    // Languages are keyed by ISO code and geo/taxonomy slugs are referenced in
    // saved filters and URLs, so a rename there keeps the existing key.
    return {};
  }

  private async assertKeyFree(spec: CatalogSpec, id: string, keys: Record<string, string>) {
    const delegate = catalogDelegateFor(this.prisma, spec.type);
    for (const [field, value] of Object.entries(keys)) {
      if (!value) continue;
      const clash = await delegate.findFirst({ where: { [field]: value, NOT: { id } } });
      if (clash) {
        throw new BadRequestException(
          `Renaming would collide with "${clash.name}". Merge them instead.`,
        );
      }
    }
  }

  private async resolveParentId(spec: CatalogSpec, parentSlug?: string): Promise<string | null> {
    if (!spec.parent) return null;
    if (!parentSlug) {
      if (spec.parent.required) {
        throw new BadRequestException(`${spec.parent.label} is required`);
      }
      return null;
    }
    const parent = await catalogDelegateFor(this.prisma, spec.parent.type).findFirst({
      where: { slug: parentSlug },
      select: { id: true, name: true, archivedAt: true, curatedAt: true },
    });
    if (!parent) throw new BadRequestException(`${spec.parent.label} "${parentSlug}" not found`);
    return parent.id;
  }

  /**
   * Archives, or hard deletes when nothing references the row. Seed-managed
   * catalogs are always archived: a purge would be undone by the next deploy.
   */
  async archive(type: CatalogType, id: string) {
    const spec = CATALOG_SPECS[type];
    const delegate = catalogDelegateFor(this.prisma, type);
    const row = await delegate.findUnique({ where: { id }, select: catalogSelect(spec) });
    if (!row) throw new NotFoundException('Catalog entry not found');

    const usage = await this.usage(type, id);
    if (usage.total === 0 && !spec.seedManaged) {
      await delegate.delete({ where: { id } });
      return { outcome: 'deleted' as const, usage };
    }

    const archived = await delegate.update({
      where: { id },
      data: { archivedAt: new Date(), curatedAt: new Date() },
      select: catalogSelect(spec),
    });
    return { outcome: 'archived' as const, usage, entry: archived };
  }

  async restore(type: CatalogType, id: string) {
    const spec = CATALOG_SPECS[type];
    const delegate = catalogDelegateFor(this.prisma, type);
    const row = await delegate.findUnique({ where: { id }, select: catalogSelect(spec) });
    if (!row) throw new NotFoundException('Catalog entry not found');
    return delegate.update({
      where: { id },
      data: { archivedAt: null, curatedAt: new Date() },
      select: catalogSelect(spec),
    });
  }

  private markCurated(type: CatalogType, id: string) {
    return catalogDelegateFor(this.prisma, type).update({
      where: { id },
      data: { curatedAt: new Date() },
      select: catalogSelect(CATALOG_SPECS[type]),
    });
  }
}
