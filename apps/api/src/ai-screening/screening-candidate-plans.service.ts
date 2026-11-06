import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { registerCvVersion } from '../profiles/cv-evidence';
import { ScreeningPackets, enqueueWork } from './screening-packets.service';
import { hash } from './screening.policy';
@Injectable()
export class ScreeningCandidatePlans {
    constructor(private db: PrismaService, private packets: ScreeningPackets) { }
    async request(sessionId: string) {
        const row = await this.db.aiScreeningSession.findUnique({ where: { id: sessionId } });
        if (!row || row.status !== 'DRAFT' || !row.resumeId)
            return null;
        const packet = await this.packets.sync(row.jobId);
        if (!packet)
            return null;
        return this.db.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "AiScreeningSession" WHERE id=${sessionId} FOR UPDATE`);
            const current = await tx.aiScreeningSession.findUniqueOrThrow({ where: { id: sessionId }, include: { package: true, currentPlan: true } });
            if (current.status !== 'DRAFT' || !current.resumeId)
                return null;
            if (current.package && current.package.version > packet.version) return current.currentPlan;
            const resume = await tx.resume.findFirst({ where: { id: current.resumeId, profileId: current.profileId, deletedAt: null, fileKey: { not: null } } });
            if (!resume?.fileKey)
                return null;
            const version = await registerCvVersion(tx, resume.id, resume.fileKey);
            await tx.aiCvSource.upsert({ where: { versionId: version.id }, create: { versionId: version.id, checksum: version.checksum ?? '' }, update: {} });
            await enqueueWork(tx, 'CV_SOURCE', version.id);
            const fingerprint = hash([version.id, version.fileKey, packet.fingerprint, packet.promptVersion]);
            let plan = await tx.aiCandidatePlan.upsert({ where: { sessionId_fingerprint: { sessionId, fingerprint } }, create: { sessionId, packageId: packet.id, resumeVersionId: version.id, fingerprint, promptVersion: packet.promptVersion }, update: {} });
            if (plan.status === 'SUPERSEDED') {
                plan = await tx.aiCandidatePlan.update({ where: { id: plan.id }, data: { status: plan.payload ? 'READY' : 'PENDING', error: null } });
                await tx.aiScreeningWork.updateMany({ where: { key: 'CANDIDATE:' + plan.id, status: 'DONE' }, data: { status: 'PENDING', availableAt: new Date() } });
            }
            await tx.aiScreeningSession.update({ where: { id: sessionId }, data: { currentPlanId: plan.id, packageId: packet.id, resumeVersionId: version.id, error: null, ...(current.currentPlanId !== plan.id ? { revision: { increment: 1 } } : {}) } });
            await enqueueWork(tx, 'CANDIDATE', plan.id);
            return plan;
        });
    }
}
