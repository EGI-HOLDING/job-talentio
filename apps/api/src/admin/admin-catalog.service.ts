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
import type { CatalogKind } from '../common/i18n/catalog-kind';
import { geoAliasKey } from '../common/geo-selection';
import { dateRange, envelope, skipFor } from './admin-query';
import {
  CATALOG_SPECS,
  CATALOG_TYPES,
  catalogDelegateFor,
  catalogSelect,
  countingDelegate,
} from './catalog-registry';
import type { CatalogRecord, CatalogSpec, CatalogType } from './catalog-registry';
import type { OccupationMatchingMetadata } from '@job-talentio/shared';

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

  private async validateMetadata(type:CatalogType,id:string | undefined,metadata:OccupationMatchingMetadata | null | undefined) {
    if (metadata === undefined || metadata === null) return;
    if (type !== 'jobTitle') throw new BadRequestException('Occupation metadata belongs to job titles only');
    const targets = metadata.relatedRoles.map(row => row.id);
    if (new Set(targets).size !== targets.length || (id && targets.includes(id))) throw new BadRequestException('Related occupations must be distinct and cannot reference themselves');
    if (targets.length && await this.prisma.jobTitle.count({where:{id:{in:targets},archivedAt:null}}) !== targets.length) throw new BadRequestException('Related occupation not found or archived');
  }

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
        hasAliases: Boolean(spec.aliasModel),
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
          ...(spec.parent ? { [spec.parent.type]: { select: { id:true, name: true, slug: true } } } : {}),
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
              { nameId: { contains: term, mode: 'insensitive' } },
            ]
          : []),
      ];
    }

    if (query.parentSlug && spec.parent) {
      where[spec.parent.type] = { OR: [{id:query.parentSlug},{slug:query.parentSlug}] };
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
    input: {
      matchingMetadata?: OccupationMatchingMetadata;
      name: string;
      iso2?: string; iso3?: string; phoneCode?: string; currencyCode?: string; isActive?: boolean; kind?: string;
      key?: string;
      parentSlug?: string;
      parentId?: string;
      sortOrder?: number;
      icon?: string;
      nameUz?: string;
      nameRu?: string;
      nameId?: string;
    },
  ) {
    const spec = CATALOG_SPECS[type];
    const name = input.name.trim();
    await this.validateMetadata(type, undefined, input.matchingMetadata);
    if (!name) throw new BadRequestException('Name is required');
    try {
      assertCatalogLabel(name, { skipCharset: type === 'jobTitle' });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    if (type === 'country' && (!input.iso2 || !input.iso3 || !input.phoneCode)) throw new BadRequestException('ISO2, ISO3 and phone code are required');
    let created: CatalogRecord;
    if (spec.resolver) {
      created = await this.createViaResolver(spec, name, input.key);
    } else {
      const parentId = await this.resolveParentId(spec, input.parentSlug, input.parentId);
      const key = (input.key?.trim() || catalogSlugify(name)).toLowerCase();
      if (!key) throw new BadRequestException('Could not derive a slug from that name');

      const delegate = catalogDelegateFor(this.prisma, type);
      const clash = await delegate.findFirst({ where: { [spec.keyField]: key, ...(type === 'province' ? { countryId: parentId } : {}) } });
      if (clash) {
        throw new BadRequestException(`An entry with ${spec.keyField} "${key}" already exists`);
      }

      created = await delegate.create({
        data: {
          name,
          ...(type === 'country' ? { iso2: input.iso2, iso3: input.iso3, phoneCode: input.phoneCode, currencyCode: input.currencyCode || null, isActive: input.isActive ?? false } : {}),
          ...(type === 'city' ? { kind: input.kind || 'CITY' } : {}),
          [spec.keyField]: key,
          ...(spec.parent && parentId ? { [spec.parent.field]: parentId } : {}),
          ...(spec.hasSortOrder ? { sortOrder: input.sortOrder ?? 0 } : {}),
          ...(spec.hasIcon && input.icon ? { icon: input.icon } : {}),
          curatedAt: new Date(),
        },
        select: catalogSelect(spec),
      });
    }

    if (input.matchingMetadata) await this.prisma.jobTitle.update({where:{id:created.id},data:{matchingMetadata:input.matchingMetadata as unknown as import('@prisma/client').Prisma.InputJsonValue}});
    const curated = await this.markCurated(type, created.id);
    if (!spec.hasLocaleNames) {
      return curated;
    }

    const localeNames = {
      nameUz: input.nameUz?.trim() || null,
      nameRu: input.nameRu?.trim() || null,
      nameId: input.nameId?.trim() || null,
    };
    if (!localeNames.nameUz && !localeNames.nameRu && !localeNames.nameId) return curated;
    const localeStatus = localeNames.nameUz && localeNames.nameRu && localeNames.nameId
      ? 'COMPLETE'
      : 'PENDING';
    return catalogDelegateFor(this.prisma, type).update({
      where: { id: created.id },
      data: {
        ...localeNames,
        ...(spec.hasI18nStatus
          ? {
              nameUzIsMachine: false,
              nameRuIsMachine: false,
              nameIdIsMachine: false,
              i18nStatus: localeStatus,
            }
          : {}),
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
      matchingMetadata?: OccupationMatchingMetadata | null;
      iso2?: string; iso3?: string; phoneCode?: string; currencyCode?: string; isActive?: boolean; kind?: string;
      name?: string;
      key?: string;
      nameUz?: string | null;
      nameRu?: string | null;
      nameId?: string | null;
      parentSlug?: string;
      parentId?: string;
      sortOrder?: number;
      icon?: string | null;
    },
  ) {
    const spec = CATALOG_SPECS[type];
    const delegate = catalogDelegateFor(this.prisma, type);
    const row = await delegate.findUnique({ where: { id }, select: catalogSelect(spec) });
    if (!row) throw new NotFoundException('Catalog entry not found');

    await this.validateMetadata(type,id,patch.matchingMetadata);
    const data: Record<string, unknown> = { curatedAt: new Date() };
    if (type === 'jobTitle' && patch.matchingMetadata !== undefined) {
      if (patch.matchingMetadata === null) throw new BadRequestException('Use empty sources and relatedRoles to clear metadata');
      data.matchingMetadata = patch.matchingMetadata;
    }
    if (type === 'country') for (const field of ['iso2','iso3','phoneCode','currencyCode','isActive'] as const) { if (patch[field] !== undefined) data[field] = patch[field]; }
    if (type === 'city' && patch.kind !== undefined) data.kind = patch.kind;
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
      if (patch.nameId !== undefined) {
        data.nameId = patch.nameId?.trim() || null;
        if (spec.hasI18nStatus) data.nameIdIsMachine = false;
      }
    }

    if (spec.hasI18nStatus && (patch.nameUz !== undefined || patch.nameRu !== undefined || patch.nameId !== undefined)) {
      const nameUz = 'nameUz' in data ? (data.nameUz as string | null) : row.nameUz;
      const nameRu = 'nameRu' in data ? (data.nameRu as string | null) : row.nameRu;
      const nameId = 'nameId' in data ? (data.nameId as string | null) : row.nameId;
      if (row.i18nStatus !== 'IGNORED') {
        data.i18nStatus = nameUz && nameRu && nameId ? 'COMPLETE' : 'PENDING';
      }
    }

    if (spec.parent && (patch.parentSlug !== undefined || patch.parentId !== undefined)) {
      const parentId = await this.resolveParentId(spec, patch.parentSlug, patch.parentId);
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
    if (type === 'city' && oldKey) {
      const aliasKey = geoAliasKey(oldKey);
      await this.prisma.cityAlias.upsert({ where: { cityId_aliasKey: { cityId: id, aliasKey } }, create: { cityId: id, alias: oldKey, aliasKey }, update: {} });
      return;
    }
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

  async listAliases(type: CatalogKind | 'city', id: string) {
    if (type === 'city') {
      if (!await this.prisma.city.findUnique({ where: { id } })) throw new NotFoundException('City not found');
      return this.prisma.cityAlias.findMany({ where: { cityId: id }, orderBy: { alias: 'asc' } });
    }
    const entry = await catalogDelegateFor(this.prisma, type).findUnique({
      where: { id },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Catalog entry not found');
    const { delegate, foreignKey } = catalogAlias(this.prisma, type);
    return delegate.findMany({ where: { [foreignKey]: id }, orderBy: { alias: 'asc' } });
  }

  async addAlias(type: CatalogKind | 'city', id: string, rawAlias: string) {
    if (type === 'city') {
      if (!await this.prisma.city.findUnique({ where: { id } })) throw new NotFoundException('City not found');
      const alias = rawAlias.trim(), aliasKey = geoAliasKey(alias);
      if (!aliasKey) throw new BadRequestException('Alias is required');
      await this.prisma.city.update({ where: { id }, data: { curatedAt: new Date() } });
      return this.prisma.cityAlias.upsert({ where: { cityId_aliasKey: { cityId: id, aliasKey } }, create: { cityId: id, alias, aliasKey }, update: { alias } });
    }
    const alias = rawAlias.trim();
    if (!alias) throw new BadRequestException('Alias is required');
    try {
      assertCatalogLabel(alias, { skipCharset: type === 'jobTitle' });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const entry = await catalogDelegateFor(this.prisma, type).findUnique({
      where: { id },
      select: { id: true, name: true, [CATALOG_SPECS[type].keyField]: true, normalizedKey: true },
    });
    if (!entry) throw new NotFoundException('Catalog entry not found');

    const aliasKey = this.aliasKeyFor(type, alias);
    if (!aliasKey) throw new BadRequestException('Alias is too short or invalid');
    const primaryKey =
      type === 'language'
        ? languageKey(entry.name)
        : type === 'jobTitle'
          ? normalizeJobTitleKey(entry.name)
          : type === 'skill'
            ? normalizeSkillKey(entry.name)
            : benefitKey(entry.name);
    if (aliasKey === primaryKey || aliasKey === entry.code || aliasKey === entry.normalizedKey) {
      throw new BadRequestException('Alias matches this catalog entry already');
    }

    const spec = CATALOG_SPECS[type];
    const aliasSlug =
      type === 'skill'
        ? skillSlugify(alias)
        : type === 'jobTitle'
          ? jobTitleSlugify(alias)
          : type === 'benefit'
            ? catalogSlugify(alias).toLowerCase()
            : undefined;
    const canonicalMatch = await catalogDelegateFor(this.prisma, type).findFirst({
      where: {
        OR: [
          { normalizedKey: aliasKey },
          ...(aliasSlug
            ? [{ [spec.keyField]: aliasSlug }]
            : [{ [spec.keyField]: aliasKey }]),
        ],
      },
      select: { id: true },
    });
    if (canonicalMatch) {
      throw new BadRequestException(
        canonicalMatch.id === id
          ? 'Alias matches this catalog entry already'
          : 'This alias matches another catalog entry',
      );
    }

    const { delegate, foreignKey } = catalogAlias(this.prisma, type);
    const existing = await delegate.findUnique({ where: { aliasKey } });
    if (existing) {
      if (existing[foreignKey as keyof typeof existing] === id) return existing;
      throw new BadRequestException('This alias is already assigned to another catalog entry');
    }

    try {
      return await delegate.create({
        data: { [foreignKey]: id, alias, aliasKey },
      });
    } catch {
      throw new BadRequestException('This alias already exists');
    }
  }

  async removeAlias(type: CatalogKind | 'city', id: string, aliasId: string) {
    if (type === 'city') {
      const alias = await this.prisma.cityAlias.findFirst({ where: { id: aliasId, cityId: id } });
      if (!alias) throw new NotFoundException('City alias not found');
      await this.prisma.city.update({ where: { id }, data: { curatedAt: new Date() } });
      return this.prisma.cityAlias.delete({ where: { id: aliasId } });
    }
    const { delegate, foreignKey } = catalogAlias(this.prisma, type);
    const alias = await delegate.findUnique({ where: { id: aliasId } });
    if (!alias || alias[foreignKey as keyof typeof alias] !== id) {
      throw new NotFoundException('Catalog alias not found');
    }
    return delegate.delete({ where: { id: aliasId } });
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
    const owner = spec.type === 'province' ? await delegate.findUnique({where:{id},select:{countryId:true}}) : null;
    for (const [field, value] of Object.entries(keys)) {
      if (!value) continue;
      const clash = await delegate.findFirst({ where: { [field]: value, ...(owner ? {countryId:owner.countryId} : {}), NOT: { id } } });
      if (clash) {
        throw new BadRequestException(
          `Renaming would collide with "${clash.name}". Merge them instead.`,
        );
      }
    }
  }

  private async resolveParentId(spec: CatalogSpec, parentSlug?: string, parentId?: string): Promise<string | null> {
    if (!spec.parent) return null;
    if (!parentSlug && !parentId) {
      if (spec.parent.required) {
        throw new BadRequestException(`${spec.parent.label} is required`);
      }
      return null;
    }
    const parents = await catalogDelegateFor(this.prisma, spec.parent.type).findMany({
      where: { ...(parentId ? {id:parentId} : {slug:parentSlug}), archivedAt:null },
      select: {id:true}, take:2,
    });
    if (parents.length !== 1) throw new BadRequestException('Select an unambiguous '+spec.parent.label+' from the catalog');
    const parent = parents[0];
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
