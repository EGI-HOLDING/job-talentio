import { PrismaClient } from '@prisma/client';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { PositionGroupService } from '../matching/position-group.service';
import { PositionCatalogService } from '../matching/position-catalog.service';

const db = new PrismaClient();
const catalog = new PositionCatalogService(
  new EmployeeCatalogSnapshot(db as never),
  new PositionGroupService(db as never, new OccupationRelationsService(db as never)),
  { ensure() {} } as never,
  db as never,
);

async function main() {
  const apply = process.argv.includes('--apply');
  const { ordered, revision } = await catalog.snapshot();
  const exact = new Map<string, Set<string>>();
  const selectable = new Set<string>();
  for (const row of ordered) {
    if (row.kind !== 'ROLE') continue;
    if (row.selectable) selectable.add(row.id);
    for (const label of [row.label, ...row.aliases]) {
      const ids = exact.get(label) ?? new Set<string>();
      ids.add(row.id);
      exact.set(label, ids);
    }
  }
  const alerts = await db.jobAlert.findMany({
    where: { positionReviewRequired: true },
    select: { id: true, query: true },
  });
  const totals = { apply, revision, scanned: alerts.length, matched: 0, review: 0, migrated: 0 };
  for (const alert of alerts) {
    const ids = exact.get(catalogTitleIdentityKey(alert.query ?? ''));
    const id = ids?.size === 1 ? [...ids][0] : undefined;
    if (!id || !selectable.has(id)) {
      totals.review++;
      continue;
    }
    totals.matched++;
    if (apply) {
      const result = await db.jobAlert.updateMany({
        where: { id: alert.id, query: alert.query, positionReviewRequired: true },
        data: { positionSelections: [{ kind: 'ROLE', id }], positionReviewRequired: false },
      });
      totals.migrated += result.count;
    }
  }
  console.log(JSON.stringify(totals));
}

void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
