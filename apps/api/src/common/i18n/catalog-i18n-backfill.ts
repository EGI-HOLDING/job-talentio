import type { PrismaClient } from '@prisma/client';
import { CITY_NAMES, COUNTRY_NAMES, PROVINCE_NAMES } from './geo-names';
import {
  BENEFIT_NAMES,
  CATEGORY_NAMES,
  INDUSTRY_GROUP_NAMES,
  INDUSTRY_NAMES,
  LANGUAGE_NAMES,
} from './taxonomy-names';
import { JOB_TITLE_NAMES, SKILL_NAMES } from './role-names';

type LocalizedName = { uz: string; ru: string };

type Db = Pick<
  PrismaClient,
  | 'country'
  | 'province'
  | 'city'
  | 'jobCategory'
  | 'industryGroup'
  | 'industry'
  | 'benefit'
  | 'language'
  | 'jobTitle'
  | 'skill'
>;

/**
 * `updated` was written, `skipped` belongs to an admin who edited it, `missing`
 * is not seeded in this environment.
 */
export type CatalogI18nResult = Record<
  string,
  { updated: number; skipped: number; missing: number }
>;

type Outcome = 'updated' | 'skipped' | 'missing';

/** Hand-written translations count as reviewed and are never machine output. */
function curated(value: LocalizedName) {
  return {
    nameUz: value.uz,
    nameRu: value.ru,
    nameUzIsMachine: false,
    nameRuIsMachine: false,
    i18nStatus: 'COMPLETE',
  } as const;
}

type Delegate = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
};

/**
 * Writes a seeded translation only when no admin has taken ownership of the row.
 * These names are good defaults, but an admin edit is a deliberate later
 * decision and this backfill can run at any time.
 */
function writeUncurated(
  delegate: Delegate,
  keyField: string,
  build: (value: LocalizedName) => Record<string, unknown>,
) {
  return async (key: string, value: LocalizedName): Promise<Outcome> => {
    const { count } = await delegate.updateMany({
      where: { [keyField]: key, curatedAt: null },
      data: build(value),
    });
    if (count > 0) return 'updated';
    const exists = await delegate.count({ where: { [keyField]: key } });
    return exists > 0 ? 'skipped' : 'missing';
  };
}

/** Rows are matched on their stable key, so the backfill is safe to re-run. */
async function applyByKey(
  label: string,
  names: Record<string, LocalizedName>,
  apply: (key: string, value: LocalizedName) => Promise<Outcome>,
  result: CatalogI18nResult,
) {
  const counts = { updated: 0, skipped: 0, missing: 0 };
  for (const [key, value] of Object.entries(names)) {
    counts[await apply(key, value)] += 1;
  }
  result[label] = counts;
}

const localeOnly = (value: LocalizedName) => ({ nameUz: value.uz, nameRu: value.ru });

export async function backfillCatalogI18n(db: Db): Promise<CatalogI18nResult> {
  const result: CatalogI18nResult = {};
  const as = (delegate: unknown) => delegate as unknown as Delegate;

  await applyByKey(
    'country',
    COUNTRY_NAMES,
    writeUncurated(as(db.country), 'slug', localeOnly),
    result,
  );

  // Province slugs are unique per country, so they are matched without an id.
  await applyByKey(
    'province',
    PROVINCE_NAMES,
    writeUncurated(as(db.province), 'slug', localeOnly),
    result,
  );

  await applyByKey('city', CITY_NAMES, writeUncurated(as(db.city), 'slug', localeOnly), result);

  await applyByKey(
    'jobCategory',
    CATEGORY_NAMES,
    writeUncurated(as(db.jobCategory), 'slug', localeOnly),
    result,
  );

  await applyByKey(
    'industryGroup',
    INDUSTRY_GROUP_NAMES,
    writeUncurated(as(db.industryGroup), 'slug', localeOnly),
    result,
  );

  await applyByKey(
    'industry',
    INDUSTRY_NAMES,
    writeUncurated(as(db.industry), 'slug', localeOnly),
    result,
  );

  // The four catalogs below accept user input, so curated rows are also marked
  // done to keep them out of the admin review queue.
  await applyByKey(
    'benefit',
    BENEFIT_NAMES,
    writeUncurated(as(db.benefit), 'slug', curated),
    result,
  );

  await applyByKey(
    'language',
    LANGUAGE_NAMES,
    writeUncurated(as(db.language), 'code', curated),
    result,
  );

  await applyByKey(
    'jobTitle',
    JOB_TITLE_NAMES,
    writeUncurated(as(db.jobTitle), 'slug', curated),
    result,
  );

  await applyByKey('skill', SKILL_NAMES, writeUncurated(as(db.skill), 'slug', curated), result);

  return result;
}
