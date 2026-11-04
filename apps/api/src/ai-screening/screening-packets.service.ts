import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { recruiterJobInclude } from '../matching/recruiter-matching.service';
import { hash, json, normalizedText, SCREENING_PROMPT_VERSION, screeningEnabled } from './screening.policy';
import { freezePromptRegistry } from './prompts/registry';
export async function enqueueWork(db: Pick<Prisma.TransactionClient, 'aiScreeningWork'>, kind: string, subjectId: string, key = kind + ':' + subjectId) {
    return db.aiScreeningWork.upsert({ where: { key }, create: { key, kind, subjectId }, update: {} });
}
@Injectable()
export class ScreeningPackets {
    private cursor: string | undefined;
    constructor(private db: PrismaService) { }
    async sync(jobId: string) {
        if (!screeningEnabled())
            return null;
        return this.db.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
            const job = await tx.jobPost.findUnique({ where: { id: jobId }, include: { ...recruiterJobInclude, company: true, benefit: true } });
            if (!job || job.status !== 'PUBLISHED' || job.company.isBanned || job.company.anonymizedAt || job.benefit?.expiresAt && job.benefit.expiresAt <= new Date())
                return null;
            const document = await tx.aiCompanyDocument.findFirst({ where: { companyId: job.companyId, status: 'READY' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
            const company = { name: job.company.name, description: job.company.description, industryId: job.company.industryId, profile: document?.text ?? null, profileChecksum: document?.checksum ?? null };
            const source = { title: normalizedText(job.title), description: normalizedText(job.description), jobTitleId: job.jobTitleId, experienceLevel: job.experienceLevel, experienceYearsMin: job.experienceYearsMin,
                skills: job.jobSkills.map(s => ({ skillId: s.skillId, name: s.skill.name, isRequired: s.isRequired, minLevel: s.minLevel })).sort((a, b) => a.skillId.localeCompare(b.skillId)),
                languages: job.jobLanguages.map(l => ({ code: l.language.code, minLevel: l.minLevel, isRequired: l.isRequired, provenance: l.provenance })).sort((a, b) => a.code.localeCompare(b.code)), company };
            const promptSnapshot = freezePromptRegistry();
            const fingerprint = hash([source, SCREENING_PROMPT_VERSION, promptSnapshot]);
            const found = await tx.aiScreeningPackage.findUnique({ where: { jobId_fingerprint: { jobId, fingerprint } } });
            if (found)
                return found;
            const previous = await tx.aiScreeningPackage.aggregate({ where: { jobId }, _max: { version: true } });
            const packet = await tx.aiScreeningPackage.create({ data: { jobId, fingerprint, version: (previous._max.version ?? 0) + 1, jobSnapshot: json(job), companySnapshot: json(company), promptVersion: SCREENING_PROMPT_VERSION, promptSnapshot: json(promptSnapshot) } });
            await enqueueWork(tx, 'PREPARE', packet.id);
            return packet;
        }, { timeout: 15000 });
    }
    async available(jobId: string) {
        const job = await this.db.jobPost.findUnique({ where: { id: jobId }, include: { company: { select: { isBanned: true, anonymizedAt: true } }, benefit: true } });
        if (!job || job.status !== 'PUBLISHED' || job.company.isBanned || job.company.anonymizedAt || job.benefit?.expiresAt && job.benefit.expiresAt <= new Date())
            throw new NotFoundException('Lowongan ini sudah tidak menerima lamaran.');
        return job;
    }
    async reconcile() {
        if (!screeningEnabled())
            return;
        // Bounded discovery also repairs outbox creation after a process restart.
        const jobs = await this.db.jobPost.findMany({ where: { status: 'PUBLISHED' }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}) });
        this.cursor = jobs.length === 100 ? jobs[jobs.length - 1].id : undefined;
        for (const job of jobs)
            await this.sync(job.id);
    }
}
