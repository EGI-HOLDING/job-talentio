import { Prisma, type PrismaClient } from '@prisma/client';
import { buildCandidatePreparation, candidateEvidence, type CandidateJob } from './candidate-preparation';
import { isCurrentConversation } from './conversation.policy';
import { enqueueWork } from './screening-packets.service';
import { json } from './screening.policy';
import type { PackagePayload } from './screening.schemas';
import { frozenRoleRubric } from './role-rubric';
import { attachLiveRoleTopics } from './tara-live-agenda';

export const candidatePreparationInclude = {
    package: true,
    resumeVersion: { include: { screeningSource: true } },
    session: { include: { profile: { select: { user: { select: { fullName: true, isBanned: true, anonymizedAt: true } } } },
        invitation: { include: { candidate: { select: { stage: true, company: { select: { isBanned: true, anonymizedAt: true } } } } } },
        job: { select: { company: { select: { isBanned: true, anonymizedAt: true } } } },
    } },
} satisfies Prisma.AiCandidatePlanInclude;
type CandidatePlan = Prisma.AiCandidatePlanGetPayload<{ include: typeof candidatePreparationInclude }>;

export function pendingCandidateDraft(plan: CandidatePlan) {
    const { session } = plan, invite = session.invitation, account = session.profile.user, company = session.job.company;
    return session.status === 'DRAFT' && !session.startedAt && session.currentPlanId === plan.id &&
        session.packageId === plan.packageId && session.resumeVersionId === plan.resumeVersionId &&
        !account.isBanned && !account.anonymizedAt && !company.isBanned && !company.anonymizedAt &&
        (!invite || (invite.packageId === plan.packageId && invite.status === 'INVITED' && invite.expiresAt > new Date() &&
            !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(invite.candidate.stage)));
}

export function candidatePreparationInput(plan: CandidatePlan) {
    const source = plan.resumeVersion.screeningSource;
    if (!source?.text?.trim() || source.status !== 'READY' || !plan.package.payload || plan.package.status !== 'READY') return null;
    return { segments: candidateEvidence(source.text, plan.session.profile.user.fullName),
        rubric: plan.package.payload as unknown as PackagePayload, job: plan.package.jobSnapshot as unknown as CandidateJob };
}

export async function publishCandidatePreparation(db: PrismaClient, before: CandidatePlan, workId: string,
    prepared: ReturnType<typeof buildCandidatePreparation>, options: { owner?: string; reconcileIds?: string[] }) {
    return db.$transaction(async tx => {
        if (before.session.invitation) await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${before.session.invitation.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${before.sessionId} FOR UPDATE`;
        const retained = await tx.aiCandidatePlan.findUnique({ where: { id: before.id }, include: candidatePreparationInclude });
        if (retained && retained.session.currentPlanId !== before.id) {
            await tx.aiCandidatePlan.updateMany({ where: { id: before.id, status: { in: ['PENDING', 'RUNNING'] } }, data: { status: 'SUPERSEDED' } });
            return 'SKIPPED';
        }
        if (!retained || !pendingCandidateDraft(retained) || retained.status === 'READY' || retained.status === 'SUPERSEDED') return 'SKIPPED';
        const source = retained.resumeVersion.screeningSource, previous = before.resumeVersion.screeningSource;
        if (!source || !previous || source.status !== 'READY' || source.checksum !== previous.checksum || +source.updatedAt !== +previous.updatedAt ||
            retained.package.status !== 'READY' || !isCurrentConversation(retained.package.conversationPolicy) ||
            retained.session.revision !== before.session.revision) return 'CHANGED';
        const claimed = await tx.aiScreeningWork.updateMany({ where: { id: workId, kind: 'CANDIDATE', subjectId: before.id,
            ...(options.owner ? { status: 'RUNNING', leaseOwner: options.owner, leaseUntil: { gt: new Date() } } : { status: 'FAILED' }) },
            data: { status: 'DONE', leaseOwner: null, leaseUntil: null, error: null } });
        if (!claimed.count) return 'SKIPPED';
        for (const callId of options.reconcileIds ?? []) await enqueueWork(tx, 'CANDIDATE_RESPONSE', callId);
        const packet = retained.package.payload as unknown as PackagePayload;
        const payload = attachLiveRoleTopics(prepared.payload, frozenRoleRubric(retained.package.jobSnapshot), packet.liveAgenda);
        await tx.aiCandidatePlan.update({ where: { id: before.id }, data: { status: 'READY', payload: json(payload), error: null } });
        await tx.aiScreeningSession.update({ where: { id: before.sessionId }, data: { revision: { increment: 1 }, error: null } });
        return 'READY';
    });
}

const recoverablePreparationErrors = [
    'Ungrounded CV skill', 'Ungrounded CV claim', 'Ungrounded evidence requirement', 'Invalid alternative criterion',
    'Invalid CV claim', 'Invalid candidate plan', 'INVALID_CONVERSATION_OPENING', 'TARA_INVALID_OUTPUT', 'TARA_RETRY_LIMIT',
];

export async function recoverFailedCandidatePreparations(db: PrismaClient, apply: boolean) {
    const report = { inspected: 0, eligible: 0, skipped: 0, recovered: 0, claims: 0, alternatives: 0, proposals: 0, rejected: 0, storedResponses: 0 };
    let cursor: string | undefined;
    for (;;) {
        const plans: CandidatePlan[] = await db.aiCandidatePlan.findMany({ where: { status: 'FAILED',
            error: { in: recoverablePreparationErrors }, session: { status: 'DRAFT', startedAt: null },
            ...(cursor ? { id: { gt: cursor } } : {}) },
            include: candidatePreparationInclude, orderBy: { id: 'asc' }, take: 50 });
        if (!plans.length) return report;
        cursor = plans.at(-1)!.id;
        for (const plan of plans) {
            report.inspected++;
            const context = pendingCandidateDraft(plan) && isCurrentConversation(plan.package.conversationPolicy) ? candidatePreparationInput(plan) : null;
            if (!context) { report.skipped++; continue; }
            const work = await db.aiScreeningWork.findUnique({ where: { key: 'CANDIDATE:' + plan.id } });
            if (!work || work.status !== 'FAILED') { report.skipped++; continue; }
            const calls = await db.aiScreeningCall.findMany({ where: { workId: work.id, subjectId: plan.sessionId, task: 'candidate',
                promptVersion: plan.promptVersion, status: { in: ['INVALID', 'COMPLETED'] }, result: { not: Prisma.DbNull } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
            const assembled = buildCandidatePreparation(context.segments, context.rubric, context.job, calls.map(call => call.result), { recoverStored: true });
            report.eligible++;
            report.storedResponses += calls.length;
            report.claims += assembled.payload.claims.length;
            report.alternatives += Number(!assembled.payload.claims.length);
            report.proposals += assembled.proposals;
            report.rejected += assembled.rejected;
            if (apply && await publishCandidatePreparation(db, plan, work.id, assembled, {}) === 'READY') report.recovered++;
        }
    }
}
