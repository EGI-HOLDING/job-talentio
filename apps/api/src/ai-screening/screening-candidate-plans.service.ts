import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { registerCvVersion } from '../profiles/cv-evidence';
import { ScreeningPackets, enqueueWork } from './screening-packets.service';
import { hash, json } from './screening.policy';
import { isCurrentConversation } from './conversation.policy';
import { freezeTakaInterview } from './taka-interview';

export function candidatePlanFingerprint(version: { id: string; fileKey: string },
    packet: { fingerprint: string; promptVersion: string }, invite?: { snapshot: unknown } | null) {
    return hash([version.id, version.fileKey, packet.fingerprint, packet.promptVersion,
        ...(invite ? ['invitation-cv', (invite.snapshot as {cvText?: unknown} | null)?.cvText] : [])]);
}

@Injectable()
export class ScreeningCandidatePlans {
    constructor(private db: PrismaService, private packets: ScreeningPackets) { }
    async request(sessionId: string) {
        const row = await this.db.aiScreeningSession.findUnique({ where: { id: sessionId }, include: { invitation: true } });
        if (!row || row.status !== 'DRAFT' || !row.resumeId)
            return null;
        const packet = row.invitation ? await this.packets.currentInvitationPacket(row.invitation.packageId) : await this.packets.sync(row.jobId);
        if (!packet)
            return null;
        return this.db.$transaction(async (tx) => {
            if (row.invitation) await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${row.invitation.id} FOR UPDATE`;
            await tx.$queryRaw(Prisma.sql `SELECT id FROM "AiScreeningSession" WHERE id=${sessionId} FOR UPDATE`);
            const current = await tx.aiScreeningSession.findUniqueOrThrow({ where: { id: sessionId }, include: { package: true, currentPlan: true } });
            if (current.status !== 'DRAFT' || !current.resumeId)
                return null;
            if (current.package && isCurrentConversation(current.package.conversationPolicy) && current.package.version > packet.version) return current.currentPlan;
            const invite = row.invitation ? await tx.screeningInvitation.findUnique({ where: { id: row.invitation.id } }) : null;
            if (row.invitation && (!invite || invite.status !== 'INVITED' || invite.sessionId !== sessionId || invite.expiresAt <= new Date())) return null;
            const resume = await tx.resume.findFirst({ where: { id: current.resumeId, profileId: current.profileId,
                ...(invite ? {} : { deletedAt: null, fileKey: { not: null } }) } });
            if (!resume) return null;
            const version = invite
                ? await tx.resumeVersion.findFirst({ where: { id: current.resumeVersionId ?? '', resumeId: resume.id } })
                : await registerCvVersion(tx, resume.id, resume.fileKey!);
            if (!version) return null;
            if (invite) {
                const snapshot = invite.snapshot as Record<string, unknown>;
                if (invite.packageId !== packet.id || !snapshot.takaInterviewAssessment) await tx.screeningInvitation.update({ where: { id: invite.id }, data: {
                    packageId: packet.id, snapshot: json({ ...snapshot, takaInterviewAssessment: snapshot.takaInterviewAssessment ?? freezeTakaInterview() }),
                } });
            } else {
                await tx.aiCvSource.upsert({ where: { versionId: version.id }, create: { versionId: version.id, checksum: version.checksum ?? '' }, update: {} });
                await enqueueWork(tx, 'CV_SOURCE', version.id);
            }
            const fingerprint = candidatePlanFingerprint(version, packet, invite);
            let plan = await tx.aiCandidatePlan.upsert({ where: { sessionId_fingerprint: { sessionId, fingerprint } }, create: { sessionId, packageId: packet.id, resumeVersionId: version.id, fingerprint, promptVersion: packet.promptVersion }, update: {} });
            if (plan.status === 'SUPERSEDED') {
                plan = await tx.aiCandidatePlan.update({ where: { id: plan.id }, data: { status: plan.payload ? 'READY' : 'PENDING', error: null } });
                await tx.aiScreeningWork.updateMany({ where: { key: 'CANDIDATE:' + plan.id, status: 'DONE' }, data: { status: 'PENDING', availableAt: new Date() } });
            }
            if (current.currentPlanId !== plan.id || current.packageId !== packet.id || current.resumeVersionId !== version.id || current.error)
                await tx.aiScreeningSession.update({ where: { id: sessionId }, data: { currentPlanId: plan.id, packageId: packet.id,
                    resumeVersionId: version.id, error: null, ...(current.currentPlanId !== plan.id ? { revision: { increment: 1 } } : {}) } });
            await enqueueWork(tx, 'CANDIDATE', plan.id);
            return plan;
        });
    }
}
