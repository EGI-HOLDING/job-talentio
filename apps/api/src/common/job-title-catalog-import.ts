import { createHash } from 'node:crypto';
import type { JobTitle, JobTitleAlias, Prisma } from '@prisma/client';
import { z } from 'zod';
import { assertCatalogLabel } from './lookup-normalize';
import { canonicalDisplayName, jobTitleSlugify, normalizeJobTitleKey } from './title-resolve';

const label = z.string().trim().min(2).max(120);
const datasetSchema = z.object({
  datasetId: z.string().min(1),
  version: z.string().min(1),
  status: z.string(),
  rows: z.array(z.object({
    key: z.string().min(1),
    labels: z.object({ en: label, id: label, uz: label }),
    sourceKind: z.enum(['esco', 'market_extension']),
    sourceRefs: z.array(z.string()).min(1),
    sourceUrl: z.string().url(),
    reviewFamily: z.string(),
    reviewStatus: z.literal('pending'),
    readyForImport: z.literal(false),
  }).passthrough()).min(1).max(10000),
}).passthrough();

export type CatalogDataset = z.infer<typeof datasetSchema>;
type TitleState = Pick<JobTitle, 'id' | 'name' | 'nameId' | 'nameUz' | 'nameRu' |
  'nameIdIsMachine' | 'nameUzIsMachine' | 'nameRuIsMachine' | 'normalizedKey' |
  'slug' | 'i18nStatus' | 'curatedAt' | 'archivedAt'>;
export type CatalogSnapshot = {
  titles: TitleState[];
  aliases: Pick<JobTitleAlias, 'id' | 'jobTitleId' | 'alias' | 'aliasKey'>[];
  audits: { id: string; entityId: string | null }[];
};
export type ImportEntry = {
  source: CatalogDataset['rows'][number];
  targetId: string;
  create?: Prisma.JobTitleCreateManyInput;
  patch?: Prisma.JobTitleUpdateInput;
  auditId: string;
  createAudit: boolean;
};
export type ImportPlan = {
  entries: ImportEntry[];
  aliases: Prisma.JobTitleAliasCreateManyInput[];
  aliasConflicts: { alias: string; targetId: string; ownerIds: string[] }[];
  summary: {
    sourceRows: number; createdTitles: number; matchedTitles: number;
    titlesWithMissingTranslationsFilled: number; createdAliases: number;
    createdAuditRecords: number; archivedMatchesPreserved: number;
    curatedMatchesPreserved: number; aliasConflicts: number;
  };
};

export const CATALOG_IMPORT_ACTION = 'IMPORT_JOB_TITLE_CATALOG_DRAFT';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function parseCatalogDataset(value: unknown): CatalogDataset {
  const dataset = datasetSchema.parse(value);
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const row of dataset.rows) {
    const key = normalizeJobTitleKey(row.labels.en);
    if (keys.has(row.key) || names.has(key)) throw new Error(`Duplicate source identity: ${row.key}`);
    if (!key || key.length < 2) throw new Error(`Invalid title identity: ${row.key}`);
    keys.add(row.key);
    names.add(key);
    for (const name of Object.values(row.labels)) assertCatalogLabel(name, { skipCharset: true });
  }
  return dataset;
}

