import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { JOB_LANGUAGE_LIMIT } from '@job-talentio/shared';
import { MetaService } from '../meta/meta.service';
import { JobsService } from '../jobs/jobs.service';
import { EmployeeEvidenceService } from '../matching/employee-evidence.service';
import { employeeEvidenceParserVersion } from '../matching/employee-intent-evidence';
import { ProfilesService } from '../profiles/profiles.service';
import { parseCvText } from '../profiles/cv-parser';
import type { AuthUser } from './auth.decorators';
import { resolveLanguage } from './language-resolve';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /^\/language_catalog_test_/.test(url.pathname),
    'Run only against a local language_catalog_test_* database with migrations applied');
  const db = new PrismaClient();
  try {
    const meta = new MetaService(db as never);
    const catalog = await meta.languages();
    assert.ok(catalog.length >= 199, 'the catalog contains the ISO and regional entries');
    for (const [query, code] of [['indonesia', 'id'], ['Bahasa Indonesia', 'id'], ['Jepang', 'ja'], ['日本語', 'ja'], ['Mandarin', 'zh'], ['Русский', 'ru'], ['Aceh', 'ace'], ['Español', 'es']]) {
      assert.equal((await meta.suggestLanguages(query, 10, 'id'))[0]?.code, code, query);
    }
    assert.equal((await meta.suggestLanguages('', 250, 'id')).length, catalog.length);
    assert.deepEqual(await meta.suggestLanguages('Not a language query', 10, 'id'), []);
    assert.equal((await resolveLanguage(db, { name: 'Bahasa Indonesia', allowCreate: false })).language.code, 'id');
    assert.equal((await resolveLanguage(db, { name: 'Jepang', allowCreate: false })).language.code, 'ja');
    assert.equal((await resolveLanguage(db, { name: 'Romanian', allowCreate: false })).language.code, 'ro');

    const candidates = await db.language.findMany({ where: { code: { in: ['ak', 'id', 'ja'] } }, include: { aliases: true } });
    assert.deepEqual(parseCvText('Saya akan belajar lebih lanjut di Indonesia.', [], candidates).languages, []);
    assert.equal(parseCvText('Bahasa\nJepang B2', [], candidates).languages[0]?.code, 'ja');
    assert.equal(parseCvText('Indonesian B2', [], candidates).languages[0]?.level, 'B2');

    const recruiter = await db.user.create({ data: { role: 'RECRUITER', fullName: 'HR', email: 'hr@example.test' } });
    const candidate = await db.user.create({ data: { role: 'EMPLOYEE', fullName: 'Candidate', email: 'candidate@example.test' } });
    const profile = await db.employeeProfile.create({ data: { userId: candidate.id } });
    const company = await db.company.create({ data: { name: 'Test company', slug: 'test-company', members: { create: { userId: recruiter.id, role: 'OWNER' } } } });
    const jobs = new JobsService(db as never, { assertMember: async () => ({ company }), assertOpen: () => undefined } as never,
      {} as never, {} as never, { rankedIds: async () => null, syncJob: async () => undefined } as never, {} as never);
    const languages = [
      { code: 'en', minLevel: 'C1', isRequired: true },
      { code: 'id', minLevel: 'B2', isRequired: false },
      { code: 'ja', minLevel: 'A2', isRequired: false },
      { code: 'ace', minLevel: 'B1', isRequired: true },
    ];
    assert.equal(languages.length, JOB_LANGUAGE_LIMIT);
    const fields = { title: 'Language Test Engineer', description: 'A test vacancy with separate language requirements.', workMode: 'REMOTE', languages };
    const created = await jobs.create(recruiter as AuthUser, company.id, fields);
    assert.ok(created);
    const saved = await db.jobPostLanguage.findMany({ where: { jobPostId: created.id }, include: { language: true } });
    assert.deepEqual(saved.map(row => ({ code: row.language.code, minLevel: row.minLevel, isRequired: row.isRequired })).sort((a, b) => a.code.localeCompare(b.code)),
      [...languages].sort((a, b) => a.code.localeCompare(b.code)));
    assert.ok(saved.every(row => row.provenance === 'EMPLOYER_CONFIRMED'));
    await assert.rejects(jobs.create(recruiter as AuthUser, company.id, { ...fields, languages: [...languages, { code: 'ko' }] }), /Too many job languages/);
    await db.jobPost.update({ where: { id: created.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    assert.equal((await jobs.search({ languages: 'id:B2,ja:B2', page: 1, limit: 12, sort: 'newest' })).total, 1);
    assert.equal((await jobs.search({ languages: 'id:C1,ja:B2', page: 1, limit: 12, sort: 'newest' })).total, 0);

    const profiles: Pick<ProfilesService, 'addLanguage'> = Object.assign(Object.create(ProfilesService.prototype), { prisma: db });
    await profiles.addLanguage(candidate as AuthUser, { code: 'id', level: 'NATIVE' });
    await profiles.addLanguage(candidate as AuthUser, { code: 'ja', level: 'B2' });
    await profiles.addLanguage(candidate as AuthUser, { code: 'ja', level: 'C1' });
    assert.equal(await db.profileLanguage.count({ where: { profileId: profile.id } }), 2);
    assert.equal((await db.profileLanguage.findFirst({ where: { profileId: profile.id, language: { code: 'ja' } } }))?.level, 'C1');

    const resume = await db.resume.create({ data: { profileId: profile.id, title: 'Test CV' } });
    const version = await db.resumeVersion.create({ data: { resumeId: resume.id, fileKey: 'test.pdf', parseStatus: 'READY' } });
    await db.resume.update({ where: { id: resume.id }, data: { currentVersionId: version.id } });
    await db.resumeEmployeeEvidence.create({ data: {
      versionId: version.id, status: 'READY', generation: version.parseGeneration, parserVersion: employeeEvidenceParserVersion([]),
      facts: { roles: [], skills: [], experiences: [], languages: [] },
    } });
    const evidence = new EmployeeEvidenceService(db as never, {} as never, {} as never, { get: async () => ({ roles: [] }) } as never);
    const add = (key: string, revision: number, code: string, level: string) => evidence.patch(candidate.id, resume.id, version.id,
      { key, revision, value: { code, level }, kind: 'LANGUAGE', operation: 'UPSERT' });
    await add('user:1', 0, 'id', 'NATIVE');
    const updated = await add('user:2', 1, 'ja', 'B2');
    assert.deepEqual(updated.facts?.languages.map(row => [row.code, row.level, row.confirmed]), [['id', 'NATIVE', true], ['ja', 'B2', true]]);
    await assert.rejects(add('user:3', 2, 'ja', 'C1'), /CV_LANGUAGE_DUPLICATE/);
    assert.equal((await add('user:2', 2, 'ja', 'C1')).facts?.languages[1]?.level, 'C1');
    console.log('Language catalog, multiple HR and candidate entries, search, and CV regressions passed');
  } finally { await db.$disconnect(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
