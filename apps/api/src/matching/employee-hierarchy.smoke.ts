import assert from 'node:assert/strict';
import { compileHierarchy, EmployeeHierarchyIndex, HIERARCHY_VERSION, type HierarchyManifest } from './employee-hierarchy';
import { EmployeeOccupationIndex, type IntentRole } from './employee-occupation';
import { positionRoleRevision } from './position-groups';
import { rankRelatedProfessions } from './employee-intent.service';
import type { IntentEvaluation } from './employee-intent';

const role = (id: string, familyId: string, canonicalRoleId: string | null = null): IntentRole => ({
  id, name: id, familyId, family: { id: familyId, name: familyId, archivedAt: null },
  canonicalRoleId, matchingApproved: true, aliases: [],
});
const roles = [role('media', 'visual'), role('graphic', 'visual'), role('alias', 'visual', 'media'),
  role('architect', 'visual'), role('frontend', 'software'), role('backend', 'software')];
roles[0].matchingMetadata = { relatedRoles: [
  { id: 'frontend', kind: 'RELATED', approved: true, reference: 'admin:correction', score: 0.99 },
  { id: 'architect', kind: 'RELATED', approved: true, reference: 'task:generic', score: 0.98 },
] };
const ref = (id: string) => ({ id, revision: positionRoleRevision(roles.find(r => r.id === id)!) });
const manifest: HierarchyManifest = { version: HIERARCHY_VERSION, specializations: [],
  pairs: [{ from: ref('media'), to: ref('graphic'), evidence: 'Create visual assets for publication' }] };
const groups = [{ id: 'explicit', nameEn: 'Explicit group', members: ['frontend', 'graphic'] }];
const compiled = compileHierarchy(new EmployeeOccupationIndex(roles), groups, manifest);
assert.deepEqual(compiled.reasons, []);
const test = (index: EmployeeHierarchyIndex, id: string) => index.eligibility(index.expandedIds, id);
const specific = new EmployeeHierarchyIndex(roles, ['alias'], [], 'release', compiled);
assert.equal(test(specific, 'media').matchType, 'EXACT');
assert.equal(test(specific, 'graphic').matchType, 'RELATED', 'Accepted scope does not depend on an old graph edge');
assert.equal(test(specific, 'frontend').eligible, false, 'An admin edge cannot cross family');
assert.equal(test(specific, 'architect').eligible, false, 'Family does not establish a compatible profession');
const selected = new EmployeeHierarchyIndex(roles, ['media', 'graphic'], groups, 'release', compiled);
assert.equal(test(selected, 'graphic').matchType, 'EXACT');
assert.equal(test(selected, 'frontend').matchType, 'GROUP');
assert.equal(test(selected, 'backend').eligible, false);
const groupOnly = new EmployeeHierarchyIndex(roles, [], groups, 'release', compiled);
assert.equal(test(groupOnly, 'graphic').matchType, 'GROUP');
assert.equal(test(groupOnly, 'frontend').matchType, 'GROUP');
assert.equal(test(groupOnly, 'media').eligible, false, 'Group members cannot create inferred suggestions');
const stale = compileHierarchy(new EmployeeOccupationIndex(roles.map(r => r.id === 'media' ? {...r, name: 'Changed'} : r)), groups, manifest);
assert.ok(stale.reasons.length && stale.allowed.size === 0);
const invalid = compileHierarchy(new EmployeeOccupationIndex(roles), groups, {...manifest,
  pairs: [{ from: ref('media'), to: ref('frontend'), evidence: 'Invalid cross-family approval' }]});
assert.ok(invalid.reasons.length && invalid.allowed.size === 0);
assert.equal(test(new EmployeeHierarchyIndex(roles, ['media'], groups, 'release', compiled, true), 'media').matchType, 'EXACT');
const directOnly = new EmployeeHierarchyIndex(roles, ['media'], [], 'release', compiled, true);
assert.equal(test(directOnly, 'graphic').eligible, false);
const row = (id: string, relationScore: number, matchType: 'RELATED' | 'EXACT' = 'RELATED') => ({
  job: { publishedAt: null },
  evaluation: {
    score: 50, optionalScore: 0, tier: 1, practical: [0.5, 0.5, 0.5],
    eligibility: { eligible: true, reason: 'MATCH', matchType, canonicalRoleId: id, relationScore },
    insights: {},
  } as IntentEvaluation,
});
const cards = rankRelatedProfessions([row('strong', 0.8), row('volume', 0.3), row('volume', 0.2),
  row('volume', 0.1), row('exact', 1, 'EXACT')], true);
assert.deepEqual(cards.map(([id, card]) => [id, card.count]), [['strong', 1], ['volume', 3]]);
console.log(JSON.stringify({ suite: 'employee-hierarchy', checks: 15 }));
