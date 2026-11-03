import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { EmployeeEvidencePatch } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { extractCvText } from '../profiles/parse/cv-text-extract';
import { EmployeeOccupationIndex, intentRoleInclude } from './employee-occupation';
import { EMPLOYEE_EVIDENCE_PARSER, applyEmployeeOverrides, evidenceConflicts, hasEmployeeCareerEvidence, parseEmployeeEvidence, type IntentFacts, type EvidenceOverride } from './employee-intent-evidence';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(+new Date(s)) && new Date(s).toISOString().slice(0, 10) === s).nullable();
const validators = {
    SKILL: z.object({ skillId: z.string().min(1), level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).nullable().default(null) }).strict(),
    ROLE: z.object({ jobTitleId: z.string().min(1), title: z.string().min(1).max(160) }).strict(),
    EXPERIENCE: z.object({ title: z.string().min(1).max(160), jobTitleId: z.string().nullable(), startDate: date, endDate: date, isCurrent: z.boolean(), seniority: z.enum(['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE']).nullable() }).strict(),
    LANGUAGE: z.object({ code: z.string().min(2).max(10), level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE']).nullable() }).strict(),
};
@Injectable()
export class EmployeeEvidenceService {
    private working = false;
    constructor(private db: PrismaService, private storage: StorageService, private config: ConfigService) { }
    async recover() {
        if (this.working || !['shadow', 'enabled'].includes(process.env.EMPLOYEE_INTENT_V3_MODE ?? 'off'))
            return;
        this.working = true;
        try {
            await this.db.resumeEmployeeEvidence.updateMany({ where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 240000) } }, data: { status: 'PENDING', error: null } });
            const missing = await this.db.resumeVersion.findMany({ where: { parseStatus: 'READY', currentFor: { is: { deletedAt: null, isPrimary: true } }, OR: [{ employeeEvidence: { is: null } }, { employeeEvidence: { is: { parserVersion: { not: EMPLOYEE_EVIDENCE_PARSER } } } }] }, take: 2, orderBy: { updatedAt: 'asc' }, select: { id: true, parseGeneration: true } });
            for (const version of missing)
                await this.db.resumeEmployeeEvidence.upsert({ where: { versionId: version.id }, create: { versionId: version.id, generation: version.parseGeneration, parserVersion: EMPLOYEE_EVIDENCE_PARSER }, update: { status: 'PENDING', generation: version.parseGeneration, parserVersion: EMPLOYEE_EVIDENCE_PARSER } });
            const stale = await this.db.resumeVersion.findMany({ where: { parseStatus: 'READY', currentFor: { is: { deletedAt: null, isPrimary: true } }, employeeEvidence: { is: { status: { not: 'PROCESSING' } } } }, select: { id: true, parseGeneration: true, employeeEvidence: { select: { generation: true } } } });
            for (const version of stale)
                if (version.parseGeneration !== version.employeeEvidence!.generation)
                    await this.db.resumeEmployeeEvidence.updateMany({ where: { versionId: version.id, status: { not: 'PROCESSING' } }, data: { status: 'PENDING', generation: version.parseGeneration } });
            const pending = await this.db.resumeEmployeeEvidence.findMany({ where: { status: 'PENDING' }, take: 2, orderBy: { updatedAt: 'asc' } });
            // Sequential file extraction bounds OCR memory; durable rows are the work queue.
            for (const row of pending)
                await this.process(row.versionId, row.generation);
        }
        finally {
            this.working = false;
        }
    }
    async process(versionId: string, generation: number) {
        const claim = await this.db.resumeEmployeeEvidence.updateMany({ where: { versionId, generation, status: 'PENDING' }, data: { status: 'PROCESSING', startedAt: new Date(), error: null } });
        if (!claim.count)
            return;
        try {
            const version = await this.db.resumeVersion.findUniqueOrThrow({ where: { id: versionId }, include: { currentFor: { include: { profile: { select: { user: { select: { fullName: true } } } } } } } });
            if (version.parseGeneration !== generation || version.parseStatus !== 'READY' || !version.currentFor || version.currentFor.deletedAt)
                throw new Error('CV changed; evidence requires retry');
            const [roles, skills, languages, buffer] = await Promise.all([this.db.jobTitle.findMany({ include: intentRoleInclude }), this.db.skill.findMany({ where: { archivedAt: null }, include: { aliases: true }, orderBy: { id: 'asc' } }), this.db.language.findMany({ where: { archivedAt: null }, include: { aliases: true } }), this.storage.getObjectBuffer(version.fileKey)]);
            const parserConfig = { get: (key: string) => key === 'CV_PARSE_OCR_LANGS' ? this.config.get('EMPLOYEE_INTENT_OCR_LANGS', 'eng+ind') : this.config.get(key) } as ConfigService;
            const extracted = await extractCvText({ buffer, filename: version.fileKey.split('/').pop()!, mimeType: version.fileKey.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }, parserConfig);
            const facts = parseEmployeeEvidence(extracted.text, new EmployeeOccupationIndex(roles), skills, languages, version.currentFor.profile.user);
            await this.db.$transaction(async (tx) => {
                await tx.$queryRaw(Prisma.sql `SELECT id FROM "ResumeVersion" WHERE id=${versionId} FOR UPDATE`);
                const current = await tx.resumeVersion.findUniqueOrThrow({ where: { id: versionId } });
                if (current.parseGeneration !== generation || current.parseStatus !== 'READY')
                    return;
                await tx.resumeEmployeeEvidence.updateMany({ where: { versionId, generation, status: 'PROCESSING' }, data: { facts: facts as unknown as Prisma.InputJsonValue, status: 'READY', startedAt: null, revision: { increment: 1 }, error: null } });
            });
        }
        catch (error) {
            await this.db.resumeEmployeeEvidence.updateMany({ where: { versionId, generation, status: 'PROCESSING' }, data: { status: 'FAILED', startedAt: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Evidence processing failed' } });
        }
    }
    private async owned(db: Prisma.TransactionClient, userId: string, resumeId: string, versionId: string) {
        const resume = await db.resume.findFirst({ where: { id: resumeId, profile: { userId }, deletedAt: null, currentVersionId: versionId }, include: { currentVersion: true } });
        if (!resume)
            throw new NotFoundException('Current CV version not found');
        return resume;
    }
    async get(userId: string, resumeId: string, versionId: string) {
        const owned = await this.owned(this.db, userId, resumeId, versionId);
        const row = await this.db.resumeEmployeeEvidence.findUnique({ where: { versionId } });
        if (!row)
            return { versionId, status: 'PENDING', revision: 0, facts: null, conflicts: [] };
        if (owned.currentVersion!.parseStatus !== 'READY' || row.generation !== owned.currentVersion!.parseGeneration)
            return { versionId, status: owned.currentVersion!.parseStatus === 'FAILED' ? 'FAILED' : 'PENDING', revision: row.revision, facts: null, conflicts: [] };
        const facts = row.facts as unknown as IntentFacts | null;
        const overrides = (row.overrides ?? []) as EvidenceOverride[];
        const skillLabels = facts ? await this.db.skill.findMany({ where: { id: { in: applyEmployeeOverrides(facts, overrides).skills.map(s => s.skillId) } }, select: { id: true, name: true, nameId: true } }) : [];
        return { exclusions: overrides.filter(o => o.excluded).map(o => ({ kind: o.kind, key: o.key })), skillLabels, versionId, status: row.status, revision: row.revision, parserVersion: row.parserVersion, facts: facts ? applyEmployeeOverrides(facts, overrides) : null, conflicts: facts ? evidenceConflicts(facts, overrides) : [], hasCareerEvidence: facts ? hasEmployeeCareerEvidence(applyEmployeeOverrides(facts, overrides)) : false, error: row.status === 'FAILED' ? 'CV evidence could not be processed; retry reading the CV' : null };
    }
    async prepare(userId: string, resumeId: string, versionId: string) {
        await this.db.$transaction(async (tx) => {
            await this.owned(tx, userId, resumeId, versionId);
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "ResumeVersion" WHERE id=${versionId} FOR UPDATE`);
            const resume = await this.owned(tx, userId, resumeId, versionId);
            const version = resume.currentVersion!;
            if (version.parseStatus !== 'READY')
                return;
            const row = await tx.resumeEmployeeEvidence.findUnique({ where: { versionId } });
            if (row && row.status !== 'FAILED' && row.generation === version.parseGeneration && row.parserVersion === EMPLOYEE_EVIDENCE_PARSER)
                return;
            await tx.resumeEmployeeEvidence.upsert({ where: { versionId }, create: { versionId, generation: version.parseGeneration, parserVersion: EMPLOYEE_EVIDENCE_PARSER }, update: { generation: version.parseGeneration, parserVersion: EMPLOYEE_EVIDENCE_PARSER, status: 'PENDING', error: null } });
        });
        return this.get(userId, resumeId, versionId);
    }
    async patch(userId: string, resumeId: string, versionId: string, patch: EmployeeEvidencePatch) {
        await this.db.$transaction(async (tx) => {
            await this.owned(tx, userId, resumeId, versionId);
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "ResumeVersion" WHERE id=${versionId} FOR UPDATE`);
            const resume = await this.owned(tx, userId, resumeId, versionId);
            const row = await tx.resumeEmployeeEvidence.findUnique({ where: { versionId } });
            if (!row || row.status !== 'READY' || resume.currentVersion!.parseStatus !== 'READY' || row.generation !== resume.currentVersion!.parseGeneration || row.revision !== patch.revision)
                throw new ConflictException('CV evidence changed; reload before editing');
            const facts = row.facts as unknown as IntentFacts;
            const overrides = (row.overrides ?? []) as EvidenceOverride[];
            const collection = { SKILL: 'skills', EXPERIENCE: 'experiences', ROLE: 'roles', LANGUAGE: 'languages' } as const;
            const source = facts[collection[patch.kind]].find(e => e.key === patch.key);
            if (!source && !overrides.some(o => o.kind === patch.kind && o.key === patch.key) && !patch.key.startsWith('user:'))
                throw new BadRequestException('Unknown evidence key');
            let value: Record<string, unknown> | undefined;
            if (patch.operation === 'UPSERT') {
                const clean = validators[patch.kind].safeParse(patch.value);
                if (!clean.success)
                    throw new BadRequestException('Invalid evidence fields');
                value = clean.data;
                if (patch.kind === 'SKILL' && !await tx.skill.findFirst({ where: { id: String(value.skillId), archivedAt: null } }))
                    throw new BadRequestException('Select a catalog skill');
                if (patch.kind === 'LANGUAGE' && !await tx.language.findFirst({ where: { code: String(value.code), archivedAt: null } }))
                    throw new BadRequestException('Select a catalog language');
                if (value.jobTitleId) {
                    const index = new EmployeeOccupationIndex(await tx.jobTitle.findMany({ include: intentRoleInclude }));
                    if (!index.identity(String(value.jobTitleId)))
                        throw new BadRequestException('Select a reviewed occupation');
                    value.jobTitleId = index.identity(String(value.jobTitleId))!.canonicalRoleId;
                }
                if (patch.kind === 'EXPERIENCE') {
                    const now = new Date().toISOString().slice(0, 10);
                    if (value.startDate && String(value.startDate) > now || value.endDate && String(value.endDate) > now || value.startDate && value.endDate && String(value.endDate) < String(value.startDate) || value.isCurrent && value.endDate)
                        throw new BadRequestException('Invalid experience chronology');
                }
            }
            const next = overrides.filter(o => o.key !== patch.key || o.kind !== patch.kind);
            if (patch.operation !== 'RESET')
                next.push({ kind: patch.kind, key: patch.key, ...(patch.operation === 'EXCLUDE' ? { excluded: true } : { value }) });
            if (next.length > 500)
                throw new BadRequestException('Too many evidence corrections');
            const updated = await tx.resumeEmployeeEvidence.updateMany({ where: { versionId, revision: patch.revision, generation: row.generation, status: 'READY' }, data: { overrides: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
            if (!updated.count)
                throw new ConflictException('CV evidence changed; reload before editing');
        });
        return this.get(userId, resumeId, versionId);
    }
}
