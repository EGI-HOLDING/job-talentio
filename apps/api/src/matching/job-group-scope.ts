import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { EmployeeEligibility } from '@job-talentio/shared';
import { intentRoleInclude } from './employee-occupation';
import { positionRoleRevision, type GroupDefinition } from './position-groups';
import type { GroupChoice } from './position-group-index';

export const jobGroupsEnabled = () => process.env.HR_JOB_POSITION_GROUPS_ENABLED === 'true'
  && process.env.HR_FLOW_MARKET === 'id' && process.env.POSITION_GROUPS_ENABLED === 'true';

const verifiedRoot = {
  archivedAt: null, matchingApproved: true, canonicalRoleId: null, family: { is: { archivedAt: null } },
} satisfies Prisma.JobTitleWhereInput;

export const jobGroupSelect = {
  positionGroupId: true,
  positionGroup: { select: { archivedAt: true } },
  approvedPositionMembers: { where: { jobTitle: verifiedRoot }, select: { jobTitleId: true } },
} as const;

type GroupJob = {
  positionGroupId: string | null;
  positionGroup: { archivedAt: Date | null } | null;
  approvedPositionMembers: Array<{jobTitleId: string}>;
};
export type JobGroupCatalog = ReadonlyMap<string, {nameEn: string; members: ReadonlySet<string>}>;
export const jobGroupCatalog = (choices: GroupChoice[] = []): JobGroupCatalog =>
  new Map(choices.map(group => [group.id, { nameEn: group.nameEn, members: new Set(group.members) }]));

export type JobGroupIntent = { groups: ReadonlySet<string>; roles: ReadonlyMap<string, string> };

/** A different selected group never supplies implicit roles for a group vacancy. */
export function jobGroupWhere(catalog: JobGroupCatalog, intent: JobGroupIntent, releaseId?: string | null): Prisma.JobPostWhereInput[] {
  if (!jobGroupsEnabled() || !releaseId || (!intent.groups.size && !intent.roles.size)) return [];
  const clauses: Prisma.JobPostWhereInput[] = [];
  for (const [id, group] of catalog) {
    const members = [...group.members].filter(role => intent.groups.has(id) || intent.roles.has(role));
    if (members.length) clauses.push({
      positionGroupId: id,
      approvedPositionMembers: { some: { jobTitleId: { in: members }, jobTitle: verifiedRoot } },
    });
  }
  return clauses.length ? [{
    positionEntryMode: 'GROUP',
    positionGroupApprovedAt: { not: null },
    positionGroup: { is: { archivedAt: null, memberships: { some: { releaseId, release: { states: { some: { id: 'indonesia' } } } } } } },
    OR: clauses,
  }] : [];
}

export function effectiveJobGroup(job: GroupJob, catalog: JobGroupCatalog) {
  const group = job.positionGroupId && job.positionGroup && !job.positionGroup.archivedAt && jobGroupsEnabled()
    ? catalog.get(job.positionGroupId) : undefined;
  const members = job.approvedPositionMembers.filter(row => group?.members.has(row.jobTitleId)).map(row => row.jobTitleId).sort();
  return group && members.length ? { name: group.nameEn, members } : null;
}

export function matchJobGroup(job: GroupJob, catalog: JobGroupCatalog, intent: JobGroupIntent, releaseId?: string | null): EmployeeEligibility {
  const scope = effectiveJobGroup(job, catalog);
  const id = job.positionGroupId;
  const selectedRole = scope?.members.find(member => intent.roles.has(member));
  const selectedGroup = Boolean(id && intent.groups.has(id));
  if (!id || !scope || (!selectedRole && !selectedGroup)) return { eligible: false, reason: 'POSITION_MISMATCH' };
  return {
    eligible: true, reason: 'MATCH', matchType: 'GROUP', selectionBasis: 'GROUP',
    vacancyGroupId: id, vacancyGroupName: scope.name, groupReleaseVersion: releaseId ?? undefined,
    selectedGroupId: selectedGroup ? id : undefined, selectedGroupName: selectedGroup ? scope.name : undefined,
    selectedRoleId: selectedRole, selectedRoleName: selectedRole ? intent.roles.get(selectedRole) : undefined,
  };
}

