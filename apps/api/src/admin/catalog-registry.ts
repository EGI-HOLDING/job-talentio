import type { PrismaClient } from '@prisma/client';

/**
 * One description per admin-managed lookup table, so the CRUD endpoints work
 * the same way for ten models instead of repeating a controller each time.
 */
export const CATALOG_TYPES = [
  'skill',
  'jobTitle',
  'language',
  'benefit',
  'jobCategory',
  'industry',
  'industryGroup',
  'country',
  'province',
  'city',
] as const;

export type CatalogType = (typeof CATALOG_TYPES)[number];

export function isCatalogType(value: unknown): value is CatalogType {
  return typeof value === 'string' && (CATALOG_TYPES as readonly string[]).includes(value);
}

/** A relation that makes a row "in use" and therefore not safe to hard delete. */
type UsageRelation = { model: string; field: string; label: string };

/** The optional parent a row hangs from, edited as a slug in the admin form. */
type ParentSpec = { type: CatalogType; field: string; label: string; required: boolean };

export type CatalogSpec = {
  type: CatalogType;
  label: string;
  /** Prisma delegate key, which matches the type for every model here. */
  model: CatalogType;
  /** Natural key the admin edits and the resolvers match on. */
  keyField: 'slug' | 'code';
  hasLocaleNames: boolean;
  /** Only the four user-extensible catalogs carry the translation queue state. */
  hasI18nStatus: boolean;
  hasSortOrder: boolean;
  hasIcon: boolean;
  aliasModel?: string;
  parent?: ParentSpec;
  usage: UsageRelation[];
  /**
   * True when a deploy backfill recreates rows from a code catalog. Purging is
   * pointless for these: the next container start would bring the row back, so
   * archiving is the only lifecycle that sticks.
   */
  seedManaged: boolean;
  /** Creating goes through this resolver so keys and aliases stay consistent. */
  resolver?: 'skill' | 'jobTitle' | 'language' | 'benefit';
  supportsMerge: boolean;
};