/** Pure planner: exact identities only; never infer equivalence from relatedEsco. */
export function planJobTitleCatalogImport(
  dataset: CatalogDataset,
  snapshot: CatalogSnapshot,
  datasetHash: string,
): ImportPlan {
  const titles = snapshot.titles.map(t => ({ ...t }));
  const aliases = new Map(snapshot.aliases.map(a => [a.aliasKey, { ...a }]));
  const auditOwners = new Map(snapshot.audits.map(a => [a.id, a.entityId]));
  const entries: ImportEntry[] = [];
  const aliasConflicts: ImportPlan['aliasConflicts'] = [];
  const newAliases: ImportPlan['aliases'] = [];
  const claimed = new Map<string, string>();

  for (const source of dataset.rows) {
    const name = canonicalDisplayName(source.labels.en);
    const key = normalizeJobTitleKey(name);
    const deterministicId = `jobcat_${sha256(source.key).slice(0, 32)}`;
    const auditId = `jobcat_audit_${sha256(`${datasetHash}:${source.key}`).slice(0, 32)}`;
    const sourceOwnerId = auditOwners.get(auditId);
    const candidates = titles.filter(t => t.id === deterministicId ||
      t.id === sourceOwnerId || t.normalizedKey === key || normalizeJobTitleKey(t.name) === key);
    if (candidates.length > 1) throw new Error(`Ambiguous existing title: ${source.labels.en}`);
    let target = candidates[0];
    const entry: ImportEntry = { source, targetId: '', auditId, createAudit: !auditOwners.has(auditId) };

    if (!target) {
      if (sourceOwnerId) throw new Error(`Previous imported entry is missing: ${source.key}`);
      if (aliases.has(key)) throw new Error(`Canonical title conflicts with an existing alias: ${source.labels.en}`);
      let slug = jobTitleSlugify(name);
      if (titles.some(t => t.slug === slug)) slug = `${slug.slice(0, 49)}-${sha256(source.key).slice(0, 10)}`;
      if (!slug || titles.some(t => t.slug === slug)) throw new Error(`Slug conflict: ${source.key}`);
      entry.create = {
        id: deterministicId, name, normalizedKey: key, slug,
        nameId: source.labels.id, nameUz: source.labels.uz,
        nameIdIsMachine: true, nameUzIsMachine: true,
        i18nStatus: 'PENDING',
      };
      target = {
        id: deterministicId, name, normalizedKey: key, slug,
        nameId: source.labels.id, nameUz: source.labels.uz, nameRu: null,
        nameIdIsMachine: true, nameUzIsMachine: true, nameRuIsMachine: false,
        i18nStatus: 'PENDING', curatedAt: null, archivedAt: null,
      };
      titles.push(target);
    } else if (!target.curatedAt && !target.archivedAt && target.i18nStatus !== 'IGNORED') {
      const patch: Prisma.JobTitleUpdateInput = {};
      if (!target.nameId?.trim()) {
        patch.nameId = source.labels.id;
        patch.nameIdIsMachine = true;
        target.nameId = source.labels.id;
        target.nameIdIsMachine = true;
      }
      if (!target.nameUz?.trim()) {
        patch.nameUz = source.labels.uz;
        patch.nameUzIsMachine = true;
        target.nameUz = source.labels.uz;
        target.nameUzIsMachine = true;
      }
      if (Object.keys(patch).length) {
        patch.i18nStatus = 'PENDING';
        target.i18nStatus = 'PENDING';
        entry.patch = patch;
      }
    }
    if (claimed.has(target.id)) throw new Error(`Two source roles would map to one title: ${source.key}`);
    claimed.set(target.id, source.key);
    entry.targetId = target.id;
    entries.push(entry);
  }

  // Check alias owners after ALL canonical titles have been planned. This also
  // catches a translation that accidentally equals a different English title.
  for (const entry of entries) {
    const target = titles.find(t => t.id === entry.targetId)!;
    if (target.archivedAt || target.i18nStatus === 'IGNORED') continue;
    for (const alias of [target.name, target.nameId, target.nameUz].filter((s): s is string => Boolean(s))) {
      const aliasKey = normalizeJobTitleKey(alias);
      if (!aliasKey) throw new Error(`Empty alias identity: ${entry.source.key}`);
      const owners = titles.filter(t => t.normalizedKey === aliasKey ||
        normalizeJobTitleKey(t.name) === aliasKey || t.slug === jobTitleSlugify(alias)).map(t => t.id);
      const existingAlias = aliases.get(aliasKey);
      if (existingAlias) owners.push(existingAlias.jobTitleId);
      const otherOwners = [...new Set(owners.filter(id => id !== target.id))];
      if (otherOwners.length) {
        aliasConflicts.push({ alias, targetId: target.id, ownerIds: otherOwners });
        continue;
      }
      if (existingAlias || aliasKey === target.normalizedKey || target.slug === jobTitleSlugify(alias)) continue;
      const row = {
        id: `jobcat_alias_${sha256(aliasKey).slice(0, 32)}`,
        jobTitleId: target.id, alias, aliasKey,
      };
      aliases.set(aliasKey, row);
      newAliases.push(row);
    }
  }

  return {
    entries, aliases: newAliases, aliasConflicts,
    summary: {
      sourceRows: entries.length,
      createdTitles: entries.filter(e => e.create).length,
      matchedTitles: entries.filter(e => !e.create).length,
      titlesWithMissingTranslationsFilled: entries.filter(e => e.patch).length,
      createdAliases: newAliases.length,
      createdAuditRecords: entries.filter(e => e.createAudit).length,
      archivedMatchesPreserved: entries.filter(e => snapshot.titles.some(t => t.id === e.targetId && t.archivedAt)).length,
      curatedMatchesPreserved: entries.filter(e => snapshot.titles.some(t => t.id === e.targetId && t.curatedAt)).length,
      aliasConflicts: aliasConflicts.length,
    },
  };
}

export function catalogImportPlanHash(plan: ImportPlan): string {
  return sha256(JSON.stringify({
    entries: plan.entries.map(e => ({ key: e.source.key, targetId: e.targetId, create: e.create,
      patch: e.patch, auditId: e.auditId, createAudit: e.createAudit })),
    aliases: plan.aliases, conflicts: plan.aliasConflicts,
  }));
}
