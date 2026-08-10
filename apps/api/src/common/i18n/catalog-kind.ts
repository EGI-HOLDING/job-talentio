import type { CatalogI18nStatus, PrismaClient } from '@prisma/client';

/** Catalogs users can extend at runtime, and which therefore need review. */
export const CATALOG_KINDS = ['skill', 'jobTitle', 'language', 'benefit'] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export function isCatalogKind(value: unknown): value is CatalogKind {
  return typeof value === 'string' && (CATALOG_KINDS as readonly string[]).includes(value);
}

export type CatalogRow = {
  id: string;
  name: string;
  nameUz: string | null;
  nameRu: string | null;
  nameUzIsMachine: boolean;
  nameRuIsMachine: boolean;
  i18nStatus: CatalogI18nStatus;
  createdAt: Date;
};

/**
 * The four catalogs share the same locale columns but are separate tables, so
 * admin and translation code addresses them through this narrow shape instead
 * of repeating a switch for every operation.
 */
export type CatalogDelegate = {
  findUnique(args: { where: { id: string } }): Promise<CatalogRow | null>;
  findMany(args: Record<string, unknown>): Promise<CatalogRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CatalogRow>;
  count(args: Record<string, unknown>): Promise<number>;
};

export type AliasDelegate = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
};

/** Foreign key each alias table uses to point at its catalog row. */
const ALIAS_FOREIGN_KEY: Record<CatalogKind, string> = {
  skill: 'skillId',
  jobTitle: 'jobTitleId',
  language: 'languageId',
  benefit: 'benefitId',
};

export function catalogDelegate(prisma: PrismaClient, kind: CatalogKind): CatalogDelegate {
  return prisma[kind] as unknown as CatalogDelegate;
}

export function catalogAlias(
  prisma: PrismaClient,
  kind: CatalogKind,
): { delegate: AliasDelegate; foreignKey: string } {
  const key = `${kind}Alias` as 'skillAlias' | 'jobTitleAlias' | 'languageAlias' | 'benefitAlias';
  return {
    delegate: prisma[key] as unknown as AliasDelegate,
    foreignKey: ALIAS_FOREIGN_KEY[kind],
  };
}

/** Language names always differ per locale, so they never count as tech identities. */
export function allowsTechIdentity(kind: CatalogKind): boolean {
  return kind !== 'language';
}

/**
 * Join tables that point at a catalog row. `owner` names the other side of a
 * unique pair, so a merge can drop rows that would collide instead of failing;
 * it is null where the reference is a plain nullable column.
 */
export type CatalogRelation = { model: string; owner: string | null; key: string };

export const CATALOG_RELATIONS: Record<CatalogKind, CatalogRelation[]> = {
  skill: [
    { model: 'profileSkill', owner: 'profileId', key: 'skillId' },
    { model: 'jobPostSkill', owner: 'jobPostId', key: 'skillId' },
    { model: 'jobAlertSkill', owner: 'alertId', key: 'skillId' },
  ],
  jobTitle: [
    { model: 'jobPost', owner: null, key: 'jobTitleId' },
    { model: 'resume', owner: null, key: 'targetJobTitleId' },
  ],
  language: [
    { model: 'profileLanguage', owner: 'profileId', key: 'languageId' },
    { model: 'jobPostLanguage', owner: 'jobPostId', key: 'languageId' },
  ],
  benefit: [{ model: 'jobPostBenefit', owner: 'jobPostId', key: 'benefitId' }],
};

export type RelationDelegate = {
  findMany(args: Record<string, unknown>): Promise<Array<Record<string, string>>>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
};

export function relationDelegate(prisma: PrismaClient, model: string): RelationDelegate {
  return (prisma as unknown as Record<string, RelationDelegate>)[model];
}