export const CATALOG_SPECS: Record<CatalogType, CatalogSpec> = {
  skill: {
    type: 'skill',
    label: 'Skills',
    model: 'skill',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: true,
    hasSortOrder: false,
    hasIcon: false,
    aliasModel: 'skillAlias',
    usage: [
      { model: 'profileSkill', field: 'skillId', label: 'profiles' },
      { model: 'jobPostSkill', field: 'skillId', label: 'job postings' },
      { model: 'jobAlertSkill', field: 'skillId', label: 'job alerts' },
    ],
    seedManaged: false,
    resolver: 'skill',
    supportsMerge: true,
  },
  jobTitle: {
    type: 'jobTitle',
    label: 'Job titles',
    model: 'jobTitle',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: true,
    hasSortOrder: false,
    hasIcon: false,
    aliasModel: 'jobTitleAlias',
    usage: [
      { model: 'jobPost', field: 'jobTitleId', label: 'job postings' },
      { model: 'resume', field: 'targetJobTitleId', label: 'resumes' },
    ],
    seedManaged: false,
    resolver: 'jobTitle',
    supportsMerge: true,
  },
  language: {
    type: 'language',
    label: 'Languages',
    model: 'language',
    keyField: 'code',
    hasLocaleNames: true,
    hasI18nStatus: true,
    hasSortOrder: false,
    hasIcon: false,
    aliasModel: 'languageAlias',
    usage: [
      { model: 'profileLanguage', field: 'languageId', label: 'profiles' },
      { model: 'jobPostLanguage', field: 'languageId', label: 'job postings' },
    ],
    seedManaged: false,
    resolver: 'language',
    supportsMerge: true,
  },
  benefit: {
    type: 'benefit',
    label: 'Benefits',
    model: 'benefit',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: true,
    hasSortOrder: false,
    hasIcon: true,
    aliasModel: 'benefitAlias',
    usage: [{ model: 'jobPostBenefit', field: 'benefitId', label: 'job postings' }],
    seedManaged: false,
    resolver: 'benefit',
    supportsMerge: true,
  },
  jobCategory: {
    type: 'jobCategory',
    label: 'Job categories',
    model: 'jobCategory',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: false,
    hasIcon: true,
    usage: [
      { model: 'jobPost', field: 'categoryId', label: 'job postings' },
      { model: 'jobAlert', field: 'categoryId', label: 'job alerts' },
    ],
    seedManaged: false,
    supportsMerge: false,
  },
  industry: {
    type: 'industry',
    label: 'Industries',
    model: 'industry',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: true,
    hasIcon: false,
    parent: { type: 'industryGroup', field: 'groupId', label: 'Industry group', required: true },
    usage: [{ model: 'company', field: 'industryId', label: 'companies' }],
    seedManaged: true,
    supportsMerge: false,
  },
  industryGroup: {
    type: 'industryGroup',
    label: 'Industry groups',
    model: 'industryGroup',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: true,
    hasIcon: false,
    // The database restricts deleting a group that still has industries.
    usage: [{ model: 'industry', field: 'groupId', label: 'industries' }],
    seedManaged: true,
    supportsMerge: false,
  },
  country: {
    type: 'country',
    label: 'Countries',
    model: 'country',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: false,
    hasIcon: false,
    usage: [{ model: 'province', field: 'countryId', label: 'provinces' }],
    seedManaged: true,
    supportsMerge: false,
  },
  province: {
    type: 'province',
    label: 'Provinces',
    model: 'province',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: false,
    hasIcon: false,
    parent: { type: 'country', field: 'countryId', label: 'Country', required: true },
    usage: [{ model: 'city', field: 'provinceId', label: 'cities' }],
    seedManaged: true,
    supportsMerge: false,
  },
  city: {
    type: 'city',
    label: 'Cities',
    model: 'city',
    keyField: 'slug',
    hasLocaleNames: true,
    hasI18nStatus: false,
    hasSortOrder: false,
    hasIcon: false,
    parent: { type: 'province', field: 'provinceId', label: 'Province', required: true },
    usage: [
      { model: 'jobPost', field: 'cityId', label: 'job postings' },
      { model: 'employeeProfile', field: 'cityId', label: 'profiles' },
      { model: 'company', field: 'cityId', label: 'companies' },
      { model: 'jobAlert', field: 'cityId', label: 'job alerts' },
      { model: 'workExperience', field: 'cityId', label: 'work experience entries' },
    ],
    seedManaged: true,
    supportsMerge: false,
  },
};

/** Shape every catalog row exposes to the admin console. */
export type CatalogRecord = {
  id: string;
  name: string;
  nameUz?: string | null;
  nameRu?: string | null;
  slug?: string;
  code?: string;
  icon?: string | null;
  sortOrder?: number;
  archivedAt: Date | null;
  curatedAt: Date | null;
  i18nStatus?: string;
};

export type GenericDelegate = {
  findUnique(args: Record<string, unknown>): Promise<CatalogRecord | null>;
  findFirst(args: Record<string, unknown>): Promise<CatalogRecord | null>;
  findMany(args: Record<string, unknown>): Promise<CatalogRecord[]>;
  create(args: Record<string, unknown>): Promise<CatalogRecord>;
  update(args: Record<string, unknown>): Promise<CatalogRecord>;
  delete(args: Record<string, unknown>): Promise<CatalogRecord>;
  count(args: Record<string, unknown>): Promise<number>;
};

export function catalogDelegateFor(prisma: PrismaClient, type: CatalogType): GenericDelegate {
  return prisma[CATALOG_SPECS[type].model] as unknown as GenericDelegate;
}

export function countingDelegate(
  prisma: PrismaClient,
  model: string,
): { count(args: Record<string, unknown>): Promise<number> } {
  return (prisma as unknown as Record<string, { count(args: Record<string, unknown>): Promise<number> }>)[
    model
  ];
}

/** Columns the admin list and detail views select for any catalog type. */
export function catalogSelect(spec: CatalogSpec): Record<string, boolean> {
  return {
    id: true,
    name: true,
    archivedAt: true,
    curatedAt: true,
    [spec.keyField]: true,
    ...(spec.hasLocaleNames ? { nameUz: true, nameRu: true } : {}),
    ...(spec.hasI18nStatus ? { i18nStatus: true } : {}),
    ...(spec.hasSortOrder ? { sortOrder: true } : {}),
    ...(spec.hasIcon ? { icon: true } : {}),
  };
}
