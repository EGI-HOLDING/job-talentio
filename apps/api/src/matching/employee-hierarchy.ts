import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { EmployeeEligibility } from '@job-talentio/shared';
import { EmployeeOccupationIndex, reviewedRelatedRoles, type IntentRole } from './employee-occupation';
import { PositionGroupOccupationIndex, type GroupChoice } from './position-group-index';
import { positionRoleRevision } from './position-groups';

export const HIERARCHY_VERSION = 'employee-related-hierarchy-v1';
export function employeeHierarchyMode() {
  const mode = process.env.EMPLOYEE_RELATED_HIERARCHY_MODE;
  return mode === 'strict' || mode === 'direct-only' ? mode : undefined;
}

const roleRef = z.object({ id: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = z.object({
  version: z.literal(HIERARCHY_VERSION),
  specializations: z.array(z.object({ groupId: z.string().min(1), members: z.array(roleRef).min(2), evidence: z.string().min(12) }).strict()),
  pairs: z.array(z.object({ from: roleRef, to: roleRef, evidence: z.string().min(12) }).strict()),
}).strict();
export type HierarchyManifest = z.infer<typeof manifestSchema>;

export function loadHierarchyManifest(): HierarchyManifest | null {
  try {
    const path = join(__dirname, '../../prisma/data/position-groups/related-hierarchy-v1.json');
    return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

export function compileHierarchy(index: EmployeeOccupationIndex, groups: GroupChoice[], manifest: HierarchyManifest | null) {
  const allowed = new Map<string, Map<string, string>>();
  const reasons: string[] = [];
  const memberships = new Map(groups.map(group => [group.id, new Set(group.members)]));
  const specializations = new Map<string, Set<string>>();
  const add = (from: string, to: string, reference: string) => {
    const source = index.identity(from), target = index.identity(to);
    if (!source || !target || from === to || source.familyId !== target.familyId) return false;
    const targets = allowed.get(from) ?? new Map<string, string>();
    if (!targets.has(to)) targets.set(to, reference);
    allowed.set(from, targets);
    return true;
  };
  const current = ({ id, revision }: z.infer<typeof roleRef>) => {
    const role = index.roles.get(id);
    return role && index.identity(id)?.canonicalRoleId === id && positionRoleRevision(role) === revision;
  };
  if (!manifest) reasons.push('MISSING_MANIFEST');
  for (const group of manifest?.specializations ?? []) {
    const active = memberships.get(group.groupId);
    const ids = new Set(group.members.map(member => member.id));
    if (ids.size !== group.members.length || group.members.some(member => !active?.has(member.id) || !current(member))) {
      reasons.push('STALE_SPECIALIZATION:' + group.groupId);
      continue;
    }
    for (const id of ids) {
      const roleGroups = specializations.get(id) ?? new Set<string>();
      roleGroups.add(group.groupId);
      specializations.set(id, roleGroups);
      for (const other of ids) add(id, other, 'hierarchy:group:' + group.groupId);
    }
  }
  for (const pair of manifest?.pairs ?? []) {
    if (!current(pair.from) || !current(pair.to)) {
      reasons.push('STALE_PAIR:' + pair.from.id + ':' + pair.to.id);
      continue;
    }
    const fromGroups = specializations.get(pair.from.id), toGroups = specializations.get(pair.to.id);
    if (fromGroups?.size && toGroups?.size && ![...fromGroups].some(group => toGroups.has(group))) {
      reasons.push('CONFLICTING_SPECIALIZATIONS:' + pair.from.id + ':' + pair.to.id);
      continue;
    }
    if (!add(pair.from.id, pair.to.id, 'hierarchy:reviewed:' + pair.from.id + ':' + pair.to.id)) {
      reasons.push('INVALID_PAIR:' + pair.from.id + ':' + pair.to.id);
    }
  }
  // A stale manifest disables all inferred relationships for this snapshot.
  if (reasons.length) allowed.clear();
  const revision = createHash('sha256').update(JSON.stringify([HIERARCHY_VERSION, manifest, reasons])).digest('hex');
  return { allowed, reasons, revision };
}

export class EmployeeHierarchyIndex extends PositionGroupOccupationIndex {
  private readonly sourcesByTarget = new Map<string, EmployeeEligibility[]>();
  constructor(
    roles: IntentRole[],
    explicitIds: string[],
    groups: GroupChoice[],
    groupRelease: string,
    readonly hierarchy: ReturnType<typeof compileHierarchy>,
    directOnly = false,
  ) {
    super(roles, explicitIds, groups, groupRelease, false);
    if (directOnly) return;
    for (const sourceId of this.explicitRoleIds) {
      const source = this.roles.get(sourceId)!;
      const evidence = new Map(reviewedRelatedRoles(source).map(row => [row.id, row.score]));
      for (const [targetId, reference] of hierarchy.allowed.get(sourceId) ?? []) {
        const target = this.identity(targetId);
        if (!target || source.familyId !== target.familyId) continue;
        const candidates = this.sourcesByTarget.get(targetId) ?? [];
        candidates.push({
          ...target, eligible: true, reason: 'MATCH', matchType: 'RELATED',
          selectedRoleId: sourceId, selectedRoleName: source.name,
          relationReference: reference, relationScore: evidence.get(targetId),
        });
        this.sourcesByTarget.set(targetId, candidates);
      }
    }
    for (const sources of this.sourcesByTarget.values()) sources.sort((a, b) =>
      (b.relationScore ?? 0) - (a.relationScore ?? 0) || a.selectedRoleId!.localeCompare(b.selectedRoleId!));
  }
  relatedSources(jobTitleId: string) {
    const target = this.identity(jobTitleId);
    return target ? this.sourcesByTarget.get(target.canonicalRoleId) ?? [] : [];
  }
  override eligibility(_selectedIds: string[], jobTitleId: string | null | undefined): EmployeeEligibility {
    const direct = super.eligibility(this.expandedIds, jobTitleId);
    if (direct.eligible || !jobTitleId) return direct;
    return this.relatedSources(jobTitleId)[0] ?? direct;
  }
}
