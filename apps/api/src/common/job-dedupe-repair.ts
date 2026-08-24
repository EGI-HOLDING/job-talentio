import { Prisma, PrismaClient } from '@prisma/client';
import {
  ACTIVE_JOB_DUPLICATE_STATUSES,
  type ActiveJobDedupeSnapshot,
  type DuplicateInventory,
  formatDuplicateGroup,
  inventoryActiveJobDuplicates,
  jobFingerprint,
  pickActiveDuplicateWinner,
} from './dedupe';

type RepairDb = Pick<PrismaClient, 'jobPost'>;

const ACTIVE = [...ACTIVE_JOB_DUPLICATE_STATUSES];

async function loadActiveJobSnapshots(
  db: RepairDb,
  extraWhere?: Prisma.JobPostWhereInput,
): Promise<ActiveJobDedupeSnapshot[]> {
  const rows = await db.jobPost.findMany({
    where: { status: { in: ACTIVE }, ...extraWhere },
    select: {
      id: true,
      companyId: true,
      title: true,
      workMode: true,
      cityId: true,
      status: true,
      fingerprint: true,
      contentHash: true,
      createdAt: true,
      company: { select: { name: true, slug: true } },
      city: { select: { name: true } },
      _count: { select: { applications: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    companySlug: row.company.slug,
    title: row.title,
    workMode: row.workMode,
    cityId: row.cityId,
    cityName: row.city?.name ?? null,
    status: row.status,
    fingerprint: row.fingerprint,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    applicationCount: row._count.applications,
  }));
}

export async function inventoryActiveJobDuplicatesFromDb(
  db: RepairDb,
): Promise<{ snapshots: ActiveJobDedupeSnapshot[]; inventory: DuplicateInventory }> {
  const snapshots = await loadActiveJobSnapshots(db);
  return { snapshots, inventory: inventoryActiveJobDuplicates(snapshots) };
}

async function closeIfStillActive(
  db: RepairDb,
  job: ActiveJobDedupeSnapshot,
  keptId: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const live = await db.jobPost.findUnique({
    where: { id: job.id },
    select: { id: true, status: true, title: true, workMode: true, cityId: true },
  });
  if (!live || !(ACTIVE as string[]).includes(live.status)) return false;
  const fingerprint = jobFingerprint({
    title: live.title,
    workMode: live.workMode,
    cityId: live.cityId,
  });
  await db.jobPost.update({
    where: { id: live.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      fingerprint,
    },
  });
  log(
    `Closed duplicate job ${live.id} ("${live.title}") kept=${keptId} company=${job.companySlug}`,
  );
  return true;
}

/** Restore SHA-256 fingerprints; skip when another active row already owns the hash. */
async function restoreCanonicalFingerprints(
  db: RepairDb,
  log: (msg: string) => void,
): Promise<number> {
  const rows = await db.jobPost.findMany({
    where: { fingerprint: { contains: ':' } },
    select: {
      id: true,
      companyId: true,
      title: true,
      workMode: true,
      cityId: true,
      fingerprint: true,
      status: true,
    },
  });
  let restored = 0;
  for (const row of rows) {
    const next = jobFingerprint({
      title: row.title,
      workMode: row.workMode,
      cityId: row.cityId,
    });
    if (row.fingerprint === next) continue;
    try {
      await db.jobPost.update({
        where: { id: row.id },
        data: { fingerprint: next },
      });
      restored += 1;
    } catch (err) {
      log(
        `Skip fingerprint restore ${row.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return restored;
}

export async function repairActiveJobDuplicates(
  db: RepairDb,
  log: (msg: string) => void = () => undefined,
): Promise<{
  groupsBefore: DuplicateInventory['counts'];
  closed: number;
  remaining: DuplicateInventory['counts'];
  remainingJobsToClose: number;
}> {
  const before = await inventoryActiveJobDuplicatesFromDb(db);
  log(
    `Job dedupe inventory: A=${before.inventory.counts.A} B=${before.inventory.counts.B} ` +
      `C=${before.inventory.counts.C} D=${before.inventory.counts.D} ` +
      `jobsToClose=${before.inventory.jobsToClose} active=${before.snapshots.length}`,
  );
  for (const group of before.inventory.groups) {
    if (group.class === 'D') {
      log(`Job dedupe report-only ${formatDuplicateGroup(group)}`);
      continue;
    }
    log(`Job dedupe ${formatDuplicateGroup(group)}`);
  }

  let closed = 0;
  for (const group of before.inventory.groups) {
    if (group.class === 'D') continue;
    const stillActive = await loadActiveJobSnapshots(db, {
      id: { in: group.jobs.map((job) => job.id) },
    });
    if (stillActive.length < 2) continue;
    const winner = pickActiveDuplicateWinner(stillActive);
    for (const job of stillActive) {
      if (job.id === winner.id) continue;
      if (await closeIfStillActive(db, job, winner.id, log)) closed += 1;
    }
  }

  const restored = await restoreCanonicalFingerprints(db, log);
  if (restored > 0) log(`Job dedupe restored ${restored} canonical fingerprint(s)`);

  const after = await inventoryActiveJobDuplicatesFromDb(db);
  log(
    `Job dedupe remaining: A=${after.inventory.counts.A} B=${after.inventory.counts.B} ` +
      `C=${after.inventory.counts.C} D=${after.inventory.counts.D} ` +
      `jobsToClose=${after.inventory.jobsToClose}`,
  );

  return {
    groupsBefore: before.inventory.counts,
    closed,
    remaining: after.inventory.counts,
    remainingJobsToClose: after.inventory.jobsToClose,
  };
}

export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Close active siblings that block a canonical fingerprint write. */
export async function closeFingerprintCollision(
  db: RepairDb,
  opts: {
    postId: string;
    companyId: string;
    nextFingerprint: string;
    log: (msg: string) => void;
  },
): Promise<void> {
  const snapshots = await loadActiveJobSnapshots(db, {
    companyId: opts.companyId,
    OR: [
      { id: opts.postId },
      { fingerprint: opts.nextFingerprint },
      { fingerprint: { startsWith: `${opts.nextFingerprint}:` } },
    ],
  });
  if (snapshots.length < 2) return;
  const winner = pickActiveDuplicateWinner(snapshots);
  for (const job of snapshots) {
    if (job.id === winner.id) continue;
    await closeIfStillActive(db, job, winner.id, opts.log);
  }
}
