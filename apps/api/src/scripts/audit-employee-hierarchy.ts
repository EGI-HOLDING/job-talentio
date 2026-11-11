import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PrismaService } from '../prisma/prisma.service';
import { liveJobWhere } from '../benefits/benefit-policy';
import { compileHierarchy, EmployeeHierarchyIndex, loadHierarchyManifest } from '../matching/employee-hierarchy';
import { EmployeeCatalogSnapshot } from '../matching/employee-catalog-snapshot';
import { OccupationRelationsService } from '../matching/occupation-relations.service';
import { PositionGroupService } from '../matching/position-group.service';
import { VacancyTasksService } from '../matching/vacancy-tasks.service';
import { EmployeeIntentService } from '../matching/employee-intent.service';

const cases = [
  ['Digital Media Designer', 'Graphic Designer', true],
  ['Digital Media Designer', 'Frontend Developer', false],
  ['Digital Media Designer', 'Full-stack Developer', false],
  ['Digital Media Designer', 'Architect', false],
  ['Data Analyst', 'Computer Vision Engineer', false],
  ['Cashier', 'Supervisor Gerai Ritel', false],
  ['Early Years Teacher', 'Kepala Pusat Penitipan Anak', false],
  ['General Veterinarian', 'Animal Massage Therapist', false],
  ['Chef', 'Sous Chef Dapur Panas', true],
  ['Chef', 'Kepala Dapur Dingin', true],
  ['Chef', 'Cook', false],
  ['Nurse Responsible For General Care', 'Specialist Nurse', true],
  ['Nurse Responsible For General Care', 'Pharmacist', false],
  ['Backend Developer', 'Java Developer', true],
  ['Frontend Developer', 'React Developer', true],
  ['Frontend Developer', 'Backend Developer', false],
  ['QA Engineer', 'Software Tester', true],
  ['Travel Agent', 'Travel Consultant', true],
  ['Travel Agent', 'Tourist Guide', false],
] as const;

