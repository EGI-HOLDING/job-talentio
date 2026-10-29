import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../..');
const prior = path.resolve(directory, '../job-titles-2026-10-23');
const initial = JSON.parse(fs.readFileSync(path.join(directory, 'before.json'), 'utf8'));
const source = [0, 1, 2, 3].flatMap(i => JSON.parse(fs.readFileSync(path.join(prior, `sources/esco-occupations-page-${i}.json`), 'utf8'))._embedded.results);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const identity = text => text.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/c\+\+/g, 'cplusplus').replace(/c#/g, 'csharp').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const display = text => text.split(' ').map(word => /[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const byCode = new Map(source.map(row => [row.code, row]));
if (source.length !== 3039 || byCode.size !== 3039) throw new Error('Incomplete or duplicate ESCO source');

const translations = new Map();
for (const file of fs.readdirSync(directory).filter(name => /^labels-.*\.tsv$/.test(name)).sort()) {
  for (const [i, line] of fs.readFileSync(path.join(directory, file), 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [code, id, uz, extra] = line.split('|').map(value => value.trim());
    if (!byCode.has(code) || !id || !uz || extra || translations.has(code)) throw new Error(`Invalid/duplicate translation ${file}:${i + 1}: ${line}`);
    translations.set(code, { id, uz });
  }
}
const corrections = new Map(fs.readFileSync(path.join(directory, 'reviewed-corrections.tsv'), 'utf8')
  .split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [code, id, uz] = line.trim().split('|');
    if (!byCode.has(code) || !id || !uz) throw new Error('Invalid reviewed correction: ' + code);
    return [code, { id, uz }];
  }));
const sourceOwners = new Map(initial.auditImports.filter(a => a.metadata?.source?.esco?.uri).map(a => [a.metadata.source.esco.uri, a.entityId]));
const originalSourceOwners = new Map(sourceOwners);
const merges = [];
const oldMobile = initial.titles.find(t => t.name === 'Mobile Developer');
const escoMobile = initial.titles.find(t => t.name === 'Mobile Application Developer');
if (oldMobile && escoMobile) {
  merges.push({ from: escoMobile.id, to: oldMobile.id, reason: 'Same mobile application development function; retain the pre-existing ID used by postings' });
  sourceOwners.set(byCode.get('2514.2.2').uri, oldMobile.id);
}

const rows = [];
const remaining = [];
for (const occupation of source) {
  const existing = initial.titles.find(t => t.id === sourceOwners.get(occupation.uri));
  const original = initial.titles.find(t => t.id === originalSourceOwners.get(occupation.uri));
  const labels = translations.get(occupation.code);
  const correction = corrections.get(occupation.code);
  if (correction && existing?.curatedAt) throw new Error('Reviewed correction conflicts with an admin override');
  const id = correction?.id || existing?.nameId || labels?.id || original?.nameId;
  const uz = correction?.uz || existing?.nameUz || labels?.uz || original?.nameUz;
  if (!id || !uz) { remaining.push({ code: occupation.code, name: occupation.preferredLabel.en, uri: occupation.uri }); continue; }
  rows.push({
    key: `esco:${occupation.uri.split('/').at(-1)}`,
    targetId: existing?.id || `jobcat_${hash(`esco:${occupation.uri.split('/').at(-1)}`).slice(0,32)}`,
    name: existing?.curatedAt ? existing.name : display(occupation.preferredLabel.en),
    nameId: id, nameUz: uz,
    source: { provider: 'European Commission ESCO', uri: occupation.uri, code: occupation.code, version: '1.2.1', preferredLabelEn: occupation.preferredLabel.en, isco08: occupation.code.slice(0,4) },
    labelStatus: { en: 'source_preferred_or_existing_curated', id: 'editorial_translation', uz: 'editorial_translation_native_review_recommended' },
  });
}

