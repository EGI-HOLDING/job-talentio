import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { recruiterJobInclude } from '../matching/recruiter-matching.service';
import { hash, json, normalizedText, screeningEnabled, PDF_TEMPLATE_VERSION } from './screening.policy';
import { freezePromptRegistry } from './prompts/registry';
import { isCurrentConversation, newConversationPolicy } from './conversation.policy';
export async function enqueueWork(db: Pick<Prisma.TransactionClient, 'aiScreeningWork'>, kind: string, subjectId: string, key = kind + ':' + subjectId) {
    return db.aiScreeningWork.upsert({ where: { key }, create: { key, kind, subjectId }, update: {} });
}
export async function enqueueEvaluationPdf(db: Pick<Prisma.TransactionClient, 'aiScreeningWork'>, sessionId: string, inputHash: string | null, legacyKeys: string[] = []) {
    const key = 'PDF:' + sessionId + ':' + (inputHash ?? 'legacy') + ':' + PDF_TEMPLATE_VERSION;
    if (legacyKeys.length) {
        const existing = await db.aiScreeningWork.findFirst({ where: { key: { in: [key, ...legacyKeys] }, status: { not: 'DONE' } }, orderBy: { createdAt: 'asc' } });
        if (existing) return existing;
    }
    return enqueueWork(db, 'PDF', sessionId, key);
}

@Injectable()
export class ScreeningPackets {
    private cursor: string | undefined;
    constructor(private db: PrismaService) { }
    async sync(jobId: string, invited = false) {
        if (!screeningEnabled())
            return null;
        return this.db.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
            const job = await tx.jobPost.findUnique({ where: { id: jobId }, include: { ...recruiterJobInclude, company: true, benefit: true } });
            if (!job || job.company.isBanned || job.company.anonymizedAt || !invited && (job.status !== 'PUBLISHED' || Boolean(job.benefit?.expiresAt && job.benefit.expiresAt <= new Date())))
                return null;
            const document = await tx.aiCompanyDocument.findFirst({ where: { companyId: job.companyId, status: 'READY' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
            const company = { name: job.company.name, description: job.company.description, industryId: job.company.industryId, profile: document?.text ?? null, profileChecksum: document?.checksum ?? null };
            const policy = newConversationPolicy();
            const source = { title: normalizedText(job.title), description: normalizedText(job.description), jobTitleId: job.jobTitleId, experienceLevel: job.experienceLevel, experienceYearsMin: job.experienceYearsMin,
                responsibilities: job.responsibilities.map(normalizedText),
                skills: job.jobSkills.map(s => ({ skillId: s.skillId, name: s.skill.name, isRequired: s.isRequired, minLevel: s.minLevel })).sort((a, b) => a.skillId.localeCompare(b.skillId)),
                languages: job.jobLanguages.map(l => ({ code: l.language.code, minLevel: l.minLevel, isRequired: l.isRequired, provenance: l.provenance })).sort((a, b) => a.code.localeCompare(b.code)), company };
            const promptSnapshot = freezePromptRegistry();
            const fingerprint = hash([source, policy.version, promptSnapshot, policy]);
            const found = await tx.aiScreeningPackage.findUnique({ where: { jobId_fingerprint: { jobId, fingerprint } } });
            if (found)
                return found;
            const previous = await tx.aiScreeningPackage.aggregate({ where: { jobId }, _max: { version: true } });
            const packet = await tx.aiScreeningPackage.create({ data: { jobId, fingerprint, version: (previous._max.version ?? 0) + 1, jobSnapshot: json(job), companySnapshot: json(company), promptVersion: policy.version, promptSnapshot: json(promptSnapshot), conversationPolicy: json(policy) } });
            await enqueueWork(tx, 'PREPARE', packet.id);
            return packet;
        }, { timeout: 15000 });
    }
    async currentInvitationPacket(id: string) {
        const frozen = await this.db.aiScreeningPackage.findUniqueOrThrow({ where: { id } });
        if (isCurrentConversation(frozen.conversationPolicy)) return frozen;
        if (!screeningEnabled()) return null;
        const policy = newConversationPolicy(), prompts = freezePromptRegistry();
        const fingerprint = hash(['invitation-policy-upgrade', frozen.fingerprint, policy, prompts]);
        return this.db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "JobPost" WHERE id=${frozen.jobId} FOR UPDATE`;
            const found = await tx.aiScreeningPackage.findUnique({ where: { jobId_fingerprint: { jobId: frozen.jobId, fingerprint } } });
            if (found) {
                if (found.status !== 'SUPERSEDED') return found;
                await tx.aiScreeningWork.updateMany({ where: { key: 'PREPARE:' + found.id, status: 'DONE' },
                    data: { status: 'PENDING', availableAt: new Date() } });
                return tx.aiScreeningPackage.update({ where: { id: found.id }, data: { status: 'PENDING', error: null } });
            }
            const previous = await tx.aiScreeningPackage.aggregate({ where: { jobId: frozen.jobId }, _max: { version: true } });
            const packet = await tx.aiScreeningPackage.create({ data: { jobId: frozen.jobId, fingerprint, version: (previous._max.version ?? 0) + 1,
                jobSnapshot: json(frozen.jobSnapshot), companySnapshot: json(frozen.companySnapshot), promptVersion: policy.version,
                promptSnapshot: json(prompts), conversationPolicy: json(policy) } });
            await enqueueWork(tx, 'PREPARE', packet.id);
            return packet;
        });
    }
    async available(jobId: string, invited = false) {
        const job = await this.db.jobPost.findUnique({ where: { id: jobId }, include: { company: { select: { isBanned: true, anonymizedAt: true } }, benefit: true } });
        if (!job || job.company.isBanned || job.company.anonymizedAt || !invited && (job.status !== 'PUBLISHED' || Boolean(job.benefit?.expiresAt && job.benefit.expiresAt <= new Date())))
            throw new NotFoundException('Lowongan ini sudah tidak menerima lamaran.');
        return job;
    }
    async reconcile() {
        if (!screeningEnabled())
            return;
        // Bounded discovery also repairs outbox creation after a process restart.
        // Existing jobs refresh lazily on candidate selection. A prompt release must
        // not regenerate every old context in the background.
        const jobs = await this.db.jobPost.findMany({ where: { status: 'PUBLISHED', screeningPackages: { none: {} } }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}) });
        this.cursor = jobs.length === 100 ? jobs[jobs.length - 1].id : undefined;
        for (const job of jobs)
            await this.sync(job.id);
    }
}