async function main() {
  const db = new PrismaService();
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const connection = tx as unknown as PrismaService;
      const relations = new OccupationRelationsService(connection);
      const catalogService = new EmployeeCatalogSnapshot(connection, undefined, relations);
      const catalog = await catalogService.get(true);
      assert.ok('relationReleaseId' in catalog && 'taskVersion' in catalog, 'An active graph is required');
      const groupService = new PositionGroupService(connection, relations);
      const groups = await groupService.snapshot(catalog.roles);
      assert.ok(groups && groups.choices.length === 99, 'Load the published Indonesia groups');
      const hierarchy = compileHierarchy(catalog.index, groups.choices, loadHierarchyManifest());
      assert.deepEqual(hierarchy.reasons, [], 'Reviewed catalog must match this database');
      const jobs = await tx.jobPost.findMany({ where: liveJobWhere(), select: { id: true, jobTitleId: true } });
      const tasks = new VacancyTasksService(connection, relations);
      const roles = catalog.roles.filter(role => catalog.index.identity(role.id)?.canonicalRoleId === role.id);
      const scopes = new Map<string, { roles: number; reviewedSources: number; vacancies: number; relatedBefore: number; relatedAfter: number }>();
      for (const role of roles) {
        const family = scopes.get(role.familyId!) ?? { roles: 0, reviewedSources: 0, vacancies: 0, relatedBefore: 0, relatedAfter: 0 };
        family.roles++;
        if (hierarchy.allowed.has(role.id)) family.reviewedSources++;
        scopes.set(role.familyId!, family);
      }
      const jobsByRole = new Map<string, number>();
      for (const job of jobs) {
        const identity = catalog.index.identity(job.jobTitleId ?? '');
        if (!identity) continue;
        scopes.get(identity.familyId)!.vacancies++;
        jobsByRole.set(identity.canonicalRoleId, (jobsByRole.get(identity.canonicalRoleId) ?? 0) + 1);
      }
      const graph = await relations.snapshot();
      let outsideBefore = 0;
      for (const edge of graph.relations) {
        const source = catalog.index.identity(edge.fromRoleId), target = catalog.index.identity(edge.toRoleId);
        if (!source || !target) continue;
        const count = jobsByRole.get(edge.toRoleId) ?? 0;
        scopes.get(source.familyId)!.relatedBefore += count;
        if (source.familyId !== target.familyId) outsideBefore += count;
      }
      let outsideAfter = 0;
      for (const [source, targets] of hierarchy.allowed) {
        for (const target of targets.keys()) {
          const family = catalog.index.identity(source)!.familyId;
          const count = jobsByRole.get(target) ?? 0;
          if (family !== catalog.index.identity(target)?.familyId) outsideAfter += count;
          scopes.get(family)!.relatedAfter += count;
        }
      }
      assert.equal(outsideAfter, 0, 'Reviewed scopes must not cross families');
      let tp = 0, fp = 0, fn = 0, tn = 0;
      const missing: string[] = [];
      const projected = new Map<string, Awaited<ReturnType<VacancyTasksService['select']>>>();
      for (const [from, to, expected] of cases) {
        const source = catalog.index.resolve(from), target = catalog.index.resolve(to);
        if (!source || !target) {
          missing.push(from + ' → ' + to);
          assert.ok(!expected, 'Missing required positive identity: ' + to);
          continue;
        }
        const index: EmployeeHierarchyIndex = new EmployeeHierarchyIndex(catalog.roles, [source], [], groups.releaseId, hierarchy);
        const actual: boolean = index.eligibility(index.expandedIds, target).matchType === 'RELATED';
        if (expected && actual) tp++;
        else if (expected) fn++;
        else if (actual) fp++;
        else tn++;
        assert.equal(actual, expected, from + ' → ' + to);
        if (!projected.has(source)) {
          const allowed = catalog.roles.filter(role => index.eligibility(index.expandedIds, role.id).eligible).map(role => role.id);
          projected.set(source, await tasks.select(index, index.expandedIds, allowed, catalog.relationReleaseId as string, undefined, catalog.taskVersion as string));
        }
        for (const row of projected.get(source)!.decisions.values()) {
          assert.equal(row.eligibility.familyId, index.identity(source)?.familyId, 'Published vacancy crossed the family boundary');
          assert.ok(index.eligibility(index.expandedIds, row.roleId).eligible, 'Published vacancy bypassed hierarchy');
        }
      }
      const designer = catalog.index.resolve('Digital Media Designer')!;
      const graphic = catalog.index.resolve('Graphic Designer')!;
      const graphicJobs = jobsByRole.get(graphic) ?? 0;
      if (process.argv.includes('--require-live-graphic')) assert.ok(graphicJobs, 'Published Graphic Designer fixture required');
      assert.equal(jobs.filter(job => projected.get(designer)!.decisions.get(job.id)?.eligibility.canonicalRoleId === graphic).length, graphicJobs);
      const engineer = groups.choices.find(group => group.nameEn === 'Engineer');
      assert.ok(engineer);
      const index = new EmployeeHierarchyIndex(catalog.roles, [], [engineer], groups.releaseId, hierarchy);
      const groupFamilies = new Set(index.expandedIds.map(id => index.identity(id)?.familyId));
      assert.ok(groupFamilies.size > 1);
      assert.ok(index.expandedIds.every(id => index.eligibility(index.expandedIds, id).matchType === 'GROUP'));
      const grouped = await tasks.select(index, index.expandedIds, catalog.roles
        .filter(role => index.eligibility(index.expandedIds, role.id).eligible).map(role => role.id),
        catalog.relationReleaseId as string, undefined, catalog.taskVersion as string);
      assert.ok([...grouped.decisions.values()].every(row => row.eligibility.matchType === 'GROUP'));
      let verifiedProfiles = 0;
      if (process.argv.includes('--verify-profiles')) {
        const intent = new EmployeeIntentService(connection, catalogService, undefined, tasks, groupService);
        const candidates = await tx.employeeProfile.findMany({
          where: {
            desiredRoles: { some: { jobTitleId: designer }, every: { jobTitleId: designer } },
            desiredGroups: { none: {} },
          },
          select: { id: true }, take: 3,
        });
        assert.ok(candidates.length, 'Verify the existing design preference through the production service');
        for (const { id } of candidates) {
          const context = await intent.context(id);
          assert.ok(context.index instanceof EmployeeHierarchyIndex, 'Hierarchy mode must be active');
          const related = await intent.recommend(id, 1, 24, context, 'related', { separated: true });
          assert.ok(related.items.length && related.items.every(row => row.eligibility.canonicalRoleId === graphic));
          assert.ok(related.relatedProfessions.length === 1 && related.relatedProfessions[0].id === graphic);
          const primary = await intent.recommend(id, 1, 24, context, 'recommendations', { separated: true });
          assert.equal(primary.primaryTotal, 0);
          assert.equal(primary.relatedTotal, related.total);
          const filtered = await intent.recommend(id, 1, 24, context, 'related', { relatedRoleId: graphic });
          assert.equal(filtered.total, related.total);
          verifiedProfiles++;
        }
      }
      const familyReport = [...scopes].map(([id, row]) => ({ family: id, ...row }));
      console.log(JSON.stringify({
        graph: graph.releaseId, groups: groups.releaseId, hierarchy: hierarchy.revision, roles: roles.length,
        families: scopes.size, vacancies: jobs.length, outsideBefore, outsideAfter,
        reviewedSources: hierarchy.allowed.size, approvedPairs: [...hierarchy.allowed.values()].reduce((n, x) => n + x.size, 0),
        sample: { tp, fp, fn, tn, precision: tp / (tp + fp), recall: tp / (tp + fn), missing }, graphicJobs,
        groupJobs: grouped.decisions.size, groupFamilies: groupFamilies.size, verifiedProfiles,
        ...(process.argv.includes('--by-family') ? { byFamily: familyReport } : {}),
      }));
    }, { timeout: 60000 });
  } finally {
    await db.$disconnect();
  }
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
