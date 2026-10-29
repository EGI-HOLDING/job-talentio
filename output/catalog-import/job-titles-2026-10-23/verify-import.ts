import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { MetaService } from '../../../apps/api/src/meta/meta.service';
import { PrismaService } from '../../../apps/api/src/prisma/prisma.service';
import { resolveJobTitle } from '../../../apps/api/src/common/title-resolve';

async function main() {
  const target = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(target.hostname));
  const root = 'output/catalog-import/job-titles-2026-10-23/';
  const receipt = JSON.parse(await readFile(`${root}applied.json`, 'utf8'));
  const db = new PrismaService();
  try {
    const meta = new MetaService(db);
    const first = await meta.jobTitles(undefined, 1, 100);
    const pages = await Promise.all(Array.from({ length: first.totalPages - 1 }, (_, i) => meta.jobTitles(undefined, i + 2, 100)));
    const publicIds = new Set([first, ...pages].flatMap(p => p.items.map(r => r.id)));
    const mappedIds: string[] = receipt.mapping.map((r: { jobTitleId: string }) => r.jobTitleId);
    assert.equal(mappedIds.length, 450);
    assert(mappedIds.every(id => publicIds.has(id)), 'Imported entries must be visible in the public catalog service');
    const titles = await db.jobTitle.findMany({ where: { id: { in: mappedIds } } });
    assert(titles.every(t => t.name && t.nameId && t.nameUz && !t.archivedAt));
    const checks = [];
    for (const terms of [
      ['Akuntan', 'Buxgalter', 'Accountant'],
      ['Tukang ledeng', 'Santexnik', 'Plumber'],
      ['Pengembang frontend', 'Frontend dasturchi', 'Frontend Developer'],
    ]) {
      const results = await Promise.all(terms.map(term => meta.suggestJobTitles(term, 20)));
      const resolved = await Promise.all(terms.map(name => resolveJobTitle(db, { name, allowCreate: false })));
      assert.equal(new Set(resolved.map(r => r.jobTitle.id)).size, 1, `Languages must resolve to one identity: ${terms.join('/')}`);
      for (const hits of results) assert(hits.some(r => r.id === resolved[0].jobTitle.id));
      checks.push({ terms, sameJobTitleId: resolved[0].jobTitle.id, suggestionsPassed: true });
    }
    const legacy = await resolveJobTitle(db, { name: 'Machine Learning Engineer', allowCreate: false });
    assert.equal(legacy.jobTitle.id, receipt.mapping.find((r: { sourceKey: string }) => r.sourceKey === 'talentio-draft:machine-learning-engineer').jobTitleId);
    const counts = { titles: await db.jobTitle.count(), aliases: await db.jobTitleAlias.count(), jobs: await db.jobPost.count(), applications: await db.application.count() };
    assert.deepEqual(counts, receipt.countsAfter);
    const evidence = { checkedAt: new Date().toISOString(), sourceRowsVisibleInPublicCatalog: mappedIds.length,
      publicCatalogTotal: first.total, threeLanguageNamesPresent: true, checks,
      legacyTitleIdentityPreserved: true, counts };
    await writeFile(`${root}verification.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await db.$disconnect(); }
}

main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Catalog verification failed'); process.exitCode = 1; });
