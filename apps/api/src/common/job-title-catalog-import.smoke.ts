import assert from 'node:assert/strict';
import {
  CatalogSnapshot, parseCatalogDataset, planJobTitleCatalogImport,
} from './job-title-catalog-import';

const input = (en = 'accountant', id = 'Akuntan', uz = 'Buxgalter') => ({
  key: en, labels: { en, id, uz }, sourceKind: 'esco', sourceRefs: ['esco'],
  sourceUrl: 'https://esco.ec.europa.eu/', reviewFamily: 'accounting',
  reviewStatus: 'pending', readyForImport: false,
});
const dataset = (rows = [input()]) => parseCatalogDataset({ datasetId: 'test', version: 'draft', status: 'draft', rows });
const empty = (): CatalogSnapshot => ({ titles: [], aliases: [], audits: [] });
const existing = (): CatalogSnapshot['titles'][number] => ({
  id: 'existing', name: 'Accountant', nameId: null, nameUz: 'Buxgalter', nameRu: null,
  normalizedKey: 'accountant', slug: 'accountant', nameIdIsMachine: false,
  nameUzIsMachine: false, nameRuIsMachine: false, i18nStatus: 'PENDING',
  curatedAt: null, archivedAt: null,
});
const hash = 'source-hash';

const first = planJobTitleCatalogImport(dataset(), empty(), hash);
assert.equal(first.summary.createdTitles, 1);
assert.equal(first.entries[0].create?.i18nStatus, 'PENDING');
assert.equal(first.entries[0].create?.nameIdIsMachine, true);
assert.equal(first.entries[0].create?.nameUzIsMachine, true);
assert.equal(first.summary.createdAliases, 2);

const reused = planJobTitleCatalogImport(dataset(), { ...empty(), titles: [existing()] }, hash);
assert.equal(reused.summary.createdTitles, 0);
assert.equal(reused.summary.matchedTitles, 1);
assert.equal(reused.entries[0].patch?.nameId, 'Akuntan');
assert.equal(reused.entries[0].patch?.nameUz, undefined);
assert.equal(reused.entries[0].patch?.nameUzIsMachine, undefined);

for (const state of [
  { ...existing(), curatedAt: new Date() },
  { ...existing(), archivedAt: new Date() },
  { ...existing(), i18nStatus: 'IGNORED' as const },
]) {
  const protectedPlan = planJobTitleCatalogImport(dataset(), { ...empty(), titles: [state] }, hash);
  assert.equal(protectedPlan.entries[0].patch, undefined);
}

assert.throws(() => planJobTitleCatalogImport(dataset(), {
  ...empty(), aliases: [{ id: 'old-alias', jobTitleId: 'other-title', alias: 'Accountant', aliasKey: 'accountant' }],
}, hash), /Canonical title conflicts/);

const collision = planJobTitleCatalogImport(dataset(), {
  ...empty(), aliases: [{ id: 'old-alias', jobTitleId: 'other-title', alias: 'Akuntan', aliasKey: 'akuntan' }],
}, hash);
assert.equal(collision.aliasConflicts.length, 1);
assert.equal(collision.aliases.some(a => a.aliasKey === 'akuntan'), false);

const legacy = { ...existing(), name: 'Machine Learning Engineer', normalizedKey: 'machinelearningengineer', slug: 'ai-engineer', nameUz: null };
const legacyPlan = planJobTitleCatalogImport(dataset([input('machine learning engineer', 'Insinyur pembelajaran mesin', 'Mashinaviy o‘rganish muhandisi')]), { ...empty(), titles: [legacy] }, hash);
assert.equal(legacyPlan.summary.createdTitles, 0);
assert(legacyPlan.aliases.some(a => a.aliasKey === 'machine-learning-engineer'));

const distinct = dataset([
  input('software developer', 'Pengembang perangkat lunak', 'Dasturiy ta’minot dasturchisi'),
  { ...input('backend developer', 'Pengembang backend', 'Backend dasturchi'), sourceKind: 'market_extension' },
]);
const distinctPlan = planJobTitleCatalogImport(distinct, empty(), hash);
assert.equal(distinctPlan.summary.createdTitles, 2);
assert.notEqual(distinctPlan.entries[0].targetId, distinctPlan.entries[1].targetId);

const created = first.entries[0].create!;
const after: CatalogSnapshot = {
  titles: [{ ...existing(), ...created, id: String(created.id), name: String(created.name),
    slug: String(created.slug), normalizedKey: String(created.normalizedKey), archivedAt: null, curatedAt: null }],
  aliases: first.aliases.map(a => ({ id: String(a.id), alias: a.alias, aliasKey: a.aliasKey, jobTitleId: a.jobTitleId })),
  audits: first.entries.map(e => ({ id: e.auditId, entityId: e.targetId })),
};
const rerun = planJobTitleCatalogImport(dataset(), after, hash);
assert.equal(rerun.summary.createdTitles, 0);
assert.equal(rerun.summary.titlesWithMissingTranslationsFilled, 0);
assert.equal(rerun.summary.createdAliases, 0);
assert.equal(rerun.summary.createdAuditRecords, 0);
console.log('job-title catalog import: creation, draft flags, preservation, conflicts, legacy keys, distinct roles, and idempotency passed');
