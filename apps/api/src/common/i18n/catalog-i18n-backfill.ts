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

export type CatalogI18nResult = Record<string, { updated: number; missing: number }>;

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

/** Rows are matched on their stable key, so the backfill is safe to re-run. */
async function applyByKey(
  label: string,
  names: Record<string, LocalizedName>,
  update: (key: string, value: LocalizedName) => Promise<unknown>,
  result: CatalogI18nResult,
) {
  let updated = 0;
  let missing = 0;
  for (const [key, value] of Object.entries(names)) {
    try {
      await update(key, value);
      updated += 1;
    } catch {
      // Row not seeded in this environment; translations for it stay unused.
      missing += 1;
    }
  }
  result[label] = { updated, missing };
}

export async function backfillCatalogI18n(db: Db): Promise<CatalogI18nResult> {
  const result: CatalogI18nResult = {};

  await applyByKey(
    'country',
    COUNTRY_NAMES,
    (slug, v) =>
      db.country.update({ where: { slug }, data: { nameUz: v.uz, nameRu: v.ru } }),
    result,
  );

  // Province slugs are unique per country, so update through the compound key.
  let provinceUpdated = 0;
  let provinceMissing = 0;
  for (const [slug, value] of Object.entries(PROVINCE_NAMES)) {
    const rows = await db.province.updateMany({
      where: { slug },
      data: { nameUz: value.uz, nameRu: value.ru },
    });
    if (rows.count > 0) provinceUpdated += rows.count;
    else provinceMissing += 1;
  }
  result.province = { updated: provinceUpdated, missing: provinceMissing };

  await applyByKey(
    'city',
    CITY_NAMES,
    (slug, v) => db.city.update({ where: { slug }, data: { nameUz: v.uz, nameRu: v.ru } }),
    result,
  );

  await applyByKey(
    'jobCategory',
    CATEGORY_NAMES,
    (slug, v) => db.jobCategory.update({ where: { slug }, data: { nameUz: v.uz, nameRu: v.ru } }),
    result,
  );

  await applyByKey(
    'industryGroup',
    INDUSTRY_GROUP_NAMES,
    (slug, v) => db.industryGroup.update({ where: { slug }, data: { nameUz: v.uz, nameRu: v.ru } }),
    result,
  );

  await applyByKey(
    'industry',
    INDUSTRY_NAMES,
    (slug, v) => db.industry.update({ where: { slug }, data: { nameUz: v.uz, nameRu: v.ru } }),
    result,
  );

  // The four catalogs below accept user input, so curated rows are also marked
  // done to keep them out of the admin review queue.
  await applyByKey(
    'benefit',
    BENEFIT_NAMES,
    (slug, v) => db.benefit.update({ where: { slug }, data: { ...curated(v) } }),
    result,
  );

  await applyByKey(
    'language',
    LANGUAGE_NAMES,
    (code, v) => db.language.update({ where: { code }, data: { ...curated(v) } }),
    result,
  );

  await applyByKey(
    'jobTitle',
    JOB_TITLE_NAMES,
    (slug, v) => db.jobTitle.update({ where: { slug }, data: { ...curated(v) } }),
    result,
  );

  await applyByKey(
    'skill',
    SKILL_NAMES,
    (slug, v) => db.skill.update({ where: { slug }, data: { ...curated(v) } }),
    result,
  );

  return result;
}