export async function previewJobGroup(db: Prisma.TransactionClient, groupId: string, lock = false) {
  if (!jobGroupsEnabled()) throw new BadRequestException('JOB_POSITION_GROUPS_UNAVAILABLE');
  if (lock) {
    // Serialize approval with release activation. The state pointer is also protected
    // against other writers for the rest of the publication transaction.
    await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(7749932)`;
    await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(742159744)`;
    await db.$queryRaw`SELECT id FROM "PositionGroupState" WHERE id = 'indonesia' FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "PositionGroup" WHERE id = ${groupId} FOR SHARE`;
  }
  const [state, group] = await Promise.all([
    db.positionGroupState.findUnique({ where: { id: 'indonesia' }, include: { activeRelease: { select: { report: true } } } }),
    db.positionGroup.findFirst({ where: { id: groupId, archivedAt: null }, select: { id: true } }),
  ]);
  const releaseId = state?.activeReleaseId;
  const head = (state?.activeRelease?.report as {headDefinitions?: GroupDefinition[]} | undefined)?.headDefinitions?.find(row => row.id === groupId);
  if (!group || !head || !releaseId) throw new BadRequestException('POSITION_GROUP_UNAVAILABLE');
  const memberships = await db.positionGroupMembership.findMany({
    where: { releaseId, groupId }, orderBy: { jobTitleId: 'asc' }, select: { jobTitleId: true, basis: true },
  });
  const ids = memberships.map(row => row.jobTitleId);
  if (lock && ids.length) {
    await db.$queryRaw(Prisma.sql`SELECT id FROM "JobTitle" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`);
    await db.$queryRaw(Prisma.sql`SELECT id FROM "JobFamily" WHERE id IN (SELECT "familyId" FROM "JobTitle" WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR SHARE`);
  }
  const roles = await db.jobTitle.findMany({
    where: { id: { in: ids }, ...verifiedRoot },
    include: { ...intentRoleInclude, positionGroupLabels: { where: { releaseId }, select: { nameEn: true } } },
  });
  const byId = new Map(roles.map(role => [role.id, role]));
  const members = memberships.flatMap(row => {
    const role = byId.get(row.jobTitleId);
    const revision = (row.basis as {roleRevision?: string}).roleRevision;
    return role && revision === positionRoleRevision(role)
      ? [{ id: role.id, name: role.positionGroupLabels[0]?.nameEn ?? role.name, family: role.family?.name, revision }] : [];
  });
  const scopeRevision = createHash('sha256').update(JSON.stringify([groupId, head.nameEn, releaseId, state.revision, members])).digest('hex');
  return { id: groupId, name: head.nameEn, releaseId, scopeRevision, members };
}

export async function approveJobGroup(db: Prisma.TransactionClient, jobId: string, groupId: string, revision: unknown) {
  const preview = await previewJobGroup(db, groupId, true);
  if (preview.scopeRevision !== revision) {
    throw new ConflictException({ message: 'POSITION_GROUP_SCOPE_CHANGED', scope: preview });
  }
  if (!preview.members.length) throw new BadRequestException('POSITION_GROUP_HAS_NO_VERIFIED_MEMBERS');
  await db.jobPositionGroupMember.deleteMany({ where: { jobId } });
  await db.jobPositionGroupMember.createMany({ data: preview.members.map(member => ({ jobId, jobTitleId: member.id })) });
  await db.jobPost.update({ where: { id: jobId }, data: {
    title: preview.name, positionGroupReleaseId: preview.releaseId, positionGroupApprovedAt: new Date(),
    positionGroupScopeRevision: preview.scopeRevision,
  } });
}

/** Read once per HR ranking operation. Existing application evidence stays frozen. */
export async function withRecruiterGroupScope<T extends { id: string; positionGroupId?: string | null }>(
  db: Prisma.TransactionClient, job: T,
): Promise<T & {effectivePositionMemberIds?: string[]}> {
  if (!job.positionGroupId) return job;
  const empty = { ...job, effectivePositionMemberIds: [] };
  if (!jobGroupsEnabled()) return empty;
  try {
    const [preview, saved] = await Promise.all([
      previewJobGroup(db, job.positionGroupId),
      db.jobPost.findFirst({ where: { id: job.id, positionGroupId: job.positionGroupId, positionGroupApprovedAt: { not: null } }, select: jobGroupSelect }),
    ]);
    if (!saved) return empty;
    const catalog = new Map([[preview.id, { nameEn: preview.name, members: new Set(preview.members.map(member => member.id)) }]]);
    return { ...job, effectivePositionMemberIds: effectiveJobGroup(saved, catalog)?.members ?? [] };
  } catch (error) {
    if (error instanceof BadRequestException && error.message === 'POSITION_GROUP_UNAVAILABLE') return empty;
    throw error;
  }
}
