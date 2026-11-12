import type { PrismaService } from '../prisma/prisma.service';
import type { CandidatePayload, PackagePayload } from './screening.schemas';
import type { PromptPreset } from './prompts/compose';
import { AiPending, AiUncertain, type ScreeningClient } from './screening.client';
import { enqueueEvaluationPdf } from './screening-packets.service';
import { combineScores, hash, json } from './screening.policy';
import { acceptTakaJudgements, prepareTakaEvidence, scoreTakaInterview, takaEvaluationRequest } from './taka-interview';
import type { taraInterviewReport } from './tara-interview';
import { invalidateHrRanking } from '../matching/recruiter-ranking.service';

export async function evaluateTakaInterview(
    db: PrismaService, client: ScreeningClient, workId: string,
    session: { id: string; revision: number; currentPlanId: string | null; applicationId: string | null },
    invitation: { id: string; snapshot: unknown } | null,
    preset: PromptPreset, plan: CandidatePayload, turns: Parameters<typeof prepareTakaEvidence>[1],
    { interrupted, notes, owner, voice, rubric, applicationCv }: { interrupted: boolean; notes?: ReturnType<typeof taraInterviewReport>; owner?: string;
        rubric: PackagePayload;
        applicationCv?: { assessable: boolean; total: number } | null;
        voice?: { closeReason: string | null; transcriptComplete: boolean; durationSeconds: number } },
) {
    const inputHash = hash([preset, session.currentPlanId, plan, rubric, turns, interrupted, notes, voice, applicationCv]);
    const previous = await db.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
    if (previous?.result && previous.inputHash === inputHash) return;
    if (await db.aiScreeningCall.count({ where: { subjectId: session.id, task: 'evaluate',
        promptVersion: { not: preset.version }, status: { in: ['RUNNING', 'UNCERTAIN'] } } }))
        throw new AiUncertain('Taka masih merekonsiliasi penilaian terdahulu.');

    const evidence = prepareTakaEvidence(plan, turns, rubric.criteria);
    async function assess(claims: CandidatePayload['claims']) {
        const request = takaEvaluationRequest(preset, evidence, claims);
        const raw = await client.run(workId, session.id, 'evaluate', request.data, request.preset);
        return acceptTakaJudgements(evidence, claims.map(claim => claim.id), raw);
    }
    let judgements: Awaited<ReturnType<typeof assess>> = new Map();
    if (plan.claims.length && evidence.catalog.length) {
        judgements = await assess(plan.claims);
        const unresolved = plan.claims.filter(claim => !judgements.has(claim.id));
        // Reuse accepted rows on restart. A repair with the same input would repeat the same invalid result.
        if (unresolved.length && unresolved.length < plan.claims.length) {
            try {
                for (const [id, row] of await assess(unresolved)) judgements.set(id, row);
            } catch (error) {
                if (error instanceof AiPending) throw error;
                // Retain the valid assessment if a targeted repair fails or its delivery is uncertain.
            }
        }
    }
    const { result, score, coverage } = scoreTakaInterview(evidence, judgements, interrupted, notes);
    const frozen = invitation?.snapshot as { cvScore?: number | null; cvResult?: unknown } | undefined;
    const cvScore = invitation ? frozen?.cvScore ?? null : applicationCv?.assessable ? applicationCv.total : null;
    const cvBreakdown = invitation ? frozen?.cvResult : applicationCv;
    const finalScore = invitation || coverage.state !== 'COMPLETE' ? null : combineScores(cvScore, score);
    const payload = voice ? { ...result, voice: { ...voice, partial: interrupted,
        testedClaims: coverage.assessedClaims, totalClaims: coverage.plannedClaims } } : result;
    await db.$transaction(async tx => {
        if (invitation) {
            await tx.$queryRaw`SELECT id FROM "ScreeningInvitation" WHERE id=${invitation.id} FOR UPDATE`;
            const currentInvite = await tx.screeningInvitation.findUnique({ where: { id: invitation.id }, select: { status: true, sessionId: true } });
            if (currentInvite?.sessionId !== session.id || currentInvite.status !== 'COMPLETED') return;
        }
        await tx.$queryRaw`SELECT id FROM "AiScreeningSession" WHERE id=${session.id} FOR UPDATE`;
        const currentSession = await tx.aiScreeningSession.findUnique({ where: { id: session.id },
            select: { revision: true, currentPlanId: true, status: true, applicationId: true } });
        if (currentSession?.status !== (invitation ? 'COMPLETED' : 'SUBMITTED') || currentSession.applicationId !== session.applicationId ||
            currentSession.revision !== session.revision ||
            currentSession.currentPlanId !== session.currentPlanId) return;
        if (owner && !(await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AiScreeningWork"
            WHERE id=${workId} AND "leaseOwner"=${owner} AND status='RUNNING' FOR UPDATE`).length) return;
        const current = await tx.aiScreeningEvaluation.findUnique({ where: { sessionId: session.id } });
        if (current?.inputHash !== inputHash) {
            const data = { status: ['COMPLETE', 'ALTERNATIVE'].includes(coverage.state) ? 'READY' : 'NEEDS_REVIEW',
                promptVersion: preset.version, inputHash, model: preset.model, result: json(payload), error: null,
                cvScore, ...(cvBreakdown ? { cvBreakdown: json(cvBreakdown) } : {}),
                screeningScore: score, finalScore, pdfKey: null, pdfVersion: null };
            const saved = await tx.aiScreeningEvaluation.upsert({ where: { sessionId: session.id },
                create: { sessionId: session.id, ...data }, update: data });
            await tx.aiScreeningEvaluationRevision.upsert({ where: { evaluationId_inputHash: { evaluationId: saved.id, inputHash } },
                create: { evaluationId: saved.id, inputHash, promptVersion: preset.version, snapshot: json({ ...saved, promptSnapshot: preset }) },
                update: {} });
        }
        await enqueueEvaluationPdf(tx, session.id, inputHash);
    });
    invalidateHrRanking();
}
