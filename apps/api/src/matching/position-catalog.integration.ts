import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeCatalogSnapshot } from './employee-catalog-snapshot';
import { OccupationRelationsService } from './occupation-relations.service';
import { PositionCatalogService } from './position-catalog.service';
import { PositionGroupService } from './position-group.service';
import { PositionSearchIndex } from './position-search-index';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname)
    && ['/talentio_position_picker_20261110', '/talentio_position_groups_20261110'].includes(url.pathname));
  const db = new PrismaService();
  try {
    const catalog = new EmployeeCatalogSnapshot(db);
    const groups = new PositionGroupService(db, new OccupationRelationsService(db));
    const positions = new PositionCatalogService(catalog, groups, { ensure() {}, async search() { return null; } } as never, db);
    const frozen = await positions.snapshot();
    positions.snapshot = async () => frozen;
    const { roles, index } = await catalog.get();
    const group = await groups.snapshot(roles);
    assert.equal(frozen.ordered.filter(row => row.kind === 'GROUP').length, 99);
    const expected = new Map<string, Set<string>>();
    for (const role of roles.filter(row => !row.archivedAt)) {
      const id = index.identity(role.id)?.canonicalRoleId ?? role.id;
      const canonical = index.roles.get(id)!;
      for (const name of [group?.labels.get(id) ?? canonical.name, role.name, role.nameId, role.nameUz, role.nameRu,
        ...role.aliases.filter(alias => alias.matchingApproved).map(alias => alias.alias)]) {
        const query = name && catalogTitleIdentityKey(name);
        if (!query) continue;
        const ids = expected.get(query) ?? new Set<string>();
        ids.add(id);
        expected.set(query, ids);
      }
    }
    for (const [q, ids] of expected) {
      const result = await positions.search({ q, page: 1, limit: ids.size, scope: 'role' });
      assert.deepEqual(new Set(result.items.map(row => row.id)), ids, 'Exact label/alias: ' + q);
    }
    const known = await positions.search({ q: 'AI Engineer', page: 1, limit: 1, scope: 'role', groupId: 'group:engineer' });
    assert.equal(known.items[0]?.name, 'Artificial Intelligence Engineer');
    const ai = known.items[0];
    const memberIds = await positions.jobTitleIds([{ kind: 'GROUP', id: 'group:engineer' }, { kind: 'ROLE', id: ai.id }]);
    assert(memberIds.includes(ai.id));
    assert.equal(new Set(memberIds).size, memberIds.length);
    assert.deepEqual(await positions.jobTitleIds([{ kind: 'GROUP', id: 'group:missing' }]), []);
    assert.equal((await positions.search({ q: 'Artificial Intelligence Engineer', page: 1, limit: 1, scope: 'candidate' })).searchState, 'DEGRADED');

    if (process.env.MEILI_HOST) {
      assert(['localhost', '127.0.0.1'].includes(new URL(process.env.MEILI_HOST).hostname));
      assert.equal(process.env.MEILI_POSITIONS_INDEX, 'positions_picker_qa');
      const real = new PositionCatalogService(catalog, groups, new PositionSearchIndex(new ConfigService()), db);
      const search = { q: 'Artificial Intellignece Engineer', page: 1, limit: 8, scope: 'role' as const };
      let typo = await real.search(search);
      const expires = Date.now() + 75_000;
      while (typo.searchState !== 'READY' && Date.now() < expires) {
        await new Promise(resolve => setTimeout(resolve, 500));
        typo = await real.search(search);
      }
      assert.equal(typo.searchState, 'READY');
      assert(typo.items.some(row => row.id === ai.id), 'Meilisearch typo should include the expected position');
      const unrelated = await real.search({ ...search, q: 'quantum pineapple sandwich' });
      assert.equal(unrelated.total, 0);
    }
    console.log(JSON.stringify({ roles: roles.filter(row => !row.archivedAt).length, groups: 99,
      exactQueries: expected.size, meili: Boolean(process.env.MEILI_HOST) }));
  } finally {
    await db.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
