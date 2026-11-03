/** Explicit, idempotent deployment tool. Dry-run is the default; never runs in seed/startup. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { employeePreferenceUpdate } from '../matching/employee-preferences';
import { EmployeeOccupationIndex, intentRoleInclude } from '../matching/employee-occupation';
import { catalogTitleIdentityKey } from '../common/title-resolve';
import { EMPLOYEE_EVIDENCE_PARSER } from '../matching/employee-intent-evidence';
const db = new PrismaClient();
async function main() {
    const apply = process.argv.includes('--apply');
    const dir = path.resolve(__dirname, '../../prisma/data');
    const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const families = read(path.join(dir, 'employee-job-families.json')) as {
        source: string;
        sourceVersion: string;
        rows: Array<{
            code: string;
            name: string;
            nameId?: string;
        }>;
    };
    if (families.rows.length !== 130 || new Set(families.rows.map(r => r.code)).size !== 130 || families.rows.some(r => !/^\d{3}$/.test(r.code)))
        throw new Error('Invalid official ISCO-08 family manifest');
    const source = read(path.join(dir, 'job-titles/audit-2026-10-24.json')) as {
        rows: Array<{
            targetId: string;
            name: string;
            source?: {
                isco08?: string;
                uri?: string;
            };
        }>;
    };
    const sourceById = new Map(source.rows.map(r => [r.targetId, r]));
    const knownCodes = new Set(families.rows.map(r => r.code));
    const stored = await db.jobTitle.findMany({ include: intentRoleInclude });
    const report: {
        mode: string;
        mappedTitles: number;
        unreviewedTitles: string[];
        unresolvedJobs: string[];
        profilesNeedingReview: string[];
        profilesMapped: number;
        queuedEvidence: number;
    } = { mode: apply ? 'APPLY' : 'DRY_RUN', mappedTitles: 0, unreviewedTitles: [], unresolvedJobs: [], profilesNeedingReview: [], profilesMapped: 0, queuedEvidence: 0 };
    const projected = stored.map(role => {
        if (role.matchingApproved || role.archivedAt)
            return role;
        if (role.canonicalRoleId) {
            report.unreviewedTitles.push(role.id);
            return role;
        }
        const source = sourceById.get(role.id);
        const code = source?.source?.isco08?.slice(0, 3);
        if (!code || !knownCodes.has(code) || !source?.source?.uri || !source.source.uri.startsWith('http://data.europa.eu/esco/occupation/') || catalogTitleIdentityKey(role.name) !== catalogTitleIdentityKey(source.name)) {
            report.unreviewedTitles.push(role.id);
            return role;
        }
        report.mappedTitles++;
        const family = { id: 'isco:' + code, name: families.rows.find(f => f.code === code)!.name, archivedAt: null };
        return { ...role, familyId: family.id, family, matchingApproved: true };
    });
    let index = new EmployeeOccupationIndex(projected);
    if (apply) {
        report.mappedTitles = 0;
        await db.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql `SELECT pg_advisory_xact_lock(742159744)`);
            for (const family of families.rows)
                await tx.jobFamily.upsert({ where: { id: 'isco:' + family.code }, create: { id: 'isco:' + family.code, code: family.code, name: family.name, nameId: family.nameId ?? null, source: families.source, sourceVersion: families.sourceVersion }, update: {} });
            for (const row of projected)
                if (row.matchingApproved && !stored.find(s => s.id === row.id)!.matchingApproved) {
                    const changed = await tx.jobTitle.updateMany({ where: { id: row.id, matchingApproved: false, archivedAt: null, name: row.name, nameId: row.nameId, nameUz: row.nameUz, nameRu: row.nameRu, canonicalRoleId: null }, data: { familyId: row.familyId, matchingApproved: true } });
                    report.mappedTitles += changed.count;
                }
        }, { timeout: 60000 });
        index = new EmployeeOccupationIndex(await db.jobTitle.findMany({ include: intentRoleInclude }));
    }
    const jobs = await db.jobPost.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, title: true, jobTitleId: true } });
    for (const job of jobs) {
        const role = job.jobTitleId ? index.identity(job.jobTitleId) : null;
        const id = job.jobTitleId ? null : index.resolve(job.title);
        if (!role && !id)
            report.unresolvedJobs.push(job.id);
        if (apply && id)
            await db.jobPost.updateMany({ where: { id: job.id, jobTitleId: null, title: job.title }, data: { jobTitleId: id } });
    }
    const profiles = await db.employeeProfile.findMany({ select: { id: true, desiredPositions: true, desiredPosition: true, matchingPreferencesReviewed: true } });
    for (const profile of profiles) {
        if (profile.matchingPreferencesReviewed)
            continue;
        const texts = profile.desiredPositions.length ? profile.desiredPositions : profile.desiredPosition ? [profile.desiredPosition] : [];
        if (!texts.length || texts.some(text => !index.resolve(text))) {
            report.profilesNeedingReview.push(profile.id);
            continue;
        }
        report.profilesMapped++;
        if (apply)
            await db.$transaction(async (tx) => { await tx.$queryRaw(Prisma.sql `SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`); const current = await tx.employeeProfile.findUniqueOrThrow({ where: { id: profile.id } }); if (!current.matchingPreferencesReviewed)
                await tx.employeeProfile.update({ where: { id: profile.id }, data: await employeePreferenceUpdate(tx, { desiredPositions: current.desiredPositions.length ? current.desiredPositions : current.desiredPosition ? [current.desiredPosition] : [] }) }); });
    }
    // Optional reviewed skill classifications are explicit IDs, never guessed from CV wording.
    const skillsArg = process.argv.indexOf('--skill-manifest');
    if (skillsArg >= 0) {
        const skills = read(process.argv[skillsArg + 1]) as Array<{
            id: string;
            matchingKind: 'PROFESSIONAL' | 'GENERAL';
            reviewedBy: string;
        }>;
        if (skills.some(s => !s.reviewedBy?.trim() || !['PROFESSIONAL', 'GENERAL'].includes(s.matchingKind)))
            throw new Error('Skill classifications require an identified reviewer');
        if (apply)
            for (const skill of skills)
                await db.skill.update({ where: { id: skill.id }, data: { matchingKind: skill.matchingKind } });
    }
    if (apply) {
        const versions = await db.resumeVersion.findMany({ where: { parseStatus: 'READY', currentFor: { is: { isPrimary: true, deletedAt: null } }, employeeEvidence: { is: null } }, select: { id: true, parseGeneration: true } });
        for (const version of versions) {
            await db.resumeEmployeeEvidence.upsert({ where: { versionId: version.id }, create: { versionId: version.id, generation: version.parseGeneration, parserVersion: EMPLOYEE_EVIDENCE_PARSER }, update: {} });
            report.queuedEvidence++;
        }
    }
    console.log(JSON.stringify(report, null, 2));
}
void main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
