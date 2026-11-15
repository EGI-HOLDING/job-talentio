import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { normalizeSkillKey } from '@job-talentio/shared';
import { AlertsService } from '../alerts/alerts.service';
import { JobsService } from '../jobs/jobs.service';
import { EmployeeEvidenceService } from '../matching/employee-evidence.service';
import { employeeEvidenceParserVersion } from '../matching/employee-intent-evidence';
import type { AuthUser } from './auth.decorators';
import { readSkillNameIdentities } from './skill-resolve';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /^\/skill_names_test_/.test(url.pathname),
    'Run only against a dedicated local skill_names_test_* database with migrations applied');
  const db = new PrismaClient();
  try {
    const hr = await db.user.create({ data: { role: 'RECRUITER', fullName: 'HR', email: 'hr@example.test' } });
    const candidate = await db.user.create({ data: { role: 'EMPLOYEE', fullName: 'Candidate', email: 'candidate@example.test' } });
    const company = await db.company.create({ data: { name: 'Test company', slug: 'test-company', members: { create: { userId: hr.id, role: 'OWNER' } } } });
    const publishedAt = new Date();
    const jobs = new JobsService(db as never, {
      assertMember: async () => ({ company }), assertOpen: () => undefined,
    } as never, {} as never, {} as never, { rankedIds: async () => null, syncJob: async () => undefined } as never, {} as never);

    const names = ['R', 'C++', 'C#', '.NET', 'React (Hooks)'];
    const fields = {
      title: 'Skill Test Engineer',
      description: 'A test vacancy with structured and independently configurable skills.',
      workMode: 'REMOTE',
      skills: names.map((name, index) => ({ name, isRequired: index !== 0, minLevel: index === 1 ? 'ADVANCED' : null })),
    };
    const job = await jobs.create(hr as AuthUser, company.id, fields);
    assert.ok(job);
    const saved = await db.jobPostSkill.findMany({ where: { jobPostId: job.id }, include: { skill: true } });
    assert.deepEqual(saved.map(row => row.skill.name).sort(), [...names].sort());
    assert.equal(saved.find(row => row.skill.name === 'R')?.isRequired, false);
    assert.equal(saved.find(row => row.skill.name === 'C++')?.minLevel, 'ADVANCED');
    const cpp = saved.find(row => row.skill.name === 'C++')!.skill;
    await db.skillAlias.create({ data: { skillId: cpp.id, alias: 'CPP language', aliasKey: normalizeSkillKey('CPP language') } });
    const identities = await readSkillNameIdentities(db, ['C++', 'CPP language', 'Future Test Skill']);
    assert.equal(identities.get('C++'), identities.get('CPP language'));
    assert.equal(identities.get('Future Test Skill'), 'name:futuretestskill');
    await assert.rejects(jobs.create(hr as AuthUser, company.id, { ...fields, skills: [{ name: 'C++' }, { name: 'c++' }] }), /JOB_SKILL_DUPLICATE:2/);
    await assert.rejects(jobs.create(hr as AuthUser, company.id, { ...fields, skills: [{ name: 'C++' }, { name: 'CPP language' }] }), /JOB_SKILL_DUPLICATE:2/);
    assert.equal(await db.jobPost.count(), 1);
    await db.jobPost.update({ where: { id: job.id }, data: { status: 'PUBLISHED', publishedAt } });

    const search = (query: Pick<Parameters<JobsService['search']>[0], 'skillName' | 'skills' | 'skillMode'>) =>
      jobs.search({ ...query, page: 1, limit: 10, sort: 'newest' });
    assert.equal((await search({ skillName: ['CPP language', 'Future Test Skill'], skillMode: 'OR' })).total, 1);
    assert.equal((await search({ skillName: ['CPP language', 'Future Test Skill'], skillMode: 'AND' })).total, 0);
    assert.equal((await search({ skillName: ['.net'], skills: cpp.slug, skillMode: 'AND' })).total, 1);
    assert.equal((await search({ skills: cpp.slug })).total, 1);

    const notifications: { linkUrl: string }[] = [];
    const alerts = new AlertsService(db as never, {} as never, {
      create: async (event: { linkUrl: string }) => { notifications.push(event); },
    } as never, { isConfigured: () => false } as never, {
      validate: async () => [], describe: async () => [],
    } as never);
    const oldAlert = await alerts.create(candidate as AuthUser, { name: 'Legacy', skillSlugs: [cpp.slug], notifyEmail: false });
    assert.deepEqual(oldAlert.skillNames, []);
    const edited = await alerts.update(candidate.id, oldAlert.id, { skillNames: ['React (Hooks)'], isActive: false });
    assert.deepEqual(edited.skills.map(row => row.skill.slug), [cpp.slug]);
    assert.deepEqual(edited.skillNames, ['React (Hooks)']);
    await assert.rejects(alerts.update(candidate.id, oldAlert.id, { skillNames: ['An unsaved term'], skillSlugs: ['missing-slug'] }));
    assert.deepEqual((await alerts.list(candidate.id)).find(row => row.id === oldAlert.id)?.skillNames, ['React (Hooks)']);
    await alerts.create(candidate as AuthUser, { name: 'Future', skillNames: ['Future Test Skill'], notifyEmail: false });
    assert.equal(await db.skill.count(), names.length, 'filters and alerts leave the catalog unchanged');
    await alerts.runNow();
    assert.equal(notifications.length, 0);
    const future = await jobs.create(hr as AuthUser, company.id, { ...fields, skills: [{ name: 'Future Test Skill' }] });
    assert.ok(future);
    await db.jobPost.update({ where: { id: future.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    const futureSkill = await db.skill.findUniqueOrThrow({ where: { normalizedKey: 'futuretestskill' } });
    await db.jobPostSkill.create({ data: { jobPostId: job.id, skillId: futureSkill.id } });
    await alerts.runNow();
    assert.equal(notifications.length, 1);
    assert.deepEqual(new URL(notifications[0].linkUrl, 'https://example.test').searchParams.getAll('skillName'), ['Future Test Skill']);

    const profile = await db.employeeProfile.create({ data: { userId: candidate.id } });
    const resume = await db.resume.create({ data: { profileId: profile.id, title: 'Test CV' } });
    const version = await db.resumeVersion.create({ data: { resumeId: resume.id, fileKey: 'test.pdf', parseStatus: 'READY' } });
    await db.resume.update({ where: { id: resume.id }, data: { currentVersionId: version.id } });
    await db.resumeEmployeeEvidence.create({ data: {
      versionId: version.id, status: 'READY', generation: version.parseGeneration, parserVersion: employeeEvidenceParserVersion([]),
      facts: { roles: [], skills: [], experiences: [], languages: [] },
    } });
    const evidence = new EmployeeEvidenceService(db as never, {} as never, {} as never, { get: async () => ({ roles: [] }) } as never);
    const add = (key: string, revision: number, value: Record<string, unknown>) => evidence.patch(candidate.id, resume.id, version.id,
      { key, revision, value, kind: 'SKILL', operation: 'UPSERT' });
    const edits = await Promise.allSettled([
      add('user:1', 0, { name: 'New CV Skill', level: 'EXPERT' }),
      add('user:2', 0, { name: 'Other tab skill' }),
    ]);
    assert.equal(edits.filter(edit => edit.status === 'fulfilled').length, 1);
    assert.match(String(edits.find(edit => edit.status === 'rejected')?.reason), /CV evidence changed/);
    const corrected = await add('user:3', 1, { skillId: cpp.id, level: 'BEGINNER' });
    assert.equal(corrected.facts?.skills.length, 2);
    assert.ok(corrected.facts?.skills.every(skill => skill.source === 'USER' && skill.confirmed));
    assert.equal(await db.skill.count({ where: { name: { in: ['New CV Skill', 'Other tab skill'] }, matchingKind: 'UNREVIEWED' } }), 1);
    await assert.rejects(add('user:4', 2, { name: 'CPP language' }), /CV_SKILL_DUPLICATE/);
    await assert.rejects(evidence.get(hr.id, resume.id, version.id), /not found/i);
    console.log('PostgreSQL skill-name integration passed');
  } finally {
    await db.$disconnect();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
