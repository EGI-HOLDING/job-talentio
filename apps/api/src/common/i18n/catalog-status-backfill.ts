import type { PrismaClient } from '@prisma/client';
import { isCatalogTechIdentity } from './catalog-tech-identity';

type Db = Pick<PrismaClient, 'skill' | 'jobTitle' | 'language' | 'benefit'>;

export type CatalogStatusResult = Record<
  string,
  { complete: number; ignored: number; pending: number }
>;

type Row = { id: string; name: string; nameUz: string | null; nameRu: string | null };

function classify(row: Row, allowTechIdentity: boolean) {
  if (row.nameUz && row.nameRu) return 'COMPLETE' as const;
  if (allowTechIdentity && isCatalogTechIdentity(row.name)) return 'IGNORED' as const;
  return 'PENDING' as const;
}

/**
 * Sorts existing catalog rows into the review queue. Idempotent, so it can run
 * after every deploy that adds curated translations. Language names are never
 * treated as tech identities because they always differ per locale.
 */
export async function backfillCatalogStatus(db: Db): Promise<CatalogStatusResult> {
  const result: CatalogStatusResult = {};

  const tables = [
    { label: 'skill', model: db.skill, allowTechIdentity: true },
    { label: 'jobTitle', model: db.jobTitle, allowTechIdentity: true },
    { label: 'benefit', model: db.benefit, allowTechIdentity: true },
    { label: 'language', model: db.language, allowTechIdentity: false },
  ] as const;

  for (const { label, model, allowTechIdentity } of tables) {
    const counts = { complete: 0, ignored: 0, pending: 0 };
    const buckets: Record<'COMPLETE' | 'IGNORED' | 'PENDING', string[]> = {
      COMPLETE: [],
      IGNORED: [],
      PENDING: [],
    };

    const rows = (await (model as { findMany: (args: unknown) => Promise<Row[]> }).findMany({
      select: { id: true, name: true, nameUz: true, nameRu: true },
    })) as Row[];

    for (const row of rows) {
      const status = classify(row, allowTechIdentity);
      buckets[status].push(row.id);
      if (status === 'COMPLETE') counts.complete += 1;
      else if (status === 'IGNORED') counts.ignored += 1;
      else counts.pending += 1;
    }

    for (const [status, ids] of Object.entries(buckets)) {
      if (!ids.length) continue;
      await (
        model as { updateMany: (args: unknown) => Promise<unknown> }
      ).updateMany({ where: { id: { in: ids } }, data: { i18nStatus: status } });
    }

    result[label] = counts;
  }

  return result;
}