for (const line of fs.readFileSync(path.join(directory, 'legacy-labels.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [name, id, uz] = line.split('|');
  const existing = initial.titles.find(t => t.name === name);
  if (!existing) throw new Error('Unknown legacy entry: ' + name);
  const represented = rows.find(row => row.targetId === existing.id);
  if (represented) { represented.nameId ||= id; represented.nameUz ||= uz; continue; }
  rows.push({ key: 'existing:' + existing.id, targetId: existing.id, name: existing.name,
    nameId: existing.nameId || id, nameUz: existing.nameUz || uz,
    source: { provider: 'Existing Talentio catalog, audited translation', uri: null, code: null, version: '2026-10-24' },
    labelStatus: { en: 'existing_market_term', id: 'editorial_translation', uz: 'editorial_translation_native_review_recommended' } });
}

// Preserve the original market roles, including explicit owner-approved names.
for (const title of initial.titles.filter(t => !t.archivedAt && !merges.some(m => m.from === t.id))) {
  if (rows.some(row => row.targetId === title.id)) continue;
  if (!title.nameId || !title.nameUz) throw new Error('Missing legacy translation: ' + title.name);
  rows.push({ key: 'existing:' + title.id, targetId: title.id, name: title.name,
    nameId: title.nameId, nameUz: title.nameUz,
    source: { provider: 'Existing Talentio catalog, audited preservation', uri: null, code: null, version: '2026-10-24' },
    labelStatus: { en: 'existing_market_term', id: 'existing_label_preserved', uz: 'existing_label_preserved' } });
}

for (const file of ['market-additions.tsv', 'medical-additions.tsv']) {
  for (const line of fs.readFileSync(path.join(directory, file), 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'))) {
    const parts = line.trim().split('|');
    const [key, name, nameId, nameUz, url] = file.startsWith('market-') ? parts : [identity(parts[0]), ...parts];
    if (!key || !name || !nameId || !nameUz || !url?.startsWith('https://')) throw new Error('Invalid market addition: ' + line);
    if (rows.some(row => identity(row.name) === identity(name))) throw new Error('Market role already represented: ' + name);
    rows.push({ key: 'market:' + key, targetId: 'jobcat_' + hash('market:' + key).slice(0, 32), name, nameId, nameUz,
      source: { provider: 'Primary employer or occupational authority, editorial market extension', uri: url, code: null, version: '2026-10-24', scope: 'Observed profession; local labels are editorial equivalents, not licensing equivalence' },
      labelStatus: { en: 'editorial_market_term', id: 'editorial_translation', uz: 'editorial_translation_native_review_recommended' } });
  }
}
for (const line of fs.readFileSync(path.join(directory, 'additional-aliases.tsv'), 'utf8').split(/\r?\n/).filter(line => line.trim())) {
  const [name, alias] = line.trim().split('|');
  const row = rows.find(row => identity(row.name) === identity(name));
  if (!row || !alias) throw new Error('Unknown alias target: ' + name);
  row.aliases ||= [];
  row.aliases.push(alias);
}

const snapshotIds = new Set(rows.map(row => row.targetId));
if (snapshotIds.size !== rows.length) throw new Error('Two source identities map to one target without an explicit reviewed equivalence');
const activeAfter = initial.titles.filter(t => !t.archivedAt && !merges.some(m => m.from === t.id)).map(t => {
  const row = rows.find(row => row.targetId === t.id);
  return row ? { ...t, ...row } : t;
});
for (const row of rows) if (!activeAfter.some(t => t.id === row.targetId || t.targetId === row.targetId)) activeAfter.push({ ...row, id: row.targetId });
const labelCollisions = [];
for (const language of ['name','nameId','nameUz']) {
  const owners = new Map();
  for (const row of activeAfter) {
    const label = row[language]; if (!label) continue;
    const normalized = identity(label);
    const previous = owners.get(normalized);
    if (previous && previous.id !== row.id) labelCollisions.push({ language, label, roles: [previous.name, row.name], ids: [previous.id,row.id] });
    else owners.set(normalized, row);
  }
}
const dataset = { datasetId: 'talentio-job-title-audit-2026-10-24', sourceVersion: 'ESCO v1.2.1', sourceCount: source.length, rows, merges,
  provenance: { sourceDownloadedOn: '2026-10-23', sourceVersionRecheckedOn: '2026-10-24', nationalReferences: ['KBJI 2026 (reference only; not a copied national database)', 'Uzbekistan MMK-2025 (reference only; no official national code equivalence claimed)'], translationMethod: 'Editorial translations prepared during this audit; no translation API invoked', sources: ['https://esco.ec.europa.eu/en/classification/occupation_main','https://esco.ec.europa.eu/en/use-esco/download/privacy-statement','https://www.bps.go.id/id/publication/2026/09/18/037999e06c01ccb8acd2e7af/klasifikasi-baku-jabatan-indonesia--kbji--2026.html','https://stat.uz/uz/interaktiv-xizmatlar/statistik-klassifikasiyalar'] } };
const dest = path.join(repo, 'apps/api/prisma/data/job-titles');
fs.mkdirSync(dest, { recursive:true });
fs.writeFileSync(path.join(dest, 'audit-2026-10-24.json'), JSON.stringify(dataset,null,2)+'\n');
const coverage = { sourceCount: source.length, sourceMapped: rows.filter(row => row.source.code).length, sourceRemaining: remaining.length, sourceGroupsMapped: new Set(rows.filter(row => row.source.code).map(row => row.source.isco08)).size, sourceGroupsTotal:426, plannedRows: rows.length, newTitles: rows.filter(row => !initial.titles.some(t => t.id === row.targetId)).length, merges: merges.length, labelCollisions };
fs.writeFileSync(path.join(directory, 'coverage.json'), JSON.stringify(coverage,null,2)+'\n');
fs.writeFileSync(path.join(directory, 'remaining.json'), JSON.stringify(remaining,null,2)+'\n');
console.log(JSON.stringify(coverage,null,2));
